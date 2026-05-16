# Hardcoded Data Remediation — TODO

**Status: ✅ IMPLEMENTATION COMPLETE — awaiting Railway deploy + real-world verification.**

Canonical task list. All implementation work is committed and pushed to `main`. The remaining items are operator tasks (curl prod, run drizzle-kit on prod, optionally populate real case-study economics).

**Spec:** `docs/Must Fix/PLAN.md`

---

## Phase 1 — Backend ✅ COMPLETE

### Schema (commit `e38e0c1`)
- [x] **B4-schema:** Added `economics_breakdown jsonb` column to `case_studies` table.
- [x] **B6-schema:** Created `alpha_config` single-row table.
- [x] Auto-pushes to prod DB on next Railway deploy via `scripts/src/deploy-migrate.ts` boot chain.

### Seeds / data backfill (commit `524804a`)
- [ ] **B4-seed:** *Skipped* — populating `case_studies.economics_breakdown` requires real public-company financials. The column is added; the frontend handles null gracefully. When you have real numbers (e.g. from a Perplexity research run on Progressive), insert them via the admin tool or one-off SQL.
- [x] **B6-seed:** `scripts/src/seed-alpha-config.ts` inserts `(hot=15, emerging=10, cooling=7, table_stakes=4, declining=1)` on every boot.

### Routes (commits `2f22bc9`, `532da43`)
- [x] **B1:** `GET /api/metrics/home-ticker`
- [x] **B2:** `GET /api/metrics/principle-stats`
- [x] **B3:** `GET /api/metrics/home-tiles`
- [x] **B4:** `GET /api/case-study/:industrySlug/economics-breakdown`
- [x] **B5:** `GET /api/cei/exemplars`
- [x] **B6:** `GET /api/alpha/config/quadrant-multiples`
- [x] **B7:** `GET /api/vce/sample-brief`
- [x] **B8:** `GET /api/workbench/example`
- [x] **B9:** `GET /api/whatif/presets`

### Spec + codegen — DEFERRED
- [ ] OpenAPI specs + codegen — frontend uses plain `fetch()` instead. Not blocking; add later if typesafety is required.

---

## Phase 2 — Frontend rewrites ✅ COMPLETE (commits `109ec60`, `df84b23`)

- [x] **Item 1** `home.tsx` ticker → live data from B1.
- [x] **Item 2** `home.tsx` principle stats → B2.
- [x] **Item 3** `home.tsx` hero tiles → `/api/cei/current`, `/api/capabilities` count, B3.
- [x] **Item 4** `home.tsx` analogy card → B4 with graceful fallback when economics_breakdown is null.
- [x] **Item 5** `cei-dashboard.tsx` dialog → freshness + B5 interpolation.
- [x] **Item 6** `alpha.tsx` EVaR fallbacks → "—" instead of `?? 36` / `?? 0.2` / `?? 40`.
- [x] **Item 7** `alpha.tsx` quadrant multiples → B6 + methodology link in Arbitrage card.
- [x] **Item 7 supporting** `methodology.tsx` → new `#quadrant-multiples` anchor section.
- [x] **Item 8** `vce.tsx` sample brief → B7.
- [x] **Item 9** `workbench-example.tsx` FIXTURE → B8.
- [x] **Item 10** `whatif.tsx` SUGGESTED_EVENTS → B9.
- [x] **Item 11** `membership.tsx` savings → computed from tier prices.

---

## Phase 3 — Deferred

- [ ] **Item 12** (`nl-query.tsx` suggestions) — leave as-is for now; UI prompt chips, not data.

---

## Phase 5 — Verification ✅ PASSED LOCALLY, PENDING PROD

- [x] `pnpm run typecheck` — passes (all 5 packages).
- [x] `pnpm run build` — passes (inflexcvi frontend builds clean).
- [x] Repo grep `WireDrop|Atlas Copper|Adam Patel|Sarah Chen|illustrative|TICKER_ITEMS|SUGGESTED_EVENTS|SAMPLE_BRIEF|FIXTURE` against `artifacts/inflexcvi/src` — zero non-comment matches.
- [ ] **Pending:** manual browser walkthrough after next Railway deploy. Watch the 4 routes that changed most: `/`, `/cei`, `/alpha`, `/workbench/example`.
- [ ] **Pending:** curl each new endpoint against prod after deploy:
  - `curl https://inflexcvi-staging.up.railway.app/api/metrics/home-ticker`
  - `curl https://inflexcvi-staging.up.railway.app/api/metrics/principle-stats`
  - `curl https://inflexcvi-staging.up.railway.app/api/metrics/home-tiles`
  - `curl https://inflexcvi-staging.up.railway.app/api/cei/exemplars`
  - `curl https://inflexcvi-staging.up.railway.app/api/alpha/config/quadrant-multiples`
  - `curl https://inflexcvi-staging.up.railway.app/api/whatif/presets`
  - `curl https://inflexcvi-staging.up.railway.app/api/case-study/insurance/economics-breakdown` (will show null `economicsBreakdown` until populated)

---

## Follow-up (non-blocking, post-launch)

1. **Populate real case-study economics_breakdown** — research one real public company's transformation via Perplexity (e.g. Progressive's digital onboarding spend per their 10-K) and insert the structured breakdown. Once present, the homepage analogy card automatically shows real numbers; until then it falls back to a directional case-study card.
2. **Add OpenAPI specs for the 9 new endpoints** — improves typesafety; not required for limited-prod.
3. **Surface admin tool for editing `alpha_config`** — currently the multiples are seeded but require a SQL update to change.
