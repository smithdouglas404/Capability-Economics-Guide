"""
Runtime patch for the self-hosted Mem0 server that:

1. Calls `mem0_falkordb.register()` at import time so the falkordb
   graph_store provider becomes available to `Memory.from_config(...)`.

2. Monkey-patches `mem0.Memory.from_config` so that when
   MEM0_GRAPH_STORE_PROVIDER=falkordb is set in env, the graph_store
   block is auto-injected into whatever config dict the API receives.
   The Mem0 server's /configure endpoint accepts a config dict but
   doesn't read env vars itself; injecting here is the cleanest way to
   point a managed Mem0 deployment at FalkorDB without forking the
   upstream code.

Env vars consumed:
  MEM0_GRAPH_STORE_PROVIDER          — "falkordb" enables this patch
  MEM0_GRAPH_STORE_FALKORDB_HOST     — e.g. falkordb.railway.internal
  MEM0_GRAPH_STORE_FALKORDB_PORT     — default 6379
  MEM0_GRAPH_STORE_FALKORDB_DATABASE — default "mem0"
  MEM0_GRAPH_STORE_FALKORDB_USERNAME — optional
  MEM0_GRAPH_STORE_FALKORDB_PASSWORD — optional

If MEM0_GRAPH_STORE_PROVIDER is unset (or != "falkordb"), the patch
does NOT inject anything — the server runs vector-only, identical
to the previous behaviour.

This file lives in /app/server/mem0_falkordb_patch.py and is imported
once by the Docker CMD before `uvicorn main:app` boots the FastAPI
server. Safe to import multiple times (register() is idempotent).
"""
import os
import sys

try:
    import mem0_falkordb  # noqa: F401  — the registration side-effect happens on import
    if hasattr(mem0_falkordb, "register"):
        mem0_falkordb.register()
        print("[mem0_falkordb_patch] register() called — falkordb graph_store available", file=sys.stderr)
    else:
        print("[mem0_falkordb_patch] mem0_falkordb imported but no register() — assuming auto-registration", file=sys.stderr)
except ImportError as exc:
    print(f"[mem0_falkordb_patch] mem0_falkordb not installed: {exc} — graph backend disabled", file=sys.stderr)
    # Don't kill the server — vector-only is a valid fallback.

provider = (os.environ.get("MEM0_GRAPH_STORE_PROVIDER") or "").strip().lower()
if provider == "falkordb":
    host = os.environ.get("MEM0_GRAPH_STORE_FALKORDB_HOST", "falkordb.railway.internal")
    port = int(os.environ.get("MEM0_GRAPH_STORE_FALKORDB_PORT", "6379"))
    database = os.environ.get("MEM0_GRAPH_STORE_FALKORDB_DATABASE", "mem0")
    username = os.environ.get("MEM0_GRAPH_STORE_FALKORDB_USERNAME") or None
    password = os.environ.get("MEM0_GRAPH_STORE_FALKORDB_PASSWORD") or None

    graph_block = {
        "provider": "falkordb",
        "config": {
            "host": host,
            "port": port,
            "database": database,
        },
    }
    if username:
        graph_block["config"]["username"] = username
    if password:
        graph_block["config"]["password"] = password

    try:
        from mem0 import Memory
        _original = Memory.from_config

        def _patched_from_config(config, *args, **kwargs):
            if isinstance(config, dict) and "graph_store" not in config:
                config = {**config, "graph_store": graph_block}
                print(
                    f"[mem0_falkordb_patch] injected graph_store=falkordb (host={host}:{port} db={database})",
                    file=sys.stderr,
                )
            return _original(config, *args, **kwargs)

        Memory.from_config = staticmethod(_patched_from_config)  # type: ignore[method-assign]
        print("[mem0_falkordb_patch] Memory.from_config patched to inject FalkorDB graph_store", file=sys.stderr)
    except ImportError as exc:
        print(f"[mem0_falkordb_patch] mem0 import failed: {exc}", file=sys.stderr)
else:
    # Provider not requested — leave Mem0 in vector-only mode (matches
    # the original Dockerfile behaviour before this patch landed).
    pass
