# Limited-Production Readiness

This document records the audit and hardening pass run on the
`claude/refine-local-plan-Q4eBO` branch to take the Capability Economics
platform from Replit-era staging to limited production on Railway.

## Context

The app moved off Replit onto Railway. Two things had to be true before
limited production could open to real customers and investors:

1. **Every service the app depends on lives on Railway** (or a deliberate
   third-party SaaS) with all required env vars set on the correct service.
2. **No hardcoded, seeded, or demo content leaks to real users.** Fake-brand
   placeholders, synthetic Stripe sellers, dev-only error strings, and
   `@example.com` security contacts must not appear in user-visible UI.

## Railway infrastructure — verified

Six services live in the **Capability Economics** project
(`b4a4c027-0c13-48ad-aa90-f0c8daee52cb`, environment `production`):

| Service | Source |
|---|---|
| `capabilityeconomics` | this repo, root `/` — api-server + serves SPA |
| `Mem0` | this repo, root `mem0` (libpq5-patched, clones mem0ai/mem0 v2.0.2) |
| `letta-2EOT` | `letta/letta:latest` Docker image |
| `pgvector` | `pgvector/pgvector:pg18` — Mem0's vector store |
| `Postgres` | `ghcr.io/railwayapp-templates/postgres-ssl:18` — app DB |
| `Neo4j Graph Database` | `neo4j:5.26-community-bullseye` — deployed but not yet wired into app code |

`REDIS_URL` points at Redis Cloud (third-party, intentional). The only
Replit references in the codebase are `process.env.REPL_ID` checks in three
`vite.config.ts` files that no-op outside Replit.

## Environment variables

Already set on `capabilityeconomics`:

```
DATABASE_URL, PORT
MEM0_BASE_URL, MEM0_API_KEY
LETTA_BASE_URL, LETTA_API_KEY
OPENROUTER_API_KEY, PERPLEXITY_API_KEY, ANTHROPIC_API_KEY
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, VITE_CLERK_PUBLISHABLE_KEY
DIDIT_API_KEY, DIDIT_WORKFLOW_ID
NOWPAYMENTS_API_KEY, NOWPAYMENTS_IPN_SECRET
RESEND_API_KEY, EMAIL_FROM
REDIS_URL, MARKETPLACE_STORAGE_DIR
```

**Must add before prod:**

| Env var | Why | Action |
|---|---|---|
| `ADMIN_API_KEY` | Required by `requireAdmin.ts:37` and `requireReviewer.ts:59` — every `/api/admin/*` route returns 401 without it. | Generate `openssl rand -base64 32` and set on the `capabilityeconomics` service Variables tab. Distinct value from `MEM0_API_KEY` despite the name overlap. |

**Deferred:**

- `DIDIT_WEBHOOK_SECRET` — only matters when KYC webhooks fire. Add when KYC flow goes live.
- `APP_BASE_URL` — hardcoded fallback in `email.ts:293` matches the current Railway URL. Revisit when a custom production domain is provisioned.

## What changed in code

### Backend

- **`artifacts/api-server/src/routes/marketplace-listings.ts`** — public
  `GET /marketplace/listings` and `GET /marketplace/listings/:id` now require
  the joined seller to have `chargesEnabled = true`. Listings owned by demo
  sellers (whose Stripe Connect account is synthetic and can't accept
  charges) are excluded from public browse and return 404 on direct lookup
  for non-owners.
- **`scripts/src/seed-marketplace-listings.ts`** — synthetic seed seller now
  inserts with `chargesEnabled: false`. An idempotent `UPDATE` runs at the
  top of the seed to force-flip any rows that earlier boots set to `true`,
  including the sibling seed seller `acct_ce_demo_seller` from
  `services/marketplace-seed.ts`. Both synthetic sellers now carry
  `chargesEnabled=false` and are excluded by the listings filter.

### Frontend — auth gating

- **`artifacts/capability-economics/src/App.tsx`** — added a
  `RequireSignedIn` route wrapper mirroring the existing `AdminOnly`
  pattern. `/demo` and `/workbench/example` are wrapped; unauthenticated
  visitors are redirected to `/sign-in`.
- **`artifacts/capability-economics/src/pages/vce.tsx`** — the "Try with
  sample brief" CTA is now conditional on `useAuth().isSignedIn`. The route
  itself stays public.

### Frontend — copy fixes

- **`pages/security.tsx`** — both `security@example.com` occurrences
  (header `<p>` and footer `<a>`) replaced with `security@capabilityeconomics.com`.
- **`pages/demo.tsx`** — the dev-facing empty-state string
  ("Run POST /api/admin/patterns/seed with admin auth") replaced with
  "Disruption patterns are still populating. Check back in a moment."
- **`pages/organization.tsx`** — placeholder `"e.g. Acme Insurance Co."` → `"Your company name"`.
- **`pages/account.tsx`** — placeholder `"Team name (e.g. Acme Strategy)"` → `"Team name"`.
- **`components/manual-comp-form.tsx`** — placeholder `"Acme Inc." / "Jane Doe"` → `"Company name" / "Person's name"`.

### Docs

- **`CLAUDE.md`** — the Mem0+Letta-on-Railway section incorrectly said the
  api-server sends `Authorization: Bearer`. The code uses `X-API-Key`
  (`artifacts/api-server/src/services/agent/memory.ts:74`); doc updated to
  match.

## Manual Railway action

Generate `openssl rand -base64 32`. On the `capabilityeconomics` service →
Variables → add `ADMIN_API_KEY=<generated>`. Save → service redeploys.

## Verification

1. **Build typechecks locally:** `pnpm run typecheck`.
2. **Admin auth:** `curl -H "x-admin-key: <KEY>" https://capabilityeconomics-staging.up.railway.app/api/admin/marketplace/listings/pending` returns 200; without the header it returns 401.
3. **Marketplace filter:** `curl https://.../api/marketplace/listings | jq '.listings[].sellerName' | sort -u` contains no entries from the demo sellers. Direct ID lookup of a previously-known synthetic-seller listing returns 404.
4. **Auth-gated demo routes:** in an incognito window, hitting `/demo` or `/workbench/example` redirects to `/sign-in`. After signing in, both render.
5. **VCE button:** in incognito, the "Try with sample brief" button is absent on `/vce`; after sign-in it appears.
6. **Security page:** `/security` shows `security@capabilityeconomics.com` in both spots.
7. **Form placeholders:** `/organization`, `/account`, and any page rendering `manual-comp-form` show no `Acme` strings.
8. **Patterns slide:** the empty-state message is the humanized version, not the dev string.

## Out of scope (deliberate non-decisions)

- Custom production domain + `APP_BASE_URL` swap
- Wiring Neo4j into application code
- Real Stripe Connect onboarding for marketplace sellers (the filter makes browse empty until a real seller onboards — intended state)
- `DIDIT_WEBHOOK_SECRET` (only matters when KYC is live)
- `/insurance-example` legacy redirect (harmless)
- `/home` ticker-bar illustrative ROI tags
- `vite.config.ts` `REPL_ID` feature gates (no-op outside Replit)
- `seed-insights.ts` destructive refresh (manual-only; not in the auto-boot chain)
