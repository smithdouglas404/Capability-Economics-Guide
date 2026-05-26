# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`replit.md` contains the authoritative product/feature description and design-system notes — read it before touching `artifacts/inflexcvi/` or the data model. This file focuses on how the pieces fit together.

## Commands

```bash
pnpm run typecheck                                   # tsc --build for libs + per-artifact tsc --noEmit
pnpm run build                                       # typecheck + pnpm -r run build (all packages)
pnpm run build:deploy                                # libs + inflexcvi + api-server only (Railway build)
pnpm run start                                       # runs api-server (which also serves the built SPA)
pnpm --filter @workspace/api-server run build        # esbuild → artifacts/api-server/dist/index.mjs
pnpm --filter @workspace/api-server run dev          # NODE_ENV=development, build + start
pnpm --filter @workspace/api-server run start        # node --enable-source-maps dist/index.mjs
pnpm --filter @workspace/inflexcvi run dev    # vite dev server (defaults PORT=5173, BASE_PATH=/)
pnpm --filter @workspace/inflexcvi run build  # vite build → dist/public
pnpm --filter @workspace/api-spec run codegen        # regenerate api-client-react + api-zod from openapi.yaml
cd lib/db && npx drizzle-kit push --force            # push schema changes (dev only)
```

There is no test runner configured in any package — do not invent `pnpm test` commands.

**pnpm is enforced.** The root `preinstall` hook deletes `package-lock.json`/`yarn.lock` and exits if the user agent isn't pnpm. Never run `npm install` or `yarn`.

**Vite config env vars.** Both Vite configs default `PORT=5173/5174` and `BASE_PATH="/"` when unset — safe to run `pnpm run build` with no env setup. `PORT` only affects the dev/preview server; `BASE_PATH` becomes the `<base href>` of the built bundle and should be `/` for root deploys (anything else breaks SPA fallback routing).

## Architecture

### Monorepo layout

pnpm workspace with three tiers:

- `artifacts/*` — deployables. `api-server` (Express 5 backend, port 8080), `inflexcvi` (Vite/React SPA, the main product), `ce-pitch-deck` (pitch deck frontend), `mockup-sandbox` (secondary frontend).
- `lib/*` — shared packages referenced as `@workspace/<name>`. `db` (Drizzle schema + pg Pool), `api-spec` (OpenAPI source of truth + Orval config), `api-zod` (generated Zod validators), `api-client-react` (generated React Query hooks + `customFetch`), `integrations-anthropic-ai` (Replit AI Integrations proxy), `integrations` (additional integration packages).
- `scripts` — one-off TS scripts (seeders, Perplexity client). Runs under `tsx`.

Root `tsconfig.json` is a solution file with project references to the four `lib/*` packages that need declaration emit. `pnpm run typecheck:libs` runs `tsc --build` on that; per-artifact `typecheck` scripts then run `tsc -p tsconfig.json --noEmit` inside each artifact.

Dependencies are pinned via **pnpm catalog** (`pnpm-workspace.yaml`). React, Vite, Tailwind, Drizzle, Zod, tsx, etc. are `"catalog:"` — bump versions there, not in individual `package.json` files. Note: `zod: 3.25.76` in the catalog, but **import from `zod/v4`** in code that consumes generated schemas.

### The OpenAPI → generated-code pipeline

`lib/api-spec/openapi.yaml` is the source of truth for all API types, routes, and validation. `pnpm --filter @workspace/api-spec run codegen` runs Orval, which writes to:

- `lib/api-client-react/src/generated/api.ts` — React Query hooks + fetch wrappers
- `lib/api-zod/src/generated/api.ts` — Zod schemas used by the backend to validate params/query/body

**Codegen rules** (from replit.md, non-obvious and load-bearing):
- Do NOT change OpenAPI `info.title` — it controls generated filenames.
- Do NOT make changes to files in `lib/api-zod/` — this is generated code. `lib/api-zod/src/index.ts` must only contain `export * from "./generated/api";`. Orval re-adds a duplicate export on every codegen run — always revert that edit.
- `customFetch` (exported from `@workspace/api-client-react`) is the escape hatch for calls where generated hooks don't fit — e.g. CSV upload uses `customFetch(getUploadCsvUrl(...))` directly because generated `uploadCsv` wraps the body in `JSON.stringify`.
- Frontend pages often hardcode `const API_BASE = "/api"` and call `fetch` directly instead of going through `customFetch`/generated hooks. When changing the API base URL, grep for `API_BASE` — `setBaseUrl()` alone won't redirect those.

### Backend (`artifacts/api-server`)

Express 5, bundled with esbuild (`build.mjs`) into a single `dist/index.mjs` ESM file. The bundle includes pino via `esbuild-plugin-pino` (transports as sibling `pino-*.mjs` files). Many native/unbundleable packages are externalized in `build.mjs` — add to that list if adding a new dep that uses native modules or path traversal.

`src/index.ts` requires `PORT` (throws if missing) and kicks off `startScheduler()` in the `app.listen` callback. `src/app.ts` mounts middleware + `app.use("/api", router)` and, when a built frontend bundle is resolvable, serves it statically with a non-`/api` SPA fallback. Resolution order: `FRONTEND_DIST_PATH` env var → `$cwd/artifacts/inflexcvi/dist/public` → `__dirname/../../inflexcvi/dist/public` (monorepo layout). Missing bundle is non-fatal — the server logs a warning and runs API-only.

All routes are mounted under `/api`. Route handlers use generated Zod schemas from `@workspace/api-zod` to validate `params`/`query`/`body`. The `lib/db` package throws on import if `DATABASE_URL` isn't set.

**Admin-protected routes**: Middleware in `src/middlewares/requireAdmin.ts` requires `x-admin-key` header matching `ADMIN_API_KEY`. Set `ADMIN_AUTH_BYPASS=1` to disable the check locally (never in production). Protected routes include enrichment triggers, agent scheduler control, CVI refresh, insight generation, review queue, admin dashboards, and content management. Public read-only endpoints (catalog browsing, capability detail, EVaR, moat, etc.) remain open.

### Enrichment pipeline

Perplexity research feeds into GLM 5.1 (via OpenRouter) for synthesis and DB insertion. Three phases: capability quadrant classification, value chain stages, and company profiles. Tracks run history in `enrichment_runs` with a concurrency lock to prevent simultaneous runs.

### Sub-capability decomposition

Every top-level capability has 4–6 sub-capabilities auto-generated by Haiku 4.5. Children get factually triangulated by the rotation scheduler; parents are pure rollups (weighted avg of children's posteriors, never directly triangulated — avoids double-counting). New approved capabilities auto-decompose via `services/sub-capability-generator.ts`. Macro events on a parent expand bidirectionally to children (and vice versa) through `expandAffectedCapabilityIds`. Backfill script: `scripts/backfill-sub-capabilities.ts`.

### Autonomous CVI agent (`src/services/agent/`)

The most complex subsystem. LangGraph state machine with nodes `evaluate → decide → research → compute → memorize → finalize`, running every 30 minutes via `scheduler.ts` (guarded against overlap). Live events stream to the frontend via SSE at `/api/agent/events`.

**AI-first reasoning loop (2026-05-17, commits `4ae6de9` + `192b7c0`):** `generateInsightsTool` now grounds insights in Mem0 patterns + world-model `findCorrelations()` (Graphiti+FalkorDB primary, Postgres fallback) in addition to Perplexity + CVI scores. `services/stack-optimizer.ts` `recommendStack` reads world-model upstream blockers + Mem0 validated/contradicted patterns and makes ONE batched Haiku call per request (not N). A daily `Synthesis Agent` produces a cross-agent strategic brief that every other agent prepends to its system prompt. A 6h temporal-shift detector watches relationship-weight momentum (uses real snapshots in `memory_relation_snapshots` after 30 days post-deploy, falls back to linear extrapolation before then). A recommendation-feedback loop scores past recommendations against actual CVI outcomes 60 days later. **Full narrative + verification: see [`docs/ai-first-impact.md`](docs/ai-first-impact.md).**

Key files (post-AgentKit migration, 2026-05-24):
- `../cvi-agent-agentkit.ts` — procedural 9-phase orchestration (evaluate → recall → decide → research → compute → reflect → memorize → generateContent → finalize). Single-agent AgentKit Network is used only for the memorize-phase prior refinement; the other 8 phases run direct DB queries + tool invocations. Replaced the deleted `graph.ts` (LangGraph StateGraph).
- `tools.ts` — 5 tool wrappers (perplexity_research, query_database, compute_cvi, recall_memories, store_memory) plus content-generation tools used by the CVI cycle. Still defined via `tool()` from `@langchain/core/tools` for now — kept because the `.invoke()` shape is reused by `cvi-agent-agentkit.ts`.
- `memory.ts` — Mem0 client (auto-detects cloud vs self-hosted from hostname; currently pointed at self-hosted `mem0-server-production-8f56.up.railway.app`) with local-DB fallback. Stores mirror to the `agent_memories` table with `metadata.mem0Id` linking Mem0 ↔ local rows; `getAllMemories` dedupes on that.
- `temporal-shift-detector.ts` — 6h scheduled detector + `writeMemoryRelationSnapshots` daily writer + `getCachedTemporalShiftReport` cached read for the Synthesis Agent tool.
- `recommendation-feedback.ts` — scores insights > 60 days old against CVI trajectory; writes validated/contradicted patterns to Mem0 (`category: "recommendation_outcome"`). Dormant until day 60+ post-deploy.
- `agentkit-shared.ts` — shared `AgentRunResult` type for the AgentKit migration (replaces what the now-deleted `base-agent.ts` used to export).
- `../synthesis-agent-agentkit.ts` — daily cross-agent intelligence layer; uses Sonnet. Reads all 5 specialized-agent digests + world-model graph correlations (Graphiti+FalkorDB primary, Postgres fallback) + Mem0 patterns + cached temporal-shift report; publishes brief to `NS.sharedKnowledge("synthesis_brief")`.
- `store.ts` — **Letta-backed adapter** preserving the original `getSharedStore` / `NS` / `getAgentPriorBlock` / `putAgentPriorBlock` / `appendAgentArchive` / `searchAgentArchive` / `storePing` surface so the AgentKit agents read/write the same Letta state the LangGraph versions did. Core block labels map to `lettaReadBlock`/`lettaUpdateBlock`; namespaced put/search maps to Letta archival memory with `[NS:<ns>|<key>]` prefix. See `### Letta — back to self-hosted` below for the full story.
- `events.ts` — in-process pub/sub for SSE.

All three managed integrations (Mem0, Letta, Perplexity) **graceful-degrade** when env vars/services are missing — absence is logged, features disable, process keeps running. When editing the agent, preserve this: never throw on missing `MEM0_API_KEY` / `LETTA_API_KEY` / `PERPLEXITY_API_KEY`. **Both Mem0 and Letta are now self-hosted again on Railway** (different project from Capability Economics) — see the dedicated sections below.

Agent run metadata lives in `agent_runs`; persistent learnings in `agent_memories`. Perplexity calls per run are capped at 6 (cost control) — see `tools.ts`.

**All 8 agents now run on `@inngest/agent-kit`** (Phase 9 migration, 2026-05-24; disruption-vector-agent followed shortly after): `services/cvi-agent-agentkit.ts` for the autonomous CVI agent, and `services/<agent>-agentkit.ts` for the 6 specialized agents (macro-event, disruption, peer-coop, stack-optimizer, ontology, disruption-vector) + synthesis. The legacy LangGraph implementations (`services/agent/graph.ts`, `services/macro-event-agent.ts`, etc.) are deleted. Vercel AI SDK continues to handle one-shot structured-output calls (the 14 workflows in `services/workflows/` + the 8 Tier-1 service callers); AgentKit handles stateful multi-step agent loops. See `### AgentKit migration complete (Phase 9, 2026-05-24)` below for details.

### LangMem / Shared Agent Store

**LangMem is Python-only and is NOT installed in this TypeScript project.** Do not attempt to `import { create_prompt_optimizer } from "langmem"` — it will not resolve. The TypeScript equivalents are built on `@langchain/langgraph-checkpoint-postgres` + `@langchain/anthropic`.

Implementation files:
- `artifacts/api-server/src/services/agent/store.ts` — `PostgresStore` singleton with namespace helpers (`NS.*`). This is the shared blackboard all agents read from and write to. Backed by the existing `DATABASE_URL` Postgres — no new service. Tables auto-created via `ensureSharedStoreReady()` on boot. **Import path is `@langchain/langgraph-checkpoint-postgres/store` (the subpath), NOT the package root** (root only exports `PostgresSaver` for run checkpointing).
- ~~`artifacts/api-server/src/services/agent/optimizer.ts`~~ — DELETED. See `### Letta — back to self-hosted` below; Letta's sleeptime + core_memory_replace handles autonomous learning natively.

**Shared store namespaces** (always go through `NS.*`, never inline string arrays):
- `NS.industryPatterns(industryName)` — validated industry patterns published by the CVI Agent
- `NS.macroEvents()` — macro events discovered by the CVI Agent, read by future Disruption Agent
- `NS.disruptionRisks()` — disruption scores published by the (future) Disruption Agent
- `NS.peerBenchmarks()` — cohort benchmarks published by the (future) Peer Co-op Agent
- `NS.agentPriors(agentName)` — per-agent standing instructions (forward-path replacement for Letta core blocks)
- `NS.clientKnowledge(clientId)` — per-client private memory (VCR Agent)

**Multi-agent architecture rule — NO LangGraph supervisor.** Each agent is autonomous:
1. Agents run on their own `setInterval` schedules in `scheduler.ts`
2. Agents publish discoveries to the shared `PostgresStore` via `NS.*` namespaces
3. Agents read from the shared store at the start of each run to benefit from other agents' work
4. `optimizeAgentInstructions()` runs weekly per agent to improve their standing instructions

If you need agents to coordinate, **use the shared store as the communication channel** — do NOT add a LangGraph supervisor node.

### Letta — back to self-hosted (2026-05-23)

**Letta now runs self-hosted again** at `https://letta-production-1b3f.up.railway.app` (Railway, separate project — not Capability Economics; same project as the new self-hosted Mem0). The brief Letta-Cloud period (2026-05-17 → 2026-05-23) is over. `@letta-ai/letta-client` is in `artifacts/api-server/package.json`; `services/agent/letta.ts` and `services/agent/letta-tools.ts` were restored verbatim from `b3261fc~1` and continue to work — the SDK doesn't care whether the endpoint is `api.letta.com` or a Railway hostname.

Configuration model — env vars on the **api-server (`capabilityeconomics`) Railway service**:

```env
LETTA_BASE_URL=https://letta-production-1b3f.up.railway.app
LETTA_API_KEY=<token from the self-hosted Letta admin UI>
LETTA_MODEL=openrouter/anthropic/claude-sonnet-4.6   # optional override
LETTA_EMBEDDING=letta/letta-free                      # optional override
```

If using Letta tool callbacks, also set on the api-server:
- `INFLEXCVI_AGENT_TOOL_KEY` — shared secret for the tool-callback HMAC
- `INFLEXCVI_API_BASE` — public callback URL (the api-server's public Railway URL)

**`services/agent/store.ts` is now a Letta-backed adapter.** Same API surface (`getSharedStore`, `NS`, `getAgentPriorBlock`, `putAgentPriorBlock`, `appendAgentArchive`, `searchAgentArchive`, `storePing`) so the 5 specialized agents (macro-event, disruption, peer-coop, stack-optimizer, ontology) work unchanged. The adapter maps:
- Core block labels → `lettaReadBlock` / `lettaUpdateBlock`
- Namespaced put/search (the agents' digest pub/sub) → Letta archival memory with `[NS:<ns>|<key>]` prefix convention
- `storePing` → `lettaPing` (used by `/api/health/services`)

**`services/agent/optimizer.ts` was DELETED.** That was the weekly LangMem-equivalent prompt rewriter the user explicitly rejected ("the learning code I needed wasn't this"). Letta's own sleeptime + core_memory_replace pattern handles autonomous learning natively.

**Health probe**: `/api/health/services` reports a `letta` field with `configured / ok / error` shape. Look for `status: "ok"` after the self-hosted Letta token is configured. Self-hosted probe latency is typically <100 ms (Railway internal vs the prior 200–400 ms cloud round-trip).

**If Letta is not configured** (`LETTA_API_KEY` / `LETTA_BASE_URL` unset): all `letta*()` calls return safely (no throw), `storePing` reports `configured: false`, agents continue to operate using their Mem0 layer for short-term recall. Graceful-degrade matches the original Letta wiring.

### Frontend (`artifacts/inflexcvi`)

Vite + React 19 + wouter (not React Router) + TanStack Query + shadcn/ui (Radix primitives + Tailwind). Tailwind v4 via `@tailwindcss/vite`.

Design system notes from `replit.md` are load-bearing: HSL values are **space-separated without the `hsl()` wrapper** (e.g. `244 47% 50%`), and the Google Fonts `@import` in `index.css` **must be the first line**. Don't reorder it.

Session management (non-obvious): session token in `localStorage` as `ce_session_token`, industry id as `ce_industry_id`. Hook signatures: `useUpsertAssessments()` takes no args (mutation receives `{ sessionToken, data }`); `useGetDashboard(sessionToken, params?, options?)`.

### Database (`lib/db`)

Drizzle ORM over node-postgres. Schema in `src/schema.ts` (re-exported from `src/index.ts`). Zod validators via `drizzle-zod`. Migrations use `drizzle-kit push` in dev; there is no migration-file workflow configured.

Notable tables: `industries` / `capabilities` / `capability_metrics` / `capability_dependencies` form the core capability graph; `organizations` + `organization_capabilities` hold user assessments (unique constraint on `(org_id, capability_id)`); `cvi_snapshots` / `cvi_components` / `source_triangulations` back the CVI computation; `agent_runs` + `agent_memories` back the autonomous agent; `data_sources` with `sourceIds` jsonb columns on thresholds/leaderboard/white-papers implements the citation system.

### Required environment variables

- **Mandatory**: `DATABASE_URL` (api-server + scripts + drizzle), `PORT` (api-server runtime)
- **Feature-gated** (graceful degrade): `PERPLEXITY_API_KEY`, `MEM0_BASE_URL` + `MEM0_API_KEY` (self-hosted at `https://mem0-server-production-8f56.up.railway.app` — `MEM0_API_KEY` must match Mem0 service's `ADMIN_API_KEY`), `LETTA_BASE_URL` + `LETTA_API_KEY` (self-hosted at `https://letta-production-1b3f.up.railway.app`), `ANTHROPIC_API_KEY` (via `@workspace/integrations-anthropic-ai` AND via `@langchain/anthropic` in the 5 specialized agents — cron silently skips if missing). The weekly LangMem-equivalent optimizer is gone; Letta's sleeptime + core_memory_replace handles autonomous learning natively.
- **LLM model override**: `LLM_MODEL` — overrides the default `anthropic/claude-sonnet-4.6` (or `anthropic/claude-haiku-4.5` for `/api/insights`) for all single-shot OpenRouter calls. Set to e.g. `google/gemini-2.0-flash-001` or `deepseek/deepseek-chat-v3` to switch when OpenRouter credits run low. Note: this does NOT affect the fallback chain in `services/llm-fallback.ts` (which already cascades Sonnet → Haiku → GLM 5.1 on budget errors) — only the direct `model:` literals in `services/alpha/{enrich,thesis}.ts`, `services/enrichment/runners.ts`, `services/vcr/tools.ts`, `services/agent/tools.ts`, `routes/{insights,assess,dynamic-industries}.ts`.
- **World-model graph reads (opt-in)**: `USE_GRAPHITI_WORLD_MODEL=1` — switches `services/disruption.ts:computeDisruptionRisk` and the `/api/cascade/:id` route from 1-hop Postgres lookup to Cypher multi-hop traversal via `services/agent/capabilityGraphSync.ts:cypherCascadeImpacted`. Default off. Requires a populated Graphiti+FalkorDB instance (run `pnpm --filter @workspace/scripts run backfill:graphiti-world-model` after first wiring up Graphiti). The Postgres path is preserved as the fallback; if Graphiti is unreachable mid-request, the function silently returns Postgres-only results.

### Graph sync — honest scope (Neo4j removed 2026-05-25)

Two graph subsystems live in the world-model graph (Graphiti+FalkorDB); do not confuse them:

1. **Memory entity graph** (`memory_entities` / `memory_relations` tables → `:Entity` nodes). Written by `services/agent/graphMemory.ts:upsertEntity` / `recordRelation` (Postgres-only writes after the Neo4j removal; Graphiti receives entities through separate ingestion paths). Read by the core CVI agent's `memory.ts` recall and by `ontology-agent.ts`. **NOT** used by any customer-facing analytical surface.

2. **Capability graph** (`capabilities` / `capability_dependencies` tables → `:Capability` nodes + `:DEPENDS_ON` relationships). Mirror-written to Graphiti by `services/agent/capabilityGraphSync.ts:mirrorCapability` / `mirrorDependency`. Wired at: `routes/review.ts`, `routes/dynamic-industries.ts`, `services/sub-capability-generator.ts`. Read by `services/disruption.ts:computeDisruptionRisk` and `/api/cascade/:id` ONLY when `USE_GRAPHITI_WORLD_MODEL=1`. **All other readers (Fragility, Explainability, Stack Optimizer, generateInsightsTool, Alpha tabs, business-case analyzer) still query Postgres `capability_dependencies` directly.**

3. **Bi-temporal :Episodic nodes** (live since 2026-05-26). `services/agent/capabilityGraphSync.ts` exposes three episode writers that fire-and-forget through `addEpisode`:
   - `recordPlatformCviEpisode` — called from `services/cvi-engine.ts` after every cvi_snapshots insert. Throttled by `agent_tuning.cviEpisodeMinIntervalMinutes` (default 10 min; common ops value 1440 for daily; 0 disables throttle). Bookkeeping in `system_flags.last_cvi_episode_at`. Name shape `cvi-snapshot-{id}` exactly mirrors the backfill, so `/api/cvi/platform-history-bitemporal` sees live + backfilled episodes the same way.
   - `recordMacroEventEpisode` — called from `services/macro-events.ts:createMacroEvent`. Not throttled (events are rare and narrative-worthy). Name shape `macro-event-{id}`.
   - `recordCapabilityEpisode` — called from `routes/review.ts` (event=submitted) and `services/sub-capability-generator.ts` (event=decomposed). Not throttled. Name shape `cap-{pgId}-{eventName}`.

   Each `addEpisode` invokes Graphiti's configured LLM (Haiku 4.5 by default) for entity extraction. Steady-state cost ~$1/yr at 1440-min throttle, ~$137/yr at 10-min default, ~$274/yr unthrottled. Tune via `PATCH /api/admin/tunables/system { "cviEpisodeMinIntervalMinutes": <N> }`.

Backfill (run once after first wiring Graphiti; safe to re-run for drift recovery):
- `pnpm --filter @workspace/scripts run backfill:graphiti-world-model` — populates :Entity + :Capability nodes

**Neo4j was removed from Capability Economics on 2026-05-25** — `neo4j-driver` is gone from both `artifacts/api-server/package.json` and `scripts/package.json`; `services/agent/graphMemory.ts` and `services/agent/capabilityGraphSync.ts` no longer carry Neo4j read/write branches; the `runNeo4jMirrors()` phase 4 of `deploy-migrate.ts` is gone; the two backfill scripts (`backfill-memory-to-neo4j.ts`, `backfill-capability-graph-to-neo4j.ts`) are deleted. The CE-related data was migrated to FalkorDB on 2026-05-26 (492 :Capability + 203 :Entity + 163 :CO_OCCURS_WITH + 30 :DEPENDS_ON). The `Neo4j Graph Database (Metal-Ready)` Railway service (`fca5eba2-…`) **STAYS LIVE** — a separate application (SAFe agile transformation tracker, 96 :Capability nodes with epicId/valueStreamId/storyPoints) uses it. Do NOT delete that service. To recover any Capability Economics Neo4j code, see git history before the 2026-05-25 commit landing in main.
- **Foundry token rotation** (graceful degrade): `FOUNDRY_TOKEN` / `PALANTIR_TOKEN` / `PALANTIR_FOUNDRY_TOKEN` — still read as env-var fallback, but the preferred path is to store the token via `POST /api/admin/foundry/rotate-token` (admin UI) which writes to `system_secrets` table. `ADMIN_NOTIFY_EMAIL` — email address for the 30-min Foundry token expiry cron alert (also configurable per-token via `PATCH /api/admin/foundry/notify-email`).
- **Multi-agent + tool callback secrets**: `INFLEXCVI_AGENT_TOOL_KEY` (shared between api-server and any external tool callback services)
- **Admin auth**: `ADMIN_API_KEY` (required for admin routes), `ADMIN_AUTH_BYPASS=1` (disables admin auth check, local dev only)
- **Optional**: `LOG_LEVEL` (pino, default `info`), `NODE_ENV`, `BASE_PATH` (Vite `base:`, defaults to `/`), `FRONTEND_DIST_PATH` (override SPA static dir)

### Local dev server — silent OpenRouter cost trap (2026-05-25 incident)

**The Replit workspace auto-starts a local api-server in dev mode whenever the project opens.** It reads `OPENROUTER_API_KEY` from `/run/replit/env/latest` (which is usually valid) and runs **14 internal `setInterval` timers** out of `services/agent/scheduler.ts` — `rotationTimer`, `worldScanTimer`, `digestTimer`, `regulationsWatchTimer`, `cviSignalsTimer`, `edgarRssTimer`, etc. Several of those fire LLM calls on their own cadence. **In a 3-hour Claude Code session with the dev server quietly running, this can quietly burn through real OpenRouter spend with no visible signal to the operator.**

**If you're working on this project but NOT actively driving the local app:**
- `pgrep -af "@workspace/api-server run dev"` — if it returns a PID, the dev server is alive.
- Kill it: `pkill -f "@workspace/api-server"` (also kill the wrapper `sh -c export NODE_ENV=development...` shell if present).
- The 3 Vite frontend dev servers (inflexcvi / ce-pitch-deck / mockup-sandbox) are SAFE to leave running — they're pure bundlers, zero LLM calls.

Prod Railway agents (the 7 AgentKit agents on Inngest crons) are a SEPARATE expected-cost line item — they always run and you've already budgeted for them. The trap is specifically the LOCAL dev server that nobody asked for.

### CVI backfill safety (`scripts/src/backfill-graphiti-world-model.ts`)

Pass 2 of the backfill calls the LLM per CVI snapshot via OpenRouter → Anthropic Haiku 4.5. At ~$0.001-$0.005 per snapshot × ~800 historical snapshots that's $0.80-$4 in real spend per full run. Two defenses are wired into the script:

1. **`BACKFILL_CONFIRMED=1` required** — the CVI pass refuses to start without this env var set. Structural pass + DRY_RUN are exempt. Add `SKIP_CVI=1` to run only structural (zero LLM cost).
2. **Auto-skip via FalkorDB query** — the script queries `MATCH (e:Episodic) WHERE e.name STARTS WITH 'cvi-snapshot-' RETURN e.name` on start, builds a Set of already-processed snapshot IDs, and skips them. So `BACKFILL_CONFIRMED=1 pnpm --filter @workspace/scripts run backfill:graphiti-world-model` is naturally idempotent — no `CVI_OFFSET` math required. (`CVI_OFFSET` is still respected as a debug override.)
3. **Graceful shutdown** — the script handles SIGTERM/SIGINT cleanly, exiting at the next snapshot boundary (worst case ~1 in-flight LLM call wasted). Operators can also `STOP_FILE=/tmp/stop-backfill` and `touch` that path to halt — useful because pnpm doesn't forward signals to its tsx child, so `kill <pnpm-pid>` leaves an orphan worker. Use `kill -SIGTERM <tsx-pid>` (printed at script startup) OR the STOP_FILE path.

If you see a runaway backfill, the fastest reliable kill is `pkill -9 -f backfill-graphiti-world-model`.

### Session auth state — DO NOT trust Replit-injected values

**The app runs on Railway, not Replit.** Replit is only used for editing the codebase. Values that appear in this shell's `env` (sourced from `/run/replit/env/latest`) were pasted into Replit Secrets manually by the user at some point and are **stale / often expired** — they must not be treated as the live truth for anything. Railway service Variables are the source of truth.

**Source-of-truth rules** (load-bearing):
- "Is API key X currently valid?" → check **Railway** (CLI or dashboard), never the local shell `env`.
- "Where should I add/rotate credential Y?" → **Railway service Variables**, never Replit Secrets. Adding to Replit Secrets creates a second stale copy.
- Tokens to manage Railway/GitHub themselves (`RAILWAY_API_TOKEN`, `GH_TOKEN`) — also do not depend on Replit Secrets for these. Use desktop Claude Code where `~/.config/{railway,gh}/` persists across sessions.

**Why the Replit CLI auth keeps breaking** — both `gh` and `railway` write auth state under `~/.config/`, which does **not** persist between Claude Code sessions on this Replit. Each session starts unauth'd. Worse, `railway login --browserless` **fails from a Claude Code shell** with `Cannot login in non-interactive mode` (no TTY); it only works from a real interactive Replit Shell tab — and even then, the auth is gone next session.

**Practical implications:**
- `git push/pull` works fine (uses `GITHUB_TOKEN` via git credential helper — this is the one Replit-injected token that's reliable because git uses it transactionally).
- `gh` and `railway` CLI **cannot be authenticated from within a Claude Code session** without user-supplied tokens. If a task requires either, ask the user to either (a) paste a fresh token as `export RAILWAY_API_TOKEN=…` / `export GH_TOKEN=…` in the same shell, or (b) move the work to desktop Claude Code.

**Working around missing CLI auth — diagnostics that don't need it:**
- Prod health: `curl https://capabilityeconomics-staging.up.railway.app/api/health/services` (this endpoint reports which keys are `not_configured` on the live Railway deploy — a much more honest signal than local `env`). The Railway service is named `capabilityeconomics`, not `inflexcvi` — older notes have the wrong subdomain.
- Direct Letta queries: `curl https://letta-production-1b3f.up.railway.app/v1/agents -H "Authorization: Bearer <LETTA_API_KEY>"` works against self-hosted Letta. All paths return 401 without auth (good — endpoint exists). Local `LETTA_*` values in `/run/replit/env/latest` are stale — use the Railway `capabilityeconomics` service variables as the truth.
- Direct Mem0 queries: `curl https://mem0-server-production-8f56.up.railway.app/memories -H "X-API-Key: <ADMIN_API_KEY>"`. Self-hosted Mem0 uses `X-API-Key` and the `/memories` path (no `/v1` prefix). Local `MEM0_BASE_URL` in `/run/replit/env/latest` is stale.

When the user says "you have access to Railway," verify before agreeing — `railway whoami` is the only honest signal.

**Railway access from a Claude shell — use GraphQL, not the CLI.** Ask the user for a project-scoped token (Railway dashboard → project Settings → Tokens, UUID format). Send as header `Project-Access-Token: <uuid>` (NOT `Authorization: Bearer`; the account-scoped `RAILWAY_API_TOKEN` does not work on this endpoint). Endpoint: `https://backboard.railway.app/graphql/v2` — note the `.app` TLD; `.com` returns "Project Token not found" even with a valid token.

Alternative: the Railway CLI works once `RAILWAY_TOKEN=<uuid>` is exported (project-token mode bypasses the interactive login that `--browserless` requires). `railway status` confirms project/environment immediately; `railway variables --service <name>` lists a service's vars. Useful when GraphQL feels heavy.

Discovery query (returns projectId, environmentId, and all services with IDs):
```bash
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Project-Access-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"query { projectToken { projectId environmentId project { name services { edges { node { id name } } } } } }"}'
```

List a service's variables (returns `{KEY: VALUE}` — strip values before logging):
```bash
curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Project-Access-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"query":"query Vars($p:String!,$e:String!,$s:String!){variables(projectId:$p,environmentId:$e,serviceId:$s)}","variables":{"p":"<projectId>","e":"<envId>","s":"<serviceId>"}}'
```

Project IDs (verify via discovery query before relying on them — services get renamed; project itself is named **"Capability Economics"** in Railway, not "Inflexcvi"):
- projectId: `b4a4c027-0c13-48ad-aa90-f0c8daee52cb`
- production environmentId: `f4909034-d3d7-4087-bdfe-980138541751`
- service `capabilityeconomics` (the api-server — name was NOT renamed to `inflexcvi` as earlier notes implied): `f4585a12-c207-4faa-9171-5362997768ec`
- service `Mem0`: `8b75626c-40ba-49b1-a416-d145b4591711` — **dead carcass** in this project (zero deployments, zero instances). The live self-hosted Mem0 was re-deployed in a different Railway project at `https://mem0-server-production-8f56.up.railway.app` (2026-05-23, replacing the brief Mem0-Cloud experiment after its free-tier quota blew). Safe to delete this old shell; the paired `pgvector` (id `ff32eab9-…`) is also delete-safe.
- service `Postgres`: `fb4bdcb0-cc4c-4746-9f50-f3950e53835d`
- service `pgvector`: `ff32eab9-53dc-46de-b23a-b8d3e0be834c` — only used by the (now-unused) self-hosted Mem0 service. Delete together with Mem0.
- service `Neo4j Graph Database (Metal-Ready)`: `fca5eba2-01fb-420f-8188-bb184e16e199` — **STAYS LIVE** (do NOT delete). A separate non-CE application uses this service (SAFe agile transformation tracker, holds 96 :Capability nodes with epicId/valueStreamId/storyPoints metadata that have no equivalent in the CE schema). The Capability Economics api-server has zero functional links to Neo4j — `NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`/`USE_NEO4J_CAPABILITY_GRAPH` env vars were removed from the `capabilityeconomics` service on 2026-05-25, the `neo4j-driver` package is gone from this monorepo, and the world-model graph is Graphiti+FalkorDB only. The service is shared infrastructure for the other app.
- Letta service: was deleted from Capability Economics in May 2026; the active self-hosted Letta now lives in a different Railway project at `https://letta-production-1b3f.up.railway.app` — see `### Letta — back to self-hosted` below.

Never reuse a token from memory or a prior session — always ask for a fresh one. The CLI's `railway login --browserless` fails from a non-TTY Claude shell ("Cannot login in non-interactive mode") — GraphQL is the only path that works.

### Deploying to Railway

Single-service deploy is configured via `railway.json` + `nixpacks.toml`. Railway runs `pnpm install --frozen-lockfile && pnpm run build:deploy` then `pnpm run start` — the api-server both exposes `/api/*` and serves the built inflexcvi SPA with a client-routing fallback. Provision Postgres and set `DATABASE_URL`; run `drizzle-kit push` against prod before first boot. `PORT` is injected by Railway. All AI integration keys are optional — absence logs a warning and disables the dependent feature.

**Deploy model — push to git IS deploy.** Railway watches `origin/main` on the `capabilityeconomics` service in the Capability Economics project. A `git push origin main` triggers a build + deploy within a couple minutes — no manual `railway up` needed, no dashboard click needed. So: once code is committed and pushed, the work is durable AND the deploy is in flight. Don't lecture the user about "next steps to deploy" after a push; the push is the deploy.

**In-process AI workflows.** The 14 LLM workflows (onboarding-concierge, tier-selector, listing-moderation, kyc-failure-counselor, payment-recovery, capability-review-assist, research-pipeline, synthesis-brief-composer, assessment-analyzer, industry-bootstrap, case-study-generator, capability-enrichment-retry, admin-config-proposer, marketplace-search-v2) run natively in the api-server via `services/workflows/index.ts`. Each typed wrapper calls Anthropic (via OpenRouter) + Perplexity inline and returns `null` on failure so callers fall back to legacy code. No external workflow service in the loop.

### Mem0 — back to self-hosted (2026-05-23)

**Mem0 now runs self-hosted again** at `https://mem0-server-production-8f56.up.railway.app` (Railway, separate project — not Capability Economics; this token scope can't see it). The earlier cloud cutover (commits `ba0de9c` + `bfaeb46`, 2026-05-17) was reversed after the cloud free-tier quota exceeded (`quota_used 7001 / quota_limit 5000`, resets 2026-06-14) and agents lost recall.

Configuration model — env vars on the **api-server (`capabilityeconomics`) Railway service**:

```env
MEM0_BASE_URL=https://mem0-server-production-8f56.up.railway.app
MEM0_API_KEY=<must match ADMIN_API_KEY on the Mem0 service>
```

`services/agent/memory.ts` auto-detects cloud vs self-hosted from the hostname (`/(^|\/\/|\.)mem0\.ai(\/|$|:)/`). For the Railway hostname above the self-hosted branch fires:
- Self-hosted → `X-API-Key: <MEM0_API_KEY>` (must equal the Mem0 service's `ADMIN_API_KEY`), `/memories` paths
- Cloud (legacy fallback) → `Authorization: Token <m0-…>` (NOT `Bearer`), `/v1/memories/` paths (trailing slash matters)

**Verify**: `GET /api/health/services` should show `mem0` and `agent_store` both `status: "ok"`. Self-hosted probe latency is typically <100 ms (Railway internal vs the prior 200–400 ms cloud round-trip).

**Local memory mirror**: `agent_memories` table mirrors Mem0 writes via `metadata.cloudMem0Id` (name kept for compat; column tracks the self-hosted Mem0 row id post-flip) for idempotent re-runs and as the fallback when `MEM0_API_KEY` is unset. The local DB is authoritative for the "have we already stored this?" check.

**If Mem0 is not configured** (`MEM0_API_KEY` / `MEM0_BASE_URL` unset): `services/agent/memory.ts` graceful-degrades to local-DB-only storage. Never throws on missing keys.

**Diagnostic curl** (the URL is public-domain; auth-gated `/memories`):
```bash
curl https://mem0-server-production-8f56.up.railway.app/docs                 # 200 — FastAPI Swagger renders
curl https://mem0-server-production-8f56.up.railway.app/memories             # 401 — endpoint exists, expects X-API-Key
curl -H "X-API-Key: <ADMIN_API_KEY>" https://mem0-server-production-8f56.up.railway.app/memories  # 200 — list memories
```

**Stale Mem0 services in the Capability Economics project (safe to delete)**: service `Mem0` (id `8b75626c-40ba-49b1-a416-d145b4591711`) and its paired `pgvector` (id `ff32eab9-53dc-46de-b23a-b8d3e0be834c`) have zero deployments and are unused — the active Mem0 lives on the new URL above, in a different Railway project. The `mem0/Dockerfile` in this repo is the legacy deployment artifact; if the new self-hosted Mem0 needs rebuilding, note the historic gotchas: `MEM0_VERSION=v2.1.0` is pinned but doesn't exist upstream (highest tag is `v2.0.2`), CMD only runs `uvicorn` — never `alembic upgrade head`, so the `users`/`api_keys`/`request_logs`/`settings`/`refresh_token_jtis` tables won't exist unless the CMD is fixed to `sh -c "alembic upgrade head && uvicorn …"` and `APP_DB_NAME` points at an existing DB.

**Letta** — see `### Letta — back to self-hosted` above. Now runs at `https://letta-production-1b3f.up.railway.app` (different Railway project from Capability Economics, same project as the new self-hosted Mem0).

### Inngest — self-hosted (2026-05-23, in the AI Genome Project — NOT Capability Economics)

Inngest provides durable execution, scheduled triggers, event-driven coordination, retries, replay, and observability. Self-hosted OSS (no Inngest Cloud).

**Where it lives** — Railway "**AI Genome Project**" (`projectId 56d5a0a0-2abc-41ec-a798-ff065fde2533`), NOT the Capability Economics project. The user explicitly placed it there 2026-05-23 to isolate from the main app. Three services back it:
- `inngest` — `inngest/inngest:latest`, serviceId `90753004-301c-44a7-9f1b-a44f803bfe95`, public domain **`https://inngest-production-2b26.up.railway.app`** (dashboard + Event API + `/health`). Start command: `inngest start`. Reads `INNGEST_POSTGRES_URI`, `INNGEST_REDIS_URI`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` from env.
- `inngest-redis` — `redis:7-alpine`, serviceId `f2bfea7e-d197-4dfb-8d49-fc3ced448121`, internal-only at `inngest-redis.railway.internal:6379` (no auth).
- shares the existing `Postgres` service (serviceId `3698f59f-dba4-4853-a026-a2d771e8fd53`) — Inngest's tables are prefixed so they coexist safely with whatever else uses that DB.

**The `feat/inngest-migration` branch** in this Capability Economics monorepo wired the api-server to talk to it: `inngest@^4.4.0` in `artifacts/api-server/package.json`, `src/inngest/client.ts` (singleton), `src/inngest/functions/index.ts` (`pingFn` on `test/ping`), and `src/app.ts` mounts `serve()` at `/api/inngest` BEFORE Clerk/apiKey middleware (Inngest's signing-key check authenticates the inbound request itself — auth middleware would reject it).

**Cross-project wiring (still TODO — user action)**: this api-server runs in the **Capability Economics** Railway project but talks to Inngest in **AI Genome**. To complete Phase 0 the operator must set these env vars on the `capabilityeconomics` Railway service (NOT in this repo, NOT in Replit Secrets):
```env
INNGEST_BASE_URL=https://inngest-production-2b26.up.railway.app
INNGEST_EVENT_KEY=<value in /home/runner/.claude/secrets/inngest-ai-genome.env>
INNGEST_SIGNING_KEY=<value in same file — pure hex, NOT signkey-prod-… prefix>
```
Then deploy `feat/inngest-migration` to capabilityeconomics. The api-server will auto-register with Inngest on first boot; `test/ping` events sent via the dashboard will then route to `pingFn`. Verify by visiting Inngest's dashboard → Apps tab.

**Inngest Connect — beta WebSocket worker (Phase 7, 2026-05-23)**: opt-in replacement for the inbound HTTP webhook. Default OFF; the HTTP `/api/inngest` mount stays so the worker is purely additive. Cutover is operator-driven via env var.
```env
INNGEST_CONNECT=1                                # gate: set to "1" to dial out via WebSocket; default unset keeps HTTP webhook as the only path
INNGEST_CONNECT_GATEWAY_URL=ws://…               # optional: override the gateway URL the Inngest API returns (proxy / private network)
INNGEST_CONNECT_ISOLATE_EXECUTION=false          # optional: disable worker_threads isolation (SDK default true)
INNGEST_INSTANCE_ID=<stable id>                  # optional: identifier for this replica; defaults to hostname
```
Implementation: `artifacts/api-server/src/inngest/connect-worker.ts` calls `connect({ apps: [{ client, functions }] })` from `inngest/connect` and is booted from `src/index.ts` AFTER `app.listen`. SIGTERM/SIGINT handlers call `stopInngestConnectWorker()` for clean Railway redeploys. **Server-side support verified 2026-05-23**: probing the self-hosted gateway returns `/api/v1/connect` → 200 and `/v0/connect` → 401 (auth-gated, endpoint exists). Beta SDK surface — flip `INNGEST_CONNECT` back to unset to fall back to HTTP without touching the gateway.

**Gotchas learned the hard way (so future Claude doesn't re-learn them)**:
- Railway's `startCommand` runs WITHOUT a shell, so `$VAR` expansion doesn't work. Use bare commands and let the binary read env vars itself — `inngest start` reads `INNGEST_POSTGRES_URI` / `INNGEST_REDIS_URI` directly. Do NOT try `inngest start --postgres-uri "$INNGEST_POSTGRES_URI"`; the literal `$INNGEST_POSTGRES_URI` will be passed to the binary and it'll error `unsupported database URL`.
- The self-hosted Inngest binary's `--signing-key` flag requires **pure hex** (`openssl rand -hex 32` → 64 hex chars). The `signkey-prod-…` prefix you see in Inngest Cloud SDK examples is a Cloud convention — passing a prefixed value to the OSS binary causes `Error: signing-key must be hex string with even number of chars` and an infinite crashloop.
- Inngest in the OSS binary listens on `:8288` by default. Railway's `serviceDomainCreate` needs `targetPort: 8288`. Setting `PORT=8288` in env vars is redundant but not harmful.
- Inngest's tables auto-create on first boot — no manual migration step needed.

**Local secrets store**: `/home/runner/.claude/secrets/inngest-ai-genome.env` holds the generated EVENT_KEY + SIGNING_KEY + BASE_URL with `0600` perms. NOT committed. Source it from a Claude Code shell to recover values; rotate by running another `openssl rand` + `variableCollectionUpsert`.

**`INNGEST_OWNS_*` cutover flags** — every Inngest function gates itself on a per-feature flag so legacy in-process timers and the Inngest-owned path can co-exist during cutover. Set the flag to `1` on the `capabilityeconomics` Railway service to hand ownership to Inngest; leave unset (or set to anything other than `"1"`) to keep the legacy setInterval / cron path active. Each flag also gates the matching `setInterval` skip in `artifacts/api-server/src/services/agent/scheduler.ts` so the same job never double-runs.
- `INNGEST_OWNS_CVI` — `cvi-agent` cron (every 5 min)
- `INNGEST_OWNS_MACRO_EVENT` — `macro-event-agent` cron (every 30 min)
- `INNGEST_OWNS_DISRUPTION` — `disruption-agent` cron (hourly)
- `INNGEST_OWNS_PEER_COOP` — `peer-coop-agent` cron (every 6 h)
- `INNGEST_OWNS_STACK_OPTIMIZER` — `stack-optimizer-agent` cron (daily)
- `INNGEST_OWNS_ONTOLOGY` — `ontology-agent` cron (every 4 h)
- `INNGEST_OWNS_SYNTHESIS` — `synthesis-agent` event-driven (10-min debounce on 5 specialized-agent digest events). `INNGEST_SYNTHESIS_DAILY_FLOOR=1` additionally enables the legacy `0 6 * * *` cron as a safety floor.
- `INNGEST_OWNS_TEMPORAL_SHIFT` — `temporal-shift-detector` cron (every 6 h)
- `INNGEST_OWNS_MEMORY_SNAPSHOT` — `memory-relation-snapshot` cron (daily)
- `INNGEST_OWNS_RECOMMENDATION_FEEDBACK` — `recommendation-feedback` event-driven; sleeps 60 days after `agent.insight.created` emitted by `generateInsightsTool` (services/agent/tools.ts), then scores one insight's CVI trajectory via `scoreRecommendationByInsightId`. Legacy bulk poll (`scoreRecommendationAccuracy`) remains in services/agent/recommendation-feedback.ts as the fallback.
- `INNGEST_OWNS_FOUNDRY_ALERT` — `foundry-token-expiry-alert` event-driven; sleeps until `(expiresAt - 30min)` after `system.secret.expiring` emitted by `POST /api/admin/foundry/rotate-token` (when caller provides `expiresAt` / `expiresInSeconds`) or by the OAuth client_credentials mint path in services/foundry/auth.ts. Emails `system_secrets.notifyEmail` (with `ADMIN_NOTIFY_EMAIL` env fallback).

All flags default OFF. The cutover order is per-feature — flipping one flag has no effect on the others.

### AgentKit migration kill-switch (Phase 9, 2026-05-24) — historical

The migration commits 1–8 of Phase 9 introduced a per-agent `USE_LANGGRAPH_*` env-var kill-switch so any single AgentKit agent could be reverted to its LangGraph implementation without a redeploy. Commit 9 of the migration removed those branches along with the underlying LangGraph implementations — the kill-switch flags are NO LONGER read. All 8 agents unconditionally run their AgentKit version.

To roll back if AgentKit proves problematic, recover the legacy implementations from git history (commits prior to the Phase 9 commit 9 — `services/agent/graph.ts`, `services/macro-event-agent.ts`, `services/disruption-agent.ts`, `services/peer-coop-agent.ts`, `services/stack-optimizer-agent.ts`, `services/synthesis-agent.ts`, and the legacy `services/ontology-agent.ts`).

Letta agent names (e.g. `cvi-macro-event-agent`) were preserved across the migration via `AGENT_REGISTRY` so memory + identity continuity holds.

### AgentKit migration complete (Phase 9, 2026-05-24)

All 8 agents now run on `@inngest/agent-kit` (v0.13.2, Apache-2.0):
- `cvi-autonomous-agent` → `services/cvi-agent-agentkit.ts` (procedural 9-phase orchestration with a single-agent AgentKit Network for the memorize-phase prior refinement)
- `macro-event-agent` → `services/macro-event-agent-agentkit.ts`
- `disruption-agent` → `services/disruption-agent-agentkit.ts`
- `peer-coop-agent` → `services/peer-coop-agent-agentkit.ts`
- `stack-optimizer-agent` → `services/stack-optimizer-agent-agentkit.ts`
- `ontology-agent` → `services/ontology-agent-agentkit.ts` (was the Phase 8 shadow target; now authoritative)
- `synthesis-agent` → `services/synthesis-agent-agentkit.ts` (Sonnet model)
- `disruption-vector-agent` → `services/disruption-vector-agent-agentkit.ts` (followed shortly after the Phase 9 batch; the legacy `services/disruption-vector-agent.ts` is deleted)

LangGraph + LangChain dependencies removed; the legacy `services/agent/graph.ts`, `services/agent/base-agent.ts`, `services/agent/optimizer.ts`, `services/disruption-vector-agent.ts`, and per-agent legacy entry points (`runMacroEventAgent` etc.) are deleted in commit 9 of the migration. The Phase 8 shadow Inngest function (`ontologyAgentShadow`) and `INNGEST_SHADOW_ONTOLOGY` flag references are retired; the `agent_shadow_runs` table is preserved for historical data. The `langsmith` npm dep was the last LangChain-ecosystem package; dropped 2026-05-26 alongside this CLAUDE.md cleanup.

Kill-switch flags `USE_LANGGRAPH_<AGENT>` from commits 1–8 of this migration are NO LONGER read — the legacy LangGraph code paths were removed in commit 9 along with the legacy `services/<agent>.ts` files. Rollback now requires reverting from git history.

### Capability Disruption Index (DI) — forward-looking risk + opportunity layer

Forward-looking sibling of CVI (current value) and DVX (current disruption signal). Predicts how disruptable a capability is + which of 8 reference disruption-pattern archetypes (Uber / Airbnb / Google / Amazon / Stripe / OpenAI / Tesla / Netflix) would attack it.

**Surfaces:**
- `/disruption-index` — sortable/filterable listing with **two views: "Top 5 per industry" (default) + "Full table"**. Each cap shows top-5 pattern badges, color-graded composite DI.
- `/disruption-lab` — interactive: pick capability + apply enabling techs → live DI recompute. Manual / Pitch / Compare modes. Saved scenarios per user.
- `/capability/:id` — `<DisruptionFishbone>` component mounts below the ConsensusNarrative + CapabilityCascadePanel, surfacing 6-bone visualization with click-drawer evidence per sub-score.

**Scoring (`services/disruption-index.ts`):**
- 6 sub-scores: assetFriction + jtbdAbstractability + enablingTechStrength + trustReplaceability + latentSupplyMultiplier + marginAsymmetry
- Deterministic: assetFriction (from regulation_capability_requirements + capability_alpha proxies + description keyword scan) + marginAsymmetry (from capability_alpha.margin_structure_pct vs 60% software baseline)
- LLM-batched: the other 4 sub-scores + top-3 enabling-tech picks in ONE Sonnet call per cap
- Composite = weighted sum (enabling_tech 25% > asset 20% > jtbd/trust/supply 15% each > margin 10%)
- Playbook matching uses **Pearson correlation on sub-score deviations** (NOT raw cosine) — matches shape, not magnitude. Sharp #1 vs #2 spread.

**Disruption Vector Agent (`services/disruption-vector-agent-agentkit.ts`):**
- 8th specialized agent in the autonomous network (sibling to macro-event, disruption, peer-coop, stack-optimizer, ontology, synthesis + CVI autonomous)
- Inngest cron `0 */6 * * *` (every 6 hours), 8 caps per cycle, Sonnet-class scoring (~$0.56/cycle budget)
- Activated via `INNGEST_OWNS_DISRUPTION_INDEX=1` on capabilityeconomics

### Capability Disruption Simulator — time-axis forward projection

Sibling to the DI Index/Lab. Where the Lab answers "what's the DI of this capability right now under that stack," the Simulator answers "how does that DI play out over the next 12-60 months."

**Surface:** `/disruption-simulator` — three-mode page (Manual / Pitch / Saved). Output card-grid shows trajectory chart (incumbent CVI vs entrant strength line over time + crossover marker + cumulative $-at-risk), second-order cascade (per-dependent-cap CVI shift), defender counterfactuals (acquire / build / lobby with $ cost + new crossover).

**Engine (`services/disruption-simulator.ts`):** Pure-math, no LLM calls per simulation. For each month t = 0..horizon:
1. Bass diffusion `F(t)` with curve preset {p, q} × capital tier multiplier × regulatory friction delay
2. Entrant strength = F × 100; incumbent CVI = baseline × (1 - F × substitutionFactor)
3. Margin compression kicks in once entrant share > 20% (reflexive death-spiral)
4. Cumulative $ disrupted = Σ(delta-share × incumbent revenue)
5. Dependency cascade at horizon end: walk capability_dependencies, decay dependents by (decay × edge_weight × 0.5)
6. Crossover = first month entrant_strength > incumbent_cvi
7. Defender counterfactuals: acquire (M9, 10× ARR), build (+18mo friction, ~$200MM 3-yr), lobby (+12mo friction, ~$10MM)

**Curve presets:**
- `slow_burn` {p:0.001, q:0.18} — PE rollup
- `standard_b2b_saas` {p:0.003, q:0.30} — enterprise SaaS reference accounts
- `viral_b2c` {p:0.015, q:0.40} — Airbnb / Uber S-curve
- `stripe_dev` {p:0.020, q:0.35} — bottom-up developer adoption

**Capital multipliers on p:** bootstrap 0.6 / seed 1.0 / series_b 1.6 / mega_fund 2.4

**Pitch mode** uses Sonnet to extract all 9 simulator inputs from a startup pitch text in one round-trip, then runs the simulation.

Schema: `disruption_simulations` carries the full snapshot — inputs + trajectory[] + cascade[] + defenderOptions[] — so saved scenarios are self-contained and forkable (parentSimulationId).

### Observability

The 8 agents trace through Inngest's dashboard (run-by-run timing, retries, step traces, debug payloads) at the configured `INNGEST_BASE_URL`. LangSmith tracing was removed entirely on 2026-05-26 when the `langsmith` npm dep was dropped — it was the last LangChain-ecosystem package and after the Phase 10 LangGraph removal nothing else imported from it. The `LANGCHAIN_TRACING_V2` / `LANGCHAIN_API_KEY` / `LANGCHAIN_PROJECT` env vars are no longer read anywhere; `/api/health/services` no longer reports a `langsmith` field.
