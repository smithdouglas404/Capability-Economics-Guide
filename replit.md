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
- `/` — Home page with definition, real estate analogy, and navigation
- `/case-study` — Insurance industry case study with capability cards and 5-year ROI chart
- `/c-suite` — Interactive C-Suite perspectives hub (CEO, COO, CFO, CTO, CIO, CMO, CHRO, CPO)
- `/knowledge-graph` — Industry Capability Explorer: browse 6 industries, view capability maps with radar charts, drill into metrics/dependencies/C-suite mappings. Cross-Industry Comparison tab with benchmark bar chart, industry cards, and shared thematic capabilities
- `/projects` — Technology Project Impact Analysis: 6 projects across AI, App Mod, Mainframe, and Data domains. Each project has capability impact overlay (bar + radar charts), executive agenda (CFO/CEO/CIO perspectives with metrics and decision frameworks), and risk-of-inaction analysis
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
- Input validation on all routes (PUT org, CSV import enums, dashboard query)
- Technology projects endpoints: list with category filter, detail with capability impacts/executive insights/risks

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

### Key Dependencies
- **wouter** for client-side routing
- **framer-motion** for animations
- **recharts** for data visualizations (radar charts, bar charts)
- **lucide-react** for icons
- **shadcn/ui** components (cards, tabs, scroll-area, etc.)
- **@tanstack/react-query** for data fetching via generated hooks

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
