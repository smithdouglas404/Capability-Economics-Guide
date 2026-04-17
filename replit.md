# Overview

This project is a full-stack educational platform called "Capability Economics App" designed to teach novice users about capability economics. It features an executive-grade design and aims to showcase how organizations can strategically manage their capabilities for economic advantage. Key capabilities include interactive tools for C-Suite perspectives, a knowledge graph for exploring industry capabilities, technology project impact analysis, AI-powered insights, and an autonomous agent for continuous capability intelligence enrichment. The project's vision is to provide a comprehensive, data-driven platform for understanding, assessing, and improving organizational capabilities, with market potential in strategic consulting and business education.

# User Preferences

I want iterative development.
Ask before making major changes.
I want detailed explanations.
Do not make changes to the folder `lib/api-zod/`.
Do not make changes to the file `lib/api-zod/src/index.ts`.

# System Architecture

## Design
- **Color Scheme**: Indigo primary (#244 47% 50%), amber accent.
- **Typography**: Outfit sans-serif, Playfair Display serif, imported via Google Fonts.
- **Background**: Slate with space-separated HSL values.
- **UI Components**: Utilizes shadcn/ui for various components like cards, tabs, and scroll-areas.
- **Icons**: Lucide-react.
- **Animations**: Framer-motion.

## Technical Implementation
- **Monorepo**: pnpm workspaces with TypeScript 5.9.
- **Backend**: Node.js 24, Express 5, running on Port 8080.
- **Database**: PostgreSQL with Drizzle ORM.
- **Validation**: Zod (v4) and drizzle-zod for schema validation across all API routes.
- **API Codegen**: Orval for generating API client hooks and Zod schemas from OpenAPI spec.
- **Build Tool**: esbuild for CJS bundles.
- **Routing**: wouter for client-side routing.
- **Data Fetching**: @tanstack/react-query for managing API data.
- **Session Management**: Session tokens and industry IDs stored in `localStorage`.
- **Generated Code**: React Query hooks in `@workspace/api-client-react` and Zod schemas in `@workspace/api-zod` are generated from `openapi.yaml`.

## Feature Specifications

### Frontend Pages
- **Home (`/`)**: Definition, real estate analogy, Mem0 institutional memory, navigation.
- **Case Study (`/case-study`)**: Insurance industry case study with capability cards and 5-year ROI chart.
- **C-Suite (`/c-suite`)**: Interactive C-Suite perspectives hub.
- **Knowledge Graph (`/knowledge-graph`)**: Industry Capability Explorer with radar charts, cross-industry comparison, and D3.js force-directed network visualization.
- **Projects (`/projects`)**: Technology Project Impact Analysis across AI, App Mod, Mainframe, Data domains.
- **Insights (`/insights`)**: AI-Powered Insights & Recommendations, industry leaderboard, capability ontology, curated white papers.
- **Organization (`/organization`)**: Setup wizard for creating organizations and assessing capabilities.
- **Dashboard (`/dashboard`)**: Personalized dashboard for organizational maturity comparison and gap analysis.
- **Capability Economics Index (`/cei`)**: Live composite index with sentiment gauge and industry breakdown, calculated using a multi-source triangulation and Bayesian consensus formula.

### Backend API Endpoints
- Standard REST API for industries, capabilities, roles, organizations, technology projects, insights, and enrichment.
- Organization CRUD with session tokens.
- Capability assessment upserts with validation and transactions.
- CSV upload for bulk assessment imports.
- Perplexity-powered live research endpoint (`POST /api/research`).
- Enrichment pipeline endpoints for running, status, and retrieving quadrants, value chains, and company data.
- Autonomous Agent endpoints for status, triggering, history, events (SSE), memories, and tools.
- Assessment endpoints for saving, retrieving history, sharing (public URL), and exporting.

### Database Schema
- Comprehensive schema including `industries`, `capabilities`, `organizations`, `technology_projects`, `capability_thresholds`, `capability_insights`, `industry_leaderboard`, `data_sources`, `ontology_relationships`, `cei_snapshots`, `agent_runs`, `capability_quadrants`, `value_chain_stages`, and `company_capability_profiles`.

### Enrichment Pipeline
- **Process**: Perplexity research feeds into GLM 5.1 (via OpenRouter) for synthesis and DB insertion.
- **Phases**: Capability quadrant classification, value chain stages, and company profiles.
- **Data Retention**: Tracks run history in `enrichment_runs` with status and duration.
- **Concurrency**: Lock to prevent simultaneous enrichment runs.

### Autonomous Agent
- **Orchestration**: LangChain + LangGraph state machine.
- **Nodes**: Evaluate, decide, research, compute, memorize, finalize.
- **Memory**: Mem0 Cloud for persistent storage of observations and insights.
- **Decision Engine**: Evaluates data staleness, volatility, confidence, and memory patterns.
- **Tools**: `perplexity_research`, `query_database`, `compute_cei`, `recall_memories`, `store_memory`.
- **Scheduler**: Runs agent every 30 minutes.
- **Real-time Events**: SSE for live agent activity.

### Capability Assessment (Enhanced)
- **Input Signals**: Competitor benchmarking (SEC 10-K analysis), job posting analysis (Claude-powered), quick assess toggle.
- **Analysis Output**: 3-phase 12-month action plan roadmap, industry peer average overlay, WEF sub-indicators, competitor advantage insights, job posting insights, enhanced SEC insights.
- **Persistence**: All complete assessments saved to DB and listed in history. Letta memory write after each analysis.
- **Sharing**: Generates shareable tokens for public URLs, JSON download, print/PDF options.

# External Dependencies

- **Database**: PostgreSQL
- **AI/LLM**:
    - Anthropic Claude (via Replit AI Integrations proxy)
    - Perplexity API (for research, `PERPLEXITY_API_KEY`)
    - GLM 5.1 (via OpenRouter for synthesis)
- **Memory**: Mem0 Cloud (`MEM0_API_KEY`)
- **Stateful Agent Layer**: Letta (`@letta-ai/letta-client`)
- **UI Frameworks/Libraries**:
    - `wouter` (client-side routing)
    - `framer-motion` (animations)
    - `recharts` (data visualizations)
    - `lucide-react` (icons)
    - `shadcn/ui` (components)
    - `@tanstack/react-query` (data fetching)
- **AI Orchestration**:
    - `@langchain/core`
    - `@langchain/langgraph`
    - `langchain`
- **ORM**: Drizzle ORM
- **Validation**: Zod
- **API Codegen**: Orval

## Admin-Protected API Routes

All admin endpoints share one middleware (`artifacts/api-server/src/middlewares/requireAdmin.ts`).
Outside production it's a no-op; in production, the request must include the
header `x-admin-key: <ADMIN_API_KEY>`. Routes behind the middleware:

- `POST /api/review/draft`, `GET /api/review/queue`, `POST /api/review/:id/retry`,
  `POST /api/review/:id/approve`, `POST /api/review/:id/reject`,
  `GET /api/review/:id/notes`
- `GET /api/admin/overview`, `GET /api/admin/assessments`, `GET /api/admin/content`,
  `GET /api/admin/agent-runs`, `POST /api/admin/trigger/:tool`, `GET /api/admin/models`
- `POST /api/enrichment/run`
- `POST /api/alpha/enrich`, `POST /api/alpha/enrich-detail`, `POST /api/alpha/thesis`
- `POST /api/agent/scheduler/start`, `POST /api/agent/scheduler/stop`,
  `POST /api/agent/run-ontology`
- `POST /api/cei/refresh`
- `POST /api/insights/generate`, `POST /api/research`
- `PATCH /api/membership/tiers/:id`
- `POST /api/industries`, `POST /api/projects/generate`
- `DELETE /api/admin/case-studies/:id`, `POST /api/case-studies/generate`
- `GET/POST/PATCH/DELETE /api/admin/educational-content[/:id]`

Public read-only endpoints (catalog browsing, capability detail, EVaR, moat,
fragility, arbitrage, flows, talent, twin, status, graph, public educational
content, etc.) remain open.