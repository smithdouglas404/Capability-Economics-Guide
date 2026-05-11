# Limited-Production Readiness Report — Capability Economics

**Date:** 2026-05-11

This document is the audit + plan that gated the limited-production rollout. It captures (a) the current Railway state, (b) the full audit of seed/hardcoded/demo data across backend and frontend, (c) decisions taken about each finding, and (d) the concrete action plan to close the gap.

---

## 0. Context

Moving Capability Economics off Replit onto Railway and rolling into **limited production**. Two things must be true before that's safe:

1. **Every service the app depends on is hosted on Railway** (or a deliberate third-party SaaS), with no hidden Replit-side coupling, and every env var the code reads is set on the correct Railway service.
2. **Every piece of hardcoded, seeded, or demo data is either intentional production content, gated behind a flag, hidden from end-user UI, or deleted** — because real customers and investors will be on the system.

---

## 1. Railway infrastructure — current state (verified, no action needed)

All six services are deployed on Railway in the **Capability Economics** project (project ID `b4a4c027-0c13-48ad-aa90-f0c8daee52cb`, environment `production`):

| Service | Railway service ID | Status | Source | Notes |
|---|---|---|---|---|
| `capabilityeconomics` | `f4585a12-c207-4faa-9171-5362997768ec` | SUCCESS | this repo, root `/`, builder Dockerfile | api-server + serves SPA |
| `Mem0` | `8b75626c-40ba-49b1-a416-d145b4591711` | SUCCESS | this repo, root `mem0`, builder Dockerfile | libpq5-patched, clones mem0ai/mem0 v2.0.2 |
| `letta-2EOT` | `b6b84d74-984e-4792-8218-3e97bcc2831c` | SUCCESS | `letta/letta:latest` Docker image | listens on internal port 8080 |
| `pgvector` | `ff32eab9-53dc-46de-b23a-b8d3e0be834c` | SUCCESS | `pgvector/pgvector:pg18` | Mem0's vector store |
| `Postgres` | `fb4bdcb0-cc4c-4746-9f50-f3950e53835d` | SUCCESS | `ghcr.io/railwayapp-templates/postgres-ssl:18` | app DB |
| `Neo4j Graph Database (Metal-Ready)` | `fca5eba2-01fb-420f-8188-bb184e16e199` | SUCCESS | `neo4j:5.26-community-bullseye` | deployed but not yet wired into app code |

**Replit coupling check:** the only references to Replit env vars in the codebase are three `vite.config.ts` files that gate on `process.env.REPL_ID !== undefined`. They no-op when REPL_ID is absent (i.e. on Railway). Safe to leave; no action needed.

**`REDIS_URL`** on `capabilityeconomics` points at `redis-16296.c275.us-east-1-4.ec2.cloud.redislabs.com:16296` — that's Redis Cloud (third-party), not Replit-managed. Intentional.

---

## 2. Environment variable audit

### 2.1 Already set on `capabilityeconomics` (verified)

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
REDIS_URL
MARKETPLACE_STORAGE_DIR
```

Plus all `RAILWAY_*` (auto-injected) and the `RAILWAY_VOLUME_*` set (a volume is mounted to `capabilityeconomics`).

### 2.2 Missing — must add before prod

| Env var | Where it's required | Action |
|---|---|---|
| **`ADMIN_API_KEY`** | `artifacts/api-server/src/middlewares/requireAdmin.ts:37` and `requireReviewer.ts:59` — every `/api/admin/*` route + the reviewer middleware | **Generate `openssl rand -base64 32` and set on `capabilityeconomics` service Variables tab.** Distinct from `MEM0_API_KEY` despite the name overlap. |
| **`DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID`** | New env var — read by `services/marketplace-seed.ts` and `scripts/src/seed-marketplace-listings.ts` after the cleanup commit | When set, seeds populate demo marketplace listings under that real test Connect account. When unset (live mode), seeds short-circuit and marketplace starts empty. See § 6.B for the one-time Stripe-Dashboard setup. |
| **`DIDIT_WEBHOOK_SECRET`** | `artifacts/api-server/src/services/didit.ts:26` — rejects KYC webhooks if absent | Optional now (only matters when Didit webhooks fire). Add when KYC flow goes live. |

### 2.3 Deferred decision

| Env var | Current behavior | Decision |
|---|---|---|
| **`APP_BASE_URL`** | Defaults to hardcoded `"https://capabilityeconomics-staging.up.railway.app"` in `services/email.ts:293`. Used to build links in transactional emails. | **Leave as-is.** Functionally identical to the current Railway URL. Revisit when a custom production domain is provisioned. |

---

## 3. Backend audit findings — seeds, hardcoded data, fallbacks

### 3.1 Seed files

**Auto-running at server boot (via Dockerfile `CMD` chain, run order matters):**

| Order | File | Seeds | Intent | Notes |
|---|---|---|---|---|
| 1 | `scripts/src/seed.ts` | Industries (6), C-suite roles (8), capabilities (~50/industry), metrics, role mappings, dependencies, thresholds | **Production** | Canonical capability catalog. Idempotent via `TRUNCATE + RESTART IDENTITY` followed by upsert. Source of truth. |
| 2 | `scripts/src/seed-marketplace-listings.ts` | 15 marketplace listings under a demo seller — **only when `DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID` is set** | Demo (env-var-gated) | Skip with `SKIP_MARKETPLACE_SEED=1`. |
| 3 | `scripts/src/seed-marketplace-reports.ts` → `services/marketplace-seed.ts` | 8 research reports under the same demo seller — **only when `DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID` is set** | Demo (env-var-gated) | Skip with `SKIP_MARKETPLACE_SEED=1`. |
| 4 | `scripts/src/seed-organizations.ts` | 12 reference orgs (Allstate, Progressive, JPMorgan, Microsoft, Anthropic, Walmart, Sunrun) | **Production** | Real public-company data with Perplexity-sourced maturity scores. Skip with `SKIP_ORG_SEED=1`. |
| 5 | `scripts/src/seed-patterns.ts` | 3 disruption-pattern narratives (Uber, Stripe, OpenAI) | **Production** | Educational reference content. Skip with `SKIP_PATTERNS_SEED=1`. |

**Plus on api-server start:**

| Function | When | Purpose |
|---|---|---|
| `ensurePublicPreviewSeed()` | `index.ts:97` on every boot | Ensures `/explore` has ≥10 capabilities flagged `public_preview=true`. Idempotent. **Safe.** |
| `backfillMissingSubCapabilities()` | `index.ts:91` | Cleanup logic — generates Haiku-decomposed sub-capabilities for any top-level capability missing them. **Safe.** |

**Manual-only (not in boot chain):**

| File | What it does | Risk |
|---|---|---|
| `scripts/src/seed-insights.ts` | Generates and inserts capability thresholds, insights, white papers, leaderboard entries, ontology relationships from Perplexity research. **TRUNCATEs and replaces.** | Run manually as a refresh. If you run this against prod by accident with stale Perplexity output, you'd wipe live insight data. Treat as a destructive operation. |

### 3.2 Hardcoded synthetic Stripe accounts (resolved)

Previously hardcoded:

| File | Line | Was | Now |
|---|---|---|---|
| `services/marketplace-seed.ts` | 30 | `"acct_ce_demo_seller"` (string literal) | `process.env.DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID` |
| `scripts/src/seed-marketplace-listings.ts` | 5 | `"acct_seed_platform_000000"` (string literal) | `process.env.DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID` |

If the env var is unset, both seeds short-circuit at the top and insert nothing — so live-mode marketplace starts empty until real sellers onboard through the normal `createConnectAccount()` flow already in `services/stripe.ts:164`.

### 3.3 Hardcoded test emails (resolved)

| File | Email | Status |
|---|---|---|
| `scripts/src/seed-marketplace-listings.ts:7` | `research@capability-economics.local` (invalid TLD) | Changed to `research@capability-economics.com` |
| `services/marketplace-seed.ts:309` | `research@capability-economics.com` | Already valid — no change |
| `routes/sec.ts`, `assess.ts` | `research@capabilityeconomics.ai` | User-Agent header on Perplexity calls, not user-facing — fine |

### 3.4 Fallback / placeholder patterns

Searched for `return MOCK_*`, `return DEFAULT_*`, `return SAMPLE_*`, `?? "placeholder"`, `?? 0` on required fields, `// TODO`, `// FIXME`, `// HACK`. **No problematic fallbacks found in the services layer.** Code either returns the empty result or throws — no silent canned-data shortcuts.

### 3.5 Demo / dev-mode toggles

Searched for `DEMO`, `DEV_MODE`, `MOCK`, `STAGING`, `SHOW_DEMO`, `NODE_ENV === "development"` patterns gating user-visible behavior. **None found.** All demo content is database-row-driven (via the marketplace seeds), not code-flag-driven.

### 3.6 Hardcoded Stripe prices / product IDs

None. Prices flow through function arguments; product IDs are created on-the-fly. The only hardcoded Stripe value is the API version `"2026-03-25.dahlia"` in `services/stripe.ts` — that's intentional and correct.

### 3.7 Test-only exports

Several services export `_resetXForTest()` helpers: `coverage.ts`, `semantic-search.ts`, `source-quality.ts`, `disruption.ts`, `new-capabilities.ts`. **No runtime exposure** — underscore-prefix convention, not called from any route. Safe.

---

## 4. Frontend audit findings — demo pages, mock data, placeholders

### 4.1 Public routes with illustrative content (resolved)

| Route | File | New auth | What's there |
|---|---|---|---|
| `/demo` | `pages/demo.tsx` | **Sign-in required** | 9-slide auto-playing product walkthrough. |
| `/workbench/example` | `pages/workbench-example.tsx` | **Sign-in required** | 8-card Kanban board with illustrative metrics. |
| `/vce` "Try with sample brief" button | `pages/vce.tsx` | **Hidden when not signed-in** | Hardcoded "Atlas Copper Holdings" brief. |
| `/insurance-example` | `pages/insurance-example.tsx` | none | Legacy redirect — harmless. |
| `/security` | `pages/security.tsx` | none (intentionally public — compliance page) | Email replaced from `security@example.com` → `security@capability-economics.com`. |

### 4.2 Placeholder text in forms (resolved)

`"Acme Inc."` / `"Acme Insurance Co."` placeholders replaced with generic neutral text (`"Your organization name"`, `"e.g. Northwind Insurance"`) in:

- `components/manual-comp-form.tsx`
- `pages/organization.tsx`
- `pages/account.tsx`

Server-side `"Acme Strategy"` seller name in `services/marketplace-seed.ts` renamed to `"CE Research"`.

### 4.3 Dev-facing string in `/demo` (resolved)

The `"Patterns not yet seeded. Run POST /api/admin/patterns/seed with admin auth."` message replaced with a humanized `"Disruption patterns are still populating. Refresh in a moment."`

### 4.4 Things that are intentional and fine

- **`/home` ticker bar** with illustrative ROI tags — generic use-case examples, not customer data. Kept as-is.
- **`/mockup-sandbox` and `/ce-pitch-deck` artifacts** — separate Vite builds, **not deployed** by the api-server's SPA static-file serving. No exposure to prod users.
- **No fake people, no Lorem Ipsum, no "Coming Soon" badges, no `?demo=true` URL params.**

---

## 5. Decisions captured

| Question | Answer | Implementation |
|---|---|---|
| Demo pages (`/demo`, `/workbench/example`) | **Auth-gate both** | New `RequireAuth` wrapper in `App.tsx` using Clerk's `useAuth()`. `/vce` sample-brief CTA conditional-rendered. |
| Marketplace seeds | **Env-var-gated real test Connect account** | Both seeds read `DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID`; if unset they no-op. |
| `APP_BASE_URL` on api-server | **Leave as-is** | Revisit when a custom production domain is provisioned. |
| `security@example.com` replacement | **`security@capability-economics.com`** | Matches the valid domain already used in marketplace-seed.ts. |

---

## 6. Action plan

### 6.A Railway dashboard (no code) — **must do before prod**

1. **Generate `ADMIN_API_KEY`** with `openssl rand -base64 32`.
2. On `capabilityeconomics` service → Variables → add `ADMIN_API_KEY=<generated>`. Without this, every `/api/admin/*` route returns 401.

### 6.B One-time Stripe setup (when demo marketplace is desired)

1. Stripe Dashboard (test mode) → Connected accounts → **Create test Express account** with email `research@capability-economics.com`, country US.
2. Complete the test-mode Express onboarding (Stripe accepts dummy SSN / bank routing numbers in test mode — onboarding completes in ~30 s and flips `charges_enabled: true`).
3. Copy the resulting `acct_xxx` ID.
4. Railway → `capabilityeconomics` service → Variables → add `DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID=acct_xxx`. Save → service redeploys → next deploy populates the demo listings.

If you skip this step, the marketplace simply starts empty in production until real sellers onboard.

### 6.C – 6.H Code changes (committed in `limited-prod cleanup`)

See § 3 and § 4 above for the resolved-state summary. Files changed:

```
artifacts/api-server/src/services/marketplace-seed.ts
scripts/src/seed-marketplace-listings.ts
artifacts/capability-economics/src/App.tsx                  (RequireAuth + auth-gated routes)
artifacts/capability-economics/src/pages/vce.tsx            (conditional sample-brief CTA)
artifacts/capability-economics/src/pages/security.tsx       (real email, ×2)
artifacts/capability-economics/src/pages/demo.tsx           (humanized patterns string)
artifacts/capability-economics/src/components/manual-comp-form.tsx
artifacts/capability-economics/src/pages/organization.tsx
artifacts/capability-economics/src/pages/account.tsx
CLAUDE.md                                                   (X-API-Key, not Bearer)
docs/limited-production-readiness.md                        (this document)
```

---

## 7. Verification — end-to-end smoke test before declaring limited-prod ready

1. **Railway services** all `SUCCESS` (`railway service status --all`).
2. **Health endpoint:** `curl https://capabilityeconomics-staging.up.railway.app/api/health/services` returns `overall: "ok"`, with `mem0: ok`, `letta: ok`, `perplexity: ok`, `openrouter: ok`, `stripe: ok`, `clerk: ok`, `demo_readiness: ok`. (`anthropic` and `foundry` remain `not_configured` — deliberate.)
3. **Auth-gated routes:** in an incognito browser, `/demo` and `/workbench/example` redirect to sign-in. After sign-in, both render.
4. **Marketplace gating:**
   - Without the env var: `GET /api/marketplace/listings` returns 0 items at boot; no `acct_xxx` seller strings in the database.
   - With the env var set to a real test Connect account: listings are present and Stripe Checkout completes with a Stripe test card (`4242 4242 4242 4242`).
5. **Security page:** `/security` shows `security@capability-economics.com`, not `@example.com`.
6. **Form placeholders:** `/account`, `/organization`, and a manual-comp-form context show no `Acme` strings.
7. **Admin auth:** `curl -H "X-Admin-Key: <ADMIN_API_KEY>" https://capabilityeconomics-staging.up.railway.app/api/admin/...` returns 200; without the header it returns 401.

Once all seven check out, the app is ready for limited-production rollout. Anything surfaced during rollout becomes the next round of cleanup, not a launch blocker.

---

## 8. Out of scope (deliberate non-decisions to revisit later)

- Custom production domain + `APP_BASE_URL` swap
- Wiring the `Neo4j Graph Database (Metal-Ready)` service into application code (deployed but unused)
- Full Stripe Connect onboarding flow exposed to real marketplace sellers (current state: real sellers go through the existing `createConnectAccount()` API)
- `DIDIT_WEBHOOK_SECRET` (only matters when KYC is live)
- `/insurance-example` legacy redirect (harmless, low priority)
- `/home` ticker-bar illustrative metrics
- The three `vite.config.ts` `REPL_ID` feature gates (no-op outside Replit)
