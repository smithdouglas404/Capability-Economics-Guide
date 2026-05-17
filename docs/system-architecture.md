# Inflexcvi System Architecture — Living Reference

**Last updated:** 2026-05-17
**Status:** authoritative current-state doc. Supersedes `architecture-spec.md` v2.0 (April 2026) for any subsystem listed below.
**Audience:** engineers + technical diligence. Not marketing — code is the source of truth, this doc points at it.

> **Why this doc exists:** the platform was built by multiple AI agents shipping in parallel, and prior docs (pitchbook, architecture-spec.md, replit.md) overstated several subsystems' scope. This doc only describes what's actually in the code as of the date above, with greps you can run to verify.

---

## 0. Verifying anything in this doc

Every claim below either cites a file path or is verifiable by a `grep`. If a claim disagrees with the code, the code wins — file an issue (or fix the doc).

---

## 1. Top-level layout

pnpm workspace. Three tiers:

| Tier | Contains |
|---|---|
| `artifacts/*` | Deployables: `api-server` (Express 5 backend, port 8080), `inflexcvi` (React 19 SPA, 68 pages), `ce-pitch-deck` (static), `mockup-sandbox` (component preview) |
| `lib/*` | Shared packages: `db` (Drizzle schema, 85 tables), `api-spec` (OpenAPI 3.1), `api-client-react` (Orval-generated React Query hooks), `api-zod` (Orval-generated Zod validators), `integrations-anthropic-ai` (Replit AI Integrations proxy) |
| `scripts/*` | One-off TS scripts: seeders, backfills, Foundry sync, deploy-migrate orchestrator |
| `mem0/` | Self-hosted Mem0 Dockerfile (Railway-deployed) |

There is no test runner anywhere. The contract layer + typecheck is the safety net.

---

## 2. Data stores — what lives where

| Store | Type | Primary use | Who reads |
|---|---|---|---|
| **Postgres** | Source of truth for 85 tables | Everything (capabilities, dependencies, agents, bots, workflows, organizations, marketplace, audit, secrets, …) | Every reader unless flag below says otherwise |
| **Neo4j 5.26-community** | Mirror, dual-write | `:Entity` nodes (from `memory_entities` / `memory_relations`), `:Capability` nodes + `:DEPENDS_ON` (from `capabilities` / `capability_dependencies`) | Agent memory recall (`graphMemory.ts`); opt-in capability cascade via `USE_NEO4J_CAPABILITY_GRAPH=1` |
| **pgvector** | Postgres extension, on its own Railway service | Vector backing for Mem0 | Mem0 internal |
| **Self-hosted Mem0** | Railway service (built from our `mem0/Dockerfile`, mem0ai/mem0 v2.1.0) | Semantic memory store for agent observations / patterns / insights / decision-context | Core CVI research agent (`memory.ts`) |
| **PostgresStore** | Postgres table | Shared agent state (priors, current focus, market context, agent run archive) — replaces Letta | All 6 autonomous agents |
| **Redis** | Railway managed | BullMQ job queue backing | `services/alpha/queue.ts` |
| **Hedera Consensus Service** | External | Audit-chain anchor for admin actions + capability snapshots | `services/blockchain-audit.ts` |

### 2.1 Where the read paths actually go (audited 2026-05-17)

This is the single most important table in the doc. **Pitchbook + architecture-spec.md historically overstated this — those claims are now corrected.**

| Reader | File | Backend |
|---|---|---|
| Core CVI agent — entity recall | `services/agent/memory.ts`, `graphMemory.ts` | **Neo4j primary**, Postgres fallback |
| Core CVI agent — `findCorrelations()` / `findRelated()` | `graphMemory.ts` | **Neo4j primary**, Postgres fallback |
| Ontology agent — entity extraction | `services/ontology-agent.ts` | **Neo4j writes** (via `upsertEntity()`) |
| `disruption.ts:computeDisruptionRisk` (1-hop deps) | `services/disruption.ts` | Postgres by default; **Cypher cascade enrichment when `USE_NEO4J_CAPABILITY_GRAPH=1`** |
| Cascade tab math (other functions) | `services/disruption.ts` | Postgres |
| Fragility tab math | `services/disruption.ts` | Postgres |
| Explainability service | `services/explainability.ts` | Postgres |
| Stack Optimizer agent + service | `services/stack-optimizer-agent.ts`, `services/stack-optimizer.ts` | Postgres |
| `generateInsightsTool` (in agent tools) | `services/agent/tools.ts` | Postgres |
| `/api/insights` route | `routes/insights.ts` | Postgres |
| Business case analyzer | `services/business-cases/analyzer.ts` | Postgres |
| Alpha tab API (`/api/alpha/*`) | `routes/alpha.ts` | Postgres |
| Macro Event agent | `services/macro-event-agent.ts` | Postgres |
| Disruption agent | `services/disruption-agent.ts` | Postgres |
| Peer-Coop agent | `services/peer-coop-agent.ts` | Postgres |
| Bot workflows (all 7) | `services/bots/workflows/*` | Postgres |

**Net:** of 6 autonomous agents, only 2 use Neo4j (core + ontology). All customer-facing analytical tabs use Postgres. The capability dependency graph migration to Cypher is incremental — see §6.4 for the pattern and migration plan.

---

## 3. The autonomous agent system — 6 agents on a shared store

The system runs **6 LangGraph autonomous agents** every 30 min on a shared `PostgresStore`:

| Agent | File | Cadence | What it does |
|---|---|---|---|
| Core CVI research agent | `services/agent/graph.ts` | 30 min routine + 5 min urgency watchdog | LangGraph state machine: `evaluate → decide → research → compute → memorize → finalize`. Pulls candidate capabilities (stale / low-confidence / high-volatility), Perplexity-researches them, computes CVI components, stores findings + memories. |
| Macro Event Agent | `services/macro-event-agent.ts` | 30 min | Watches macro signals (rates, GDP releases, regulatory events), writes structured impact deltas to `macro_events`. |
| Disruption Agent | `services/disruption-agent.ts` | 30 min | Scans capability graph for ~1,000 new signal-event pairs/cycle, classifies by quadrant pressure, queues high-confidence ones for HITL. |
| Ontology Agent | `services/ontology-agent.ts` | 30 min | Proposes new capability nodes + edges from external research; submits to `pending_review`. Writes to Neo4j `:Entity`. |
| Peer-Coop Agent | `services/peer-coop-agent.ts` | 30 min | Maintains peer-benchmark cohorts; tracks valid comparators per industry+size+region. |
| Stack Optimizer Agent | `services/stack-optimizer-agent.ts` | 30 min | Observes which LLM model/route succeeded per task; writes recommendations to `agent_tuning`. |

All 6 register run records to `agent_runs` and use shared state via `services/agent/store.ts` (`NS.agentPriors`, `NS.agentRuns`, `NS.macroEvents`, `NS.disruptionRisks`).

**Weekly Claude prompt optimizer** (`services/agent/optimizer.ts`) reads each agent's `agent_runs` history + the HITL queue's accept/reject patterns and proposes prompt revisions per agent. Runs once a week.

### 3.1 Letta is decommissioned

Letta was the prior shared-state service. Removed in Phase 1.9 Step 6 (commit history searchable for "PostgresStore migration"). The `@letta-ai/letta-client` dependency is gone; `services/agent/letta.ts` and `letta-tools.ts` are deleted. Any comment in code still referencing `lettaXxx` symbol names (e.g. `state.lettaArchivalSnippets`, `syncEconomicRulesToLetta`) is historical — those now read/write PostgresStore.

---

## 4. The bot framework + workflow framework

### 4.1 Bots (synthetic agents)

`services/bots/` defines a persona-driven synthetic-agent system that exercises every customer-facing workflow end-to-end on a daily cadence. **Not counted in ARR or customer metrics.**

- 5 persona templates (`personas.ts`): PE Partner, VC Associate, Insurance Lead, Energy Strategist, Healthcare Operator. Only PE Partner is active at launch.
- 7 action types: `browse`, `assessment`, `reflection`, `comment`, `marketplace`, `deep-dive`, `cross-bot-reflect`.
- Per-bot hard budget cap (`monthlyBudgetUsdCap`, default $40/mo; realistic operating spend $10-15/mo per bot driven by deep-dive cost).
- All bot-authored UI artifacts render a "Synthetic agent · [Persona]" badge.
- Emails use RFC 2606 `.test` TLD so they can never resolve to real recipients.
- Admin UI: `admin.tsx` → System tab → "Synthetic Agents" panel.

### 4.2 Bot workflows (multi-step LangGraph)

`services/bots/workflows/` adds multi-step orchestration on top of the discrete actions. Each workflow is a LangGraph StateGraph that carries state across nodes (e.g., "browse top EVaR caps → score → for each: assess + deep-dive + publish listing"). 7 workflows registered:

| Key | Cadence | Scope | What it does |
|---|---|---|---|
| `pe-weekly-diligence` | weekly | per-bot | PE Partner's full diligence cycle |
| `vc-thesis-build` | weekly | per-bot | VC's thesis-build cycle (tech only, commoditization-velocity rank) |
| `insurance-capability-review` | bi-weekly | per-bot | Insurance lead's rotating-org comparison |
| `healthcare-org-comparison` | weekly | per-bot | Healthcare ops cohort comparison |
| `energy-quarterly-audit` | quarterly | per-bot | Energy strategist's deep audit |
| `cross-bot-consensus-map` | weekly | system-wide | Flags caps ≥3 bots active → HITL annotation |
| `bot-to-cvi-calibration` | monthly | system-wide | Pearson correlates bot scores vs CVI; flags divergent bots for prompt optimizer |

Plus event-driven trigger dispatchers (`workflows/triggers.ts`):
- `capability.added` — fired from `routes/review.ts`, `routes/dynamic-industries.ts`, `services/sub-capability-generator.ts` (all wired 2026-05-17)
- `cvi.delta-large` — fired from `services/cvi-signals/detector.ts` when |Δ| ≥ 10pt
- `user.signed-up` — STUB (no Clerk webhook handler exists server-side; companion workflow not yet implemented)

All runs persisted to `bot_workflow_runs` + `bot_workflow_steps`. Admin UI: System tab → "Bot Workflows" panel (added 2026-05-17 via `BotWorkflowsPanel`).

---

## 5. Data integrity — defensibility by rule

Two patterns ensure customer-facing data is sourced, not estimated.

### 5.1 Reference org selection (replaces hardcoded list)

The 60 reference organizations are NOT hardcoded. They're populated from a single stored criterion:

```
reference_org_selection_rule (one row):
  "Per industry, the top 10 companies globally by trailing-12-month revenue,
   mixing public + largest known private, including at least 2 non-US companies
   and at least 1 disruptor or SMB where one materially exists in the industry.
   Each entry must have a source URL …"
```

The script `scripts/src/seed-reference-orgs.ts` calls Perplexity per industry, parses results, drops any entry without a source URL, and inserts into `organizations` with sessionToken `seed:reference:<industry>:<slug>`. 90-day refresh window guarded by `lastAppliedAt`. Customer-added orgs (with Clerk userIds) are never touched.

Per-capability scoring of these orgs happens in `scripts/src/seed-organizations.ts` via Perplexity with required citations.

### 5.2 GDP weights

Per-industry GDP weights in `industry_gdp_weights`, each populated via Perplexity with required `source_url`, `source_year`, `source_citations` — schema-enforced via NOT NULL. The CVI weighted rollup excludes any industry with no weight (logs a warning); never substitutes a synthetic number.

---

## 6. The deploy pipeline — 4 phases on every container boot

`scripts/src/deploy-migrate.ts` is the orchestrator. Runs at every Railway container start, before api-server accepts traffic.

| Phase | What | Idempotent? | Fails deploy if errors? |
|---|---|---|---|
| **1** SQL migrations | Apply every `.sql` in `lib/db/migrations/` (currently 0001–0005). Used for renames + table creates that drizzle-kit can't infer non-interactively. | Yes (via `IF NOT EXISTS` / `IF EXISTS` guards) | YES |
| **2** `drizzle-kit push --force` | Sync Drizzle schema against live DB. No-op when already in sync. | Yes | YES |
| **3** Seed chain | 13 seed scripts in dependency order (knowledge graph, gdp-weights, reference-org-rule, reference-orgs, organizations, marketplace, patterns, reports, alpha-config, payg-tier, disruption-patterns, disruption-events, economic-rules). Each may insert from external sources (Perplexity, config, constants). | Yes (each seed self-checks) | YES |
| **4** Neo4j mirrors | 2 backfill scripts: `backfill:memory-to-neo4j`, `backfill:capability-graph-to-neo4j`. **Pure Postgres → Neo4j mirrors** — never create rows that don't already exist in Postgres. Skipped if `NEO4J_URI` unset. | Yes | **NO** (Neo4j is downstream optimization; mirror failures log warning, deploy continues) |

### 6.1 Migration safety pattern

drizzle-kit's interactive "is this a new table or rename?" prompt is NOT bypassed by `--force`. In a non-TTY container the prompt times out after ~10s and silently no-ops the table. The recurring fix: pre-create new tables via SQL migration in `lib/db/migrations/` so drizzle-kit sees it already exists and skips the prompt. Used for the CVI rename (0001), VCR rename (0002), system_secrets serial (0003), reference-org rule (0004), bot_workflows (0005). Same pattern for any new table.

### 6.2 Skip flags

```
SKIP_MIGRATE=1                   # everything (very cautiously)
SKIP_SQL_MIGRATIONS=1
SKIP_SEEDS=1
SKIP_NEO4J_MIRROR=1
SKIP_<NAME>_SEED=1               # per-seed (see deploy-migrate.ts header for full list)
```

---

## 7. Neo4j — what, why, the operational story

### 7.1 What's mirrored

Two graph subsystems. Do NOT confuse them.

| Subsystem | Postgres source | Neo4j shape | Read by |
|---|---|---|---|
| Agent memory graph | `memory_entities`, `memory_relations` | `:Entity` nodes + named relationships | `services/agent/graphMemory.ts` (`findRelated`, `findCorrelations`, `getGraphStats`) |
| Capability graph | `capabilities`, `capability_dependencies` | `:Capability` nodes + `:DEPENDS_ON` | `services/agent/capabilityGraphSync.ts` (`cypherCascadeImpacted`); used by `disruption.ts:computeDisruptionRisk` when flag set |

### 7.2 Dual-write call sites

Capability graph dual-writes are wired at the three capability create points:
- `routes/review.ts` (HITL submission)
- `routes/dynamic-industries.ts` (industry expansion)
- `services/sub-capability-generator.ts` (auto-decomposition)

Each calls `capabilityGraphSync.ts:mirrorCapability()` fire-and-forget after the Postgres insert. Postgres write blocks; Neo4j mirror does not.

Memory graph dual-writes happen inside `services/agent/graphMemory.ts:upsertEntity()` / `recordRelation()` whenever the core agent encounters new entities during research cycles.

### 7.3 Backfill — fresh deploy and drift recovery

`scripts/src/backfill-memory-to-neo4j.ts` and `backfill-capability-graph-to-neo4j.ts`. Both:
- Read Postgres in 500-row batches
- Idempotently MERGE into Neo4j with batched UNWIND for speed
- Pure mirrors — no external source, can never insert rows that aren't already in Postgres
- Skip if `NEO4J_URI` unset
- Honor `DRY_RUN=1`, `SKIP_ENTITIES=1`, `SKIP_RELATIONS=1`, `SKIP_CAPABILITIES=1`, `SKIP_DEPENDENCIES=1`

Run automatically as Phase 4 of every deploy. Also runnable manually:
```bash
pnpm --filter @workspace/scripts run backfill:memory-to-neo4j
pnpm --filter @workspace/scripts run backfill:capability-graph-to-neo4j
```

### 7.4 Opt-in Cypher reads

Set `USE_NEO4J_CAPABILITY_GRAPH=1` on the api-server service to flip `disruption.ts:computeDisruptionRisk` from 1-hop Postgres lookup to multi-hop Cypher cascade traversal. Postgres remains the fallback if Cypher returns null.

This is the ONLY reader migrated so far. Pattern for migrating others (Fragility, Cascade tab, Explainability, Stack Optimizer):
1. Import `useNeo4jCapabilityGraph()` + add a Cypher helper to `capabilityGraphSync.ts`
2. Branch on the flag: Cypher when set, Postgres otherwise
3. Cypher path returns null on failure → fall back to Postgres so behavior is never worse than today

### 7.5 Operational lessons learned (2026-05-17)

**Lesson 1 — Railway's internal hostname is NOT the database name.** Railway slugifies the SERVICE name. Service named `Neo4j Graph Database (Metal-Ready)` does NOT have internal hostname `neo4j.railway.internal`. Get the real hostname from the Neo4j service's **Networking** tab → "Private Networking" section.

**Lesson 2 — Reference variables resolve to empty string if source is missing.** `${{<service-id>.NEO4J_URI}}` on the api-server resolves to `""` if `NEO4J_URI` doesn't exist on the Neo4j service. The api-server then treats it as "Neo4j not configured" and silently skips all mirror passes. Always verify the source variable exists.

**Lesson 3 — The mirror chain must never fail the deploy.** Mirror failures are logged as `⚠ ... non-fatal — Postgres reads unaffected` and the deploy continues. This protects against transient Neo4j outages causing customer-facing 503s.

**Lesson 4 — Backfill is the recovery primitive.** Whenever Neo4j is suspected of drift, re-run the backfill scripts. Pure mirrors are idempotent and safe; cumulative writes between mirror runs are captured.

---

## 8. The LLM layer

### 8.1 Model selection

All chat-completion calls go through OpenRouter unless explicitly otherwise. Two patterns:

**Single-shot calls** — direct fetch to `openrouter.ai/api/v1/chat/completions`. Default model `anthropic/claude-sonnet-4.6` (or `anthropic/claude-haiku-4.5` for `/api/insights`). Overridable via `LLM_MODEL` env var. Used in: `services/alpha/{enrich,thesis}.ts`, `services/enrichment/runners.ts`, `services/vcr/tools.ts`, `services/agent/tools.ts`, `routes/{insights,assess,dynamic-industries}.ts`.

**Fallback chain** — `services/llm-fallback.ts` exports `chatWithFallback()` + `EDITORIAL_FALLBACK_CHAIN = ["anthropic/claude-sonnet-4.6", "anthropic/claude-haiku-4.5", "z-ai/glm-5.1"]`. Cascades on OpenRouter budget/credit errors so a single-model price spike never takes the pipeline offline. Used by `ideation.ts` and other editorial-JSON paths.

### 8.2 The `glmJson` historical naming bug

Function names like `glmJson()` / `glmSynthesize()` in the codebase historically called Claude Sonnet 4.6, not GLM. Confusing. Most were renamed to `openrouterChatJson()` / `openrouterSynthesize()` on 2026-05-17. A few remain in `services/vcr/tools.ts` (`glmCall`) with an inline comment explaining the situation — kept to avoid sweeping renames the user explicitly declined.

### 8.3 Perplexity

`scripts/src/perplexity-client.ts` wraps `api.perplexity.ai/chat/completions`. Default model `sonar-pro` for grounded web research. Used by: seed scripts (gdp-weights, reference-orgs, organizations), enrichment pipeline (`services/enrichment/runners.ts`), VCR campaigns, deep-dive bot action.

### 8.4 Anthropic direct

`@langchain/anthropic` used in:
- Weekly prompt optimizer (`services/agent/optimizer.ts`)
- The 5 specialized agents' reasoning (via `runReactAgent` in `services/agent/base-agent.ts`)
- Memory consolidation (`services/agent/consolidator.ts`)
- Direct ChatAnthropic.invoke() in the core agent's `memorize` node

Requires `ANTHROPIC_API_KEY`. Graceful-degrade: missing key → optimizer + specialized-agent reasoning silently skip, scheduler logs warning.

---

## 9. Required env vars

| Var | Required? | Used by | Failure mode if unset |
|---|---|---|---|
| `DATABASE_URL` | YES | Everything (api-server, scripts, drizzle) | `lib/db` throws on import; nothing starts |
| `PORT` | YES (Railway-injected) | `api-server` listen | Throws on boot |
| `OPENROUTER_API_KEY` | Feature-gated | All LLM synthesis paths | enrich/thesis/assess/insights routes 500; fallback chain offline |
| `PERPLEXITY_API_KEY` | Feature-gated | All seed scripts that source from Perplexity; enrichment; VCR; bot deep-dive | Seeds skip gracefully; enrichment + VCR throw |
| `ANTHROPIC_API_KEY` | Feature-gated | Weekly optimizer + 5 specialized agents | Cron skips silently |
| `LLM_MODEL` | Optional | Overrides default model for single-shot OpenRouter calls | Falls back to default (Sonnet 4.6) |
| `MEM0_BASE_URL`, `MEM0_API_KEY` | Feature-gated | Core agent memory recall + store | Agent runs degrade; recall returns 0 memories |
| `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` | Feature-gated | `graphMemory.ts`, `capabilityGraphSync.ts`, both backfills | Mirror phase skipped; Neo4j reads fall back to Postgres |
| `USE_NEO4J_CAPABILITY_GRAPH` | Optional (default 0) | `disruption.ts:computeDisruptionRisk` only | Postgres 1-hop path used |
| `ADMIN_API_KEY` | YES for admin routes | `requireAdmin` middleware | Admin routes 401 |
| `ADMIN_AUTH_BYPASS=1` | Optional (LOCAL DEV ONLY) | Disables `requireAdmin` check | NEVER set in production |
| `FOUNDRY_TOKEN` / `PALANTIR_TOKEN` | Optional (DB-managed preferred) | EDGAR/SEC ingestion | Foundry sync skipped |
| `ADMIN_NOTIFY_EMAIL` | Optional | Foundry token expiry email alert | No alert sent |
| `RESEND_API_KEY` | Optional | All transactional email | Email send returns false; no crash |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Required for billing | `routes/stripe-webhook.ts`, marketplace | Billing 500s |
| `CLERK_SECRET_KEY` | Required for auth | All authenticated routes | Auth fails |
| `DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID` | Optional | `seed:marketplace`, `seed:reports` | Demo seed skipped |
| `BASE_PATH` | Optional (default `/`) | Vite build | SPA fallback breaks if non-root and wrong |
| `LOG_LEVEL` | Optional (default `info`) | Pino logger | Default verbosity |
| `NODE_ENV` | Optional | Various | dev-mode behaviors |
| `FRONTEND_DIST_PATH` | Optional | api-server SPA static path | Defaults to monorepo layout |
| `SKIP_<NAME>_SEED=1` | Optional per-seed | `deploy-migrate.ts` chain | That seed skipped |
| `SKIP_MIGRATE=1` | Optional (emergency) | `deploy-migrate.ts` | All 4 phases skipped |
| `SKIP_NEO4J_MIRROR=1` | Optional | Phase 4 only | Neo4j mirrors skipped |
| `RESET_REFERENCE_ORGS=1` | Optional (destructive) | `seed-reference-orgs.ts` | Deletes existing `seed:reference:*` rows before re-populating |
| `FORCE_REFERENCE_ORGS_REFRESH=1` | Optional | `seed-reference-orgs.ts` | Bypasses 90-day refresh window |
| `SEED_ORGS_VERBOSE=1` | Optional | `seed-organizations.ts` | Restores per-org log lines |

---

## 10. Frontend

68-page React 19 SPA in `artifacts/inflexcvi`. Vite 7, Tailwind v4 (semantic tokens, no hardcoded colors), wouter for routing (NOT React Router), TanStack Query via Orval-generated hooks. shadcn/ui (Radix + Tailwind).

Session token + industry id in localStorage as `ce_session_token` / `ce_industry_id` (legacy naming, will likely rename to `cvi_*` in a future sweep).

Many pages bypass the generated hooks and call `fetch` directly with hardcoded `const API_BASE = "/api"`. When changing the API base, grep for `API_BASE` — `setBaseUrl()` alone won't redirect those.

---

## 11. Audit and observability

| Surface | What | Where |
|---|---|---|
| Structured logs | Pino JSON, fields `req_id`, `method`, `route`, `status`, `latency_ms` | All routes |
| Agent runs | One row per run with status, duration, error | `agent_runs` table |
| Bot actions | One row per discrete action (success or skip) with `costCents` | `bot_actions` table |
| Bot workflow runs | One row per multi-step workflow invocation | `bot_workflow_runs` + `bot_workflow_steps` |
| LLM usage | One row per OpenRouter call with model, endpoint, costCents | `llm_usage` table |
| Audit log | Admin actions (key rotation, etc.) | `admin_audit_log` table |
| Hedera audit chain | Tamper-evident anchor for admin rotation events + capability snapshots | `audit_chain` table + HCS topic |
| Health endpoint | `/api/health/services` reports `mem0`, `letta` (legacy field), `neo4j`, `openrouter`, `perplexity`, `redis` status (`ok` / `degraded` / `down` / `not_configured`) | `services/health/probes.ts` |
| Bot workflow admin UI | List + manually trigger + step-trace view | `admin.tsx` → System → "Bot Workflows" panel |
| Synthetic agents admin UI | Provision / pause / disable / budget edit / activity feed | `admin.tsx` → System → "Synthetic Agents" panel |

---

## 12. What this doc deliberately doesn't claim

To avoid the overclaim pattern that motivated this doc:

- **Neo4j is NOT yet the primary read path for Cascade, Fragility, Explainability, Stack Optimizer, generateInsightsTool, Alpha tabs, or business cases.** These all read Postgres. Migration is incremental and gated by `USE_NEO4J_CAPABILITY_GRAPH=1`.
- **Multi-bot output is NOT included in marketed user counts or ARR figures.** Bots are operational infrastructure, not revenue contributors.
- **The reference-org list is NOT hardcoded** as of the May 2026 refactor, but it IS sourced from a single hand-curated criterion (the rule text). The defensibility surface is the rule itself.
- **Capability dependency edges are SPARSE** (~30 edges for 348 caps as of 2026-05-17). Cypher traversals are interesting in theory; the actual graph is shallow. Edge density growth is on the enrichment-agent's roadmap.
- **Letta is GONE**, not "being deprecated." Any code or doc still referencing live Letta usage is stale.
- **There is NO Clerk signup webhook handler.** The `user.signed-up` bot trigger is a stub.

---

## 13. Companion documents

| Doc | Use it when |
|---|---|
| `CLAUDE.md` | Working in the repo — commands, conventions, do-not-do list |
| `replit.md` | Product description; user-facing surface |
| `docs/business-spec.md` | Strategy, market sizing, business model |
| `docs/pitchbook.md` | Investor-facing narrative |
| `docs/railway-setup.md` | Provisioning Railway services from scratch |
| `docs/install-mem0-letta-railway.md` | Self-hosting Mem0 (Letta section is historical) |
| `docs/limited-production-readiness.md` | Pre-launch audit + remediation log |
| `docs/agent-learning-loop.md` | Weekly prompt optimizer architecture |
| `docs/architecture-spec.md` v2.0 | Older deep spec — superseded by THIS doc for any Neo4j / agent / bot / workflow / reference-org claims. Still authoritative for CVI Bayesian math, EVaR/Fragility/Moat formulas, and the design-axiom philosophy. |

If THIS doc disagrees with any of the above, **THIS doc wins** for the subsystems it covers (everything in §1-12).
