FROM mem0/mem0-api-server:latest

# libpq5 is the runtime Postgres client lib that psycopg2 dynamically links
# against. The upstream image ships without it, so any Mem0 build that points
# at Postgres for vector/history storage fails on import with
# `libpq.so.5: cannot open shared object file`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libpq5 \
 && rm -rf /var/lib/apt/lists/*

# Mem0 self-hosted server listens on 8000 internally.
# Railway will map this to whatever public port it assigns.
EXPOSE 8000

# Required env vars (set in Railway service variables):
#   OPENAI_API_KEY   — LLM + embedder provider
#   JWT_SECRET       — signs auth tokens (generate: openssl rand -base64 48)
#   ADMIN_API_KEY    — legacy shared key; used by api-server as X-API-Key
#   AUTH_DISABLED    — set to "true" for simplified auth (internal service only)
#
# Optional — override bundled Postgres with Railway's Postgres:
#   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
