FROM mem0/mem0-api-server:latest

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
