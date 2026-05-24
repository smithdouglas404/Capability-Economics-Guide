"""FastMCP server exposing the Graphiti wrapper as MCP tools.

Mounted into the FastAPI app in main.py via streamable_http transport so
the api-server's TypeScript MCP client can call it over the network.
"""

from __future__ import annotations

import json
from typing import Any

import structlog
from mcp.server.fastmcp import FastMCP

from .graphiti_wrapper import graphiti

log = structlog.get_logger(__name__)

mcp = FastMCP("graphiti-world-model")


@mcp.tool()
async def add_episode(
    name: str,
    episode_body: str,
    group_id: str = "global",
    source_description: str = "api-server",
    reference_time: str | None = None,
) -> str:
    """Ingest an episode into Graphiti. Runs entity + edge extraction via
    the configured LLM. Pass group_id='global' for world-model facts or
    group_id='user-{id}' for per-user behavioral observations.

    reference_time should be ISO-8601 (e.g. '2026-05-24T12:00:00+00:00');
    defaults to now() if omitted."""
    try:
        result = await graphiti.add_episode(
            name=name,
            episode_body=episode_body,
            group_id=group_id,
            source_description=source_description,
            reference_time=reference_time,
        )
        return json.dumps({"ok": True, **result})
    except Exception as e:
        log.error("tool.add_episode.error", error=str(e))
        return json.dumps({"ok": False, "error": str(e)})


@mcp.tool()
async def search_nodes(
    query: str,
    group_ids: list[str] | None = None,
    limit: int = 10,
) -> str:
    """Semantic + structural search across one or more group_ids. Returns
    matching nodes with summaries. Pass group_ids=['global', 'user-{id}']
    to search the world model and a single user's subgraph in one call."""
    try:
        results = await graphiti.search_nodes(
            query=query,
            group_ids=group_ids,
            limit=limit,
        )
        return json.dumps({"ok": True, "results": results})
    except Exception as e:
        log.error("tool.search_nodes.error", error=str(e))
        return json.dumps({"ok": False, "error": str(e)})


@mcp.tool()
async def query_cypher(
    cypher: str,
    params: dict[str, Any] | None = None,
) -> str:
    """Escape hatch — execute raw Cypher against FalkorDB. Bypasses
    Graphiti's bitemporal helpers. Use only for traversals the high-level
    search API can't express (e.g. disruption cascade walks)."""
    try:
        rows = await graphiti.query_cypher(cypher, params)
        return json.dumps({"ok": True, "rows": rows})
    except Exception as e:
        log.error("tool.query_cypher.error", error=str(e))
        return json.dumps({"ok": False, "error": str(e)})
