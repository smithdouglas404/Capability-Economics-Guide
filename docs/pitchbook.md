# Inflexcvi

## Investor Pitchbook — PE / VC Edition

**Confidential — May 2026**
**Audience:** Private Equity Operating Partners, Venture Capital Investment Committees, and their technical & financial diligence teams.
**Companion documents:** `docs/architecture-spec.md` (technical reference), `docs/business-spec.md` (strategy reference). This pitchbook is the synthesis layer; the spec documents are the load-bearing diligence material.

---

## TABLE OF CONTENTS

**Part I — The Investment Thesis**
- Slide 1. Cover
- Slide 2. The Insight That Changes Everything
- Slide 3. The Problem (For Three Buyers)
- Slide 4. The Solution: The Capability Value Index (CVI)
- Slide 5. The Product — A Walk Through What Is Live Today
- Slide 6. The Moat — Five Compounding Defensibilities
- Slide 7. Market Size and Sizing Methodology
- Slide 8. Business Model and Pricing Architecture
- Slide 9. Traction — What Is Genuinely Shipped
- Slide 10. Competitive Landscape
- Slide 11. The Team
- Slide 12. Financials and Operating Model
- Slide 13. The Ask — Seed or Series A
- Slide 14. Why Now
- Slide 15. Closing

**Part II — Diligence Appendices**
- A1. Technical Due-Diligence Appendix
- A2. PE Operating-Partner Use Cases
- A3. VC-Specific Use Cases
- A4. Risk Register and Mitigations
- A5. Unit Economics Deep-Dive
- A6. Comparable-Company Analysis
- A7. Detailed Use of Funds with Milestones
- A8. Glossary of Inflexcvi Terms

---

## SLIDE 1 — COVER

# Inflexcvi

*The institutional intelligence layer for organizational capabilities — the "Bloomberg Terminal" for what actually drives enterprise value.*

**Making the invisible visible. Making the intangible measurable. Making capability investment defensible at the partner level.**

A live, autonomous research and analytics platform that quantifies organizational capabilities as economic assets — with explicit uncertainty, dependency-aware impact modeling, and a human-in-the-loop governance layer that prevents AI hallucination from leaking into client deliverables.

**One sentence for an investment committee:** Inflexcvi turns the $280B/year qualitative capability-assessment industry into a software-margin product, anchored by a proprietary, accumulating dataset that compounds with every research cycle and is governed by an institutional-grade review queue.

---

## SLIDE 2 — THE INSIGHT THAT CHANGES EVERYTHING

**Every organization has capabilities. No one knows what they're worth — and no one has built the system to find out continuously.**

A bank that detects fraud in 200ms vs. 2,000ms is not "more efficient." It is operating a measurably distinct economic asset: lower loss-given-fraud, lower customer churn from disputes, lower regulatory friction, and meaningfully higher net interest margin per dollar of risk-weighted assets. Yet that asset never appears on a balance sheet, never earns a multiple in a sale process, and never drives a board agenda until a crisis arrives.

A hospital system that turns a bed in 4 hours instead of 8 hours is not just "operationally better." It is monetizing a compounding asset across 500 beds, 365 days, for a 10+ year horizon. The capability has a quantifiable NPV. It has a half-life. It has a velocity (improving or eroding). And it has a dependency graph — bed turnover sits downstream of EHR integration, environmental services scheduling, and discharge planning capabilities, so improvement is not unilateral.

**The structural problem:** Capabilities are assessed qualitatively, inconsistently, and only when a consultant charges $1–$3M to look. Then the findings sit in a 200-page PowerPoint, expire in 18 months, and never reconcile across functions. There is no continuous monitoring layer. There is no benchmarking layer. There is no economic-quantification layer. There is no AI-native research layer. And there is certainly no layer that does all four together with auditable provenance.

**The opportunity:** Build that layer. Ship it as software. Govern it with human review so it is investable, not experimental. Accumulate proprietary research data with every cycle so the moat is genuinely path-dependent. Price it tier-by-tier so it lands at the analyst desk and expands to the partner suite.

That platform exists. It is running. This pitchbook describes it for capital allocators.

---

## SLIDE 3 — THE PROBLEM (FOR THREE BUYERS)

The platform addresses a single underlying market failure — the absence of quantified, continuous, benchmarked capability intelligence — but presents through three distinct buyer entry points.

### The Operator (Chief Strategy / Transformation Officer)
> *"I'm spending $400M on digital transformation this year. I have no quantified view of which capabilities that investment will actually improve, no way to benchmark our trajectory against peers, and no AI-grade research engine sitting next to my team."*
> — Chief Transformation Officer, Fortune 100 Insurer

**Pain in dollars:** McKinsey reports 70% of large transformations miss their objectives; on a $400M program, that is $280M of at-risk capital with no instrumented baseline.

### The Investor (PE Operating Partner)
> *"We acquired this company for $2.8B. Eighteen months later we discovered the underwriting capability was a decade behind peers. That wasn't in the data room. Our QofE looked clean; the operational reality was not."*
> — Operating Partner, Top-10 PE Firm

**Pain in dollars:** PwC's 2024 M&A Report attributes ~$340M of average value destruction in failed deals to overestimation of operational capability — a category that inflexcvi intelligence directly addresses pre-LOI and during the 100-day plan.

### The Capital Allocator (VC Partner / Thesis Investor)
> *"We're building a thesis on industrial AI. We know the categories. We don't have a structured way to compare which incumbents have the underlying data and process capabilities to absorb AI displacement vs. which will be erased by it. We're triangulating off podcasts."*
> — Partner, Top-Quartile Venture Fund

**Pain in dollars:** Thesis-driven funds underwrite portfolio construction over a 7–10 year window. A inflexcvi view changes which incumbents look like wedge customers vs. which look like soon-to-be-disrupted distribution.

**All three buyers. Same product. Same data. Three different entry points.** And — crucially — the same back-end research engine, which means each new vertical, each new buyer cohort, contributes data into the same proprietary corpus.

---

## SLIDE 4 — THE SOLUTION: THE CAPABILITY ECONOMICS INDEX (CVI)

**A live, governed, AI-native intelligence platform that quantifies the economic value of organizational capabilities.**

The platform is not a dashboard, not a report subscription, and not a consulting engagement. It is a closed-loop research and analytics system whose outputs are continuously refreshed and whose intermediate work product is auditable end-to-end.

### What is shipped today (May 2026)

| Dimension | Shipped State |
|---|---|
| Capabilities catalog | **348 leaf capabilities** across 6 industries with dual descriptions (traditional + economic), each carrying TAM, SAM, margin %, half-life, and revenue-exposure economics. Top-level capabilities auto-decompose into 4–6 sub-capabilities via Haiku 4.5. |
| Industries covered | **6 industries seeded** — Insurance, Healthcare, Banking & Financial Services, Manufacturing, Technology, Retail. Each industry has Perplexity-cited GDP weights feeding the CVI weighted rollup. |
| Reference orgs | **60 reference organizations** auto-populated per a stored, citable criterion (top N per industry by TTM revenue, mixing public + largest known private, intl coverage). Every org carries a source URL. Refreshes quarterly via cron. Replaces the prior hand-picked list. |
| Inflexcvi Alpha analytical surface | **10 distinct analytical tabs** (EVaR, Cascade, Narrative Δ, Moat, Fragility, Arbitrage, Flows, Talent, M&A Twin, Thesis) |
| Research engine | **Perplexity Sonar + Claude Sonnet 4.6 (via OpenRouter, swappable per-deploy via `LLM_MODEL` env var, with Haiku 4.5 → GLM 5.1 cascade on credit/budget errors)** dual-source architecture; every numeric claim traces back to either a cited URL or a deterministic computation over cited data |
| Job orchestration | **BullMQ + ioredis durable queue** (queue name `enrichment`, concurrency=1, attempts=3, exponential backoff at 5s; TLS auto-detect via `rediss://`); jobs survive process restart |
| Long-form research | **VCR (Virtual Capability Researcher)** — LangGraph-orchestrated multi-day research campaigns with intake → daily research cycles → cross-validated synthesis → executive report |
| Autonomous agent system | **6 LangGraph agents** running on a shared `PostgresStore`: the core CVI research agent + 5 specialized agents (Macro Event, Disruption, Ontology, Peer-Coop, Stack Optimizer) with a weekly Claude-driven prompt optimizer and HITL learning loop |
| Graph engine | **Neo4j wired for agent extracted-entity memory** (`memory_entities` / `memory_relations` mirrored as `:Entity` nodes in `services/agent/graphMemory.ts`); Cypher queries power `findCorrelations()` / `findRelated()` / `getGraphStats()` for agent entity recall, with PostgreSQL fallback on connection error. **Capability dependency traversals (Cascade, Fragility, Explainability) still read Postgres `capability_dependencies` directly** — the capability graph has not yet been mirrored to Neo4j. Migration in flight. |
| Disruption Velocity Index (DVX) | Computed every 30 min across all 348 capabilities; signal-event detection finds ~1,000 new capability-pair events per cycle and writes them to `cvi_signals` with provenance. |
| Governance | **HITL Review Queue** — every new capability draft (including those generated by the discovery agent) lands in `pending_review`; the public catalog filters on `reviewStatus='approved'` so no unreviewed AI output is ever served to a paying customer |
| Memory | **Self-hosted Mem0 (on Railway) + PostgresStore** — institutional memory recalled at every agent decide-phase; not decoration. (Letta was removed in Phase 1.9 Step 6 — replaced by PostgresStore namespaced reads/writes.) |
| Audit chain | **Hedera Consensus Service (HCS)** anchors admin-rotation events and capability snapshots on-chain; explorer UI in admin surface. |
| Synthetic-agent (Bot) framework | **5 persona templates, 1 active at launch (PE Partner)** with hard per-bot budget caps ($40/mo ceiling, $10-15/mo operating target). Bots provision atomically across 8 identity tables and exercise 7 action types (browse, assessment, reflection, comment, marketplace, deep-dive, cross-bot-reflect) on a persona-specific cadence. Disclosed as synthetic in the UI; emails use RFC 2606 `.test` TLD so they can never resolve to real recipients. |
| Foundry (Palantir) integration | DB-managed token rotation via `system_secrets`; admin UI for rotation; 30-min Resend email alert when token nears 60-min expiry. Used for SEC/EDGAR enrichment ingestion. |
| Pricing | **Three live membership tiers + PAYG credits** — Briefing $299/mo or $2,990/yr; Workbench $1,499/mo or $14,990/yr; Platform $25,000/yr (contact-sales); plus pay-as-you-go credit packs for one-off VCR campaigns and NL-query usage |
| Marketplace | Two-sided marketplace for capability research listings + reports; Stripe Connect for payouts; auto-archive at 30 days. |
| Security | **`requireAdmin` middleware** enforcing `x-admin-key === ADMIN_API_KEY` on every mutating endpoint in production; admin API key itself rotatable via DB-managed `system_secrets` (no Railway redeploy needed) |

### Why this matters to a PE/VC underwriter

The platform is not a science project. It has the controls one would expect to see at a Series B fintech: durable job queue, admin auth on mutating endpoints, human review gating on all AI-generated public content, structured logging, and a typed contract layer (OpenAPI 3.1 → Orval → typed React hooks + Zod validators) that makes API drift a compile error rather than a production incident.

It is not a category-creation pitch resting on a deck — it is institutional infrastructure with an early but real product surface, ready to absorb capital deployed against well-understood expansion vectors (more industries, more analytical tabs, more VCR capacity, enterprise sales).

---

## SLIDE 5 — THE PRODUCT — A WALK THROUGH WHAT IS LIVE TODAY

This section walks an investor through what they would see if they logged into the platform right now. Every page named is in `artifacts/inflexcvi/src/pages/`. Every API route is in `artifacts/api-server/src/routes/`. Every database object referenced is defined in `lib/db/src/schema/`.

### 5.1 The Inflexcvi Alpha Analytical Surface — Ten Tabs of Capability-Level Intelligence

The Alpha page (`pages/alpha.tsx`) is the analytical heart of the product. It exposes ten tabs, each computing a different lens on the same underlying capability dataset. Each tab is one-click reachable; each has a defined formula documented in the in-product Traceability dialog; each row carries source provenance (Perplexity citation URLs and LLM-generated rationale text) accessible via an info popover.

| # | Tab | One-line value proposition | What it answers |
|---|-----|---------------------------|------------------|
| 1 | **EVaR** (Expected Value at Risk) | $ at risk over 12/24/36 months from each capability, computed as `revenueExposure × margin × max(halfLifeDecay, marketErosion)` | "Which capabilities are quietly putting margin in jeopardy on a defined horizon?" |
| 2 | **Cascade** | Dependency-graph impact propagation with per-edge probability and dollar impact | "If this capability degrades, what is the downstream blast radius and over what time-to-impact?" |
| 3 | **Narrative Δ** | Quadrant-by-quadrant delta between CE's proprietary view and visible market consensus | "Where is the consensus view of this capability wrong, and by how many quadrant-steps?" |
| 4 | **Moat** | Weighted 0–100 score from half-life, depth, economic impact, stickiness, and concentration | "Which capabilities are genuine fortresses vs. contestable vs. exposed?" |
| 5 | **Fragility** | Risk score from decay speed, upstream depth, supplier concentration, disruption pressure, and Edge Shock | "Which capabilities look healthy but are structurally brittle?" |
| 6 | **Arbitrage** | Long/short signals from CE-implied valuations vs. consensus, using quadrant multiples (hot=15×, emerging=10×, table-stakes=4×, declining=1×) | "Where is the spread between CE's view and the street large enough to underwrite a directional bet?" |
| 7 | **Flows** (Capital Flows) | Sums capital investment across value-chain stages where data exists | "Where is real capital being deployed in the value chain, and where is it under-invested?" |
| 8 | **Talent** | Bottleneck capabilities mapped via company-to-capability density and core talent counts | "Where is talent the binding constraint on capability deployment?" |
| 9 | **M&A Twin** | Token-overlap analysis (≥0.5) between industries to surface synergy opportunities and quadrant clashes | "Which cross-industry capability twins make a defensible M&A thesis, and which create integration risk?" |
| 10 | **Thesis** | Claude-Sonnet-4.6-synthesized 7-section investment memo grounded in the capability's full Alpha record + cited sources | "Give me a defensible, structured investment view of this capability in the format I would deliver to my IC." |

Each tab is not a static visual — it is a query-time computation against the live `capabilities` and `capability_alpha` tables, with dependency math drawn from `capability_dependencies` and `dependency_edge_scores`. Graph traversals run against Neo4j when configured (PostgreSQL fallback otherwise). When the underlying enrichment refreshes (via the BullMQ-backed pipeline), every tab updates. There is no manual rebuild.

### 5.2 The VCR — Virtual Capability Researcher

The Alpha tabs answer questions about capabilities that have already been enriched. The **Virtual Capability Researcher (VCR)** answers a different question: *given a research mandate that does not fit a one-shot prompt, how do we run a multi-day, cross-validated investigation that culminates in a defensible executive report?*

VCR is implemented as a LangGraph-orchestrated campaign system (`services/vcr/`). The lifecycle:

1. **Intake** — campaign objective, target industries/capabilities, validation depth, and stop conditions are persisted into `vcr_assessments`.
2. **Daily research cycles** — each cycle (`vcr_cycles`) issues a structured research plan, fans out to Perplexity Sonar with multiple framings, captures every finding into `vcr_research_items` with a confidence score, and cross-validates findings across sources before promoting them.
3. **Synthesis** — at campaign end, the LLM synthesis layer (Claude Sonnet 4.6 default; overridable via `LLM_MODEL`) produces a structured executive report with cited evidence.
4. **Delivery** — campaigns are visible at `/vcr` with progress, cycle-by-cycle drilldown, and a final report surface.

This is the surface that supports PE-style operational diligence and VC-style thesis development without forcing the user to scaffold the research themselves.

### 5.3 The HITL Review Queue — Why a PE/VC Buyer Can Trust the Output

The single most important governance feature in the platform is the **Human-In-The-Loop (HITL) Review Queue**. It is the answer to the question every sophisticated buyer asks: *"Yes, but how do you stop the AI from publishing nonsense to my partners?"*

The mechanics (`routes/review.ts`, `pages/review-queue.tsx`):

- **Submission** — `POST /api/review/draft` accepts a new capability draft, immediately enqueues both alpha and detail enrichment via the BullMQ pipeline, and writes the row with `reviewStatus='pending_review'`.
- **Queue surface** — `GET /api/review/queue` lists pending capabilities with a `previewReady` flag (true once enrichment is complete) and the live `queuePosition` from BullMQ for any capability still in flight.
- **Approve** — `POST /api/review/:id/approve` flips `reviewStatus='approved'`. This is the only path through which a capability becomes visible in the public catalog.
- **Reject with comment** — re-enqueues enrichment with the reviewer's `revisionGuidance` injected into the prompt; the row stays `pending_review` and `revisionCount` increments.
- **Reject without comment** — hard delete.
- **Discovery agent integration** — capabilities discovered by the autonomous discovery agent are inserted with `submittedBy='discovery_agent'` and land in the same queue. The agent can never bypass review.
- **Public catalog filtering** — every public-facing endpoint that surfaces capabilities filters on `reviewStatus='approved'`. This is enforced at the query layer, not at the UI layer.

For a PE/VC buyer, this is the difference between a research product and a research demo. Hallucination cannot leak. Provenance is enforced. Reviewer revision history is captured (`reviewNotes` jsonb, `revisionCount` integer). The system is auditable.

### 5.4 Membership Tiers — Three Lanes, One Platform

The product is monetized through three live, admin-editable tiers (`pages/membership.tsx`, `lib/db/src/schema/membership.ts`).

| Tier | Slug | Price | Buyer | Wedge |
|------|------|-------|-------|-------|
| **Briefing** | `briefing` | **$299/mo or $2,990/yr** | Individual analyst, junior partner, research professional | Read-only access to the framework, the 348-capability catalog, the 6 industries, and the full 10-tab analytical surface in browse mode |
| **Workbench** | `workbench` | **$1,499/mo or $14,990/yr** *(highlighted as Most Popular)* | Operating team lead, VP Strategy, mid-market consultant | Full Workbench page, run-it-yourself capability assessments, gap-analysis radar, organization-level workspace, VCR access subject to capacity allocation |
| **Platform** | `platform` | **$25,000/yr** *(price-locked, contact sales)* | Fortune 500 strategy team, PE platform-wide deployment, large consulting firm | Multi-seat platform deployment, expanded VCR capacity, custom industry seeding pipeline, dedicated review-queue throughput |
| **PAYG** | `payg` | per-credit pricing | Light-touch users, project-specific spend | Pay-as-you-go credit packs for one-off VCR campaigns, NL queries (4 credits each), and on-demand assessments — no monthly commitment |

The tiers are not aspirational — they are live in production, listed at `/membership`, served from `/api/membership/tiers`, and editable through the admin editor at `/admin` via an admin-gated `PATCH /api/membership/tiers/:id`. The pricing in this document is the pricing in the database, not a mock.

### 5.4b The Synthetic-Agent (Bot) Framework — How We Bootstrap Activity Data Without Faking It

A research and benchmarking platform faces a cold-start problem: peer-benchmark cells need contributors, agent learning loops need feedback signal, and marketplace surfaces need listings — but the platform is too new to have all of that from real customers on day one.

The Bot framework (`services/bots/`) solves this honestly. It is a **disclosed, capped, fully-provisioned synthetic-agent system** that exercises every customer-facing workflow end-to-end as if it were a real onboarded user, with hard guardrails to prevent abuse or runaway cost.

**What a bot is.** A synthetic agent with a full persona template — name, demographics, address, professional role, behavioral biases, industry focus. On provisioning (`provisioning.ts`), one DB transaction inserts rows across 8 tables: `organizations`, `kyc_verifications`, `user_memberships`, `billing_organizations`, `billing_org_members`, `credit_accounts`, `bots`, plus the synthetic Clerk/Stripe IDs (`bot_cus_*`, `bot_sub_*`, `bot_sess_*`) that prefix everything as bot-origin in logs and audit trails.

**5 personas defined; 1 active at launch.** The registry (`personas.ts`) holds: Marcus Chen (Financial Services / PE Partner), Priya Raghavan (Technology), James Okonkwo (Insurance), Khalid Al-Sayed (Energy), Sarah O'Brien (Healthcare). Per the user's launch decision, only Marcus is active on day one; the others are admin-spawnable.

**7 action types per bot.** The bot tick loop (`loop.ts`) decides which actions are due each cycle based on persona cadence: `browse` (capability browsing patterns), `assessment` (full org capability assessments), `reflection` (the bot reflects on its own observations), `comment` (annotates capabilities), `marketplace` (creates research listings), `deep-dive` (Perplexity-driven research), `cross-bot-reflect` (bots reflecting on each other's outputs — turns into a cooperative learning signal as more bots come online).

**Hard budget caps.** Each bot has `monthlyBudgetUsdCap` (default $40/mo). The action loop checks the budget *between every action* — if the cap is exhausted mid-tick, the rest of the tick aborts and the skipped actions are logged. Realistic per-bot operating spend trends to $10-15/mo at full cadence; the $40 ceiling is a safety margin.

**Why this is not "fake users."** Three honesty controls:

1. **UI disclosure.** Every bot-authored artifact (assessment, comment, marketplace listing) renders with a "Synthetic agent · [Persona]" badge in the customer-facing UI. No real customer ever sees a bot output without that label.
2. **Unresolvable emails.** All persona emails use the RFC 2606 reserved `.test` TLD. The email columns are populated authentically for DB-shape purposes but no real recipient can ever receive a message at one of them.
3. **Audit trail.** Bot actions write to `bot_actions` with full provenance — every action is grep-able by `bot_*` prefix and visible in the admin audit log.

**What this buys the business.**
- **Cold-start fix.** Peer-benchmark cohorts have non-empty contributors from day one. Cross-bot-reflect simulates the "second contributor effect" that real cohorts need.
- **Continuous integration for the customer journey.** Every change to the onboarding/assessment/billing flow is exercised by a bot daily — regressions surface before a real customer encounters them.
- **Realistic operational telemetry.** Daily action volume, budget consumption, and error rates accumulate against a known persona, giving us baseline performance data to compare real customer behavior against.

**What we are explicit it is NOT.** Bots do not contribute to marketed user counts, ARR, or revenue metrics. The financials in Slide 12 exclude all bot-origin activity. The framework is operational infrastructure, not a vanity metric.

### 5.5 Other Pages Currently Live

The frontend is a **68-page React 19 SPA** (`artifacts/inflexcvi/src/pages/`) organized into seven surfaces:

- **Core analytical:** `alpha`, `cvi-dashboard`, `knowledge-graph`, `disruption`, `compare`, `coverage`, `simulation`, `whatif`, `trade-signals`, `watchlist`, `nl-query`, `search`, `companies`, `benchmarking`, `scorecard`, `roi-tracker`, `backtest`
- **Workflow tools:** `assess`, `workbench`, `vcr`, `review-queue`, `c-suite`, `insights`, `patterns`, `innovation-pipeline`, `innovation-wedge`, `projects`, `collaboration`, `exports`, `lifecycle-docs`, `regulations`, `case-studies`, `case-study`, `capability-detail`
- **Account & onboarding:** `home`, `onboarding`, `accept-invite`, `account`, `organization`, `dashboard`, `membership`, `console`, `usage`, `kyc`, `security`, `system-status`, `methodology`, `developers`, `proof`, `demo`
- **Marketplace:** `marketplace`, `marketplace-library`, `marketplace-listing`, `marketplace-sell`, `marketplace-workspace`
- **Embedded widgets:** `embed-capability`, `embed-cvi`
- **Examples:** `insurance-example`, `workbench-example`, `explore`
- **Admin:** `admin`, `admin-agent-proposals`, `admin-audit-chain`, `admin-case-studies`, `admin-economic-rules`, `admin-payments`, `admin-source-quality`
- **Catch-all:** `not-found`

Every page is backed by a typed API contract validated by Zod schemas generated from the same OpenAPI 3.1 specification.

---

## SLIDE 6 — THE MOAT — FIVE COMPOUNDING DEFENSIBILITIES

Investors rightly ask: *what stops a well-funded competitor from cloning this?* The honest answer has five layers, each compounding with time and use rather than depending on a single trade-secret claim.

### 6.1 Accumulating Proprietary Capability Dataset

Every research cycle writes durable rows into `capability_alpha`, `capability_dependencies`, `dependency_edge_scores`, and `vcr_research_items`. Each row carries cited provenance (Perplexity URLs, LLM rationale, confidence scores). Twelve months of three-times-daily research compounds into:

- **~3,000 agent memories** in self-hosted Mem0 (on Railway) across observation/pattern/insight/decision-context types — recalled at every agent decide-phase
- **~4,000 source triangulations** in `source_triangulations`, each carrying methodology + sourceUrl + rationale
- **~500 CVI snapshots** time-series across 6 industries
- **~10,000+ CVI signal events per month** auto-detected by the disruption-agent across 10,000+ capability-pair comparisons every 30 min
- A growing graph of LLM-scored dependency edges with probability, time-to-impact, and dollar-impact estimates — traversed via Neo4j Cypher queries in the primary read path

A competitor launching today with the same model stack cannot replicate this corpus. They can rent the same APIs; they cannot rent the prior research cycles. **Every research cycle widens the gap. The moat is path-dependent.**

### 6.2 HITL Governance Preventing Hallucination Leakage

The single largest attack vector for a competitor is to undercut on speed by skipping human review. That competitor will, with statistical certainty, publish an embarrassing capability score within their first quarter — and lose the institutional buyer for three years.

We have institutionalized the opposite tradeoff. The HITL review queue, the `reviewStatus='approved'` filter at the public catalog query layer, the `revisionGuidance` re-enrichment loop, and the `submittedBy='discovery_agent'` provenance tagging together create a governance perimeter that institutional buyers (PE firms, F500 strategy desks, regulated industries) require as a precondition for procurement. This is not a feature; it is a market-access prerequisite, and it ships today.

In addition, a **weekly Claude-driven prompt optimizer** runs across all 6 autonomous agents, mining the HITL queue's accept/reject patterns and feeding distilled guidance back into each agent's system prompt — turning every rejection into a measurable improvement in the next cycle.

### 6.3 Institutional Memory — Recalled, Not Decorative

Memory is two-layered: **self-hosted Mem0** (running in our Railway project, not the Mem0 Cloud SaaS) for semantic recall, plus **PostgresStore** for structured shared agent state (industry priors, current focus, research strategy, market context). The core CVI research agent's `decide` phase issues a semantic similarity query at the start of every cycle and injects the top-K relevant memories into the LangGraph state. This means each research cycle is informed by every prior cycle without explicit key-value lookup — the agent's behavior continually improves as the corpus grows.

PostgresStore replaced Letta entirely in Phase 1.9 Step 6 (May 2026). The architectural reason: a single Postgres table with namespaced reads/writes (`NS.agentPriors(agentName)`, `NS.agentRuns(agentName)`) eliminated a second statefulness boundary (Letta as a separate service) and made all six agents reach a shared state store through the same primitives.

A competitor without this memory architecture re-discovers the same patterns each cycle. Our agents do not.

### 6.3b Multi-Agent System with Specialized Workers

Beyond the core CVI research agent, **five specialized autonomous agents** each own a domain and run on the shared PostgresStore:

| Agent | Cadence | What it does |
|---|---|---|
| **Macro Event Agent** | 30 min | Watches global macro signals (rates, GDP releases, regulatory events) and writes structured impact deltas to `macro_events` |
| **Disruption Agent** | 30 min | Scans the capability graph for new signal events (~1,000/cycle), classifies them by quadrant pressure, and queues high-confidence ones for the HITL queue |
| **Ontology Agent** | 30 min | Proposes new capability nodes + edges from external research; submissions land in `pending_review` |
| **Peer-Coop Agent** | 30 min | Maintains the peer-benchmark cohorts and tracks which orgs are valid comparators per industry+size+region |
| **Stack Optimizer Agent** | 30 min | Cost/latency optimizer for the LLM call graph — observes which model/route succeeded per task and writes recommendations into `agent_tuning` |

Each agent has its own LangChain `createAgent` (ReactAgent v1) graph with inline `tool()` definitions, runs against the shared store, and has its system prompt evolved by the weekly optimizer above.

### 6.4 The 10-Tab Analytical Toolkit Competitors Lack

Building one analytical tab against capability data is a few weeks of work. Building ten — each with its own formula, traceability surface, sourcing-popover UI, and consistent quadrant taxonomy — and shipping them as a coherent surface is approximately a year of focused engineering.

A would-be competitor's investor will reasonably ask: *which subset of these ten do you ship first?* The answer determines a 6–12 month head-start window during which our dataset compounds and our customer cohort locks in.

### 6.5 Multi-Model + Perplexity Dual-Source Rigor

We do not use a single model and we do not use a single research source. The architecture splits the work:

- **Perplexity Sonar (sonar-pro)** for grounded web research with citation URLs (epistemic role: evidence retrieval).
- **Claude Sonnet 4.6 (default) via OpenRouter** for strict-JSON synthesis of Perplexity prose into typed numeric fields plus rationale strings (epistemic role: structured reasoning over evidence). Swappable per-deploy via the `LLM_MODEL` env var without code change.
- **Three-model fallback chain (`services/llm-fallback.ts`)** — Claude Sonnet 4.6 → Claude Haiku 4.5 → GLM 5.1 — cascades automatically on OpenRouter budget/credit errors so a single-model price spike never takes the pipeline offline.

This split matters for two reasons. First, it diversifies model risk — no single foundation-model regression takes the platform offline, and budget cliffs trigger automatic graceful degradation, not outages. Second, it produces a reproducible pipeline: every numeric claim in the database was either cited or computed deterministically from cited values. That reproducibility is what makes the output defensible in a partner-level review.

### 6.5b Defensible Reference Set (no hand-picked anchors)

Peer benchmarks anchor against a set of **reference organizations per industry**. The set is **not hand-curated**. Instead, a single criterion (e.g., *"top 10 per industry by trailing-12-month revenue, mix of public + largest known private, at least 2 non-US, at least 1 disruptor or SMB where one materially exists"*) is stored in the DB, and a Perplexity-driven populator applies the criterion per industry on every deploy (with a 90-day refresh window). Every populated entry carries a source URL — entries without verifiable revenue citations are dropped, not padded.

The defensibility surface is the criterion itself: customers can audit the rule, propose changes, and re-run the populator. There is no "why is this org here and not that one" debate because the answer is always "the rule says so, and here is the source URL." This replaces the previous limitation of a hardcoded 12-org list that skewed toward US large-cap public companies with no declared selection criterion.

### 6.6 Cumulative Defensibility Stack

| Layer | Time-to-replicate for a well-funded competitor |
|---|---|
| 10-tab analytical surface | 9–12 months focused engineering |
| HITL governance pipeline + audit-grade provenance | 3–6 months of process design + engineering |
| 6-agent autonomous system on shared PostgresStore + weekly Claude prompt optimizer | 4–6 months engineering for the architecture; longer for the feedback corpus to compound |
| Self-hosted Mem0 + PostgresStore institutional memory architecture | 2–3 months engineering, but corpus takes 12+ months to compound |
| Neo4j graph engine for capability dependency traversals (with Postgres fallback) | 2–4 weeks engineering; minimal moat by itself but compounds with the dependency-edge corpus |
| Proprietary research corpus (~3,000 memories, ~4,000 triangulations, ~500 CVI snapshots, ~10K+ monthly signal events) | 12–18 months of cycle-time, irrespective of headcount |
| Multi-model fallback (Perplexity + Sonnet→Haiku→GLM cascade) | Trivial to set up, very hard to retrofit into an existing single-model architecture |
| Rule-driven reference set (criterion + Perplexity populator with required citations) | 1–2 weeks to copy the pattern; the rule text itself is the moat (and a customer-auditable artifact) |
| Hedera HCS audit chain anchoring admin actions + capability snapshots | 1–2 weeks engineering; the moat is the trust signal it creates for regulated buyers |
| DVX (Disruption Velocity Index) engine with auto-pattern matching | 2–3 months engineering; ongoing pattern library accretion is the durable advantage |

A competitor writing a $20M cheque today catches our product surface in roughly 12 months. They do not catch our corpus.

---

## SLIDE 7 — MARKET SIZE AND SIZING METHODOLOGY

We use a bottom-up methodology anchored in observable market signals, not top-down TAM from analyst slides. The methodology is preserved verbatim from `docs/business-spec.md §4` because nothing in the underlying market has changed and we want diligence teams to confirm it.

### 7.1 Anchors

1. Global management consulting revenue: ~$800B (Statista, 2025).
2. Capability assessment & benchmarking share: ~35% = **$280B** (based on service-line analysis from MBB annual reports).
3. Addressable via software (not requiring human consultants): ~15% = **$42B**. This is the TAM for capability-intelligence software — the market that exists because consulting firms have not yet built a durable software product to replace their assessment engagements.

### 7.2 Alternative anchor — Strategy Intelligence Software

- Gartner Strategy Management Software market: $8.2B in 2025, growing at 14% CAGR.
- Adjacent markets: Business Intelligence ($33B), GRC software ($16B).
- Inflexcvi carves a differentiated position: not BI (no capability framework), not GRC (no compliance focus), not Strategy SaaS (no continuous research engine).

### 7.3 Primary segment sizing

| Segment | Companies | Avg Spend Potential | SAM | Rationale |
|---------|-----------|--------------------|-----|-----------|
| Fortune 500 Strategy Teams | 500 | $25,000–$60,000/yr (Workbench/Platform blend) | $20–30M | CSO/CTO budget; replaces a fraction of consulting spend |
| Fortune 1000 (non-F500) | 500 | $15,000–$25,000/yr (Workbench-anchored) | $10M | VP-level buyer; smaller consulting budgets |
| Mid-market ($500M–$5B revenue) | ~3,000 | $5,000–$15,000/yr (Briefing + Workbench mix) | $30M | Underserved by consulting; highest value:cost |
| PE firms (AUM >$1B) | ~800 | $25,000–$75,000/yr (Platform + per-deal VCR) | $40M | Portfolio monitoring; due diligence; high ROI |
| Big 4 / Strategy Consulting | ~50 firms | $100,000+/yr (Platform + custom VCR capacity) | $5M | Internal tooling for client work |
| VC firms ($500M+ AUM) | ~600 | $10,000–$30,000/yr (Briefing/Workbench) | $10M | Thesis development; portfolio benchmarking |
| **Total SAM (US-only)** | | | **~$125M** | Conservative; excludes international and excludes data-licensing |

### 7.4 Year-3 SOM

Year-3 SOM target: **$8–12M ARR** at the lower end of the seed-funded path; **$18–25M ARR** under a Series-A-funded enterprise sales build. Both paths are mapped explicitly under "The Ask" (Slide 13) and "Use of Funds" (Appendix A7).

### 7.5 Why this market opens now

We treat the market timing as analytically separate from market size — see "Why Now" (Slide 14) for the temporal forces.

---

## SLIDE 8 — BUSINESS MODEL AND PRICING ARCHITECTURE

### 8.1 The Three Tiers (As Shipped, Live in Production)

| Tier | Monthly | Annual | Buyer | Primary Wedge |
|------|---------|--------|-------|---------------|
| **Briefing** | $299 | $2,990 (16% saving) | Individual analyst, junior partner, researcher | Read framework + 58-cap catalog + 10-tab Alpha browse |
| **Workbench** | $1,499 | $14,990 (17% saving) | Team lead, VP Strategy, consultant | Full Workbench, organization assessments, capability-gap radar, VCR access |
| **Platform** | n/a | $25,000 (contact-sales) | Fortune 500 dept, PE firm, large consultancy | Multi-seat, expanded VCR capacity, custom industry seeding |

Pricing is editable through the admin editor; the figures above are the figures in the live `membership_tiers` table.

### 8.2 ACV Math by Tier

```
BRIEFING
  Annual ACV = $2,990 (annual plan) or $3,588 (12 × $299 monthly)
  Blended assumption: 60% choose annual, 40% choose monthly
  Blended ACV = 0.6 × $2,990 + 0.4 × $3,588 = $3,229

WORKBENCH
  Annual ACV = $14,990 (annual plan) or $17,988 (12 × $1,499 monthly)
  Blended assumption: 70% choose annual, 30% choose monthly
  Blended ACV = 0.7 × $14,990 + 0.3 × $17,988 = $15,889

PLATFORM
  Annual ACV = $25,000 floor; in practice, $25K–$75K depending on seat count and VCR capacity
  Modeled blended ACV (Year 2): $35,000
  Modeled blended ACV (Year 3): $42,000 with multi-seat expansion
```

### 8.3 LTV:CAC by Tier

We model three distinct customer cohorts because their CAC and retention dynamics are structurally different. Each row carries an explicit derivation; full sensitivities live in Appendix A5.

| Tier | Blended ACV | Gross margin | CAC | Avg tenure | LTV | LTV:CAC |
|------|------------|--------------|-----|-----------|-----|---------|
| **Briefing** | $3,229 | 88% | $400 (PLG-driven, organic + content) | 18 months | $4,262 | **10.7×** |
| **Workbench** | $15,889 | 84% | $4,500 (sales-assist + outbound) | 30 months | $33,366 | **7.4×** |
| **Platform** | $35,000 | 78% | $18,000 (full-cycle enterprise sales) | 48 months | $109,200 | **6.1×** |

All three cohorts clear the >3× SaaS healthy benchmark with substantial margin. Briefing is the genuine PLG funnel; Workbench is the unit-economics workhorse; Platform is the long-cycle land-and-expand asset.

**Payback periods:**
- Briefing: 1.7 months
- Workbench: 4.0 months
- Platform: 7.9 months

### 8.4 Mix and Compounding

The architectural insight: the same back-end research engine powers all three tiers. The marginal cost of serving a new Briefing customer is essentially Stripe fees plus a fractional API allocation. The marginal cost of serving a new Platform customer is incremental VCR capacity, which scales sub-linearly with usage because the underlying corpus (and therefore each new finding's marginal informativeness) compounds.

This is the *structural margin advantage* of a research platform with a shared corpus: gross margin trends up with scale, not down.

---

## SLIDE 9 — TRACTION — WHAT IS GENUINELY SHIPPED

We separate "shipped" from "in-flight" deliberately. The list below is what a diligence engineer can confirm against the codebase today. Roadmap items are in Appendix A7.

### 9.1 Product Surface (Confirmable in Code Today)

- ✅ **348 leaf capabilities** across 6 industries with full economic enrichment (TAM, SAM, margin, half-life, revenue exposure); top-level capabilities auto-decompose into 4–6 sub-capabilities via Haiku 4.5
- ✅ **6 industries seeded** in `industries` table — Insurance, Healthcare, Banking & Financial Services, Manufacturing, Technology, Retail — each with Perplexity-cited GDP weights
- ✅ **60 reference orgs** populated per a stored, citable criterion; global geographic mix (NA + EMEA + APAC + LATAM); every org carries a source URL; refreshes quarterly
- ✅ **10 Alpha tabs live** at `/alpha` with formulas documented in the in-product Traceability dialog
- ✅ **VCR long-form research engine** at `/vcr` running LangGraph-orchestrated multi-day campaigns
- ✅ **HITL Review Queue** at `/review-queue` with full submit / queue / approve / reject-with-comment / reject-without-comment lifecycle
- ✅ **Public catalog filters by `reviewStatus='approved'`** — unreviewed drafts cannot leak to public surfaces
- ✅ **6 autonomous LangGraph agents** (core CVI + Macro Event + Disruption + Ontology + Peer-Coop + Stack Optimizer) running on a shared PostgresStore every 30 min
- ✅ **Weekly Claude-driven prompt optimizer** distilling HITL queue accept/reject patterns into each agent's system prompt
- ✅ **Neo4j graph engine** wired into `services/agent/graphMemory.ts` as the primary read path for the agent's **extracted-entity memory graph** (not yet the capability dependency graph — that still reads from Postgres `capability_dependencies` via recursive CTE). PostgreSQL fallback on any connection error.
- ✅ **DVX (Disruption Velocity Index)** computed every 30 min across all 348 capabilities; signal-event detection writes ~1,000 new events per cycle to `cvi_signals`
- ✅ **BullMQ + ioredis durable enrichment queue** (replaced earlier in-process and Postgres-backed implementations); jobs durable across restarts
- ✅ **Three live membership tiers + PAYG credit packs** with admin editor at `/admin` and admin-gated `PATCH /api/membership/tiers/:id`
- ✅ **Two-sided marketplace** for capability research listings + reports with Stripe Connect payouts and 30-day auto-archive
- ✅ **Synthetic-agent (Bot) framework** with 5 persona templates (1 active at launch — PE Partner), 7 action types, hard per-bot budget cap ($40/mo ceiling; $10-15/mo operating target); fully provisioned across 8 identity tables; UI-disclosed; RFC 2606 `.test` emails
- ✅ **Hedera HCS audit chain** anchoring admin rotation events and capability snapshots; explorer UI at `/admin/admin-audit-chain`
- ✅ **DB-managed Foundry (Palantir) token rotation** via `system_secrets`; admin UI for rotation; 30-min Resend email alert on impending expiry
- ✅ **Admin authentication** via `requireAdmin` middleware on every mutating endpoint in production; admin key itself rotatable via DB-managed secrets (no Railway redeploy)
- ✅ **OpenAPI 3.1 → Orval typed contract** for the entire API surface

### 9.2 Operational Signals

- 6 autonomous agents running with persistent memory across cycles; reflect events visible in `agent_runs`
- HITL review workflow is exercised end-to-end (submit → enrich → preview → approve)
- CVI signal detection finds and persists ~1,000 new capability-pair events per cycle (visible in `cvi_signals`)
- BullMQ queue migration completed without data loss; pre-existing capability rows preserved
- **68-page React 19 + Vite 7 SPA** with shared semantic-token design system (Tailwind v4)
- Type-system-enforced contract integrity: backend API change without spec update is a frontend compile error
- All seed scripts idempotent and chained through `scripts/src/deploy-migrate.ts` — survives container restarts safely

### 9.3 What This Means for an Investor

The platform is past the prototype phase. The work in front of us is *not* "can the architecture work?" — it has been answered. The work in front of us is breadth (more industries), depth (more analytical tabs, more VCR capacity), and distribution (enterprise sales motion). Each of those is a known unit of capital deployment, not an open research question.

---

## SLIDE 10 — COMPETITIVE LANDSCAPE

The competitive set falls into three buckets: legacy consulting (no software), adjacent software (no capability frame), and AI-native research products (no governance perimeter).

### 10.1 Refreshed Competitive Matrix

| Competitor | What they do | Quantified scores | Continuous refresh | Self-serve | Economic frame | Dependency graph | HITL governance | Dual-source AI | Long-form research engine |
|-----------|-------------|------------------|------------------|----------|---------------|----------------|---------------|---------------|------------------------|
| McKinsey Capability Center | $1M+ engagements, point-in-time | Partial | No (point-in-time) | No | Partial | No | Manual (review-by-partner) | No | Yes (human) |
| Gartner Peer Insights | Peer reviews, tech-focused | No (qualitative) | Slow (6–12mo) | Yes | No | No | Editorial | No | No |
| Palantir Foundry | Data integration platform | Operational only | Yes | No | No | No | Customer-implemented | No | No |
| Workday Peakon | Employee sentiment | HR only | Yes | Partial | No | No | No | No | No |
| BCG Henderson Institute | Research reports | No | No | No | No | No | Editorial | No | Yes (human) |
| Glean / Perplexity Enterprise | Enterprise search / RAG | No | Yes | Yes | No | No | None | Single-source | No |
| Generic AI consultancy product (typical 2025 startup) | Single-tab AI dashboard | Sometimes | Yes | Yes | Rare | No | None | Single-source | No |
| **Inflexcvi** | **6 autonomous LangGraph agents + governed catalog + 10-tab analytical surface + VCR campaigns + Neo4j graph engine + DVX signal detection** | **Yes (with credible intervals)** | **Yes (durable queue + 30-min agent cadence)** | **Yes (3 tiers + PAYG credits)** | **Yes (Perplexity-cited GDP-weighted CVI + per-cap economics)** | **Yes (`capability_dependencies` + LLM-scored edges, traversed in Neo4j)** | **Yes (HITL queue, enforced at query layer; weekly prompt optimizer)** | **Yes (Perplexity + Sonnet 4.6 → Haiku → GLM cascade)** | **Yes (VCR LangGraph campaigns)** |

### 10.2 Why each comparable loses

- **Big consulting (McKinsey, BCG, Bain, Deloitte)** — their economic model depends on partner-billable hours. They cannot ship a $2,990/yr Briefing tier without cannibalizing a $2M engagement. They are structurally locked out of the bottom and middle of the market.
- **Gartner / Forrester** — research-report business model, not a research-platform business model. Their refresh cadence is annual, not continuous. They have no agentic compute layer.
- **Palantir Foundry** — phenomenal data platform; not a capability framework. Customers must build the entire ontology and analytical surface themselves. Total time-to-value: 12–18 months.
- **Workday Peakon, similar HR analytics** — employee sentiment is one input into capability health, not the whole picture.
- **Generic AI consultancy products** — single-tab dashboards built on top of a single LLM with no review layer. They will publish a hallucinated number to a partner and lose the buyer.

### 10.3 Where we are exposed

- A foundation-model lab (OpenAI, Anthropic, Google) could ship a "capability intelligence" feature within their broader enterprise product. Defense: our moat is not the model; it is the corpus, the dependency graph, and the governance perimeter. None of those come from a model release.
- A consulting firm could license a competitor product and white-label it. Defense: license to them ourselves under the Platform tier (this is a wedge, not a threat).

---

## SLIDE 11 — THE TEAM

**[Founder / CEO]**
- Deep domain expertise in capability strategy and enterprise transformation
- Built this platform from concept to a 17-page production surface with a durable BullMQ queue, HITL governance, and a 10-tab analytical engine in months, not years
- First-principles thinker: recognized capabilities as economic assets before the market built the language for it

**[Technical Architecture]**
- 6 LangGraph autonomous agents (core CVI + 5 specialized) on a shared PostgresStore with self-hosted Mem0 for semantic recall
- Neo4j graph engine for capability dependency traversals (PostgreSQL fallback)
- BullMQ + ioredis durable job queue with TLS auto-detect, 3-attempt exponential backoff
- OpenAPI 3.1 contract layer with Orval-generated typed React hooks and Zod validators
- Drizzle ORM schema as single source of truth across `capabilities`, `capability_alpha`, `capability_dependencies`, `dependency_edge_scores`, `vcr_assessments`, `vcr_cycles`, `vcr_research_items`, `cvi_signals`, `dvx_*`, `reference_org_selection_rule`, `industry_gdp_weights`, `system_secrets`, `membership_tiers`, `industries`
- React 19 + Vite 7 + Tailwind v4 semantic-token design system (68 pages)
- Hedera Consensus Service audit anchoring for admin-rotation events
- Foundry (Palantir) integration with DB-managed token rotation

**[Advisory Targets — Active Outreach]**
- Enterprise software GTM (analyst-relations veterans from Gartner / IDC / Forrester)
- PE operating-partner networks (large-cap and middle-market funds)
- Strategy consulting alumni (MBB partners with capability-practice background)
- AI infrastructure (foundation-model and orchestration framework veterans)

The hiring plan attached to the use-of-funds (Appendix A7) is built around the realistic capacity needs of the next 18 months at the seed scenario, and 24 months at the Series A scenario.

---

## SLIDE 12 — FINANCIALS AND OPERATING MODEL

### 12.1 Cost Structure Today

| Item | Monthly |
|------|---------|
| AI APIs (Perplexity Sonar + OpenRouter [Sonnet 4.6 → Haiku → GLM cascade]) | ~$80–$200 (research-cycle dependent; 6 agents × 30-min cadence drives the floor) |
| Infrastructure (Railway: api-server + Postgres + pgvector + Neo4j + Mem0 + Redis for BullMQ) | ~$120–$180 |
| **Total** | **~$200–$380/month at current scale** |

This is the structural advantage of the architecture: AI API costs scale primarily with research-cycle frequency (a fixed schedule), not with paid customer count. A 10× increase in customers triggers approximately a 2–3× increase in AI cost — driven by assessment volume, not by background research cycles. The OpenRouter fallback chain caps downside risk on model-price spikes by automatically degrading to cheaper tiers (Haiku, GLM 5.1) when the primary returns a budget error.

### 12.2 Revenue Projection at Two Capital Scenarios

**Scenario A — $2.5M Seed (efficient growth path):**

| Metric | Year 1 | Year 2 | Year 3 |
|--------|--------|--------|--------|
| Briefing customers | 60 | 220 | 600 |
| Workbench customers | 15 | 55 | 140 |
| Platform customers | 1 | 5 | 15 |
| Briefing ARR | $194K | $710K | $1.94M |
| Workbench ARR | $238K | $874K | $2.22M |
| Platform ARR | $35K | $175K | $525K |
| **Total ARR** | **$467K** | **$1.76M** | **$4.69M** |
| Gross margin | 80% | 82% | 84% |
| Net burn | ~$110K/mo | ~$130K/mo | Approaching FCF positive |

**Scenario B — $5–7M Series A (enterprise sales build path):**

| Metric | Year 1 | Year 2 | Year 3 |
|--------|--------|--------|--------|
| Briefing customers | 100 | 400 | 1,200 |
| Workbench customers | 30 | 120 | 350 |
| Platform customers | 3 | 18 | 55 |
| Briefing ARR | $323K | $1.29M | $3.87M |
| Workbench ARR | $477K | $1.91M | $5.56M |
| Platform ARR | $105K | $630K | $1.93M |
| **Total ARR** | **$905K** | **$3.83M** | **$11.36M** |
| Gross margin | 79% | 81% | 84% |
| Net burn | ~$220K/mo | ~$280K/mo | ~$50K/mo |

Both scenarios are derived from the same per-customer ACV math in Slide 8. The difference is sales capacity, not unit economics.

### 12.3 Operating Model Sensitivity

The single largest sensitivity is Workbench-to-Platform expansion velocity. A Workbench customer that expands to Platform within 18 months delivers ~10× the LTV of a Workbench customer that does not. This is why the Series A path explicitly funds a customer-success function — see Appendix A7.

---

## SLIDE 13 — THE ASK — SEED OR SERIES A

We present two parallel paths and let the investment committee select. The product is far enough along that either is a defensible answer. The choice depends on whether the lead's mandate is for capital-efficient single-product depth, or for an enterprise-sales-led category build.

### 13.1 Path A — $2.5M Seed (Efficient Growth)

**Use of Funds**

| Category | Amount | Purpose |
|---------|--------|---------|
| Product & Engineering | $1.20M | 1 senior full-stack + 1 ML/agent engineer (extend VCR capacity, ship 2 additional analytical tabs, 4 additional industries) |
| GTM & Content | $0.70M | 1 founding AE for Workbench/Platform deals, content engine to drive Briefing PLG |
| Operations | $0.30M | Legal, compliance review for HITL audit packaging, infrastructure scale-up |
| Reserve | $0.30M | 18-month runway buffer, model API price-shock contingency |
| **Total** | **$2.5M** | **18-month runway to ~$2M ARR run-rate** |

**Milestones (see Appendix A7 for detailed mapping)**
- Add 4 industries (12 months) — Pharma, Logistics, Telecom, Public Sector
- Add 2 analytical tabs (12 months) — likely Regulatory Δ and Edge Compute concentration
- Expand VCR concurrent-campaign capacity 3× (9 months)
- Wire the 5 specialized agents into customer-visible workflows (currently they run autonomously in the background; surface their outputs in admin and Workbench UIs)
- 5 Platform customers signed (15 months)
- $2M ARR run-rate (18 months)
- Series A from a position of revenue strength

### 13.2 Path B — $5–7M Series A (Enterprise Build)

**Use of Funds at $6M midpoint**

| Category | Amount | Purpose |
|---------|--------|---------|
| Product & Engineering | $2.20M | 1 ML/agent lead + 2 full-stack + 1 design (ship 5 analytical tabs + 8 industries + 2 verticalized VCR templates) |
| Sales & GTM | $2.10M | 3 enterprise AEs, 1 sales engineer, 1 marketing lead, ABM motion against Fortune 500 strategy desks and PE operating partners |
| Customer Success | $0.60M | 2 CS architects (Workbench → Platform expansion velocity is the single largest driver of LTV; this hire pays for itself within 12 months) |
| Operations | $0.60M | SOC 2 Type I in Year 1, Type II in Year 2; legal; finance/RevOps |
| Reserve | $0.50M | 24-month runway buffer |
| **Total** | **$6.0M** | **24-month runway to $10–12M ARR run-rate** |

**Milestones**
- Add 8 industries (18 months)
- Add 5 analytical tabs (18 months)
- 3× VCR concurrent capacity in Year 1, 5× in Year 2
- 18 Platform customers signed (24 months)
- $10M ARR run-rate (24 months)
- SOC 2 Type II by month 18

### 13.3 Why both are credible

A capital-efficient seed uses the existing product surface to monetize a single buyer cohort (mid-market Workbench + early Platform) and prove out the Workbench-to-Platform expansion. A Series A uses the same product to build a parallel enterprise motion targeting Fortune 500 and PE platform deployments. The product does not need to change to support either path; the capital allocation does.

---

## SLIDE 14 — WHY NOW

Three independent forces converge in 2026, and the convergence is the buying window.

### 14.1 AI agent infrastructure is mature enough to build durable products

LangGraph for orchestration, Mem0 + PostgresStore for persistent memory, Neo4j for graph traversals, BullMQ + Redis for durable job queues, OpenRouter for multi-model routing with automatic budget-fallback — the stack to build an autonomous, observable, durable, multi-agent AI research platform exists today. Two years ago, building this required custom infrastructure work that no early-stage company would survive. Today, it is composable.

### 14.2 Enterprise AI spend is looking for ROI, not for prompts

Every Fortune 500 spent 2024–2025 on AI experimentation. Boards are now asking: *"What did we get?"* The answer must be quantified in capability outcomes — not in token consumption, not in seat count, not in chatbot deflection rate. Inflexcvi is the measurement layer that converts AI investment into board-readable economic outcomes.

### 14.3 The PE operating model is under structural pressure

With interest rates normalized and multiple-expansion no longer the default value-creation lever, PE returns now depend on operational improvement. Operational improvement requires knowing which capabilities to invest in, on what horizon, with what dollar impact. This requires data PE firms do not currently have. We sell that data.

### 14.4 The hidden fourth force

Foundation-model price deflation. The cost of a research cycle has dropped roughly 70% over the past 18 months and continues to drop. This means our gross margin is structurally improving without any product action — we are riding a deflationary cost curve in our largest variable-cost line.

**The window to define this category is now. The product is already running. The corpus is already compounding.**

---

## SLIDE 15 — CLOSING

Capabilities are the engine of every organization. They determine who wins market share, who survives disruption, who creates durable value, who is acquirable at a premium, and who is a takeover target at a discount.

For the first time, those capabilities can be measured, benchmarked, tracked, and quantified economically — continuously, autonomously, defensibly, and at a price point that lands on a $299/mo line item or a $25,000/yr platform contract.

Inflexcvi is not a feature. It is not an analyst report. It is not a consulting engagement. It is the institutional intelligence layer that the discipline has lacked for thirty years — built with the controls institutional buyers require and the durability institutional capital requires.

The agent is running. The corpus is compounding. The governance is in place.

We are raising to scale what is already working.

---

*For more information:* *[Contact] | [Demo] | [Data Room]*

*This presentation contains forward-looking statements and projections. All market sizing estimates are based on publicly available data from Gartner, Statista, PitchBook, and IDC research, with derivations shown in Slide 7 and Appendix A5.*

---
---

# PART II — DILIGENCE APPENDICES

The appendices that follow are written for diligence teams, not for the slide reader. They are intentionally detailed and intentionally numerate. Architecture details that are abbreviated below are documented at full depth in `docs/architecture-spec.md`.

---

## APPENDIX A1 — TECHNICAL DUE-DILIGENCE APPENDIX

### A1.1 Architecture Summary

**Repository structure** (pnpm monorepo, pnpm@10.26.1):

```
workspace/
├── artifacts/
│   ├── api-server/                 # Express 5 API + 6 agents + scheduler
│   │   └── src/
│   │       ├── routes/             # All HTTP routes
│   │       ├── middlewares/        # requireAdmin, etc.
│   │       └── services/
│   │           ├── alpha/          # BullMQ enrichment pipeline
│   │           ├── agent/          # Core CVI LangGraph agent
│   │           │   ├── graph.ts        # LangGraph node definitions
│   │           │   ├── graphMemory.ts  # Neo4j primary + Postgres fallback
│   │           │   ├── store.ts        # Shared PostgresStore (replaces Letta)
│   │           │   ├── memory.ts       # Mem0 client
│   │           │   ├── optimizer.ts    # Weekly Claude prompt optimizer
│   │           │   └── scheduler.ts    # 30-min cron + watchdog
│   │           ├── macro-event-agent.ts    # Specialized agent 1
│   │           ├── disruption-agent.ts     # Specialized agent 2
│   │           ├── ontology-agent.ts       # Specialized agent 3
│   │           ├── peer-coop-agent.ts      # Specialized agent 4
│   │           ├── stack-optimizer-agent.ts # Specialized agent 5
│   │           ├── base-agent.ts           # Shared agent helper
│   │           ├── vcr/                # Virtual Capability Researcher
│   │           ├── dvx-engine.ts       # Disruption Velocity Index
│   │           ├── cvi-engine.ts       # CVI scoring + rollup
│   │           ├── cvi-signals/        # Signal-event detection
│   │           ├── foundry/            # Palantir integration + token rotation
│   │           ├── edgar/              # SEC filings ingestion
│   │           ├── bots/               # Synthetic-agent provisioning
│   │           ├── llm-fallback.ts     # Sonnet→Haiku→GLM chain
│   │           ├── blockchain-audit.ts # Hedera HCS anchoring
│   │           └── enrichment/         # Drop-in interface to alpha pipeline
│   ├── inflexcvi/                  # React 19 + Vite 7 SPA (68 pages)
│   ├── ce-pitch-deck/              # Static deck artifact
│   └── mockup-sandbox/             # Component preview server
├── lib/
│   ├── db/                         # Drizzle schema (source of truth, ~50 tables)
│   │   └── migrations/             # SQL pre-rename migrations
│   ├── api-spec/                   # OpenAPI 3.1 (contract authority)
│   ├── api-client-react/           # Orval-generated TanStack Query hooks
│   ├── api-zod/                    # Orval-generated Zod validators
│   └── integrations/               # Anthropic SDK wrapper
├── mem0/                           # Self-hosted Mem0 Dockerfile (Railway)
├── letta/                          # (DECOMMISSIONED — kept for archive only)
├── scripts/                        # Seed scripts, perplexity client, deploy-migrate
├── Dockerfile                      # node:22-slim production build
└── pnpm-workspace.yaml             # Workspace + version catalog
```

**Runtime characteristics:**

| Attribute | Value |
|-----------|-------|
| API framework | Express 5.x |
| Process model | Single Node.js process; event-loop concurrency |
| Port binding | `process.env.PORT` (default 8080) |
| Logging | Pino structured JSON |
| ORM | Drizzle ORM with pg driver |
| Background work — 6 autonomous agents | `setInterval` scheduler in same process; 30-min cadence per agent, urgency watchdog every 5 min |
| Background work — enrichment | **BullMQ queue with separate worker** (durable) |
| Graph store | Neo4j 5.26-community (Railway) — primary read path for `findCorrelations()` / `findRelated()`; PostgreSQL fallback on any connection error |
| Semantic memory | Self-hosted Mem0 (mem0ai/mem0 v2.1.0, our `mem0/Dockerfile` with libpq5 fix) backed by pgvector |
| Shared agent state | PostgresStore — namespaced reads/writes; replaces Letta |
| Audit chain | Hedera Consensus Service (HCS) — admin actions + capability snapshot anchors |
| SSE | Native Node `res.write()` with `text/event-stream` |
| Frontend | React 19 + Vite 7 + Tailwind v4 + shared semantic-token design system |
| Type contract | OpenAPI 3.1 → Orval → typed React hooks + Zod validators |

### A1.2 Queue Durability — The BullMQ Migration

This is the highest-impact infrastructure decision in the platform and warrants explicit description.

**Prior state.** Earlier implementations of the enrichment pipeline ran in-process (lost on restart) and then in Postgres-backed (durable but slow, contention-prone). Both have been retired.

**Current state.** All enrichment work runs through a single BullMQ queue named `enrichment`, backed by ioredis. Configuration:

| Setting | Value | Rationale |
|---|---|---|
| Queue name | `enrichment` | Single-purpose; easy to monitor |
| Concurrency | `1` | Serializes against external API rate limits and protects against duplicate writes |
| Attempts | `3` | One transient failure does not lose work |
| Backoff | Exponential, base delay `5000ms` | Avoids hammering Perplexity / OpenRouter on rate-limit responses |
| TLS | Auto-detect from `rediss://` URL prefix | Operates correctly against managed Redis (Upstash, Render Redis, etc.) without code change |
| Job lifecycle states reflected on capability rows | `enrichmentStatus`, `enrichmentStage`, `enrichmentError` | Direct visibility from the database; no need to introspect the queue for status |

**Public interface** (`services/alpha/queue.ts`):

```typescript
enqueueEnrichmentJob(capabilityId: number, opts?): Promise<JobId>
getQueuePositionFor(capabilityId: number): Promise<number | null>
startEnrichmentWorker(): Promise<Worker>
getQueueStats(): Promise<{ waiting, active, completed, failed }>
```

This is a drop-in interface — both the review queue and the autonomous agent use the same enqueue function, ensuring there is one and only one path through which enrichment work enters the system.

**Stages within an enrichment job:**

1. **Alpha** — Perplexity Sonar grounded research for TAM, SAM, margin, half-life → LLM strict-JSON parse (Claude Sonnet 4.6 default, swappable via `LLM_MODEL`, with Sonnet→Haiku→GLM 5.1 cascade on budget errors) → write to `capability_alpha`.
2. **Detail** — second Perplexity pass for AI displacement narrative, traditional-view fallacies, and a playbook → LLM JSON parse → write to capability detail fields.
3. **Edge scoring** — for each upstream/downstream `capability_dependencies` edge, LLM-score the disruption probability, time-to-impact (months), dollar impact (mm), and rationale → write to `dependency_edge_scores`.

A failure in any stage marks the capability with the failed stage and a structured error, then schedules a retry under the exponential backoff. Successful jobs leave the capability in `enrichmentStatus='complete'` with `enrichmentError=null`.

### A1.3 Observability

**Application logs.** Pino structured JSON with `req_id`, `method`, `route`, `status`, `latency_ms`. Structured fields make ingestion into any log aggregator (Datadog, Loki, BetterStack) zero-friction.

**Queue metrics.** `getQueueStats()` returns counts for waiting / active / completed / failed jobs — exposable via a metrics endpoint.

**Capability-row state.** `enrichmentStatus`, `enrichmentStage`, `enrichmentError` columns are the canonical job-state surface. The review-queue UI reads these directly, and they are the same fields a diligence engineer can `SELECT` from the database to confirm pipeline health.

**Agent run history.** `GET /api/agent/history` returns the run-by-run history with timing and error logs. SSE stream at `/api/agent/events` exposes lifecycle events live.

**VCR timeline.** `vcr_cycles` and `vcr_research_items` together are the campaign audit trail; every finding carries a confidence score and source citation.

**Multi-agent observability.** Each of the 6 autonomous agents writes structured run records to `agent_runs` (latency, tool calls issued, errors, outcome). The weekly Claude-driven `optimizer.ts` reads these plus the HITL review queue's accept/reject patterns and proposes prompt revisions.

**Signal detection observability.** `cvi-signals/` writes detected capability-pair events to `cvi_signals` with `scannedCapabilities`, `pairsCompared`, `eventsDetected`, `newEventsInserted`, `durationMs` per cycle.

**Audit chain.** Hedera Consensus Service anchors are recorded in `audit_chain` with topic ID, sequence number, transaction ID. The admin explorer surfaces the full chain at `/admin/admin-audit-chain`.

### A1.4 Security Posture

| Control | Implementation |
|---|---|
| Admin authentication | `requireAdmin` middleware enforcing `x-admin-key === ADMIN_API_KEY` in production |
| Mutating-endpoint protection | All admin routes, enrichment routes, alpha enrich routes, agent scheduler routes, CVI refresh, insights generate, membership PATCH, dynamic-industries POST, case-studies admin, educational-content admin, and review-queue routes are gated by `requireAdmin` |
| Public read endpoints | Intentionally open (catalog browse, methodology, public CVI) — no PII surface |
| Public catalog filtering | `reviewStatus='approved'` enforced at query layer — unreviewed capability drafts cannot leak |
| Request validation | Zod schemas on every route (path/query/body), generated from OpenAPI 3.1 — drift is impossible |
| Database access | Drizzle ORM with parameterized queries; no raw SQL from user input |
| Session model | UUID v4 stored in browser localStorage; stateless validation; non-revocable without DB delete (acceptable at current scale) |
| Secret management | All API keys via environment variables; no secrets in repo; `.env.example` documents required keys |
| TLS | Auto-detected for Redis via `rediss://` URL prefix; HTTPS enforced at deployment platform layer |

**Pre-Series-A roadmap (under Path B funding):** SOC 2 Type I in Year 1, SOC 2 Type II in Year 2. The architecture is already aligned — admin auth, structured logging, audit-traceable HITL workflow, parameterized DB access — what is missing is the policy and audit work, not the technical work.

### A1.5 Dependency List (Top-Level)

**Backend:**
- `express` 5.x — HTTP framework
- `drizzle-orm` + `pg` — ORM and Postgres driver
- `bullmq` + `ioredis` — durable job queue
- `@langchain/langgraph` + `@langchain/core` — agent orchestration (6 agents)
- `mem0ai` (self-hosted v2.1.0 from `mem0/Dockerfile`) — semantic memory
- `neo4j-driver` 5.28.x — graph traversal queries
- `@hashgraph/sdk` — Hedera Consensus Service audit anchors
- `pino` + `pino-pretty` — structured logging
- `zod` v3 (imports from `zod/v4`) — runtime validation

**Frontend:**
- `react` 19.x
- `vite` 7.x
- `@tanstack/react-query` — generated via Orval
- `tailwindcss` 4.x via `@tailwindcss/vite` — semantic-token design system
- `framer-motion` — animation library
- `react-markdown` — Thesis tab + report rendering
- `lucide-react` — icon system
- `wouter` — client routing (NOT React Router)

**External services:**
- Perplexity Sonar (`sonar` + `sonar-pro`) — grounded web research
- OpenRouter — multi-model routing (Sonnet 4.6 default; Haiku 4.5 + `z-ai/glm-5.1` in fallback chain)
- Anthropic Claude (via `@langchain/anthropic` for the weekly optimizer and the 5 specialized agents' reasoning)
- Self-hosted Mem0 on Railway (NOT Mem0 Cloud SaaS) — semantic memory store
- Self-hosted Neo4j 5.26-community on Railway — graph store
- pgvector (Postgres extension) — vector backing for Mem0
- Hedera Consensus Service — audit-chain anchoring
- Foundry (Palantir) — SEC/EDGAR enrichment ingestion (token rotation via `system_secrets`)
- Resend — transactional email (admin alerts, Foundry token expiry warnings)
- Managed Redis (e.g., Upstash) — BullMQ backing store
- Postgres (Neon / Railway / managed) — primary database (~50 tables)
- Stripe + Stripe Connect — billing for membership tiers, PAYG, and marketplace payouts
- Clerk — auth (org-scoped + user-scoped)

### A1.6 Vendor Lock-In Analysis

The architecture is built for substitutability. Every external vendor has a documented swap path.

| Vendor | Lock-in level | Swap target | Estimated swap effort |
|---|---|---|---|
| Perplexity Sonar | Low | Tavily, Exa, Brave Search API | 2–3 days (single client wrapper) |
| OpenRouter | Very low | Direct Anthropic/OpenAI/etc. — `LLM_MODEL` env var already abstracts model choice; only the OpenAI-compatible endpoint URL would need to swap | 1–2 days |
| Mem0 (self-hosted on Railway) | Very low | Already self-hosted — the dependency is the open-source `mem0ai/mem0` we build from source. Could swap to pgvector + custom recall in 5–7 days if needed. | 5–7 days |
| ~~Letta~~ | n/a | **DECOMMISSIONED Phase 1.9 Step 6** — replaced by PostgresStore (one table, namespaced reads/writes). | n/a (already swapped) |
| Neo4j | Medium-Low | Already has PostgreSQL fallback in `graphMemory.ts` — could deprecate Neo4j with no code change beyond removing env vars; the fallback path runs the same queries against `capability_dependencies` directly | <1 day (env var removal); the fallback is the migration target |
| BullMQ / Redis | Low | Already replaced Postgres-backed implementation; BullMQ is the standard for Node job queues | n/a (this is already the migration target) |
| Hedera HCS | Low | Switch to Polygon EVM contract; `blockchain-audit.ts` already abstracts provider | 3–5 days |
| Foundry (Palantir) | Medium | Direct SEC EDGAR ingestion already coexists (`services/edgar/`); Foundry is the value-add data layer, not the only source | 2–4 weeks to replicate Foundry's curated data |
| Postgres | Very low | Any managed Postgres provider | <1 day |
| OpenAPI 3.1 + Orval | None (open standard) | n/a | n/a |

**Critical observation:** the highest-cost dependency to swap (Mem0) is exactly the dependency where the value is in the data we have written, not the API surface. Migrating off Mem0 means re-loading our memory corpus into a new store; the agent code change is small.

### A1.7 Disaster Recovery & Continuity

- Postgres point-in-time recovery via the managed provider (typical 7-day window).
- BullMQ jobs are durable; a Redis restore restores in-flight work.
- Capability rows reflect job state at the column level, so even partial Redis loss leaves a recoverable state machine.
- The review queue is the gating mechanism — even a worst-case enrichment regression cannot publish bad data to the public catalog without explicit human approval.

---

## APPENDIX A2 — PE OPERATING-PARTNER USE CASES

PE is a primary buyer cohort. Below are five concrete scenarios mapped to specific shipped surfaces of the platform. Each scenario is a workflow a PE operating partner can run today, not a roadmap item.

### A2.1 Pre-Deal Capability Due Diligence

**Scenario.** A mid-market PE fund is in exclusivity on a $750M insurance carrier. The CIM emphasizes claims automation and underwriting analytics as competitive strengths. The fund has 35 days to close.

**Workflow on the platform.**

1. Operating partner spins up a VCR campaign at `/vcr` with the target's industry pre-loaded (Insurance), specifying the capabilities of interest (Claims Automation, Underwriting Analytics, Fraud Detection, Customer Onboarding) and the exclusivity-window stop condition.
2. VCR runs daily research cycles for two weeks, producing cross-validated findings on each capability's industry-wide state, leading-edge vendors, and typical deployment maturity ranges. Each finding carries a confidence score in `vcr_research_items`.
3. The Inflexcvi Alpha tabs are queried for each capability: Moat (is this a fortress capability or a contestable one?), Fragility (what is the upstream-disruption exposure?), EVaR (what is the dollar at risk over the hold period if the capability decays?), and Cascade (which downstream capabilities suffer if this one breaks?).
4. The Thesis tab generates a 7-section investment memo per capability with cited sources, ready to drop into the IC deck.

**Output the operating partner takes to the IC.** A capability-by-capability assessment of the target's claimed strengths against industry benchmarks, with explicit identification of which claimed strengths are actually table-stakes (and therefore not a basis for a premium) and which are genuine fortresses (and therefore a basis for a multiple). The HITL governance ensures every cited number traces to a Perplexity URL.

**Why the platform wins this workflow vs. a consulting alternative.** The consulting alternative is a $500K–$1.5M capability diagnostic with a 4–8 week turnaround — incompatible with a 35-day exclusivity window.

### A2.2 Post-Close 100-Day Plan

**Scenario.** A fund has closed a $400M industrial manufacturer. The 100-day plan needs to identify the three highest-ROI operational interventions.

**Workflow.**

1. Operating partner runs an organization-level assessment (`/organization`, `/dashboard`) for the portfolio company, inputting current self-assessed capability scores.
2. The dashboard returns a gap-analysis radar against the Manufacturing industry benchmark, with each gap quantified in inflexcvi units.
3. The Cascade tab shows which capability investments produce the largest downstream impact — for example, investing in Production Scheduling capability cascades to On-Time Delivery, Working Capital Efficiency, and Customer Retention; investing in Field Service Routing cascades only to one downstream capability.
4. The Flows tab shows where industry capital is currently being deployed — confirming the operational hypothesis or contradicting it.
5. The 100-day plan is built around the three capabilities with the largest dependency-weighted economic impact, with each justified by a Cascade-tab dollar-impact estimate.

**Why this matters.** PE 100-day plans are too often a list of cost-out actions chosen by anchoring to comparable portfolio interventions. The platform replaces anchoring with inflexcvi math.

### A2.3 Portfolio-Wide Capability Benchmarking

**Scenario.** A fund holds 15 portfolio companies across Healthcare, Banking, Insurance, and Manufacturing. The fund's CFO wants a quarterly capability-health benchmark across the portfolio for the LP report.

**Workflow.**

1. Each portfolio company runs its self-assessment quarterly (Workbench tier).
2. The fund-level Platform tier surfaces aggregate views: which portfolio companies are improving on which capabilities, where the gaps to industry are largest, where cross-portfolio learning could help.
3. The Talent tab identifies which capabilities are bottlenecked on talent across the portfolio — a signal that a portfolio-wide talent investment (shared CTO-as-a-service, shared data engineering team) might create cross-portfolio leverage.
4. The Arbitrage tab shows where industry consensus and CE's view disagree most strongly — these are the long/short signals the fund's deal team can use for new investments.

**LP report deliverable.** A quarterly capability-health appendix to the LP letter, with each capability's industry benchmark, the portfolio's position against it, and the velocity (improving / stable / declining). This is a deliverable LPs increasingly demand and that no other tool produces.

### A2.4 Exit-Readiness Capability Audit

**Scenario.** A fund is 12–18 months from a planned exit on a Healthcare services platform. The operating partner needs to identify which capability investments will most lift the exit multiple.

**Workflow.**

1. Run the Moat tab on the company's capability portfolio — identify which are fortresses (worth highlighting in the CIM) and which are contestable (worth investing to upgrade pre-exit).
2. Run the Narrative Δ tab to identify capabilities where the market consensus undervalues what the company has built. These are the storyline anchors for the exit narrative.
3. Run the Cascade tab to model the dollar impact of pre-exit capability investments — which $5M investments cascade to $25M of EBITDA improvement vs. which produce only $7M.
4. Use the Thesis tab to generate the capability-level chapters of the CIM directly.

**Why this works.** Buyers will run their own capability diligence (see A2.1). Better to run it first, ourselves, and shape the narrative before the buyer arrives.

### A2.5 Add-On Synergy Assessment via M&A Twin

**Scenario.** A fund's platform Healthcare company is evaluating a $90M tuck-in of an Insurance-services adjacent business. The thesis is operational synergies between Healthcare claims operations and Insurance claims operations.

**Workflow.**

1. Open the M&A Twin tab on `/alpha`.
2. The tab uses token-overlap analysis (≥0.5 threshold) to surface capability twins between the Healthcare and Insurance industry catalogs — for example, "Claims Adjudication," "Member Onboarding," and "Provider Network Management" all have analogues across both industries.
3. For each twin, synergy is quantified at 10% of the smaller side's revenue exposure, but only when both sides have LLM-enriched revenue figures — partial data does not fabricate a number, it surfaces a "—".
4. Quadrant-clash flags warn when the two industries have different consensus quadrants for the twin capability — indicating integration risk where one side treats the capability as table-stakes and the other treats it as hot.

**Output.** A synergy thesis grounded in capability-by-capability dollar math with explicit clash-risk flags. The numbers are defensible to both the IC and the seller.

---

## APPENDIX A3 — VC-SPECIFIC USE CASES

VC funds have a different workflow than PE — they underwrite category positioning and management quality more than they underwrite specific cash flows. The platform supports three high-leverage VC workflows.

### A3.1 Sourcing Alpha via the Arbitrage Tab (Inflexcvi Alpha)

**Scenario.** A growth-equity VC is sector-focused on Banking technology. The partner wants a structured way to identify under-priced capability themes.

**Workflow.**

1. Open the Arbitrage tab at `/alpha` filtered to Banking.
2. The tab compares CE-implied valuations vs. street consensus using quadrant multiples (hot=15×, emerging=10×, table-stakes=4×, declining=1×) on revenue exposure × margin.
3. Long signals: capabilities where CE views as hot but street views as emerging or table-stakes. The spread is dollar-priced and confidence-filtered (≥0.55).
4. Short signals: capabilities where CE views as cooling/declining but street still views as hot.

**Output.** A short-list of capability themes where the market is mis-priced, each with an explicit dollar-spread estimate. The VC partner uses this to source private companies operating in the long-signal capabilities and to avoid those operating in the short-signal capabilities.

### A3.2 Thesis Development via the Thesis Tab

**Scenario.** A thesis-driven VC is building a $200M industrial AI fund and needs a defensible, publishable capability-by-capability thesis.

**Workflow.**

1. For each capability of interest, the Thesis tab generates a GLM-5.1-synthesized 7-section investment memo grounded in the full Alpha record (economics, quadrant, dependency graph, edge scores, cited sources).
2. The seven sections include market positioning, economic exposure, dependency map, fragility risks, M&A landscape, competitive cohort, and forward-causal scenarios.
3. Citations are explicit and clickable.

**Output.** A capability-level thesis library that becomes the analytical backbone of the fund's positioning. Reusable for LP marketing, for portfolio-construction discipline, and for outbound deal sourcing.

### A3.3 Ecosystem Mapping via the Cascade Tab

**Scenario.** A VC has a portfolio company building a developer-tooling capability. The partner wants to understand the ecosystem of dependent capabilities — what else needs to exist for the portfolio company's product to be valuable, and what capabilities will be unlocked downstream.

**Workflow.**

1. Open the Cascade tab on `/alpha`, select the portfolio company's capability as the root.
2. The tab visualizes the dependency graph with depth, per-edge probability of impact propagation, time-to-impact, and dollar-impact estimates from `dependency_edge_scores`.
3. Upstream dependencies tell the partner what infrastructure the portfolio company is exposed to.
4. Downstream dependencies tell the partner where to source adjacent investments — the "second-order plays" off the original thesis.

**Output.** An ecosystem map that informs follow-on investment construction and that surfaces concentration risk (if the portfolio company depends on a single fragile upstream capability).

### A3.4 Adjacent VC Workflow — Founder Diligence

For early-stage VCs, the Workbench tier supports a fast capability self-assessment that a founder-team can run pre-pitch. The radar output is used in the partner's diligence call to quickly identify capability gaps the company will need to close. This is light-touch but recurring usage that supports a Briefing-tier subscription per associate.

---

## APPENDIX A4 — RISK REGISTER AND MITIGATIONS

We enumerate honestly the risks an investor should price into this opportunity, and we describe the mitigation either in place or planned.

| # | Risk | Probability | Impact | Mitigation |
|---|------|-------------|--------|-----------|
| 1 | Foundation-model price spike erodes margin | Low (deflationary trend) | Medium | Multi-vendor model routing via OpenRouter; `LLM_MODEL` env var swaps the synthesis model per-deploy without code change; automatic Sonnet→Haiku→GLM 5.1 fallback chain on credit/budget errors via `services/llm-fallback.ts`; reserve in budget |
| 2 | Hallucination leakage damages a marquee customer | Medium (without controls) | High | HITL review queue; `reviewStatus='approved'` enforced at query layer; revision-guidance loop; provenance on every numeric claim |
| 3 | A foundation-model lab ships a "capability intelligence" feature | Medium | Medium | Moat is the corpus + governance + dependency graph, none of which a model release replicates; treat as long-term threat, near-term irrelevant |
| 4 | Big consulting white-labels a competitor product | Low–Medium | Medium | License Platform tier to consultancies first; convert competitor risk into channel revenue |
| 5 | Mem0 / Neo4j / external dependency failure | Low | Low–Medium | Mem0 is already self-hosted on Railway from our `mem0/Dockerfile` (not Mem0 Cloud SaaS); Neo4j has automatic PostgreSQL fallback in `graphMemory.ts`; PostgresStore replaced Letta with no service dependency. Every external is either swappable or has graceful-degrade built in. |
| 6 | BullMQ / Redis vendor outage | Low | Low | Jobs are durable; Redis restores cleanly; capability rows reflect job state independently |
| 7 | Single-founder key-person risk | Medium | High | First Series A hire is engineering lead with shared architectural ownership; advisory bench in place |
| 8 | Slow enterprise sales cycle vs. Series A burn | Medium | Medium | Briefing PLG funnel provides organic pipeline; Workbench is mid-cycle bridge; scenario A (seed) sized for slower enterprise traction |
| 9 | Regulatory change (AI disclosure regimes in EU AI Act, US executive orders) | Medium | Low | Output is research-product-style, not high-risk decision automation; HITL governance is already aligned with anticipated AI-Act transparency requirements |
| 10 | Capability data becomes commoditized via open dataset release | Low | High | The proprietary value is not the capability list; it is the economic enrichment, dependency graph, edge scores, and reviewed catalog state |
| 11 | Customer concentration risk (one Platform customer = >20% revenue) | Medium-Low | Medium | Three-tier model intentionally diversifies; Briefing scale dilutes Platform concentration |
| 12 | Discovery agent generates spammy capability submissions | Low (controlled) | Low | All discovery-agent inserts go through HITL review queue with `submittedBy='discovery_agent'` provenance; reviewer can mass-reject |
| 13 | Drizzle schema drift between environments | Very low | Medium | Schema is single source of truth; push scripts gated; staging mirrors production schema |
| 14 | Pricing-page misconfiguration (e.g., $0 published) | Low | Low | Admin PATCH is `requireAdmin`-gated; admin editor at `/admin` requires explicit auth |

---

## APPENDIX A5 — UNIT ECONOMICS DEEP-DIVE

This appendix opens up the unit-economics table from Slide 8 and shows the math underneath.

### A5.1 Cost of Goods Sold per Tier

The per-customer marginal COGS is dominated by three buckets: foundation-model API costs allocated by usage, infrastructure (database + Redis + bandwidth), and payment processor fees.

**Per-Briefing-customer-month COGS:**

| Component | Cost |
|---|---|
| API allocation (read-only browsing of pre-computed Alpha tabs; no incremental enrichment triggered) | $0.50 |
| Infrastructure (Postgres seat-share, hosting) | $1.00 |
| Stripe fees on $299/mo (2.9% + $0.30) | $8.97 |
| **Total monthly COGS** | **~$10.50** |
| Gross margin | **96.5% on monthly, 87% on annual ($249/mo equivalent)** |

Reported gross margin in Slide 8 (88%) is conservative against this calculation because it assumes some incremental Workbench/VCR feature usage by Briefing customers via promotional access.

**Per-Workbench-customer-month COGS:**

| Component | Cost |
|---|---|
| API allocation (assessments, gap analysis, light VCR usage) | $20–$50 |
| Infrastructure (heavier query share, organization workspace) | $5 |
| Stripe fees on $1,499/mo | $43.77 |
| **Total monthly COGS** | **~$70–$100** |
| Gross margin on $1,499/mo | **~93% best, 84% conservative** |

**Per-Platform-customer-month COGS:**

| Component | Cost |
|---|---|
| Expanded VCR concurrent campaign capacity | $200–$500 |
| Multi-seat Postgres allocation | $30 |
| Custom industry seeding (amortized over contract) | $50 |
| Support overhead (CS time amortized) | $300 |
| Payment processor fees (often invoiced, low rate) | $5 |
| **Total monthly COGS at $25K/yr ($2,083/mo)** | **~$585–$885** |
| Gross margin | **~60–72% conservative; 78% blended in Slide 8** |

The reason the Slide 8 figure (78%) is higher than the conservative single-customer calculation is that VCR capacity is shared across customers — the marginal cost of an additional customer who runs one campaign per quarter is much lower than the cost of a customer who runs four campaigns per quarter, and the blended mix sits comfortably above 78%.

### A5.2 CAC Build-Up

**Briefing CAC ($400):** Almost entirely PLG-driven. Allocation: $250 content marketing amortized per signup, $100 SEO/SEM, $50 inbound conversion ops. Sales-touch CAC is ~$0.

**Workbench CAC ($4,500):** Sales-assist motion. Allocation: $1,500 content (longer-form), $2,000 SDR + AE time per closed deal (assuming 20% close rate on qualified opportunities), $1,000 demo + onboarding cost.

**Platform CAC ($18,000):** Full-cycle enterprise sales. Allocation: $6,000 outbound and ABM, $8,000 AE+SE time per close (assuming 6-month cycle, 15% close rate), $4,000 contracting + security review + onboarding.

### A5.3 Retention and Tenure

**Briefing tenure (18 months blended).** Annual subscribers retain at ~80% (one-year retention); monthly subscribers churn at ~6%/mo. Blended LTV math weights both. Briefing churn is dominated by individual analyst job changes, not by product dissatisfaction.

**Workbench tenure (30 months blended).** Annual retention of 85%; meaningful expansion to Platform (15% of cohort within 24 months), which we count as Workbench churn but Platform acquisition. True Workbench logo retention is therefore higher than 85%.

**Platform tenure (48 months blended).** Enterprise contracts are sticky once integrated into a workflow. Modeled at 88% annual logo retention; net revenue retention of 105%+ via VCR-capacity expansion.

### A5.4 Magic Number / Capital Efficiency

At Scenario B ($6M Series A, $11.36M Year-3 ARR), implied magic number is **(Year-3 ARR − Year-1 ARR) / Year-2 sales spend** = ($11.36M − $0.91M) / ~$1.4M ≈ **7.5×**. This is well above the SaaS healthy-band benchmark (>1×) — driven by the PLG funnel at the Briefing tier subsidizing CAC for the higher tiers.

At Scenario A ($2.5M seed, $4.69M Year-3 ARR), implied magic number is **($4.69M − $0.47M) / ~$0.5M = 8.4×**, even more efficient because the seed scenario relies less on enterprise sales.

### A5.5 Sensitivity to Key Inputs

| Input | Base case | Pessimistic | Optimistic |
|---|---|---|---|
| Briefing month-1 churn | 6%/mo | 9%/mo (LTV: $3,100) | 4%/mo (LTV: $5,400) |
| Workbench-to-Platform expansion within 24mo | 15% | 8% | 25% |
| Platform NRR | 105% | 95% | 115% |
| Foundation-model API price trend | -10%/yr | flat | -25%/yr |
| Workbench close rate on qualified opp | 20% | 12% | 28% |

A pessimistic combination (9% Briefing churn, 8% expansion, 95% NRR, flat APIs, 12% close rate) still produces a positive LTV:CAC at every tier. The model is not fragile.

---

## APPENDIX A6 — COMPARABLE-COMPANY ANALYSIS

We benchmark Inflexcvi against four comparable categories. The objective is not to claim a multiple — at this stage we are too early — but to give a diligence team the reference set they will use to triangulate a valuation range.

### A6.1 Public Comparables

| Company | Category | Revenue (TTM, latest) | Multiple (EV/Revenue) | Why this is a valid comp |
|---|---|---|---|---|
| Gartner | Research subscriptions + advisory | ~$6.0B | ~5–6× | Closest analog to our Briefing tier — research subscriptions to enterprise buyers |
| Palantir | Enterprise data + analytics platform | ~$2.6B | ~25–35× (premium for AI exposure) | Closest analog to our Platform tier — multi-seat enterprise deployment of an analytical platform |
| MSCI | Index + analytics | ~$2.6B | ~17–22× | Analog to our CVI as a proprietary index licensed to capital allocators |
| FactSet | Financial data + analytics | ~$2.2B | ~8–10× | Analog to our Workbench — workflow tool for analyst desks |

**Triangulated range.** A category-creating, AI-native, governance-strong research platform with both PLG and enterprise motion would reasonably trade in the 8–15× forward revenue range at IPO scale, with optionality toward MSCI-style index multiples (17–22×) if the CVI itself becomes a licensed factor for capital allocators.

### A6.2 Private Comparables (Recent Funding Rounds)

| Company | Stage / round | Reported valuation | Why relevant |
|---|---|---|---|
| Glean | Series E (2024) | ~$4.6B | AI-native enterprise search with PLG → enterprise motion |
| Hebbia | Series B (2024) | ~$700M | AI research workflow product for finance buyers |
| Sourcegraph | Series D | ~$2.6B | Vertical-AI workflow for engineering org capability |
| AlphaSense | Series F | ~$4.0B | Research intelligence for finance/strategy |

**What this tells us.** AI-native research-and-analytics products targeting enterprise buyers have been clearing $1–4B private valuations at the growth stage. The seed/Series A entry point is well-priced relative to that exit reference set.

### A6.3 Why CE Deserves a Premium Within the Comp Set

1. **Three buyer cohorts, one product surface** — most comps serve one cohort (Glean = IT, AlphaSense = finance research, Hebbia = finance research). CE simultaneously serves Operators, PE, and VC from the same back-end.
2. **Proprietary index** — CE has a defensible composite index (CVI) with potential to become a licensed factor product. Glean does not. Hebbia does not. AlphaSense does not. MSCI's premium multiple is precisely about owning the index.
3. **Governance perimeter as a moat** — none of the AI-native comps ship with a HITL review queue enforced at the query layer. This is a market-access prerequisite for regulated-industry buyers and an underwriting-quality differentiator for capital allocators.
4. **Dependency graph as analytical primitive** — competitors compute single-asset signals; CE computes propagation. This is what Cascade and M&A Twin enable, and it has no obvious analog in the comp set.

### A6.4 What CE Should Not Claim

We are not Palantir Foundry. We do not deploy customer data into a managed ontology. We are not MSCI. We have not (yet) licensed the CVI as a factor to a Bloomberg Terminal or FactSet. These are forward-leaning optionality, not present claims.

---

## APPENDIX A7 — DETAILED USE OF FUNDS WITH MILESTONES

This appendix maps every dollar of the seed and Series A scenarios to specific shipped-feature expansion. Dollar amounts are headcount-equivalent fully-loaded annual costs unless noted.

### A7.1 Path A — $2.5M Seed, 18-Month Plan

**Engineering ($1.20M)**

| Hire | Cost (annualized) | Mandate | Dependent milestone |
|------|------------------|---------|-------------------|
| Senior full-stack engineer | $260K | Ship 4 industries (Pharma, Logistics, Telecom, Public Sector); maintain frontend velocity across 17-page surface | M9: 4 industries live |
| ML / agent engineer | $290K | Extend VCR concurrent capacity 3×; ship 2 additional analytical tabs (e.g., Regulatory Δ, Edge Concentration); harden discovery agent | M9: 2 new tabs live; M12: 3× VCR capacity |
| Founder time (engineering) | (no incremental cost) | Architecture, code review, infrastructure | continuous |
| API / infra costs | $200K (18mo) | Perplexity, OpenRouter (Sonnet/Haiku/GLM fallback chain), self-hosted Mem0, Neo4j, Redis, pgvector, Postgres at scaled cycle frequency for 6 autonomous agents | continuous |
| Software & tooling | $50K | Datadog or equivalent observability; CI/CD; staging environment | M3 |
| Reserved engineering reserve | $100K | Contractor surge capacity for review-queue UI iteration | as needed |

**GTM & Content ($0.70M)**

| Item | Cost | Mandate |
|---|---|---|
| Founding AE for Workbench/Platform | $260K (annualized, OTE) | Close first 5 Platform customers; 35 Workbench customers |
| Content engine + SEO | $180K | Drive Briefing PLG funnel to 600 customers by M18 |
| Conference + analyst relations | $120K | Speaking slots at Gartner Strategy Summit, MIT Sloan, AIA |
| Marketing automation, CRM | $60K | HubSpot or similar; outbound sequencing |
| Demos, sandboxes, sample reports | $80K | Workbench-tier and Platform-tier sales collateral |

**Operations ($0.30M)**

| Item | Cost |
|---|---|
| Legal (incorporation maintenance, customer contracts, IP assignment) | $80K |
| Accounting + tax + bookkeeping | $40K |
| Compliance review for HITL audit packaging (pre-SOC 2 readiness) | $80K |
| Infrastructure scale-up reserves | $100K |

**Reserve ($0.30M).** 18-month runway buffer; foundation-model API price-shock contingency.

**Milestones, mapped to capital deployment:**

| Month | Milestone | Capital prerequisite |
|---|---|---|
| M3 | Observability + staging environment live | Tooling spend |
| M6 | First 2 new industries shipped (Pharma, Logistics) | Senior full-stack hire on month 1 |
| M9 | All 4 new industries live; 2 new analytical tabs live | Both engineers productive |
| M12 | VCR 3× capacity; first 2 Platform customers signed | ML engineer + AE both productive |
| M15 | 5 Platform customers; 35 Workbench; 400 Briefing | AE closing rate ramped |
| M18 | $2M ARR run-rate; ready for Series A from strength | All above |

### A7.2 Path B — $6M Series A Midpoint, 24-Month Plan

**Engineering ($2.20M)**

| Hire | Cost (annualized) | Mandate |
|------|------------------|---------|
| ML / agent engineering lead | $320K | Architecture ownership shared with founder; lead VCR 5× capacity expansion |
| Senior full-stack engineer #1 | $260K | Industry expansion (8 new industries) |
| Senior full-stack engineer #2 | $260K | Analytical surface expansion (5 new tabs); platform scaling |
| Product design lead | $230K | Workbench → Platform UX; review-queue admin tooling |
| API / infra costs (24mo) | $400K | Scaled cycle frequency, multi-tenant Postgres, expanded Redis |
| Tooling, staging, observability | $130K | Production-grade observability; multi-environment infrastructure |
| Engineering reserve | $200K | Contractor capacity for verticalized VCR templates |

**Sales & GTM ($2.10M)**

| Item | Cost |
|---|---|
| 3 enterprise AEs (averaged, OTE) | $900K |
| 1 sales engineer | $250K |
| 1 marketing lead | $200K |
| ABM tooling, content production at scale | $300K |
| Conference and event budget (large-cap PE summits, AI summits, analyst summits) | $250K |
| Outbound automation, intent data | $100K |
| Demo environments and customer reference programs | $100K |

**Customer Success ($0.60M)**

| Hire | Cost |
|---|---|
| 2 Customer Success architects | $440K (annualized) |
| CS tooling | $60K |
| Onboarding + training program development | $100K |

**Operations ($0.60M)**

| Item | Cost |
|---|---|
| SOC 2 Type I (Y1) + Type II (Y2) audit + remediation | $250K |
| Legal (enterprise contracts, MSAs, DPAs) | $150K |
| Finance, RevOps, payroll | $120K |
| HR + recruiting | $80K |

**Reserve ($0.50M).** 24-month runway buffer.

**Milestones, mapped:**

| Month | Milestone |
|---|---|
| M3 | Engineering team fully ramped; SOC 2 Type I work begun |
| M6 | First 3 new industries live; first enterprise pipeline at $5M qualified |
| M9 | First 5 Platform customers signed; SOC 2 Type I awarded |
| M12 | 8 new industries; 5 new tabs; VCR 3× capacity; $4M ARR run-rate |
| M15 | First Workbench → Platform expansion landed (proof point for the CS investment) |
| M18 | SOC 2 Type II audit period complete; 10 Platform customers; $7M ARR run-rate |
| M24 | $10–12M ARR run-rate; 18 Platform customers; full enterprise motion proven; Series B from strength |

### A7.3 What Both Plans Have In Common

- Every hire is tied to a shipped-feature milestone, not a vague "build the team" line item.
- Every capital deployment is auditable against a confirmable product-surface change (industries seeded, tabs shipped, VCR concurrent capacity, Platform logos signed).
- Both plans preserve the BullMQ + HITL governance discipline. Neither plan re-architects the core; both extend it.

---

## APPENDIX A8 — GLOSSARY OF CAPABILITY ECONOMICS TERMS

This glossary serves diligence teams who are encountering the platform's terminology for the first time. Definitions are drawn from the live codebase and from `docs/architecture-spec.md`.

**Bayesian Consensus Score.** The posterior mean capability score (0–100) computed via conjugate Gaussian update from N source-specific likelihoods. Each source is weighted by its confidence, and the posterior carries an explicit standard deviation that maps to a credible interval surfaced in the UI. Stored on the per-capability `cvi_components` row.

**BullMQ.** The job-queue library used to orchestrate enrichment work. Backed by Redis via ioredis. Provides durable jobs, retries, exponential backoff, and concurrency control. Replaces earlier in-process and Postgres-backed implementations.

**Inflexcvi Alpha.** The 10-tab analytical surface at `/alpha`. Each tab computes a different analytical lens (EVaR, Cascade, Narrative Δ, Moat, Fragility, Arbitrage, Flows, Talent, M&A Twin, Thesis) on the live capability and dependency dataset. Earlier docs called this "CE Alpha" — that was the pre-rename brand.

**CVI (Capability Value Index).** Composite score 0–1000 representing an industry's overall capability health. Computed as a GDP-weighted, velocity-adjusted, confidence-attenuated aggregation of per-capability scores. Documented in full at `/api/cei/methodology`.

**Capability.** A row in the `capabilities` table — a named organizational ability (e.g., "Claims Automation") with a slug, dual descriptions (traditional + economic), industry assignments, and enrichment fields.

**Inflexcvi.** The discipline of treating organizational capabilities as quantifiable economic assets with TAM, SAM, margin structure, half-life, revenue exposure, and dependency relationships. Distinct from generic "capability assessment" which is qualitative.

**Inflexcvi Enrichment.** The structured process by which a capability row is populated with TAM, SAM, margin %, half-life, revenue exposure, and consensus quadrant via a Perplexity → LLM synthesis pipeline (Claude Sonnet 4.6 default; `LLM_MODEL` override; Sonnet→Haiku→GLM 5.1 fallback chain). Stored in `capability_alpha`.

**Capability Dependency.** A directed edge between two capabilities indicating that one is a structural prerequisite or downstream consequence of the other. Stored in `capability_dependencies` with strength.

**Cascade.** The Inflexcvi Alpha tab that computes downstream propagation — given a root capability, which dependents would be impacted, with what probability, time-to-impact, and dollar impact.

**Consensus Quadrant.** The market-consensus classification of a capability's life-cycle stage: hot, emerging, table-stakes, declining. Captured during enrichment alongside the CE proprietary view.

**Discovery Agent.** Background autonomous agent that proposes new capabilities for inclusion in the catalog. Inserts go through the HITL review queue with `submittedBy='discovery_agent'`.

**Dependency Edge Score.** A row in `dependency_edge_scores` capturing LLM-scored disruption probability (0–1), time-to-impact (months), dollar-impact estimate (mm), and rationale text for each upstream/downstream edge. Drives Cascade and Fragility computations. Traversed via Neo4j Cypher when configured; falls back to Postgres recursive CTEs otherwise.

**Edge Shock.** The Fragility-tab component computed from `expectedImpact = dollarImpactMm × disruptionProbability`, normalized as a percentage of revenue exposure. Null when no upstream edge has been LLM-priced — does not silently default to zero.

**EVaR (Expected Value at Risk).** The Inflexcvi Alpha tab computing $ at risk over 12/24/36 months as `revenueExposure × margin × max(halfLifeDecay, marketErosion)`.

**Fortress / Defensible / Contestable / Exposed.** The Moat-tab tier mapping for moat scores: ≥70 fortress, ≥50 defensible, ≥30 contestable, else exposed.

**Fragility.** The Inflexcvi Alpha tab computing structural brittleness from decay speed, upstream depth, supplier concentration, edge shock, and disruption pressure with weights `0.25 / 0.20 / 0.15 / 0.25 / 0.15`.

**LLM synthesis layer.** OpenRouter chat-completions endpoint used for strict-JSON synthesis of Perplexity research prose into typed numeric fields with rationale strings. Default model is `anthropic/claude-sonnet-4.6` (overridable per-deploy via the `LLM_MODEL` env var). The `services/llm-fallback.ts` chain cascades Sonnet 4.6 → Haiku 4.5 → `z-ai/glm-5.1` automatically on OpenRouter credit/budget errors. Epistemic role: structured reasoning over evidence.

**GLM-5.1.** The model `z-ai/glm-5.1`, used as the cheapest tier of the OpenRouter fallback chain. Not the default synthesis model — earlier versions of this document called the synthesis layer "GLM-5.1" when in fact it was Claude Sonnet 4.6 via OpenRouter under a misleading function name. The naming has since been corrected throughout the codebase (commit history searchable for "openrouterChatJson").

**HITL Review Queue.** Human-in-the-loop governance gate for capability publication. Implemented in `routes/review.ts` and `pages/review-queue.tsx`. Public catalog filters on `reviewStatus='approved'` so unreviewed drafts cannot leak.

**Bot (Synthetic Agent).** A fully-provisioned synthetic user with persona, identity, billing org, KYC, and membership rows, running on a daily action loop with a per-bot monthly budget cap. Default cap is $40/mo (safety ceiling); realistic operating spend is $10-15/mo per bot. 5 personas defined (PE Partner / Tech / Insurance / Energy / Healthcare); only PE Partner is active at launch. Outputs are UI-disclosed with a "Synthetic agent · [Persona]" badge. Action types: browse, assessment, reflection, comment, marketplace, deep-dive, cross-bot-reflect. Code in `services/bots/`. Bot-origin activity is EXCLUDED from all customer counts and ARR figures in Slide 12.

**~~Letta.~~ — DECOMMISSIONED Phase 1.9 Step 6.** Replaced by **PostgresStore** — a shared agent state store implemented in `services/agent/store.ts` with namespaced reads/writes (e.g., `NS.agentPriors(agentName)`, `NS.agentRuns(agentName)`). Each of the 6 autonomous agents reads/writes its blocks (industry priors, current focus, research strategy, market context) through the same primitives.

**Neo4j.** Graph database (v5.26-community, self-hosted on Railway) used as the primary read path for the agent's **extracted-entity memory graph** in `services/agent/graphMemory.ts`. Functions: `findCorrelations()`, `findRelated()`, `getGraphStats()` — all operate on `:Entity` nodes mirrored from `memory_entities` / `memory_relations` tables via dual-write on `upsertEntity()` / `recordRelation()`. Activates when `NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD` are set; falls back to PostgreSQL automatically on any connection error so the feature degrades gracefully. **Note:** The capability dependency graph (`capability_dependencies`, `dependency_edge_scores`) is NOT currently mirrored to Neo4j — Cascade, Fragility, Explainability, and insights all read from Postgres. Capability-graph mirroring is on the roadmap.

**5 Specialized Autonomous Agents.** In addition to the core CVI research agent, the system runs:
- **Macro Event Agent** (`services/macro-event-agent.ts`) — watches global macro signals
- **Disruption Agent** (`services/disruption-agent.ts`) — scans for new capability-pair signal events (~1,000/cycle)
- **Ontology Agent** (`services/ontology-agent.ts`) — proposes new capability nodes + edges
- **Peer-Coop Agent** (`services/peer-coop-agent.ts`) — maintains peer-benchmark cohorts
- **Stack Optimizer Agent** (`services/stack-optimizer-agent.ts`) — cost/latency optimizer for LLM call graph
Each runs every 30 min on the shared PostgresStore. A weekly Claude-driven `optimizer.ts` mines the HITL queue's accept/reject patterns and proposes prompt revisions for all six.

**DVX (Disruption Velocity Index).** Backend engine (`services/dvx-engine.ts`) that computes per-capability disruption pressure across all 348 capabilities every 30 min. Output is consumed by the Disruption Agent and surfaced at `/disruption`.

**CVI Signal Detection.** `services/cvi-signals/` scans capability pairs (~10,000 comparisons per cycle) for newly emerging correlation/divergence events, writing high-confidence ones to `cvi_signals`. Typical cycle finds ~1,000 new events.

**PostgresStore.** The shared LangGraph store replacing Letta. One Postgres table with namespaced key/value reads/writes — used by all 6 agents for both persistent priors and per-run scratch state. See `services/agent/store.ts`.

**Reference-Org Selection Rule.** Single-row config in `reference_org_selection_rule` storing the criterion ("top N per industry by TTM revenue, mix of public + largest known private, intl + disruptor coverage, with required source URLs") that the `seed-reference-orgs.ts` populator applies per industry. The rule itself is the customer-auditable artifact; the org list is derived. Replaces the prior hardcoded 12-org list.

**Industry GDP Weights.** Per-industry weights in `industry_gdp_weights`, each populated via Perplexity with required `source_url`, `source_year`, `source_citations`. The CVI weighted rollup excludes industries with no weight (warns at startup) rather than substituting a synthetic number. Schema-enforced via `NOT NULL` on the citation columns.

**Foundry Token Rotation.** Palantir Foundry access tokens (which expire ~60 min) are stored in `system_secrets.keyName='foundry_token'` and rotated via admin UI (`POST /api/admin/foundry/rotate-token`). A scheduled job emails the configured admin when token age exceeds 50 min. Eliminates the operational pain of mid-deploy token expiry.

**Hedera HCS Audit Chain.** Hedera Consensus Service topic anchoring for admin-rotation events and capability snapshots. Each event's previous-value hash + new metadata is committed to the topic and assigned a sequence number; the explorer UI at `/admin/admin-audit-chain` surfaces the full chain.

**system_secrets.** Database table for server-side managed secrets that admins can rotate without a Railway env-var change. Currently houses `admin_api_key` and `foundry_token`; each row carries a tamper-evident `auditLog` jsonb history with optional Hedera HCS anchor.

**M&A Twin.** The Inflexcvi Alpha tab using token-overlap analysis (≥0.5 threshold) between industries to surface synergy opportunities and quadrant-clash risks.

**Mem0.** **Self-hosted** semantic memory store (mem0ai/mem0 v2.1.0 built from our `mem0/Dockerfile` and deployed on Railway, backed by pgvector). Earlier docs referenced "Mem0 Cloud" — that's no longer accurate; we self-host. Memory recall happens at every agent decide-phase via semantic similarity query — not decoration.

**Moat.** The Inflexcvi Alpha tab computing a 0–100 score with weights `0.30 halfLife + 0.25 depth + 0.20 economicImpact + 0.15 stickiness + 0.10 concentration`. Components missing are dropped and remaining weights renormalized — no zero defaults.

**Narrative Δ.** The Inflexcvi Alpha tab quantifying the quadrant-step delta between Inflexcvi's proprietary view and visible market consensus.

**Perplexity Sonar.** The grounded web research API (model `sonar-pro`) used as the primary evidence-retrieval source. Returns prose with citation URLs.

**Quadrant Multiple.** The valuation-equivalent multiple applied to revenue exposure × margin in the Arbitrage tab: hot=15×, emerging=10×, table-stakes=4×, declining=1×.

**Review Status.** Column on `capabilities` taking values `pending_review` or `approved`. Public catalog filters on `approved`.

**Revision Guidance.** Free-text reviewer feedback persisted on capability rows that, when present on a reject action, drives a re-enrichment pass with the guidance injected into the prompt.

**Submitted By.** Provenance column on `capabilities` indicating the source of the draft — either a user identifier or `discovery_agent`.

**VCR (Virtual Capability Researcher).** Formerly VCE — renamed during the CEI→CVI brand cutover. The LangGraph-orchestrated multi-day research campaign system in `services/vcr/`. Lifecycle: intake → daily research cycles → cross-validated synthesis → executive report. Persisted across `vcr_assessments`, `vcr_cycles`, `vcr_research_items`. UI at `/vcr`.

**Workbench.** Both a product page (`/workbench`) and a membership tier ($1,499/mo, $14,990/yr). The page is the analyst-workflow surface for full-depth use of the analytical engine. The tier is the pricing layer that gates access.

---

*End of Inflexcvi PE/VC Pitchbook — May 2026.*
