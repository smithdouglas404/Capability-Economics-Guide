# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Capability Economics App

Full-stack educational platform teaching novice users about capability economics with an executive-grade design aesthetic.

### Design
- Indigo primary (#244 47% 50%), amber accent
- Outfit sans-serif, Playfair Display serif
- Slate background, space-separated HSL values (no `hsl()` wrapper)
- Google Fonts `@import` must be first line in index.css

### Frontend Pages (`artifacts/capability-economics/`)
- `/` — Home page with definition, real estate analogy, Mem0 institutional memory showcase, and navigation
- `/case-study` — Insurance industry case study with capability cards and 5-year ROI chart
- `/c-suite` — Interactive C-Suite perspectives hub (CEO, COO, CFO, CTO, CIO, CMO, CHRO, CPO)
- `/knowledge-graph` — Industry Capability Explorer: browse 6 industries, view capability maps with radar charts, drill into metrics/dependencies/C-suite mappings. Cross-Industry Comparison tab with benchmark bar chart, industry cards, and shared thematic capabilities
- `/projects` — Technology Project Impact Analysis: 6 projects across AI, App Mod, Mainframe, and Data domains. Each project has capability impact overlay (bar + radar charts), executive agenda (CFO/CEO/CIO perspectives with metrics and decision frameworks), and risk-of-inaction analysis
- `/insights` — AI-Powered Insights & Recommendations: R/Y/G threshold monitoring, AI-generated analysis (Anthropic Claude), industry leaderboard with company benchmarks, capability ontology with relationship mapping and industry adapters, curated white papers library
- `/organization` — Organization setup wizard (2-step: create org + assess capabilities with sliders)
- `/dashboard` — Personalized dashboard comparing org maturity vs industry benchmarks, gap analysis, role-filtered views

### Backend (`artifacts/api-server/`)
- Port 8080
- REST API with routes: `/api/industries`, `/api/capabilities`, `/api/roles`, `/api/organizations`
- Organization CRUD with session tokens
- Capability assessment upserts with industry validation and transactions
- CSV upload for bulk assessment import (with enum validation)
- Dashboard aggregation with role-specific filtering (strict roleSlug validation)
- Cross-industry comparison endpoint with theme-based shared capabilities
- Standardized Zod validation on ALL routes using generated schemas from OpenAPI spec (params, query, body)
- Technology projects endpoints: list with category filter, detail with capability impacts/executive insights/risks
- Insights endpoints: thresholds (R/Y/G), insights, leaderboard, white papers, ontology, AI insight generation (POST), data-sources
- POST `/api/research` — Perplexity-powered live research endpoint returning structured findings with citations
- Anthropic AI integration via Replit AI Integrations proxy (`@workspace/integrations-anthropic-ai`)
- Perplexity API integration for live industry research (PERPLEXITY_API_KEY secret)

### Database Schema (`lib/db/`)
- `industries` — 6 seeded industries (Insurance, Healthcare, Banking, Manufacturing, Technology, Retail)
- `capabilities` — 8-12 per industry with benchmark scores
- `capability_metrics` — KPIs for each capability
- `capability_dependencies` — Inter-capability relationships
- `c_suite_roles` — Executive roles with descriptions
- `capability_role_mappings` — Role relevance per capability
- `organizations` — User orgs with session tokens
- `organization_capabilities` — Assessment scores with unique constraint on (org_id, capability_id)
- `technology_projects` — 6 projects across AI, App Mod, Mainframe, Data categories
- `project_capability_impacts` — How each project impacts specific capabilities (uplift, timeline)
- `project_executive_insights` — CFO/CEO/CIO agenda items per project
- `project_risks` — Risks of inaction per project with severity, consequence, mitigation
- `capability_thresholds` — R/Y/G threshold definitions per capability (with `sourceIds` jsonb)
- `capability_insights` — AI-generated and seeded strategic insights
- `industry_leaderboard` — Company benchmark rankings per industry (with `sourceIds` jsonb)
- `industry_white_papers` — Curated research papers by industry (with `sourceIds` jsonb, `url`)
- `data_sources` — Citation tracking: title, url, publisher, publishedDate, accessedDate, sourceType
- `ontology_relationships` — Capability-to-capability relationships (enables, competes_with, etc.)
- `ontology_industry_adapters` — Industry-specific ontology customizations with maturity models
- `capability_quadrants` — Hot/emerging/cooling/table_stakes classification with economic impact scores, perplexity sources
- `value_chain_stages` — Industry value chain stages with patent counts, startup counts, capital flows, HHI scores
- `company_capability_profiles` — Real company profiles with FEVI/CDI scores, funding stages, NAICS codes
- `company_capability_mappings` — Company-to-capability links with strength (core/emerging/adjacent)
- `enrichment_runs` — Run history tracking for enrichment pipeline executions

### Enrichment Pipeline
- Perplexity research → GLM 5.1 (via OpenRouter) synthesis → DB insert
- Three enrichment phases: capability quadrant classification, value chain stages, company profiles
- All three phases store `perplexitySources` (array of URLs) from Perplexity research
- `perplexitySearch()` returns `PerplexityResult { content: string; sources: string[] }`
- GLM 5.1 calls via OpenRouter with 180s timeout, 4096-8192 max_tokens
- Enrichment run history tracked in `enrichment_runs` table with status/duration/error tracking
- Concurrency lock prevents simultaneous enrichment runs (409 on concurrent attempt)
- Per-industry cleanup before re-enrichment prevents duplicate accumulation
- API routes: `/api/enrichment/run` (POST), `/api/enrichment/status`, `/api/enrichment/runs`, `/api/enrichment/quadrants`, `/api/enrichment/value-chain`, `/api/enrichment/companies` (paginated), `/api/enrichment/graph`
- Alias read-only routes under `/api/ontology/` prefix for graph/quadrants/companies/value-chain/runs

### Data Pipeline (Phase 5)
- All benchmark data is researched via Perplexity API (sonar-pro model) — no fabricated data
- 102+ real citation sources from McKinsey, Forrester, Deloitte, Accenture, BCG, Gartner, etc.
- Seed scripts in `scripts/src/`: `seed-insights.ts` (full), `perplexity-client.ts` (API client)
- Frontend shows clickable source badges (SourceBadges component) on thresholds, leaderboard, and white papers
- POST `/api/research` provides on-demand Perplexity research with auto-citation storage

### Capability Economics Index (CEI)
- `/cei` — Live composite index page with dark hero section, sentiment gauge, industry breakdown
- **CEI Formula**: CEI = Σ(Wi × Ci × (1 + Vi) × Ei × αi) / ΣWi × 10
  - Wi = industry GDP weight, Ci = Bayesian consensus score, Vi = velocity (EMA), Ei = economic multiplier, αi = confidence
- **Multi-source triangulation**: 4 Perplexity queries per capability (consulting, market data, academic, practitioner perspectives)
- **Bayesian consensus**: Non-informative prior (μ=50, σ²=625), posterior distribution with 95% credible intervals
- **Velocity tracking**: EMA (α=0.7) of score changes captures capability improvement/decline
- **Economic multiplier**: Derived from ontology dependency graph (1.0–2.0× based on connectivity)
- DB tables: `cei_snapshots`, `cei_components`, `source_triangulations`
- API endpoints: GET `/api/cei/current`, GET `/api/cei/history`, POST `/api/cei/refresh`, GET `/api/cei/methodology`, GET `/api/cei/components`
- Index scale: 0-1000 (Nascent → Developing → Advancing → Leading → Transformative)

### Autonomous Agent (Phase 7)
- LangChain + LangGraph state machine for autonomous CEI research orchestration
- **LangGraph nodes**: evaluate → decide → research → compute → memorize → finalize
- **Mem0 Cloud memory**: real `mem0ai` MemoryClient stores/recalls observations, patterns, insights, and decision context (MEM0_API_KEY in secrets)
- **Letta integration**: optional stateful agent layer via `@letta-ai/letta-client` — auto-connects to local Letta server, gracefully degrades when unavailable. Records cycle summaries for institutional memory blocks
- **Decision engine**: evaluates staleness (7d threshold), volatility, confidence, and memory patterns before deciding to research or skip
- **LangChain tools**: 5 tools (perplexity_research, query_database, compute_cei, recall_memories, store_memory) invoked via `.invoke()` in graph nodes
- **Background scheduler**: runs agent every 30min (configurable), prevents overlapping runs
- **SSE real-time events**: `/api/agent/events` streams live agent activity to the dashboard
- **Agent activity UI**: "Autonomous Agent" section on CEI dashboard shows status, stats, last run details, and live activity feed
- DB tables: `agent_runs` (run history with decisions), `agent_memories` (persistent learning synced with Mem0 Cloud)
- API endpoints: GET `/api/agent/status`, POST `/api/agent/trigger`, GET `/api/agent/history`, GET `/api/agent/events` (SSE), GET `/api/agent/memories`, GET `/api/agent/tools`
- Agent files: `artifacts/api-server/src/services/agent/` — graph.ts (LangGraph), tools.ts (LangChain tools), memory.ts (Mem0), letta.ts (Letta client), events.ts (SSE), scheduler.ts
- Max 6 Perplexity research calls per agent run to control API costs

### Capability Intelligence Enrichment Agent (Phase 8)
- Perplexity + GLM 5.1 research pipeline for automated capability intelligence enrichment
- **Pipeline stages**: For each of 6 industries: (1) Capability Quadrant Classification, (2) Value Chain Stage Analysis, (3) Company Profile + Mapping
- **Perplexity research**: sonar-pro model for real-time industry data gathering
- **GLM 5.1 synthesis**: z-ai/glm-5.1 via OpenRouter for structured JSON extraction from research
- **Timeout**: 180s AbortController on GLM calls, 8192 max_tokens for value chain synthesis
- **extractJson**: robust parser handling ```json fences, truncated arrays (finds last `}` + appends `]`), object fallback
- DB tables: `capability_quadrants` (quadrant classification + economic impact scores), `value_chain_stages` (patent/startup/capital metrics per stage), `company_capability_profiles` (FEVI/CDI scores), `company_capability_mappings` (company-to-capability links)
- API endpoints: POST `/api/enrichment/run`, GET `/api/enrichment/status`, GET `/api/enrichment/quadrants`, GET `/api/enrichment/value-chain`, GET `/api/enrichment/companies`, GET `/api/enrichment/company-mappings`, GET `/api/enrichment/graph`
- Admin UI: "Enrich Now" button on `/admin` page with live status display
- Enrichment service: `artifacts/api-server/src/services/enrichment/index.ts`
- Enrichment route: `artifacts/api-server/src/routes/enrichment.ts` (mounted at `/api/enrichment`)
- Verified production data: 108 quadrants, 44 value chain stages, 117 companies, 157 mappings across 6 industries

### Key Dependencies
- **wouter** for client-side routing
- **framer-motion** for animations
- **recharts** for data visualizations (radar charts, bar charts)
- **lucide-react** for icons
- **shadcn/ui** components (cards, tabs, scroll-area, etc.)
- **@tanstack/react-query** for data fetching via generated hooks
- **@langchain/core**, **@langchain/langgraph**, **langchain** for autonomous agent orchestration
- **mem0ai** for persistent agent memory (Mem0 Cloud)
- **@letta-ai/letta-client** for optional Letta stateful agent integration

### Session Management
- Session token stored in `localStorage` as `ce_session_token`
- Industry ID stored as `ce_industry_id`
- `useUpsertAssessments()` takes no args; mutation receives `{ sessionToken, data }`
- `useGetDashboard(sessionToken, params?, options?)` signature

### Generated Code (`lib/api-client-react/`, `lib/api-zod/`)
- Generated via Orval from `lib/api-spec/openapi.yaml`
- React Query hooks in `@workspace/api-client-react`
- Zod validation schemas in `@workspace/api-zod`
- IMPORTANT: Do NOT change OpenAPI `info.title` — controls generated filenames
- IMPORTANT: `lib/api-zod/src/index.ts` must only contain `export * from "./generated/api";` (codegen re-adds duplicate — always revert)
- CSV upload uses `customFetch(getUploadCsvUrl(...))` directly because generated `uploadCsv` wraps body in `JSON.stringify`
- `customFetch` exported from `@workspace/api-client-react` for direct API calls when generated hooks have limitations

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `cd lib/db && npx drizzle-kit push --force` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## /assess — Capability Assessment (Enhanced)
Full-stack capability assessment with all 6 enhancement areas complete:

**Input signals**:
- Competitor benchmarking: up to 3 competitors, SEC 10-K fetched for each, overlaid on radar
- Job posting analysis: paste a job description, Claude extracts capability/gap signals
- Quick Assess toggle: bypasses clarifying questions for sub-15s assessments

**Analysis output**:
- Roadmap tab: 3-phase 12-month action plan (Phase 1: Foundation 0-3m, Scale 3-6m, Lead 6-12m) with effort/impact tags, owner roles, WEF links
- Industry peer average overlay on radar (peerAverage per axis)
- WEF sub-indicators per capability (2-3 specific sub-indicators)
- Competitor advantage field on each gap
- Job posting insights block (strategicIntent, capabilitySignals, gapIndicators)
- Enhanced SEC insights: rdSpendSignal + riskCapabilityLinks

**Persistence & continuity**:
- All complete assessments saved to DB and listed in history panel on /assess
- Letta memory write after each analysis (writes to cei-autonomous-agent on letta.innume.com)
- GET /api/assess returns list of 20 most recent complete assessments

**Sharing & export**:
- POST /api/assess/share → generates shareToken (16-char UUID slug)
- GET /api/assess/share/:token → returns full assessment (public shareable URL)
- Download JSON: full assessment with metadata + WEF source annotations
- Print/PDF: window.print() with print-safe CSS (hides nav/step indicators)
- Share button: copies URL to clipboard with visual confirmation

**UX**:
- Animated progress steps during analysis (10-step sequence, 1.8s intervals)
- Results tabs: Overview | 12-Month Roadmap | Competitors (if competitors provided)
- Collapsible competitor and job posting sections
- Recent assessments history panel in header
