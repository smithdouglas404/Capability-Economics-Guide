"""Singleton Graphiti instance with FalkorDB driver.

API note: graphiti-core's public surface has been moving fast. The imports
and class names below match graphiti-core 0.29.x (pinned in requirements.txt).
If imports break after a version bump, the most likely fix is adjusting
FalkorDriver / OpenAIClient / OpenAIEmbedder paths — the rest of the
wrapper logic is stable.
"""

from __future__ import annotations

import structlog
from typing import Any

from .config import settings

log = structlog.get_logger(__name__)


class GraphitiWrapper:
    """Lazy-initialised Graphiti wrapper. Boots even when FalkorDB/LLM keys
    are missing; surfaces the failure on first tool call instead."""

    def __init__(self) -> None:
        self._client: Any | None = None
        self._init_error: str | None = None

    async def initialize(self) -> None:
        """Connect to FalkorDB + spin up Graphiti. Called on app startup
        and again lazily if a previous attempt failed."""
        if self._client is not None:
            return
        if not settings.openrouter_api_key or not settings.openai_api_key:
            self._init_error = (
                "Graphiti needs OPENROUTER_API_KEY (for entity extraction) and "
                "OPENAI_API_KEY (for embeddings). Set both on the Railway service."
            )
            log.warning("graphiti.init.skipped", reason=self._init_error)
            return
        try:
            # NOTE: import paths below are graphiti-core 0.7-0.8 API. Update
            # if upstream renames. The 'graphiti_core' package name is stable.
            from graphiti_core import Graphiti  # type: ignore[import-not-found]
            from graphiti_core.driver.falkordb_driver import FalkorDriver  # type: ignore[import-not-found]
            from graphiti_core.llm_client.openai_client import OpenAIClient  # type: ignore[import-not-found]
            from graphiti_core.llm_client.config import LLMConfig  # type: ignore[import-not-found]
            from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig  # type: ignore[import-not-found]

            driver = FalkorDriver(
                host=settings.falkordb_host,
                port=settings.falkordb_port,
                username=settings.falkordb_username,
                password=settings.falkordb_password,
                database=settings.falkordb_database,
            )

            llm_client = OpenAIClient(
                config=LLMConfig(
                    api_key=settings.openrouter_api_key,
                    base_url=settings.openrouter_base_url,
                    model=settings.graphiti_llm_model,
                )
            )

            embedder = OpenAIEmbedder(
                config=OpenAIEmbedderConfig(
                    api_key=settings.openai_api_key,
                    embedding_model=settings.graphiti_embedder_model,
                )
            )

            self._client = Graphiti(
                graph_driver=driver,
                llm_client=llm_client,
                embedder=embedder,
            )
            await self._client.build_indices_and_constraints()
            self._init_error = None
            log.info(
                "graphiti.init.ok",
                falkordb_host=settings.falkordb_host,
                falkordb_port=settings.falkordb_port,
                llm_model=settings.graphiti_llm_model,
            )
        except Exception as e:
            self._init_error = f"{type(e).__name__}: {e}"
            log.error("graphiti.init.error", error=self._init_error)

    def status(self) -> dict[str, Any]:
        return {
            "configured": bool(settings.openrouter_api_key and settings.openai_api_key),
            "connected": self._client is not None,
            "init_error": self._init_error,
            "falkordb_host": settings.falkordb_host,
            "llm_model": settings.graphiti_llm_model,
        }

    @property
    def client(self) -> Any:
        if self._client is None:
            raise RuntimeError(
                self._init_error or "Graphiti not initialised — call initialize() first."
            )
        return self._client

    # ---------- Episode + node operations ----------
    # These wrap the small subset of Graphiti's API the api-server needs.
    # Each one accepts a group_id so the api-server can target the global
    # subgraph or a per-user subgraph (Phase B+).

    async def add_episode(
        self,
        name: str,
        episode_body: str,
        group_id: str = "global",
        source_description: str = "api-server",
        reference_time: str | None = None,
    ) -> dict[str, Any]:
        """Ingest an episode. Graphiti runs entity + edge extraction via the
        configured LLM. Used for CVI snapshots, macro-events, and any
        unstructured signal the agents want to record."""
        from datetime import datetime, timezone
        from graphiti_core.nodes import EpisodeType  # type: ignore[import-not-found]

        ref_time = (
            datetime.fromisoformat(reference_time)
            if reference_time
            else datetime.now(timezone.utc)
        )
        result = await self.client.add_episode(
            name=name,
            episode_body=episode_body,
            source=EpisodeType.text,
            source_description=source_description,
            reference_time=ref_time,
            group_id=group_id,
        )
        return {
            "episode_uuid": getattr(result, "uuid", None),
            "nodes_created": [getattr(n, "uuid", None) for n in getattr(result, "nodes", []) or []],
            "edges_created": [getattr(e, "uuid", None) for e in getattr(result, "edges", []) or []],
        }

    async def search_nodes(
        self,
        query: str,
        group_ids: list[str] | None = None,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Semantic + structural search across one or more group_ids. Use
        ['global', 'user-{id}'] to search both the world model and a single
        user's subgraph in one call."""
        results = await self.client.search(
            query=query,
            group_ids=group_ids or ["global"],
            num_results=limit,
        )
        return [
            {
                "uuid": getattr(r, "uuid", None),
                "name": getattr(r, "name", None),
                "summary": getattr(r, "summary", None),
                "labels": getattr(r, "labels", []) or [],
                "group_id": getattr(r, "group_id", None),
            }
            for r in results or []
        ]

    async def query_cypher(
        self,
        cypher: str,
        params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Escape hatch — raw Cypher against FalkorDB. Bypasses Graphiti's
        bitemporal helpers; use sparingly (e.g. for the disruption cascade
        traversal which Graphiti's high-level search doesn't model directly)."""
        # FalkorDB driver exposes the underlying connection via .execute_query
        # in recent graphiti-core versions. Verify against installed version.
        result = await self.client.driver.execute_query(cypher, params or {})
        # Normalise to list of dicts — FalkorDB returns a Result object whose
        # shape varies by client version.
        rows: list[dict[str, Any]] = []
        for row in getattr(result, "records", None) or result or []:
            if hasattr(row, "data"):
                rows.append(row.data())
            elif isinstance(row, dict):
                rows.append(row)
            else:
                rows.append({"row": list(row) if hasattr(row, "__iter__") else row})
        return rows


# Module-level singleton — instantiated at import time, initialised on startup.
graphiti = GraphitiWrapper()
