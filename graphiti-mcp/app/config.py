"""Env-var loading. All graceful-degrade: missing FalkorDB or LLM key means
the service still boots and returns 503 on tool calls instead of crashing on
import — matches the project-wide convention from CLAUDE.md."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    # FalkorDB connection. Defaults match Railway private-network conventions.
    falkordb_host: str = "falkordb.railway.internal"
    falkordb_port: int = 6379
    falkordb_username: str | None = None
    falkordb_password: str | None = None
    falkordb_database: str = "graphiti"

    # LLM client for entity/edge extraction (Graphiti calls this on add_episode).
    # We point at OpenRouter to match the rest of the stack — see CLAUDE.md
    # OpenRouter env vars.
    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    graphiti_llm_model: str = "anthropic/claude-haiku-4.5"

    # Embedder for vector similarity. Direct OpenAI; cheap + Graphiti's default.
    openai_api_key: str | None = None
    graphiti_embedder_model: str = "text-embedding-3-small"

    # Auth — shared secret with the api-server's TypeScript MCP client.
    graphiti_mcp_api_key: str | None = None

    # HTTP server.
    port: int = 8000
    log_level: str = "info"


settings = Settings()
