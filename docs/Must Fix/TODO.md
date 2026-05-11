# Hardcoded Data Remediation — TODO

Canonical task list. Tick items as they complete. Safe to resume mid-stream — every step is independent and idempotent.

**Spec:** `docs/Must Fix/PLAN.md`

---

## Phase 1 — Backend (do first; frontend depends on these)

### Schema
- [ ] **B4-schema:** Add `economics_breakdown jsonb` column to `case_studies` table in `lib/db/src/schema/case-studies.ts`. Run `drizzle-kit push --force`.
- [ ] **B6-schema:** Create `alpha_config` single-row table in `lib/db/src/schema/alpha-config.ts` (fields: `quadrant_hot`, `quadrant_emerging`, `quadrant_cooling`, `quadrant_table_stakes`, `quadrant_declining`, `methodology_url`). Push schema.

### Seeds / data backfill
- [ ] **B4-seed:** Write `scripts/src/seed-case-study-economics.ts` populating the new column for Progressive with real numbers. Add to Dockerfile boot chain after `seed-organizations.ts`.
- [ ] **B6-seed:** Insert the single `alpha_config` row: `(hot=15, emerging=10, cooling=7, table_stakes=4, declining=1, methodology_url='/methodology#quadrant-multiples')`.

### Routes
- [ ] **B1:** `GET /api/metrics/home-ticker` — top 8 capabilities by 30d ROI movement
- [ ] **B2:** `GET /api/metrics/principle-stats` — `{ avgROIMultiple, medianMarginImprovement }`
- [ ] **B3:** `GET /api/metrics/home-tiles` — `{ valueUnlocked, topROI, quarterlyDelta }`
- [ ] **B4:** `GET /api/case-study/:slug/economics-breakdown`
- [ ] **B5:** `GET /api/cei/exemplars` — top + bottom leaf
- [ ] **B6:** `GET /api/alpha/config/quadrant-multiples`
- [ ] **B7:** `GET /api/vce/sample-brief` — anonymized real brief
- [ ] **B8:** `GET /api/workbench/example` — 8 real capability cards
- [ ] **B9:** `GET /api/whatif/presets` — 5 real recent macro events

### Spec + codegen
- [ ] Declare all 9 new endpoints in `lib/api-spec/openapi.yaml` (request + response schemas).
- [ ] Run `pnpm --filter @workspace/api-spec run codegen`. Verify `lib/api-client-react/src/generated/api.ts` and `lib/api-zod/src/generated/api.ts` regenerated. Revert any duplicate `export * from "./generated/api"` that Orval re-adds to `lib/api-zod/src/index.ts`.

---

## Phase 2 — Frontend rewrites

- [ ] **Item 1** (`home.tsx` ticker) — replace `TICKER_ITEMS` constant with `useQuery` of B1.
- [ ] **Item 2** (`home.tsx` principle stats) — replace "4.2×" / "18%" with B2 fields.
- [ ] **Item 3** (`home.tsx` hero tiles) — drive 4 tiles from `/api/cei/current`, `/api/capabilities` count, and B3 fields.
- [ ] **Item 4** (`home.tsx` analogy card) — `useSlot("homepage_case_card")` returns real `economics_breakdown` (B4 backs this).
- [ ] **Item 5** (`cei-dashboard.tsx` dialog) — replace every literal in lines 551-633 with values from already-fetched `freshness` object + B5 exemplars.
- [ ] **Item 6** (`alpha.tsx` EVaR) — change `?? 36` / `?? 0.2` / `?? 40` in lines 371-374 to render `—` with hover tooltip.
- [ ] **Item 7** (`alpha.tsx` arbitrage multiples) — fetch B6 and surface multiples + methodology link on the Arbitrage card.
- [ ] **Item 7 supporting** — add `#quadrant-multiples` anchor section to `methodology.tsx`.
- [ ] **Item 8** (`vce.tsx` sample brief) — replace `SAMPLE_BRIEF` constant with `useQuery` of B7 inside `loadSample`.
- [ ] **Item 9** (`workbench-example.tsx`) — replace `FIXTURE` array with `useQuery` of B8; keep visual layout identical.
- [ ] **Item 10** (`whatif.tsx` presets) — replace `SUGGESTED_EVENTS` with `useQuery` of B9.
- [ ] **Item 11** (`membership.tsx` savings) — replace static "~17%" with computed savings per tier.

---

## Phase 3 — Deferred (not blocking limited-prod)

- [ ] **Item 12** (`nl-query.tsx` suggestions) — leave as-is for now; revisit if team wants dynamic suggestions.

---

## Phase 4 — Verification (per item)

For each completed item, run the verification in `PLAN.md` § 4.

---

## Phase 5 — Final smoke test

- [ ] `pnpm run typecheck` passes
- [ ] `pnpm run build` passes
- [ ] Manual browser walkthrough on each touched route (signed-in normal user) — no `NaN`, no `undefined`, no stale fake strings.
- [ ] Repo grep: `grep -rn "WireDrop\|Atlas Copper\|Adam Patel\|Sarah Chen\|illustrative\|TICKER_ITEMS\|SUGGESTED_EVENTS\|SAMPLE_BRIEF\|FIXTURE" artifacts/capability-economics/src` → zero non-comment matches.
- [ ] Curl each new endpoint against prod and verify response shape.
