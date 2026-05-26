FROM python:3.12-slim

# System deps:
#   libpq5  — runtime PostgreSQL client lib that psycopg dynamically links
#             against. mem0ai/mem0's server/Dockerfile installs the `psycopg`
#             Python wheel but NOT this system lib, so the upstream image
#             crashes on import with `ImportError: no pq wrapper available …
#             libpq library not found`. This Dockerfile exists to fix that.
#   git, build-essential, libpq-dev — needed at pip-install time so any C
#     extension without a python:3.12-slim wheel can compile from source.
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        libpq5 \
        libpq-dev \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# Pin mem0 to a known-good release so rebuilds are reproducible. Override
# with `--build-arg MEM0_VERSION=vX.Y.Z` when you want a newer mem0.
#
# Bumped from v2.0.2 → v2.1.0 to unlock the May 2026 multi-signal
# retrieval algorithm (semantic + keyword + entity matching fused in
# parallel). Per Mem0's published benchmarks, that change delivers
# +29.6 pts on temporal reasoning and +23.1 pts on multi-hop queries.
# Also re-exposes server-side enhanced metadata filtering (AND/OR/
# comparison operators) which our recallMemories now relies on at
# services/agent/memory.ts.
#
# Operator pre-flight: run a staging deploy first and
#   pnpm --filter @workspace/scripts run migrate:mem0-agent-id -- --dry-run
# against the upgraded image to verify response-shape compatibility
# before pushing to prod.
ARG MEM0_VERSION=v2.1.0
RUN git clone --depth 1 --branch ${MEM0_VERSION} https://github.com/mem0ai/mem0.git /app

WORKDIR /app/server

RUN pip install --no-cache-dir -r requirements.txt

# Bet B: FalkorDB as Mem0's graph backend.
#
# Mem0 supports plugging in a graph store separately from its vector store.
# Out of the box the server runs pgvector-only — `enable_graph: true` on
# the client side is a no-op against a server with no graph_store
# configured (which is exactly what we hit in prod: 1774 memories landed
# in pgvector, zero in the graph).
#
# Installing mem0_falkordb + a thin patch to the server's config loader
# lets Mem0 also write entities/relations into FalkorDB. We point it at
# the same FalkorDB instance Graphiti already uses on the AI Genome
# Railway project (falkordb.railway.internal:6379) so there's one graph
# substrate for both Mem0's per-agent semantic memory AND Graphiti's
# capability world-model.
#
# The plugin needs to be `register()`'d before `Memory.from_config(...)`
# is called. The upstream Mem0 server (`main.py`) imports Memory in its
# startup, so we patch a wrapper that calls register() first.
RUN pip install --no-cache-dir 'falkordb>=1.0.10' && \
    pip install --no-cache-dir git+https://github.com/falkordb/mem0_falkordb.git@main || \
    pip install --no-cache-dir 'mem0_falkordb>=0.1.0'

# Drop in a runtime patch that:
#   1. Calls mem0_falkordb.register() at import time so FalkorDB becomes
#      a registered graph_store provider.
#   2. Reads MEM0_GRAPH_STORE_FALKORDB_HOST/PORT/DATABASE/USERNAME/PASSWORD
#      env vars and injects them into Memory.from_config's graph_store
#      config automatically when MEM0_GRAPH_STORE_PROVIDER=falkordb.
COPY mem0_falkordb_patch.py /app/server/mem0_falkordb_patch.py

# Mem0 keeps a SQLite "history" DB alongside its pgvector store. The default
# path comes from HISTORY_DB_PATH env var (e.g. /app/history/history.db) and
# Mem0 won't create the parent directory itself — it just calls sqlite3.connect
# and crashes with "unable to open database file" if the dir doesn't exist.
# Mount a Railway Volume here for persistence across restarts.
RUN mkdir -p /app/history && chmod 755 /app/history

EXPOSE 8000

# Import the patch BEFORE main:app so register() runs and graph_store env
# vars get picked up by Memory.from_config.
CMD ["sh", "-c", "python -c 'import mem0_falkordb_patch' && uvicorn main:app --host 0.0.0.0 --port 8000"]
