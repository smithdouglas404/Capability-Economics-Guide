# AGENTS.md

## Cursor Cloud specific instructions

### Quick reference

- **Package manager**: pnpm (enforced; `npm install` / `yarn` will fail)
- **Node.js**: v22.x (already installed in VM)
- **Build**: `pnpm run build:deploy` (libs + frontend + api-server)
- **Typecheck**: `pnpm run typecheck` (has pre-existing TS errors in api-server; esbuild build still succeeds)
- **No test runner**: There is no test suite configured. Do not invent `pnpm test` commands.
- **See `CLAUDE.md`** for detailed architecture, commands, and coding conventions.

### Starting services

**PostgreSQL** must be running before the api-server starts. Start it with:
```bash
sudo pg_ctlcluster 16 main start
```

**API server** (port 8080) — uses secrets `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from env:
```bash
export DATABASE_URL="postgresql://ubuntu:devpass@localhost:5432/capability_economics"
export PORT=8080
export OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-dummy-key-for-dev}"
export ADMIN_AUTH_BYPASS=1
export NODE_ENV=development
# CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY are injected as env secrets
pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/api-server run start
```

**Frontend Vite dev server** (port 5173) — requires `VITE_CLERK_PUBLISHABLE_KEY` from env:
```bash
# VITE_CLERK_PUBLISHABLE_KEY is injected as env secret
pnpm --filter @workspace/capability-economics run dev
```

**Full-stack on one port** (port 8080): Build the frontend with `VITE_CLERK_PUBLISHABLE_KEY` set, then start the api-server. It will serve the built SPA at `/` and API at `/api`.

### Gotchas

- **Clerk auth is required**: The `clerkMiddleware()` in the api-server validates the publishable key format. Without a real or correctly-formatted `CLERK_PUBLISHABLE_KEY`, ALL requests (including public API routes) fail with 500. The secrets `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `VITE_CLERK_PUBLISHABLE_KEY` are configured as VM environment secrets.
- **`@workspace/integrations-anthropic-ai`** throws at import time if `OPENROUTER_API_KEY` is unset. Set it to any non-empty string for local dev (AI features will return errors but the server won't crash).
- **Frontend requires `VITE_CLERK_PUBLISHABLE_KEY`** at build time. Without it, `vite build` throws.
- **Vite dev server has no API proxy**: When running the Vite dev server on port 5173, API calls to `/api/...` will fail because there's no proxy configured. For full-stack testing, use port 8080 (api-server serves both API and built SPA).
- **TypeScript errors**: The api-server has pre-existing TS errors that do not block the esbuild-based build. `pnpm run typecheck` will exit non-zero but the app runs fine.
- **Database**: Schema is pushed via `cd lib/db && npx drizzle-kit push --force`. Seeding: `pnpm --filter @workspace/scripts run seed`.
- **The api-server also serves the built SPA** when `artifacts/capability-economics/dist/public/index.html` exists. This is the recommended way to test the full app locally.
