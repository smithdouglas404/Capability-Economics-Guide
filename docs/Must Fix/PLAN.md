# Hardcoded Data Remediation — Limited-Production Plan

**Date:** 2026-05-11
**Source:** Team screenshots in `docs/Must Fix/` + Claude verification + additional audit

> **Plan canonicalized in this repo so it survives session crashes.** Pair file: `docs/Must Fix/TODO.md` (the checklist).

---

## 0. Context

Going into limited production. Real customers + investors will see the UI. Anything that **looks like a live metric but is actually a static literal in code** damages credibility — especially for PE/VC/F500 viewers, who treat numbers literally.

**User philosophy (load-bearing):**
- **Never label data as "illustrative" or "example"** — that signals incompetence. Instead, **replace with real values sourced from DB / knowledge graph / blockchain**.
- The visual design stays the same.
- No seed data or hardcoded data shipped to the frontend pages that are part of the delivered product.

**Decisions:**
1. For items where no real-data source exists today → **build the backend to feed real data**, don't relabel and don't delete.
2. `/workbench/example` → **auto-generate from real capabilities** (top N from `/api/capabilities` + `/api/alpha/economics`), keep the same layout.

---

## 1. Complete inventory (13 items)

### Tier 1 — CRITICAL (homepage + main dashboards)

| # | File:line | What's hardcoded | Real-data path | Action |
|---|---|---|---|---|
| 1 | `pages/home.tsx:49-56` | `TICKER_ITEMS` array — 8 capability ROIs ("Digital Onboarding +4.7× ROI", etc.) | NEW: `/api/metrics/home-ticker` → top 8 by recent ROI movement from `capability_economics` | Replace array with `useQuery` of new endpoint. |
| 2 | `pages/home.tsx:217-225` | `stat: "4.2×"` avg ROI / `"18%"` median margin improvement | NEW: `/api/metrics/principle-stats` — aggregates over `capability_economics` | Replace literals. |
| 3 | `pages/home.tsx:347-352` | Hero tiles: `74.2`, `840+`, `$2.1B`, `4.7×`, `"↑ 3.1 pts this quarter"` | `/api/cei/current.overallIndex` (74.2), `/api/capabilities` count (840+), NEW `/api/metrics/home-tiles` for the rest | Replace static `value`/`sub` props. |
| 4 | `pages/home.tsx:458-497` | Analogy card: "WireDrop closed $1.2B Series B"; $4.2M IT budget; $1.8M Digital Onboarding; $8.5M value generated; $6.7M unlocked | Page already calls `useSlot("homepage_case_card")` → `/api/featured-content/{slotKey}`. NEW: `/api/case-study/{slug}/economics-breakdown` from extended `case_studies` schema. | Backfill 1+ real case study (Progressive). Wire analogy card to that case study. |
| 5 | `pages/cei-dashboard.tsx:551-633` | "How to read the CVI right now" dialog — 8 hardcoded numbers: `297 leaves`, `56-64`, `~600`, `~0`, `~0.01`, `(0.01 + volBoost)`, `Agentic AI ~26, AML/KYC ~42`, `~60/100` | Page **already fetches** `/api/cei/freshness` (line 75, 160) which provides most numbers. NEW: `/api/cei/exemplars` for the top/bottom-scoring leaf call-outs. | Replace every prose literal with interpolation from already-fetched `freshness` object + exemplars. |

### Tier 2 — HIGH (primary feature pages)

| # | File:line | What's hardcoded | Real-data path | Action |
|---|---|---|---|---|
| 6 | `pages/alpha.tsx:371-374` | EVaR silent fallbacks: 36 months, 20% velocity, 40% margin | `/api/alpha/evar` already returns null for missing fields | **Frontend only:** render `—` instead of `?? 36` / `?? 0.2` / `?? 40` with tooltip "data unavailable for this row." |
| 7 | `pages/alpha.tsx:987` | Arbitrage multiples (hot=15×, emerging=10×, cooling=7×, table_stakes=4×, declining=1×) hardcoded in hidden `TraceabilityDialog` | NEW: `/api/alpha/config/quadrant-multiples` from `alpha_config` table | Move multiples to backend config. Surface multiples + methodology link on the Arbitrage card itself. |
| 8 | `pages/vce.tsx:236-251` | `SAMPLE_BRIEF` constant: 750-word "Atlas Copper Holdings" mining case | NEW: `/api/vce/sample-brief` returning anonymized real brief from `vce_assessments` | Replace constant with `useQuery`. Backend picks recent real assessment, redacts identifying info. |
| 9 | `pages/workbench-example.tsx:80-265` | `FIXTURE` array: 8 capability cards with fabricated metrics (CVI scores, "47 users, $15/mo, 64% retention", dates) | NEW: `/api/workbench/example` returning top 8 capabilities + economics + insights | Page becomes API consumer. Same layout, real data. |
| 10 | `pages/whatif.tsx:65-71` | `SUGGESTED_EVENTS` array: 5 hardcoded geopolitical scenarios | NEW: `/api/whatif/presets` from `macro_events` table | Replace array with `useQuery`. |

### Tier 3 — MEDIUM

| # | File:line | What's hardcoded | Real-data path | Action |
|---|---|---|---|---|
| 11 | `pages/membership.tsx` (~ line 343) | "Save ~17%" annual badge static | Already-fetched `/api/membership/tiers` returns `monthlyPriceCents` + `annualPriceCents` | **Frontend math only:** compute per-tier `(monthly × 12 − annual) / (monthly × 12) × 100`. |
| 12 | `pages/nl-query.tsx:17-24` | `SUGGESTIONS` array (6 preset queries) | UI hint chips, not data | **Deferred** — leave as-is for limited prod. |

### Tier 4 — CLEAN

Inspected, fully dynamic from APIs already: `case-studies.tsx`, `case-study.tsx`, `proof.tsx`, `workbench.tsx` (the real one), `methodology.tsx`, all marketplace pages, `explore.tsx`, `capability-detail.tsx`, `compare.tsx`, `whatif.tsx` (page chrome), `search.tsx`, `disruption.tsx`, `companies.tsx`, `usage.tsx`, `simulation.tsx`, `scorecard.tsx`, `trade-signals.tsx`, `innovation-pipeline.tsx`, `watchlist.tsx`, `benchmarking.tsx`, `roi-tracker.tsx`, `nl-query.tsx` (chat surface), `regulations.tsx`, `collaboration.tsx`, `console.tsx`, `system-status.tsx`, `developers.tsx`, `coverage.tsx`, `onboarding.tsx`, `backtest.tsx`, `assess.tsx`, `account.tsx`, `organization.tsx`, `security.tsx`, `patterns.tsx`, `review-queue.tsx`, `c-suite.tsx`, `insights.tsx`, `knowledge-graph.tsx`, `projects.tsx`.

---

## 2. Backend work consolidated

| # | New endpoint | Returns | Source |
|---|---|---|---|
| B1 | `GET /api/metrics/home-ticker` | `[{ capabilityName, label, valueText, direction }]` (×8) | `capability_economics` + recent `cei_components` movements |
| B2 | `GET /api/metrics/principle-stats` | `{ avgROIMultiple, medianMarginImprovement }` | aggregate over `capability_economics` |
| B3 | `GET /api/metrics/home-tiles` | `{ valueUnlocked, topROI, quarterlyDelta }` | aggregate + CVI history 90d delta |
| B4 | `GET /api/case-study/:slug/economics-breakdown` | `{ companyName, eventTitle, costBreakdown[], valueGenerated, unlocked }` | extended `case_studies.economics_breakdown` jsonb column |
| B5 | `GET /api/cei/exemplars` | `{ topLeaf, bottomLeaf }` | 2 SELECTs against `capabilities` + `cei_components` |
| B6 | `GET /api/alpha/config/quadrant-multiples` | `{ hot, emerging, cooling, table_stakes, declining, methodologyUrl }` | new `alpha_config` table |
| B7 | `GET /api/vce/sample-brief` | `{ clientName, valueCase }` (anonymized) | `vce_assessments` table |
| B8 | `GET /api/workbench/example` | `[{ id, capabilityName, industry, lifecycle, cei, velocity, insights }]` (×8) | top 8 from capabilities + economics + agent memory |
| B9 | `GET /api/whatif/presets` | `[{ label, eventType, severity, direction, decayDays }]` (×5) | `macro_events` filtered to high severity |

**Schema changes:** add `economics_breakdown jsonb` to `case_studies`; new single-row `alpha_config` table.

---

## 3. Files modified

**Frontend (8):**
- `artifacts/capability-economics/src/pages/home.tsx` (items 1-4)
- `artifacts/capability-economics/src/pages/cei-dashboard.tsx` (item 5)
- `artifacts/capability-economics/src/pages/alpha.tsx` (items 6, 7)
- `artifacts/capability-economics/src/pages/methodology.tsx` (item 7 supporting)
- `artifacts/capability-economics/src/pages/vce.tsx` (item 8)
- `artifacts/capability-economics/src/pages/workbench-example.tsx` (item 9)
- `artifacts/capability-economics/src/pages/whatif.tsx` (item 10)
- `artifacts/capability-economics/src/pages/membership.tsx` (item 11)

**Backend (new + extended):**
- `artifacts/api-server/src/routes/metrics.ts` (new: B1, B2, B3)
- `artifacts/api-server/src/routes/case-studies.ts` (extend: B4)
- `artifacts/api-server/src/routes/cei.ts` (extend: B5)
- `artifacts/api-server/src/routes/alpha.ts` (extend: B6)
- `artifacts/api-server/src/routes/vce.ts` (extend: B7)
- `artifacts/api-server/src/routes/workbench.ts` (new or extend: B8)
- `artifacts/api-server/src/routes/whatif.ts` (extend: B9)
- `artifacts/api-server/src/services/metrics.ts` (new: aggregation helpers)
- `lib/db/src/schema/case-studies.ts` (extend)
- `lib/db/src/schema/alpha-config.ts` (new)
- `lib/api-spec/openapi.yaml` (declare new endpoints)
- `scripts/src/seed-case-study-economics.ts` (new)

---

## 4. Verification (per item)

| # | Verification |
|---|---|
| 1 | `curl /api/metrics/home-ticker` → 8 capabilities. Grep `pages/home.tsx` for "Digital Onboarding" → 0 matches. |
| 2 | `curl /api/metrics/principle-stats` returns numbers. Page shows those values, not "4.2×". |
| 3 | Home "Avg CVI" tile matches `/api/cei/current.overallIndex` to 0.1. Capability count tile matches `/api/capabilities | jq length` to ±5. |
| 4 | Visit `/` signed-out. Analogy card shows real company name. Grep for "WireDrop" → 0 matches. |
| 5 | CVI dialog numbers match `/api/cei/freshness`. "Agentic AI ~26" replaced with real top-scoring leaf from `/api/cei/exemplars`. |
| 6 | Row in `/api/alpha/evar` with null `halfLifeMonths` → EVaR table shows "—" for that row, not 36. |
| 7 | `/alpha` arbitrage card shows multiples + "Methodology" link → lands on `/methodology#quadrant-multiples`. |
| 8 | "Try with sample brief" on `/vce` populates from `/api/vce/sample-brief`, not "Atlas Copper Holdings". |
| 9 | `/workbench/example` capabilities match top 8 from `/api/capabilities`. Grep for "47 users, $15/mo" → 0 matches. |
| 10 | `/whatif` quick-select buttons match `/api/whatif/presets`. Grep for "Taiwan semiconductor" → 0 matches (unless that's actually in `macro_events`). |
| 11 | Membership annual tier shows computed savings %, not "17%". |

---

## 5. Implementation order

Every step is idempotent — if a session crashes, the next can pick up from the last incomplete TODO.md checkbox.

1. **Write `docs/Must Fix/PLAN.md` + `docs/Must Fix/TODO.md` first** — crash anchor.
2. Schema changes (B4, B6) + drizzle-kit push.
3. Seeds for the new schema.
4. 9 backend routes — group into ~3 commits by area.
5. Spec + codegen.
6. Frontend changes — one commit per file.
7. Final smoke test.

~15-18 commits total.

---

## 6. Out of scope

- `pages/nl-query.tsx` suggestions (item 12) — UI prompts, defer.
- "Illustrative" labels — explicitly rejected.
- Removing any pages — explicitly rejected.
- Real-time streaming home ticker — 15-min cache is enough.
