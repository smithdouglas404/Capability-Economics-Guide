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
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY
ENV VITE_CLERK_PROXY_URL=$VITE_CLERK_PROXY_URL

# Build frontend (capability-economics) then API server
RUN pnpm run build:deploy

ENV PORT=8080
EXPOSE 8080

# Push schema + seed every idempotent catalog, then start server.
#
# Order matters:
#   1. db push              — schema must be current before any seed runs
#   2. seed                 — base data (industries, capabilities)
#   3. seed:marketplace     — legacy marketplace seed (kept for back-compat)
#   4. seed:organizations   — 12 reference orgs — fixes "Scorecard 0 scored"
#   5. seed:patterns        — Uber/Stripe/OpenAI design-thinking exemplars
#   6. seed:reports         — 8 substantive marketplace research listings (+ placeholder PDFs)
#   7. start                — api-server, which also serves SPA + starts digest cron
#
# Every seed is idempotent (upsert on slug/title/userId); safe-on-every-restart.
# Any seed can be skipped by setting SKIP_ORG_SEED / SKIP_PATTERNS_SEED /
# SKIP_MARKETPLACE_SEED / SKIP_MIGRATE = 1 in env.
CMD ["sh", "-c", "pnpm --filter @workspace/db run push && pnpm --filter @workspace/scripts run seed && pnpm --filter @workspace/scripts run seed:marketplace && pnpm --filter @workspace/scripts run seed:organizations && pnpm --filter @workspace/scripts run seed:patterns && pnpm --filter @workspace/scripts run seed:reports && pnpm run start"]
