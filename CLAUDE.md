# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`replit.md` contains the authoritative product/feature description and design-system notes — read it before touching `artifacts/capability-economics/` or the data model. This file focuses on how the pieces fit together.

## Commands

```bash
pnpm run typecheck                                   # tsc --build for libs + per-artifact tsc --noEmit
pnpm run build                                       # typecheck + pnpm -r run build (all packages)
pnpm run build:deploy                                # libs + capability-economics + api-server only (Railway build)
pnpm run start                                       # runs api-server (which also serves the built SPA)
pnpm --filter @workspace/api-server run build        # esbuild → artifacts/api-server/dist/index.mjs
pnpm --filter @workspace/api-server run dev          # NODE_ENV=development, build + start
pnpm --filter @workspace/api-server run start        # node --enable-source-maps dist/index.mjs
pnpm --filter @workspace/capability-economics run dev    # vite dev server (defaults PORT=5173, BASE_PATH=/)
pnpm --filter @workspace/capability-economics run build  # vite build → dist/public
pnpm --filter @workspace/api-spec run codegen        # regenerate api-client-react + api-zod from openapi.yaml
cd lib/db && npx drizzle-kit push --force            # push schema changes (dev only)
```

There is no test runner configured in any package — do not invent `pnpm test` commands.

**pnpm is enforced.** The root `preinstall` hook deletes `package-lock.json`/`yarn.lock` and exits if the user agent isn't pnpm. Never run `npm install` or `yarn`.

**Vite config env vars.** Both Vite configs default `PORT=5173/5174` and `BASE_PATH="/"` when unset — safe to run `pnpm run build` with no env setup. `PORT` only affects the dev/preview server; `BASE_PATH` becomes the `<base href>` of the built bundle and should be `/` for root deploys (anything else breaks SPA fallback routing).

## Architecture

### Monorepo layout

pnpm workspace with three tiers:

- `artifacts/*` — deployables. `api-server` (Express 5 backend, port 8080), `capability-economics` (Vite/React SPA, the main product), `ce-pitch-deck` (pitch deck frontend), `mockup-sandbox` (secondary frontend).
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

`src/index.ts` requires `PORT` (throws if missing) and kicks off `startScheduler()` in the `app.listen` callback. `src/app.ts` mounts middleware + `app.use("/api", router)` and, when a built frontend bundle is resolvable, serves it statically with a non-`/api` SPA fallback. Resolution order: `FRONTEND_DIST_PATH` env var → `$cwd/artifacts/capability-economics/dist/public` → `__dirname/../../capability-economics/dist/public` (monorepo layout). Missing bundle is non-fatal — the server logs a warning and runs API-only.

All routes are mounted under `/api`. Route handlers use generated Zod schemas from `@workspace/api-zod` to validate `params`/`query`/`body`. The `lib/db` package throws on import if `DATABASE_URL` isn't set.

**Admin-protected routes**: Middleware in `src/middlewares/requireAdmin.ts` requires `x-admin-key` header matching `ADMIN_API_KEY`. Set `ADMIN_AUTH_BYPASS=1` to disable the check locally (never in production). Protected routes include enrichment triggers, agent scheduler control, CEI refresh, insight generation, review queue, admin dashboards, and content management. Public read-only endpoints (catalog browsing, capability detail, EVaR, moat, etc.) remain open.

### Enrichment pipeline

Perplexity research feeds into GLM 5.1 (via OpenRouter) for synthesis and DB insertion. Three phases: capability quadrant classification, value chain stages, and company profiles. Tracks run history in `enrichment_runs` with a concurrency lock to prevent simultaneous runs.

### Sub-capability decomposition

Every top-level capability has 4–6 sub-capabilities auto-generated by Haiku 4.5. Children get factually triangulated by the rotation scheduler; parents are pure rollups (weighted avg of children's posteriors, never directly triangulated — avoids double-counting). New approved capabilities auto-decompose via `services/sub-capability-generator.ts`. Macro events on a parent expand bidirectionally to children (and vice versa) through `expandAffectedCapabilityIds`. Backfill script: `scripts/backfill-sub-capabilities.ts`.

### Autonomous CEI agent (`src/services/agent/`)

The most complex subsystem. LangGraph state machine with nodes `evaluate → decide → research → compute → memorize → finalize`, running every 30 minutes via `scheduler.ts` (guarded against overlap). Live events stream to the frontend via SSE at `/api/agent/events`.

Key files:
- `graph.ts` — LangGraph nodes, state transitions
- `tools.ts` — 5 LangChain tools (perplexity_research, query_database, compute_cei, recall_memories, store_memory)
- `memory.ts` — Mem0 Cloud client with local-DB fallback. Stores mirror to the `agent_memories` table with `metadata.mem0Id` linking cloud ↔ local rows; `getAllMemories` dedupes on that.
- `letta.ts` — optional stateful agent. Lazy-initializes against `LETTA_BASE_URL` (default `http://localhost:8283`), has a 60s retry cooldown, gracefully degrades if unreachable.
- `events.ts` — in-process pub/sub for SSE.

All three integrations (Mem0, Letta, Perplexity) **graceful-degrade** when env vars/services are missing — absence is logged, features disable, process keeps running. When editing the agent, preserve this: never throw on missing `MEM0_API_KEY` / `PERPLEXITY_API_KEY` / Letta unreachable.

Agent run metadata lives in `agent_runs`; persistent learnings in `agent_memories`. Perplexity calls per run are capped at 6 (cost control) — see `tools.ts`.

### Frontend (`artifacts/capability-economics`)

Vite + React 19 + wouter (not React Router) + TanStack Query + shadcn/ui (Radix primitives + Tailwind). Tailwind v4 via `@tailwindcss/vite`.

Design system notes from `replit.md` are load-bearing: HSL values are **space-separated without the `hsl()` wrapper** (e.g. `244 47% 50%`), and the Google Fonts `@import` in `index.css` **must be the first line**. Don't reorder it.

Session management (non-obvious): session token in `localStorage` as `ce_session_token`, industry id as `ce_industry_id`. Hook signatures: `useUpsertAssessments()` takes no args (mutation receives `{ sessionToken, data }`); `useGetDashboard(sessionToken, params?, options?)`.

### Database (`lib/db`)

Drizzle ORM over node-postgres. Schema in `src/schema.ts` (re-exported from `src/index.ts`). Zod validators via `drizzle-zod`. Migrations use `drizzle-kit push` in dev; there is no migration-file workflow configured.

Notable tables: `industries` / `capabilities` / `capability_metrics` / `capability_dependencies` form the core capability graph; `organizations` + `organization_capabilities` hold user assessments (unique constraint on `(org_id, capability_id)`); `cei_snapshots` / `cei_components` / `source_triangulations` back the CEI computation; `agent_runs` + `agent_memories` back the autonomous agent; `data_sources` with `sourceIds` jsonb columns on thresholds/leaderboard/white-papers implements the citation system.

### Required environment variables

- **Mandatory**: `DATABASE_URL` (api-server + scripts + drizzle), `PORT` (api-server runtime)
- **Feature-gated** (graceful degrade): `PERPLEXITY_API_KEY`, `MEM0_API_KEY`, `LETTA_BASE_URL`, `LETTA_API_KEY`, `ANTHROPIC_API_KEY` (via `@workspace/integrations-anthropic-ai`)
- **Admin auth**: `ADMIN_API_KEY` (required for admin routes), `ADMIN_AUTH_BYPASS=1` (disables admin auth check, local dev only)
- **Optional**: `LOG_LEVEL` (pino, default `info`), `NODE_ENV`, `BASE_PATH` (Vite `base:`, defaults to `/`), `FRONTEND_DIST_PATH` (override SPA static dir)

### Deploying to Railway

Single-service deploy is configured via `railway.json` + `nixpacks.toml`. Railway runs `pnpm install --frozen-lockfile && pnpm run build:deploy` then `pnpm run start` — the api-server both exposes `/api/*` and serves the built capability-economics SPA with a client-routing fallback. Provision Postgres and set `DATABASE_URL`; run `drizzle-kit push` against prod before first boot. `PORT` is injected by Railway. All AI integration keys are optional — absence logs a warning and disables the dependent feature.

### Mem0 + Letta on Railway

**Mem0** — Deploy via Railway's official **Mem0 template** (mem0ai/mem0 built from its repo's `server/Dockerfile` + pgvector for embeddings). The template auto-generates `ADMIN_API_KEY` + `JWT_SECRET` and auto-wires Postgres between the two services. You only need to drop `OPENAI_API_KEY` on the Mem0 service. **Do not use the Docker Hub `mem0/mem0-api-server` image** — it's arm64-only and won't run on Railway's amd64 infra (this is also why there is no `mem0/` subdirectory in this repo).

**Letta** — Built from `letta/Dockerfile` in this repo. Railway → New Service → your repo → root directory: `letta`. Set on the Letta service:
- `LETTA_SERVER_PASSWORD` — any strong string
- `OPENROUTER_API_KEY` (or another provider key) — without a provider key, Letta has no LLM handles registered and agent runs fail with `NOT_FOUND: Handle <model> not found, must be one of []`

**api-server service** — wire to both:
- `MEM0_BASE_URL=http://<mem0-service-name>.railway.internal:8000` — the internal hostname Railway assigned to the template's Mem0 service (visible under that service's Settings → Networking)
- `MEM0_API_KEY=<ADMIN_API_KEY value from the Mem0 service>` — the api-server sends it as `Authorization: Bearer <key>`, which is the standard self-hosted Mem0 auth scheme (not `X-API-Key`)
- `LETTA_BASE_URL=http://letta.railway.internal:8283`
- `LETTA_API_KEY=<same value as LETTA_SERVER_PASSWORD on Letta service>`

Verify with `GET /api/health/services` — `mem0` and `letta` should both report `status: "ok"`.
