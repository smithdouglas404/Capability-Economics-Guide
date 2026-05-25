"""FastAPI app that mounts the MCP server + a /health endpoint.

Auth: every request (other than /health) requires
    X-API-Key: <GRAPHITI_MCP_API_KEY>
matching the env var. Same pattern as the self-hosted Mem0 service —
see CLAUDE.md `### Mem0` section.
"""

from __future__ import annotations

import logging
import structlog
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse

from .config import settings
from .graphiti_wrapper import graphiti
from .mcp_server import mcp


# --- logging ---
logging.basicConfig(level=settings.log_level.upper())
structlog.configure(
    processors=[
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.add_log_level,
        structlog.processors.JSONRenderer(),
    ]
)
log = structlog.get_logger(__name__)


# --- lifecycle ---
@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    await graphiti.initialize()
    # FastMCP's StreamableHTTPSessionManager owns an anyio task group that
    # must be started before any request is served — when the MCP sub-app is
    # `app.mount()`ed (rather than launched via mcp.run()) the parent FastAPI
    # lifespan is the right place to drive it. Without this, every /mcp
    # request crashes with "Task group is not initialized."
    async with mcp.session_manager.run():
        yield


app = FastAPI(
    title="Graphiti World Model MCP Server",
    description=(
        "Wraps Graphiti + FalkorDB as an MCP tool surface for the "
        "Capability Economics api-server's AgentKit agents."
    ),
    version="0.1.0",
    lifespan=lifespan,
)


# --- auth middleware ---
@app.middleware("http")
async def require_api_key(request: Request, call_next):
    # /health is unauthenticated so Railway's healthcheck can hit it.
    if request.url.path == "/health":
        return await call_next(request)
    expected = settings.graphiti_mcp_api_key
    if not expected:
        # Service started without an API key — refuse to serve tool calls,
        # but don't crash. Operator-visible 503 is better than a silent open
        # endpoint.
        return JSONResponse(
            status_code=503,
            content={
                "error": "GRAPHITI_MCP_API_KEY not configured on this service",
            },
        )
    provided = request.headers.get("x-api-key") or request.headers.get("X-API-Key")
    if provided != expected:
        raise HTTPException(status_code=401, detail="invalid api key")
    return await call_next(request)


# --- routes ---
@app.get("/health")
async def health() -> dict:
    """Unauthenticated. Returns graphiti + falkordb status without leaking
    secrets. The api-server polls this from /api/health/services."""
    return {
        "status": "ok",
        "version": "0.1.0",
        "graphiti": graphiti.status(),
    }


# Mount the MCP server's streamable-http transport. FastMCP's sub-app
# already exposes the route at `/mcp` internally (settings.streamable_http_path
# default), so we mount at "/" — mounting at "/mcp" would double-prefix the
# path to /mcp/mcp. AgentKit's MCP client (createMCPClient or equivalent in
# the TypeScript SDK) points at https://<host>/mcp with X-API-Key set.
app.mount("/", mcp.streamable_http_app())
