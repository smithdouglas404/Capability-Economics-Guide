# AGENTS.md

## Cursor Cloud specific instructions

### Quick reference

- **Package manager**: pnpm (enforced; `npm install` / `yarn` will fail)
- **Node.js**: v22.x (already installed in VM)
- **Build**: `pnpm run build:deploy` (libs + frontend + api-server)
- **Typecheck**: `pnpm run typecheck` (has pre-existing TS errors in api-server; esbuild build still succeeds)
- **No test runner**: There is no test suite configured. Do not invent `pnpm test` commands.

### Starting services

**PostgreSQL** must be running before the api-server starts. Start it with:
```bash
sudo pg_ctlcluster 16 main start
```

**API server** (port 8080):
```bash
export DATABASE_URL="postgresql://ubuntu:devpass@localhost:5432/capability_economics"
export PORT=8080
export OPENROUTER_API_KEY="dummy-key-for-dev"  # required to avoid hard crash in integrations-anthropic-ai
export ADMIN_AUTH_BYPASS=1
export NODE_ENV=development
export CLERK_PUBLISHABLE_KEY="pk_test_Y2xlcmsuZXhhbXBsZS5jb20k"  # dummy but correctly formatted
pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/api-server run start
```

**Frontend Vite dev server** (port 5173):
```bash
export VITE_CLERK_PUBLISHABLE_KEY="pk_test_Y2xlcmsuZXhhbXBsZS5jb20k"
pnpm --filter @workspace/capability-economics run dev
```

### Gotchas

- **Clerk auth**: The `clerkMiddleware()` in the api-server validates the publishable key format. A dummy key like `pk_test_Y2xlcmsuZXhhbXBsZS5jb20k` passes format validation and lets unauthenticated API requests through (with `x-clerk-auth-status: signed-out`). Without this, ALL requests (including public API routes) fail with 500.
- **`@workspace/integrations-anthropic-ai`** throws at import time if `OPENROUTER_API_KEY` is unset. Set it to any non-empty string for local dev (AI features will return errors but the server won't crash).
- **Frontend requires `VITE_CLERK_PUBLISHABLE_KEY`** at build time. Without it, `vite build` throws. Use the same dummy key for local builds.
- **TypeScript errors**: The api-server has pre-existing TS errors that do not block the esbuild-based build. `pnpm run typecheck` will exit non-zero but the app runs fine.
- **Database**: Schema is pushed via `cd lib/db && npx drizzle-kit push --force`. Seeding: `pnpm --filter @workspace/scripts run seed`.
- **The api-server also serves the built SPA** when `artifacts/capability-economics/dist/public/index.html` exists. For dev, run both the api-server and Vite dev server separately.
