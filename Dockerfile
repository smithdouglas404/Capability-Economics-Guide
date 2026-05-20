FROM node:22-slim

WORKDIR /app

# Install pnpm — on the official node image, global packages land in /usr/local/bin (already on PATH)
RUN npm install -g pnpm@10.26.1

# Copy everything
COPY . .

# Install all workspace dependencies
RUN pnpm install --frozen-lockfile

# Build-time variables (Vite bakes these into the bundle)
ARG VITE_CLERK_PUBLISHABLE_KEY
ARG VITE_CLERK_PROXY_URL

# Build frontend (capability-economics) then API server
RUN pnpm run build:deploy

ENV PORT=8080
EXPOSE 8080

# `pnpm run start` calls scripts/src/deploy-migrate.ts, which now runs:
#   1. SQL migrations (lib/db/migrations/*.sql) — table renames + column
#      corrections that drizzle-kit cannot infer (cei_* → cvi_* etc.).
#   2. drizzle-kit push --force — creates / aligns all tables to the
#      source-of-truth schema files.
#   3. The full seed chain in dependency order — every idempotent seed
#      (knowledge graph base, marketplace, organizations, design-thinking
#      patterns, marketplace reports, alpha-config, payg tier, DVX
#      disruption patterns, disruption events catalog).
#   4. Then api-server start.
#
# Each phase fails fast if a step fails; api-server boot is gated on the
# whole chain succeeding. Per-seed skip flags + whole-phase skip flags
# documented in scripts/src/deploy-migrate.ts.
CMD ["sh", "-c", "pnpm run start"]
