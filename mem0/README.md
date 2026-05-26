# mem0 — self-hosted Mem0 with FalkorDB graph backend

Self-hosted Mem0 deployment, deployed on Railway in the **AI Genome
Project** (not Capability Economics). Exists because Mem0-Cloud's free
tier blew through the quota in May 2026; the OSS server gives us
unlimited capacity at the cost of running our own.

## What this directory contains

- `Dockerfile` — pulls Mem0 OSS v2.1.0, installs `mem0_falkordb` plugin,
  copies in the patch file, and runs `uvicorn main:app`.
- `mem0_falkordb_patch.py` — runtime patch loaded BEFORE the server
  starts. Calls `mem0_falkordb.register()` and monkey-patches
  `Memory.from_config` so the `graph_store` block is auto-injected
  when `MEM0_GRAPH_STORE_PROVIDER=falkordb`.
- `railway.toml` — Railway build config (points at the Dockerfile).

## Bet B — turning on FalkorDB as Mem0's graph backend

Before this change, Mem0 ran with `vector_store=pgvector` only. The
api-server's client code was passing `enable_graph: true` on every
`add()` and `search()` call, but the server silently dropped the flag
because no graph_store was configured. Net effect: 1774 memories landed
in pgvector, zero in any graph.

To light up the graph backend without forking upstream Mem0:

### 1. Rebuild the Docker image

```bash
cd mem0
docker build --build-arg MEM0_VERSION=v2.1.0 -t mem0-falkordb:latest .
```

Railway picks up the Dockerfile change automatically on the next deploy
of the `mem0-server` service.

### 2. Set these env vars on the `mem0-server` Railway service

```env
MEM0_GRAPH_STORE_PROVIDER=falkordb
MEM0_GRAPH_STORE_FALKORDB_HOST=falkordb.railway.internal
MEM0_GRAPH_STORE_FALKORDB_PORT=6379
MEM0_GRAPH_STORE_FALKORDB_DATABASE=mem0
```

(Username + password are optional and only needed if you've set them
on the FalkorDB service. Internal-network FalkorDB on Railway runs
unauth'd by default.)

### 3. Redeploy

Railway redeploys on env-var change. Watch the deploy logs for:

```
[mem0_falkordb_patch] register() called — falkordb graph_store available
[mem0_falkordb_patch] Memory.from_config patched to inject FalkorDB graph_store (host=falkordb.railway.internal:6379 db=mem0)
```

If you don't see those lines, the patch didn't load — check the
Dockerfile `CMD` did run `python -c 'import mem0_falkordb_patch'` first.

### 4. Verify

```bash
# /configure should now report graph_store: { provider: falkordb, ... }
curl -H "X-API-Key: $MEM0_API_KEY" https://mem0-server-production-8f56.up.railway.app/configure
```

Once verified, the api-server's existing `enable_graph: true` calls
(see `services/agent/memory.ts:354,543`) will start writing entities +
relations into the FalkorDB `mem0` graph database alongside the existing
pgvector flat-fact memories. **No api-server code change required.**

### Rollback

Unset `MEM0_GRAPH_STORE_PROVIDER` on the Railway service. The patch
becomes a no-op and Mem0 returns to vector-only mode. Any graph data
already written stays in FalkorDB until manually deleted (it doesn't
affect vector recall).

## Co-tenancy with Graphiti on the same FalkorDB

Graphiti uses FalkorDB's default graph (no database name set). This
deploy sets `MEM0_GRAPH_STORE_FALKORDB_DATABASE=mem0`, putting Mem0's
data into a separate FalkorDB database within the same Redis-backed
instance. No collision: each FalkorDB "database" is its own keyspace.

Mem0 will, per `mem0_falkordb`'s convention, further partition per
agent_id into databases named `mem0_<agent_id>` — so `cvi-autonomous-agent`,
`macro-event-agent`, etc. each get their own isolated graph. This
matches our existing per-agent isolation in the api-server's memory
service.

## Stale Mem0 Cloud / Mem0 Cloud cutover note (history)

Earlier 2026-05-17 we briefly cut over to Mem0 Cloud — the free tier
blew through its quota in 6 days (7001/5000 calls). We rolled back to
self-hosted (this deployment) on 2026-05-23 and Mem0 has lived here
since.
