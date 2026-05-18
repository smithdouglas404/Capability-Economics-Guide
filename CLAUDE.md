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

**AI-first reasoning loop (2026-05-17, commits `4ae6de9` + `192b7c0`):** `generateInsightsTool` now grounds insights in Mem0 patterns + Neo4j `findCorrelations()` in addition to Perplexity + CVI scores. `services/stack-optimizer.ts` `recommendStack` reads Neo4j upstream blockers + Mem0 validated/contradicted patterns and makes ONE batched Haiku call per request (not N). A daily `Synthesis Agent` produces a cross-agent strategic brief that every other agent prepends to its system prompt. A 6h temporal-shift detector watches relationship-weight momentum (uses real snapshots in `memory_relation_snapshots` after 30 days post-deploy, falls back to linear extrapolation before then). A recommendation-feedback loop scores past recommendations against actual CVI outcomes 60 days later. **Full narrative + verification: see [`docs/ai-first-impact.md`](docs/ai-first-impact.md).**

Key files:
- `graph.ts` — LangGraph nodes, state transitions
- `tools.ts` — 5 LangChain tools (perplexity_research, query_database, compute_cvi, recall_memories, store_memory). `generateInsightsTool` injects Mem0 patterns + Neo4j correlations into the Claude prompt.
- `memory.ts` — Mem0 Cloud client with local-DB fallback. Stores mirror to the `agent_memories` table with `metadata.mem0Id` linking cloud ↔ local rows; `getAllMemories` dedupes on that.
- `temporal-shift-detector.ts` — 6h scheduled detector + `writeMemoryRelationSnapshots` daily writer + `getCachedTemporalShiftReport` cached read for the Synthesis Agent tool.
- `recommendation-feedback.ts` — scores insights > 60 days old against CVI trajectory; writes validated/contradicted patterns to Mem0 (`category: "recommendation_outcome"`). Dormant until day 60+ post-deploy.
- `base-agent.ts` — all specialized agents prepend Mem0 patterns + their prior block + the latest Synthesis Agent brief to their system prompt before each cycle; write a post-run summary to Mem0 after each cycle (`category: "agent_run_summary"`).
- `../synthesis-agent.ts` — daily cross-agent intelligence layer; uses Sonnet. Reads all 5 specialized-agent digests + Neo4j correlations + Mem0 patterns + cached temporal-shift report; publishes brief to `NS.sharedKnowledge("synthesis_brief")`.
- `store.ts` — **Letta Cloud-backed adapter** preserving the original `getSharedStore` / `NS` / `getAgentPriorBlock` / `putAgentPriorBlock` / `appendAgentArchive` / `searchAgentArchive` / `storePing` surface so the 5 specialized agents (macro-event, disruption, peer-coop, stack-optimizer, ontology) work unchanged. Core block labels map to `lettaReadBlock`/`lettaUpdateBlock`; namespaced put/search maps to Letta archival memory with `[NS:<ns>|<key>]` prefix. See `### Letta — RESTORED (via Letta Cloud)` below for the full story.
- `events.ts` — in-process pub/sub for SSE.

All three managed integrations (Mem0, Letta, Perplexity) **graceful-degrade** when env vars/services are missing — absence is logged, features disable, process keeps running. When editing the agent, preserve this: never throw on missing `MEM0_API_KEY` / `LETTA_API_KEY` / `PERPLEXITY_API_KEY`. **Letta is on Letta Cloud, not removed** — see `### Letta — RESTORED (via Letta Cloud)` below.

Agent run metadata lives in `agent_runs`; persistent learnings in `agent_memories`. Perplexity calls per run are capped at 6 (cost control) — see `tools.ts`.

**DO NOT migrate the 7 agents off LangChain/LangGraph.** The 5 specialized agents (`macro-event-agent`, `disruption-agent`, `peer-coop-agent`, `stack-optimizer-agent`, `ontology-agent`) plus the autonomous CVI agent (`services/agent/graph.ts`) plus the `synthesis-agent` use `ChatAnthropic` + `StateGraph` from `@langchain/langgraph` and `@langchain/anthropic`. They work. They are NOT to be migrated to Vercel AI SDK. The two frameworks coexist in this repo on purpose: Vercel AI SDK is for one-shot structured-output calls (the 14 workflows in `services/workflows/` + the 8 Tier-1 service callers); LangGraph is for stateful multi-step agent loops (these 7 agents). Don't propose this migration in future sessions — it was explicitly declined 2026-05-18.

### LangMem / Shared Agent Store

**LangMem is Python-only and is NOT installed in this TypeScript project.** Do not attempt to `import { create_prompt_optimizer } from "langmem"` — it will not resolve. The TypeScript equivalents are built on `@langchain/langgraph-checkpoint-postgres` + `@langchain/anthropic`.

Implementation files:
- `artifacts/api-server/src/services/agent/store.ts` — `PostgresStore` singleton with namespace helpers (`NS.*`). This is the shared blackboard all agents read from and write to. Backed by the existing `DATABASE_URL` Postgres — no new service. Tables auto-created via `ensureSharedStoreReady()` on boot. **Import path is `@langchain/langgraph-checkpoint-postgres/store` (the subpath), NOT the package root** (root only exports `PostgresSaver` for run checkpointing).
- `artifacts/api-server/src/services/agent/optimizer.ts` — `optimizeAgentInstructions(agentName, lookbackRuns?)`: the TypeScript equivalent of LangMem's `create_prompt_optimizer`. Reads recent `agent_runs`, scores them (errored=0, otherwise memoriesStored/5), asks Haiku 4.5 to rewrite the standing instructions, persists back to `NS.agentPriors(agentName)`. Runs weekly via `OPTIMIZER_INTERVAL_MS` cron in `scheduler.ts`.

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

### Letta — RESTORED (via Letta Cloud, 2026-05-17)

**Letta is back.** The PostgresStore "LangMem-equivalent" replacement introduced in Phase 1.9 Step 6 was rejected by the user. `@letta-ai/letta-client` is re-added to `artifacts/api-server/package.json`. `services/agent/letta.ts` and `services/agent/letta-tools.ts` are restored from git history (commit `b3261fc~1`, 463 + 290 lines verbatim, no recreation).

Configuration model: **Letta Cloud** (managed service at `app.letta.com`), NOT self-hosted on Railway. Env vars go on the **api-server service**:

```env
LETTA_BASE_URL=https://api.letta.com         # Letta Cloud endpoint
LETTA_API_KEY=<cloud token from app.letta.com>
LETTA_MODEL=openrouter/anthropic/claude-sonnet-4.6   # optional override
LETTA_EMBEDDING=letta/letta-free                      # optional override
```

If using Letta Cloud tool callbacks, also set on the api-server:
- `INFLEXCVI_AGENT_TOOL_KEY` — shared secret for the tool-callback HMAC
- `INFLEXCVI_API_BASE` — public callback URL (the api-server's public Railway URL)

**`services/agent/store.ts` is now a Letta-backed adapter.** Same API surface (`getSharedStore`, `NS`, `getAgentPriorBlock`, `putAgentPriorBlock`, `appendAgentArchive`, `searchAgentArchive`, `storePing`) so the 5 specialized agents (macro-event, disruption, peer-coop, stack-optimizer, ontology) work unchanged. The adapter maps:
- Core block labels → `lettaReadBlock` / `lettaUpdateBlock`
- Namespaced put/search (the agents' digest pub/sub) → Letta archival memory with `[NS:<ns>|<key>]` prefix convention
- `storePing` → `lettaPing` (used by `/api/health/services`)

**`services/agent/optimizer.ts` was DELETED.** That was the weekly LangMem-equivalent prompt rewriter the user explicitly rejected ("the learning code I needed wasn't this"). Letta's own sleeptime + core_memory_replace pattern handles autonomous learning natively.

**Health probe**: `/api/health/services` reports a `letta` field with `configured / ok / error` shape. Look for `status: "ok"` after a Letta Cloud token is configured.

**If Letta Cloud is not configured** (`LETTA_API_KEY` / `LETTA_BASE_URL` unset): all `letta*()` calls return safely (no throw), `storePing` reports `configured: false`, agents continue to operate using their Mem0 layer for short-term recall. Graceful-degrade matches the original Letta wiring.

### Frontend (`artifacts/inflexcvi`)

Vite + React 19 + wouter (not React Router) + TanStack Query + shadcn/ui (Radix primitives + Tailwind). Tailwind v4 via `@tailwindcss/vite`.

Design system notes from `replit.md` are load-bearing: HSL values are **space-separated without the `hsl()` wrapper** (e.g. `244 47% 50%`), and the Google Fonts `@import` in `index.css` **must be the first line**. Don't reorder it.

Session management (non-obvious): session token in `localStorage` as `ce_session_token`, industry id as `ce_industry_id`. Hook signatures: `useUpsertAssessments()` takes no args (mutation receives `{ sessionToken, data }`); `useGetDashboard(sessionToken, params?, options?)`.

### Database (`lib/db`)

Drizzle ORM over node-postgres. Schema in `src/schema.ts` (re-exported from `src/index.ts`). Zod validators via `drizzle-zod`. Migrations use `drizzle-kit push` in dev; there is no migration-file workflow configured.

Notable tables: `industries` / `capabilities` / `capability_metrics` / `capability_dependencies` form the core capability graph; `organizations` + `organization_capabilities` hold user assessments (unique constraint on `(org_id, capability_id)`); `cvi_snapshots` / `cvi_components` / `source_triangulations` back the CVI computation; `agent_runs` + `agent_memories` back the autonomous agent; `data_sources` with `sourceIds` jsonb columns on thresholds/leaderboard/white-papers implements the citation system.

### Required environment variables

- **Mandatory**: `DATABASE_URL` (api-server + scripts + drizzle), `PORT` (api-server runtime)
- **Feature-gated** (graceful degrade): `PERPLEXITY_API_KEY`, `MEM0_BASE_URL` + `MEM0_API_KEY` (cloud at `https://api.mem0.ai`), `LETTA_BASE_URL` + `LETTA_API_KEY` (cloud at `https://api.letta.com`), `ANTHROPIC_API_KEY` (via `@workspace/integrations-anthropic-ai` AND via `@langchain/anthropic` in the 5 specialized agents — cron silently skips if missing). The weekly LangMem-equivalent optimizer is gone; Letta's sleeptime + core_memory_replace handles autonomous learning natively.
- **LangSmith tracing** (purely additive, off by default): `LANGCHAIN_TRACING_V2=true` + `LANGCHAIN_API_KEY` + `LANGCHAIN_PROJECT`. When set, the 7 inflexcvi agents auto-trace to LangSmith.
- **LLM model override**: `LLM_MODEL` — overrides the default `anthropic/claude-sonnet-4.6` (or `anthropic/claude-haiku-4.5` for `/api/insights`) for all single-shot OpenRouter calls. Set to e.g. `google/gemini-2.0-flash-001` or `deepseek/deepseek-chat-v3` to switch when OpenRouter credits run low. Note: this does NOT affect the fallback chain in `services/llm-fallback.ts` (which already cascades Sonnet → Haiku → GLM 5.1 on budget errors) — only the direct `model:` literals in `services/alpha/{enrich,thesis}.ts`, `services/enrichment/runners.ts`, `services/vcr/tools.ts`, `services/agent/tools.ts`, `routes/{insights,assess,dynamic-industries}.ts`.
- **Neo4j capability-graph reads (opt-in)**: `USE_NEO4J_CAPABILITY_GRAPH=1` — switches `services/disruption.ts:computeDisruptionRisk` from 1-hop Postgres lookup to Cypher multi-hop traversal via `services/agent/capabilityGraphSync.ts:cypherCascadeImpacted`. Default off. Requires a populated Neo4j capability graph (run `pnpm --filter @workspace/scripts run backfill:capability-graph-to-neo4j` after first wiring up Neo4j). The Postgres path is preserved as the fallback; if Neo4j is unreachable mid-request, the function silently returns Postgres-only results.

### Neo4j sync — honest scope as of May 2026

Two graph subsystems live in Neo4j; do not confuse them:

1. **Memory entity graph** (`memory_entities` / `memory_relations` tables → `:Entity` nodes). Written dual-write style by `services/agent/graphMemory.ts:upsertEntity` / `recordRelation`. Read by the core CVI agent's `memory.ts` recall and by `ontology-agent.ts`. **NOT** used by any customer-facing analytical surface.

2. **Capability graph** (`capabilities` / `capability_dependencies` tables → `:Capability` nodes + `:DEPENDS_ON` relationships). Written dual-write style by `services/agent/capabilityGraphSync.ts:mirrorCapability` / `mirrorDependency`. Wired at: `routes/review.ts`, `routes/dynamic-industries.ts`, `services/sub-capability-generator.ts`. Read by `services/disruption.ts:computeDisruptionRisk` ONLY when `USE_NEO4J_CAPABILITY_GRAPH=1`. **All other readers (Cascade tab math elsewhere, Fragility, Explainability, Stack Optimizer, generateInsightsTool, Alpha tabs, business-case analyzer) still query Postgres `capability_dependencies` directly.**

Backfills (run once after first wiring Neo4j; safe to re-run for drift recovery):
- `pnpm --filter @workspace/scripts run backfill:memory-to-neo4j` — populates `:Entity` nodes
- `pnpm --filter @workspace/scripts run backfill:capability-graph-to-neo4j` — populates `:Capability` + `:DEPENDS_ON`

Both honor `DRY_RUN=1`, skip if `NEO4J_URI` is unset.
- **Neo4j graph engine** (graceful degrade to PostgreSQL if absent): `NEO4J_URI` (bolt://neo4j.railway.internal:7687 for the Railway-internal Neo4j service), `NEO4J_USER` (default: neo4j), `NEO4J_PASSWORD`. When set, `graphMemory.ts` uses Cypher queries for `findCorrelations()` and `findRelated()` — the primary read path for `generateInsightsTool`. Falls back to PostgreSQL automatically on any connection error.
- **Foundry token rotation** (graceful degrade): `FOUNDRY_TOKEN` / `PALANTIR_TOKEN` / `PALANTIR_FOUNDRY_TOKEN` — still read as env-var fallback, but the preferred path is to store the token via `POST /api/admin/foundry/rotate-token` (admin UI) which writes to `system_secrets` table. `ADMIN_NOTIFY_EMAIL` — email address for the 30-min Foundry token expiry cron alert (also configurable per-token via `PATCH /api/admin/foundry/notify-email`).
- **Multi-agent + tool callback secrets**: `INFLEXCVI_AGENT_TOOL_KEY` (shared between api-server and any external tool callback services)
- **Admin auth**: `ADMIN_API_KEY` (required for admin routes), `ADMIN_AUTH_BYPASS=1` (disables admin auth check, local dev only)
- **Optional**: `LOG_LEVEL` (pino, default `info`), `NODE_ENV`, `BASE_PATH` (Vite `base:`, defaults to `/`), `FRONTEND_DIST_PATH` (override SPA static dir)

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
- Direct Letta queries: `curl https://api.letta.com/... -H "Authorization: Bearer <LETTA_API_KEY>"` works against Letta Cloud. Local `LETTA_*` values in `/run/replit/env/latest` are stale (they point at the now-deleted self-hosted Letta service) — use the Railway `capabilityeconomics` service variables as the truth.
- Direct Mem0 queries: `curl https://api.mem0.ai/v1/memories/ -H "Authorization: Token <m0-…>"`. Cloud uses the legacy `Token` scheme, NOT `Bearer`. Local `MEM0_BASE_URL` in `/run/replit/env/latest` is also stale (points at the self-hosted service).

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
- service `Mem0`: `8b75626c-40ba-49b1-a416-d145b4591711` — **self-hosted, now unused** since the cloud cutover (2026-05-17). Safe to delete; the api-server points at `https://api.mem0.ai` and the local-DB fallback in `services/agent/memory.ts` handles any old residual reference paths. The paired `pgvector` service backed only this Mem0 deployment and is also delete-safe.
- service `Postgres`: `fb4bdcb0-cc4c-4746-9f50-f3950e53835d`
- service `pgvector`: `ff32eab9-53dc-46de-b23a-b8d3e0be834c` — only used by the (now-unused) self-hosted Mem0 service. Delete together with Mem0.
- service `Neo4j Graph Database (Metal-Ready)`: `fca5eba2-01fb-420f-8188-bb184e16e199` — **wired** into `graphMemory.ts` as the primary graph traversal engine. Set `NEO4J_URI=bolt://neo4j.railway.internal:7687`, `NEO4J_USER=neo4j`, `NEO4J_PASSWORD` on the api-server service to activate. Falls back to PostgreSQL automatically when env vars are absent.
- Letta service: already deleted from Railway (Letta now runs on Letta Cloud — see `### Letta — RESTORED (via Letta Cloud)` below).

Never reuse a token from memory or a prior session — always ask for a fresh one. The CLI's `railway login --browserless` fails from a non-TTY Claude shell ("Cannot login in non-interactive mode") — GraphQL is the only path that works.

### Deploying to Railway

Single-service deploy is configured via `railway.json` + `nixpacks.toml`. Railway runs `pnpm install --frozen-lockfile && pnpm run build:deploy` then `pnpm run start` — the api-server both exposes `/api/*` and serves the built inflexcvi SPA with a client-routing fallback. Provision Postgres and set `DATABASE_URL`; run `drizzle-kit push` against prod before first boot. `PORT` is injected by Railway. All AI integration keys are optional — absence logs a warning and disables the dependent feature.

**Deploy model — push to git IS deploy.** Railway watches `origin/main` on the `capabilityeconomics` service in the Capability Economics project. A `git push origin main` triggers a build + deploy within a couple minutes — no manual `railway up` needed, no dashboard click needed. So: once code is committed and pushed, the work is durable AND the deploy is in flight. Don't lecture the user about "next steps to deploy" after a push; the push is the deploy.

**In-process AI workflows.** The 14 LLM workflows (onboarding-concierge, tier-selector, listing-moderation, kyc-failure-counselor, payment-recovery, capability-review-assist, research-pipeline, synthesis-brief-composer, assessment-analyzer, industry-bootstrap, case-study-generator, capability-enrichment-retry, admin-config-proposer, marketplace-search-v2) run natively in the api-server via `services/workflows/index.ts`. Each typed wrapper calls Anthropic (via OpenRouter) + Perplexity inline and returns `null` on failure so callers fall back to legacy code. No external workflow service in the loop.

### Mem0 — RESTORED (via Mem0 Cloud, 2026-05-17)

**Mem0 now runs on Mem0 Cloud** (`api.mem0.ai`), NOT self-hosted on Railway. The cutover landed in `ba0de9c` (auth auto-detect + local→cloud migration script) and `bfaeb46` (cloud `/v1/memories/` path mapping). Same pattern as Letta moving to Letta Cloud.

Configuration model — env vars on the **api-server service**:

```env
MEM0_BASE_URL=https://api.mem0.ai
MEM0_API_KEY=<cloud token, m0- prefix, from app.mem0.ai>
```

`services/agent/memory.ts` auto-detects cloud vs self-hosted from the hostname (`/(^|\/\/|\.)mem0\.ai(\/|$|:)/`):
- Cloud → `Authorization: Token <m0-…>` (NOT `Bearer` — Mem0 Platform uses the legacy Token scheme), `/v1/memories/` paths (trailing slash matters)
- Self-hosted → `X-API-Key: <ADMIN_API_KEY>`, `/memories` paths

**Verify**: `GET /api/health/services` should show `mem0` and `agent_store` both `status: "ok"`. Cloud probe latency is typically 200–400 ms (internet round-trip); much faster suggests something's still pointing at an internal endpoint.

**Local memory mirror**: `agent_memories` table mirrors cloud writes via `metadata.cloudMem0Id` for idempotent re-runs and as the fallback when `MEM0_API_KEY` is unset. The local DB is authoritative for the "have we already stored this?" check.

**If Mem0 Cloud is not configured** (`MEM0_API_KEY` / `MEM0_BASE_URL` unset): `services/agent/memory.ts` graceful-degrades to local-DB-only storage. Never throws on missing keys. Matches the original Mem0 wiring.

**Historical: self-hosted Mem0** — `mem0/Dockerfile` in this repo and the paired `pgvector` Railway service are the legacy self-hosted deployment. **Both Railway services are now unused and safe to delete** (service IDs `8b75626c-…` and `ff32eab9-…`). Keep the Dockerfile in-repo for now as a fallback path — if Mem0 Cloud ever has an outage we can flip `MEM0_BASE_URL` back to the internal hostname without redeploying. If you ever rebuild the Dockerfile path, note: `MEM0_VERSION=v2.1.0` is pinned but **does not exist** on upstream (highest tag is `v2.0.2`), and our CMD only runs `uvicorn` — it never runs `alembic upgrade head`, so the `users`/`api_keys`/`request_logs`/`settings`/`refresh_token_jtis` tables won't exist. Fix is to change CMD to `sh -c "alembic upgrade head && uvicorn …"` and either ensure the `mem0_app` database exists on pgvector or set `APP_DB_NAME` to an existing DB.

**Letta** — see `### Letta — RESTORED (via Letta Cloud)` above. Letta Cloud runs at `https://api.letta.com`; the self-hosted Letta Railway service was already deleted.

### LangSmith — observability across both stacks

When set on the inflexcvi api-server, LangChain auto-instruments every `ChatAnthropic.invoke()` / `createAgent` / LangGraph node and ships traces to LangSmith. No code changes needed — just env vars.

```env
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=<from smith.langchain.com>
LANGCHAIN_PROJECT=inflexcvi    # or per-environment: inflexcvi-prod, inflexcvi-staging
```

Set the project name on the api-server and traces land in one LangSmith project so you can see end-to-end flows (route handler → workflow wrapper → tool calls). Without LangSmith env vars set, all 7 inflexcvi agents continue to work — tracing is purely additive.
