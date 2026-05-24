# graphiti-mcp

MCP-over-HTTP server wrapping [Graphiti](https://github.com/getzep/graphiti) on [FalkorDB](https://www.falkordb.com/). Exposes Graphiti's bitemporal knowledge-graph operations as MCP tools so the Capability Economics api-server's AgentKit agents (TypeScript) can call them over the network.

This service is the Phase A foundation of the world-model migration laid out in `/home/runner/.claude/plans/humble-bouncing-milner.md`. It replaces the half-used Neo4j dual-write — Postgres stays authoritative for now, while Graphiti+FalkorDB takes over as the primary substrate for capability/CVI/macro-event domain data.

## Deploying on Railway

Recommended location: the **Capability Economics** Railway project (projectId `b4a4c027-0c13-48ad-aa90-f0c8daee52cb`) so it shares a private network with the api-server, FalkorDB, and (still-running) Neo4j during cutover.

### 1. Provision FalkorDB

Add a new service from the Docker image `falkordb/falkordb:latest`. Default port `6379`. Internal hostname will be `falkordb.railway.internal` (the default in `app/config.py`). No auth needed for private-network access; add `REDIS_PASSWORD` if you want belt-and-suspenders.

### 2. Provision this service

- "Deploy from Repo" → Capability Economics repo, `graphiti-mcp/` directory.
- Railway will read `railway.toml` and use `Dockerfile`.
- Generate a public domain (Settings → Networking → Generate Domain). This is what the api-server's `GRAPHITI_MCP_URL` env var will point at.

### 3. Set env vars on this service

```
GRAPHITI_MCP_API_KEY=<openssl rand -hex 32>   # shared secret with api-server
OPENROUTER_API_KEY=<existing key>             # same one the rest of the stack uses
OPENAI_API_KEY=<existing key>                 # for embeddings (text-embedding-3-small)
FALKORDB_HOST=falkordb.railway.internal       # default; override if you renamed the service
FALKORDB_PORT=6379                            # default
GRAPHITI_LLM_MODEL=anthropic/claude-haiku-4.5 # default; OpenRouter model id
LOG_LEVEL=info
```

Graceful-degrade: if `OPENROUTER_API_KEY` or `OPENAI_API_KEY` are missing, the service still boots and `/health` returns `graphiti.connected: false` with an `init_error`. Tool calls return `{ok: false, error: "..."}`. Matches the project-wide pattern from CLAUDE.md.

### 4. Set env vars on the api-server (capabilityeconomics)

```
GRAPHITI_MCP_URL=https://<railway-public-domain>
GRAPHITI_MCP_API_KEY=<same value as on this service>
FALKORDB_URI=redis://falkordb.railway.internal:6379  # only used by backfill script
USE_GRAPHITI_WORLD_MODEL=                            # leave UNSET until cutover verified
```

### 5. Verify

```bash
curl https://<railway-public-domain>/health
# → {"status": "ok", "graphiti": {"configured": true, "connected": true, ...}}

curl -H "X-API-Key: $GRAPHITI_MCP_API_KEY" \
     https://<railway-public-domain>/mcp \
     -X POST \
     -H "Content-Type: application/json" \
     -d '{"method": "tools/list"}'
# → list of MCP tools (add_episode, search_nodes, query_cypher)
```

Then run the backfill script (`scripts/backfill-graphiti-world-model.ts`) from the api-server side to populate FalkorDB with the existing capability/dependency/CVI data.

## MCP tool surface

The three tools mounted at `/mcp` are intentionally small. The api-server's `query_graph` agent tool (added in `services/agent/tools.ts` as part of this migration) wraps them with type-safe calls.

- **`add_episode(name, episode_body, group_id, source_description, reference_time)`** — Graphiti's primary ingest API. Runs entity + edge extraction via the configured LLM. Used by `capabilityGraphSync.ts` (dual-write under flag) and the backfill script (CVI snapshots).
- **`search_nodes(query, group_ids, limit)`** — Semantic + structural search. Pass `group_ids=['global', 'user-<id>']` to search the world model and a user's subgraph in one call.
- **`query_cypher(cypher, params)`** — Escape hatch for raw Cypher. Used by the disruption cascade traversal which doesn't fit Graphiti's high-level search.

## Local development

```bash
cd graphiti-mcp
pip install -r requirements.txt
export OPENROUTER_API_KEY=...
export OPENAI_API_KEY=...
export FALKORDB_HOST=localhost
# Start FalkorDB locally:
#   docker run -d -p 6379:6379 falkordb/falkordb:latest
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## API surface stability

`graphiti-core` has been moving fast. The imports in `app/graphiti_wrapper.py` target version `>=0.7.0,<0.9.0`. If a deploy errors with `ImportError` from `graphiti_core.*`, the most likely fixes are:

- `FalkorDriver` may have been renamed to `FalkorDBDriver` — check `graphiti_core.driver.*`.
- LLM/embedder client class names may have shifted. Check `graphiti_core.llm_client.*` and `graphiti_core.embedder.*`.
- `add_episode` signature may have gained/lost params; the wrapper accepts kwargs that map to current names.

The wrapper logic (group_id partitioning, JSON return shapes, error handling) is stable regardless.
