# CE Alpha — Tab Methodology Reference

Audited 2026-05-10 against live data: 274 / 356 capabilities enriched, 30 dependency edges scored across 6 industries (Insurance, Healthcare, Banking & Financial Services, Manufacturing, Technology, Retail). Source of truth: `artifacts/api-server/src/routes/alpha.ts`.

**Per-route data-integrity posture (this varies by tab — there is no single universal rule):**
- Strict enriched-only (drop rows missing real economics + quadrant): **Moat**, **Fragility**.
- Requires consensus + CE quadrant both present: **Narrative Delta**.
- Requires consensus quadrant + revenue exposure + margin + CE quadrant: **Arbitrage**.
- Drops stages without real `capitalFlowMm`: **Flows**.
- Uses scored edges only when building cascade adjacency: **Cascade**.
- Strict enriched-only (drop rows missing real economics): **EVaR** (see below).
- Pure aggregation over whatever is present: **Talent**, **Twin**, **Status**, **Thesis** (Thesis itself is admin-gated and synthesizes a memo from whichever inputs exist).

When component scores are weighted (Moat, Fragility), weights are **renormalized over only the components that exist**, so a missing input is rendered as `—`/dashed bar instead of being silently treated as 0.

---

## 1. EVaR — Economic Value at Risk
**Endpoint:** `GET /api/alpha/evar?industryId=`
**Source data:** `capability_economics` (revenueExposureMm, marginStructurePct, halfLifeMonths, commoditizationVelocity), `capability_quadrants.disruptionIntensity`, `consensusConfidence`.

**Strict enriched-only policy (rows dropped when any required field is missing):** rows must have non-null `halfLifeMonths`, `commoditizationVelocity`, `marginStructurePct`, AND `revenueExposureMm`. The `.filter()` runs before `.map()`, mirroring Moat/Fragility. The response includes a `coverage: { scored, totalCapabilities }` block so the frontend can show "N of M capabilities scored".

**Allowed defaults (band-width inputs only — never gate the projection):**
| Field                    | Default | Used for                                 |
|--------------------------|---------|------------------------------------------|
| `disruptionIntensity`    | 0.3     | market-erosion factor (additive)         |
| `consensusConfidence`    | 0.5     | confidence band width only (`bandPct`)   |

**Formula:**
```
halfLifeDecay(t)  = 1 − 0.5^(t / max(6, halfLifeMonths))
marketErosion(t)  = 1 − (1 − min(0.95, velocity × (0.6 + disruption × 0.8)))^(t/12)
fracLost(t)       = max(halfLifeDecay(t), marketErosion(t))           # conservative
EVaR_$(t)         = revenueExposureMm × (marginStructurePct/100) × fracLost(t)
bandPct           = 0.15 + (1 − consensusConfidence) × 0.35
```
Three horizons returned: 12, 24, 36 months. Sorted by `evar36` descending.
**Interpret:** EVaR(N) = expected dollars of capability cashflow at risk in next N months, taking the *worse* of half-life decay vs market-erosion pressure. Band widens when consensus confidence is low.

## 2. Cascade — Dependency Blast Radius
**Endpoint:** `GET /api/alpha/cascade` (roots) and `GET /api/alpha/cascade?capabilityId=&depth=` (graph, depth capped at 4)
**Source data:** `capability_dependencies` filtered to those with a row in `dependency_edge_scores` ("scored edges only — never unverified raw dependencies").

**Roots listing (top 40, no enrichment filter on the cap itself):**
```
totalDownstreamImpactMm = Σ over scored outgoing edges of (dollarImpactMm)        # sum, NOT probability-weighted
dependentCount          = count of scored outgoing edges
sort                    = totalDownstreamImpactMm desc, return top 40
```

**Graph (BFS from a chosen root):**
```
edges                   = scored edges traversed via reverseAdj (dependsOn → dependent), capped at depth
totalExpectedImpactMm   = Σ over rendered edges of (dollarImpactMm × (disruptionProbability ?? 0.5))   # p-weighted
```
Frontend horizon slider (6–48 months) hides edges where `timeToImpactMonths > horizon`. Edge stroke width ∝ `dollarImpactMm / maxImpactInGraph`; edge color: red if `p>0.6`, amber if `p>0.35`, neutral otherwise.

**Coverage today:** only 8 capabilities have any scored upstream/downstream edges; 30 edges total. The roots-listing endpoint always returns up to 40 entries, so even with sparse data the left pane will populate from those 8. The graph pane is empty (`root` only) for the other 348 caps. **Action:** run more iterations of the dependency-edge enrichment loop or seed more `capability_dependencies` rows.

**Interpret:** Roots list ranks capabilities by raw downstream dollar impact (not probability-discounted). The graph pane probability-discounts each edge, so the headline "Expected downstream impact" can be much lower than the root's listed total — that's the conservative discount, not a bug.

## 3. Narrative Delta — Where We Disagree With Consensus
**Endpoint:** `GET /api/alpha/narrative-delta`
**Source data:** rows where both `capability_economics.consensusQuadrant` AND `capability_quadrants.quadrant` exist.
**Formula:**
```
quadRank   = { declining: -1, cooling: 0, table_stakes: 1, emerging: 2, hot: 3 }   // 5-level ladder (declining included)
deltaSteps = quadRank[ceQuadrant] − quadRank[consensusQuadrant]                    // every emitted quadrant has a key
direction  = "long" if delta > 0
             "short" if delta < 0
             "agree" if delta == 0  (filtered out)
sort       = |deltaSteps| desc
```
Source URLs come from `consensus_sources`.
**Interpret:** Long column = CE is more bullish than the street (potential undervalued long); Short column = CE is more bearish (potential short / sell-side risk). With `declining = -1` in the ladder, a CE-bearish call against a `hot` consensus now produces a delta of −4 (the largest possible spread) instead of being silently clamped to −3.

## 4. Moat — Replication Difficulty Score
**Endpoint:** `GET /api/alpha/moat?industryId=`
**Source filter:** strict — `econByCapId.has(c.id) && quadByCapId.has(c.id)`. Rows missing economics OR quadrant are dropped.
**Source data:** `halfLifeMonths`, `economicImpactScore`, `disruptionIntensity`, dependency counts, `value_chain_stages.hhiScore`.
**Formula (weights renormalized over present components):**
| Component              | Weight | Source                                                     |
|------------------------|--------|------------------------------------------------------------|
| Half-life contribution | 0.30   | `min(100, halfLifeMonths/60 × 100)`                        |
| Dependency depth       | 0.25   | `min(100, (upstream + downstream×0.5) × 12)`               |
| Economic impact        | 0.20   | `min(100, economicImpactScore)`                            |
| Stickiness             | 0.15   | `max(0, 100 − disruptionIntensity×100)`                    |
| Supplier concentration | 0.10   | `min(100, hhi × 100)`                                      |

`moatScore = round(Σ component × (weight / Σ presentWeights))`
Tier: ≥70 fortress, ≥50 defensible, ≥30 contestable, else exposed.
**Interpret:** Higher = harder for a competitor to replicate. Composition bar shows which components drove the score; missing inputs are excluded from the renormalization.

## 5. Fragility — Vulnerability Score
**Endpoint:** `GET /api/alpha/fragility`
**Source filter:** strict — `econByCapId.has(c.id) && quadByCapId.has(c.id)`.
**Formula (weights renormalized over present components):**
| Component             | Weight | Source                                                                  |
|-----------------------|--------|-------------------------------------------------------------------------|
| Decay speed           | 0.25   | `min(100, 24 / max(6, halfLifeMonths) × 100)`                           |
| Upstream depth        | 0.20   | `min(100, upstreamEdges × 18)` — null when no upstream edges            |
| Supplier concentration| 0.15   | `min(100, hhi × 100)` — null when no stage HHI                          |
| Edge shock            | 0.25   | `min(100, topUpstreamExpectedImpact / revenueExposureMm × 100)`         |
| Disruption pressure   | 0.15   | `min(100, disruptionIntensity × 100)`                                   |

`topUpstreamExpectedImpact = max over scored upstream edges of (dollarImpactMm × disruptionProbability)`
Severity: ≥70 critical, ≥50 elevated, ≥30 moderate, else stable.
**Interpret:** Higher = more brittle to upstream shocks. Vector chart shows component contributions; dashed bars indicate inputs that haven't been enriched yet (never silently zero).

## 6. Arbitrage — CE vs Street Cashflow Spread
**Endpoint:** `GET /api/alpha/arbitrage`
**Source filter:** rows with `consensusQuadrant && revenueExposureMm != null && marginStructurePct != null` AND a CE quadrant in `capability_quadrants`. Pairs whose either-side multiple isn't in the table are dropped.
**Formula:**
```
QUADRANT_MULTIPLE = { hot: 15, emerging: 10, cooling: 7, table_stakes: 4, declining: 1 }     // 5-level coverage
annualMarginMm    = revenueExposureMm × (marginStructurePct / 100)
ceValueMm         = annualMarginMm × QUADRANT_MULTIPLE[ceQuadrant]
consensusValueMm  = annualMarginMm × QUADRANT_MULTIPLE[consensusQuadrant]
spreadMm          = ceValueMm − consensusValueMm
direction         = "long"  if conf ≥ 0.55 and spread > max(consensus×10%, $100M)
                    "short" if conf ≥ 0.55 and spread < −max(consensus×10%, $100M)
                    "neutral" otherwise
```
**Note:** `cooling = 7` sits between `table_stakes:4` and `emerging:10`. Rationale: a cooling capability still earns a defensible-cashflow premium over commodity table-stakes (the moat hasn't fully eroded), but trades at a clear discount to emerging because growth is decelerating. Pairs touching `cooling` now produce a real spread instead of being silently filtered.
Confidence gate prevents low-conviction noise from becoming actionable signals.
**Interpret:** Positive spread (green) = CE thinks the capability is worth more than street is paying — long candidate. Negative (red) = street is over-paying — short candidate. Neutral = either too small or too low confidence.

## 7. Capital/Talent (Flows) — Where Money Is Moving
**Endpoint:** `GET /api/alpha/flows`
**Source filter:** stages where `capitalFlowMm != null` (no invented zeros).
**Formula:** simple aggregation by stage and by industry; trend is per-stage average. `acceleratingMm` = sum of stages with avg trend > 10%/yr; `deceleratingMm` = sum where trend < −5%/yr.
**Interpret:** Stage and industry bars show absolute capital deployed; trend coloring (green/red) shows whether that capital is growing or contracting. Top links table is the cross-product of stage→industry capital concentrations.

## 8. Talent — Bottleneck Map
**Endpoint:** `GET /api/alpha/talent`
**Source data:** `company_capability_mappings` (157 rows), `company_capability_profiles` (FEVI scores, sector, funding stage), joined to `capabilities` and `capability_quadrants`. No enrichment filter — any capability with at least one mapping is included.
**Formula:**
```
masteryRatio    = (core + strong) mappings / total mappings
bottleneckScore = round(min(100, companies × 4) × (1 − masteryRatio))
status          = "bottleneck" if score ≥ 50
                  "saturated"  if mastery ≥ 0.7
                  "competitive" if companies ≥ 5
                  else "emerging"
```
Right pane shows funding-stage mix, NAICS sector mix, and top 5 companies ranked by FEVI.
**Interpret:** High score = many companies are pursuing this capability but few have mastered it = talent/capability bottleneck. Saturated = lots of strong players. Emerging = thin field.
**Coverage note:** Today only 5 of 6 industries have any company mappings; the empty industry will produce no rows.

## 9. M&A Targets (Twin) — Industry-vs-Industry Synergy/Clash Map
**Endpoint:** `GET /api/alpha/twin?industryAId=&industryBId=`
**Source data:** `capabilities` for both industries; `capability_economics` + `capability_quadrants` for profiles where present.
**Formula:** Token-Jaccard fuzzy match across capability names (overlap coefficient ≥ 0.5 of the smaller token set, stop-words removed). For each matched pair:
```
synergyMm = min(revenueA, revenueB) × 0.10        # only if BOTH sides have real exposure
clash     = quadrantA ≠ quadrantB                 # only if both sides quadrant-enriched
jaccard   = sharedPairs / (|A| + |B| − sharedPairs)
```
Synergy is `null` (rendered "—") when either side lacks revenue exposure — never fake $0.
**Verified:** Insurance vs Healthcare → 12 shared, 5 clashes, $33.7B total synergy.
**Interpret:** Acquirer (A) buying Target (B). Shared capabilities = integration leverage; clashes = post-merge cultural / strategic risk where the two firms hold opposing views on the same capability.

## 10. Thesis — Investment Memo Generator
**Endpoint:** `POST /api/alpha/thesis` `{ capabilityId }` (admin-gated, costs `INVESTMENT_THESIS` credits)
**Source data:** assembles EVaR + cascade roll-up + narrative delta + top company mappings for the capability, then synthesizes a markdown memo via the LLM thesis service (`services/alpha/thesis.ts → generateThesisMemo`).
**Output:** structured markdown sections (thesis, key drivers, risks, comparables, sizing) with inputs metadata (upstream/downstream dep counts, top companies). Returns `401` for non-admins.
**Interpret:** Use as a starter draft for an investment memo on a single capability. Inputs panel shows which signals the memo was conditioned on so you can sanity-check the synthesis.

---

## Audit + Repair Log (2026-05-10)

**Functional, real data live:** EVaR, Cascade roots + graph, Narrative Delta, Moat, Fragility, Arbitrage, Flows, Talent, Twin (Insurance vs Healthcare verified), Thesis (admin-gated).

**Industries seeded (7):** Insurance, Healthcare, Banking & Financial Services, Manufacturing, Technology, Retail, **Residential Solar** (added this session — industryId=7, 15 capabilities seeded with real Perplexity citations stored in `consensus_sources` and `perplexity_sources`; quadrant distribution: 4 hot, 5 table_stakes, 5 emerging, 1 cooling).

**Repairs shipped this session:**
- **EVaR policy tightened**: dropped fallback constants for `halfLifeMonths`, `commoditizationVelocity`, `marginStructurePct`, `revenueExposureMm`. Rows missing those fields are now filtered out before the EVaR formula runs (matching Moat/Fragility's strict-enriched posture). `consensusConfidence` defaults to 0.5 only as a band-width input. Response now includes a `coverage: { scored, totalCapabilities }` block. Verified live: `coverage = { scored: 259, totalCapabilities: 446 }`.
- **Quadrant maps reconciled**: `quadRank` in `/narrative-delta` extended to 5 levels `{declining: -1, cooling: 0, table_stakes: 1, emerging: 2, hot: 3}`. `QUADRANT_MULTIPLE` in `/arbitrage` extended with `cooling: 7` (between `table_stakes:4` and `emerging:10`). Arbitrage now surfaces 34 cooling-touching pairs that were previously dropped.
- **Cascade enrichment burst**: scored dependency edges raised from 30 → 114; capabilities with at least one scored outgoing edge raised from ~8 → 60+. Cascade roots panel now shows 40/40 nonzero; sample top root `Inventory Management` resolves to a 4-node, 4-edge graph with $12.5B p-weighted downstream impact. Edge insertion is constrained to fuzzy-matched existing capabilities in the same industry — no inventing new caps.
- **Frontend cleanup**: removed unused `StubTab` component and `AlertTriangle` import from `artifacts/inflexcvi/src/pages/alpha.tsx`.

**No-fallback policy in repair scripts** (firm rule: no hardcoded editorial values):
- `scripts-seed-residential-solar.mts` no longer substitutes synthetic quadrants (`emerging`) or synthetic 0-100 scores (`50`) when Perplexity omits them. Missing fields → row is skipped and logged to `errors[]`; rerun the script to retry. Quadrant labels are still validated against the allowed set.
- `scripts-edge-enrichment-burst.mts` no longer applies a synthetic `dollar_impact_mm = 50` fallback. `bucketToDollarMm()` now returns `null` for unrecognized buckets and the per-edge loop drops the edge instead of inserting a fabricated dollar value. The bucket→$M anchoring (small=25, medium=100, large=500) is documented as a unit conversion of Perplexity's own bucket choice, not an editorial value.
- Frontend traceability text in `pages/alpha.tsx` (in-page methodology panels at lines ~229 and ~965) updated to include `cooling=7×`, matching the backend `QUADRANT_MULTIPLE`.

**Known remaining gaps (deferred to sibling tasks #18-#40):**
- Cascade still has ~225 capabilities with no scored outgoing edges (114/340 covered). Further enrichment bursts (`MAX_CALLS=N tsx scripts-edge-enrichment-burst.mts`) can raise coverage incrementally without code changes.
- Talent: 6/7 industries now have `company_capability_mappings` (Residential Solar added this session — 14 real companies via `scripts-seed-residential-solar-companies.mts`, 80 mappings, all Perplexity-cited). One legacy industry remains uncovered.
- 32 of the 446 capabilities counted in `/api/alpha/status.totalCapabilities` are unenriched scaffolding rows from earlier seed passes; they correctly drop out of all strict-enriched tabs (EVaR/Moat/Fragility) and render as missing rather than zero.
