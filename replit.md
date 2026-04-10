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

Frontend-only React + Vite web application (`artifacts/capability-economics/`) that teaches novice users about capability economics. No backend needed — all content is built into the frontend.

### Pages
- `/` — Home page with definition, real estate analogy, and navigation
- `/insurance-example` — Insurance industry case study with capability cards and 5-year ROI chart
- `/c-suite` — Interactive C-Suite perspectives hub (CEO, COO, CFO, CTO, CIO, CMO, CHRO, CPO) with radar charts

### Key Dependencies
- **wouter** for client-side routing
- **framer-motion** for animations
- **recharts** for data visualizations (radar charts, bar charts)
- **lucide-react** for icons
- **shadcn/ui** components (cards, tabs, scroll-area, etc.)

### Structure
- `src/pages/` — Page components (home.tsx, insurance-example.tsx, c-suite.tsx)
- `src/components/layout.tsx` — Shared layout with navigation header and footer
- `src/App.tsx` — Router setup

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
