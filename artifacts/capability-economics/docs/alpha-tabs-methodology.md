# CE Alpha — Tab Methodology Reference

Audited 2026-05-10 against live data: 274 / 356 capabilities enriched, 30 dependency edges scored across 6 industries (Insurance, Healthcare, Banking & Financial Services, Manufacturing, Technology, Retail). Source of truth: `artifacts/api-server/src/routes/alpha.ts`.

**Per-route data-integrity posture (this varies by tab — there is no single universal rule):**
- Strict enriched-only (drop rows missing real economics + quadrant): **Moat**, **Fragility**.
- Requires consensus + CE quadrant both present: **Narrative Delta**.
- Requires consensus quadrant + revenue exposure + margin + CE quadrant: **Arbitrage**.
- Drops stages without real `capitalFlowMm`: **Flows**.
- Uses scored edges only when building cascade adjacency: **Cascade**.
- Loose — applies fallback constants when fields are missing: **EVaR** (see below).
- Pure aggregation over whatever is present: **Talent**, **Twin**, **Status**, **Thesis** (Thesis itself is admin-gated and synthesizes a memo from whichever inputs exist).

When component scores are weighted (Moat, Fragility), weights are **renormalized over only the components that exist**, so a missing input is rendered as `—`/dashed bar instead of being silently treated as 0.

---

## 1. EVaR — Economic Value at Risk
**Endpoint:** `GET /api/alpha/evar?industryId=`
**Source data:** `capability_economics` (revenueExposureMm, tamUsdMm, marginStructurePct, halfLifeMonths, commoditizationVelocity), `capability_quadrants.disruptionIntensity`, `consensusConfidence`.

**⚠️ Fallback defaults applied when fields are missing** (rows are not dropped):
| Field                    | Fallback        |
|--------------------------|-----------------|
| `halfLifeMonths`         | 36              |
| `commoditizationVelocity`| 0.2             |
| `revenueExposureMm`      | `tamUsdMm` else 0 |
| `marginStructurePct`     | 40 (i.e. 0.40)  |
| `disruptionIntensity`    | 0.3             |
| `consensusConfidence`    | 0.5             |

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
quadRank   = { cooling: 0, table_stakes: 1, emerging: 2, hot: 3 }     // 4-level ladder; "declining" is NOT in the rank map
deltaSteps = quadRank[ceQuadrant] − quadRank[consensusQuadrant]       // missing key → 0
direction  = "long" if delta > 0
             "short" if delta < 0
             "agree" if delta == 0  (filtered out)
sort       = |deltaSteps| desc
```
Source URLs come from `consensus_sources`.
**Interpret:** Long column = CE is more bullish than the street (potential undervalued long); Short column = CE is more bearish (potential short / sell-side risk). A capability whose CE or consensus quadrant is `declining` will receive `0` for that side of the rank lookup — treat large `declining`-vs-`hot` deltas with extra care.

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
QUADRANT_MULTIPLE = { hot: 15, emerging: 10, table_stakes: 4, declining: 1 }     // cooling NOT priced
annualMarginMm    = revenueExposureMm × (marginStructurePct / 100)
ceValueMm         = annualMarginMm × QUADRANT_MULTIPLE[ceQuadrant]
consensusValueMm  = annualMarginMm × QUADRANT_MULTIPLE[consensusQuadrant]
spreadMm          = ceValueMm − consensusValueMm
direction         = "long"  if conf ≥ 0.55 and spread > max(consensus×10%, $100M)
                    "short" if conf ≥ 0.55 and spread < −max(consensus×10%, $100M)
                    "neutral" otherwise
```
**Note:** `cooling` is not in the multiple table, so any pair where either side is `cooling` is dropped (returns `null` and is filtered).
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

## Audit Findings (2026-05-10)

**Functional, real data live:** EVaR, Cascade roots, Narrative Delta, Moat, Fragility, Arbitrage, Flows, Talent, Twin (Insurance vs Healthcare verified), Thesis (admin-gated).

**Coverage / behaviour gaps surfaced for follow-up:**
- **Cascade graph:** only 8 capabilities have scored upstream/downstream edges; 30 edges total. The roots panel populates from those 8 (top-40 cap means we still get a list), but selecting any of the other 348 capabilities shows root-only with no graph. Either run more iterations of the dependency-edge enrichment loop or seed more `capability_dependencies` rows.
- **EVaR placeholder policy:** `/evar` does NOT drop rows missing economics; instead it applies fallback constants (halfLife=36, velocity=0.2, margin=40%, revenue=tamUsdMm or 0, disruption=0.3, confidence=0.5). This is inconsistent with Moat/Fragility's strict-enriched policy. Decide policy: tighten `/evar` to drop unenriched rows, or document this as intentional "show-everything-with-defaults".
- **Quadrant rank coverage:** Narrative-delta `quadRank` only contains `{cooling, table_stakes, emerging, hot}`; capabilities classified `declining` get `0` (same as `cooling`), which understates "we're bearish" deltas. Arbitrage's `QUADRANT_MULTIPLE` is the inverse: includes `declining`, omits `cooling` — pairs touching `cooling` are silently dropped.
- **Talent coverage:** only 5 of 6 industries have `company_capability_mappings`. The 6th renders empty correctly.
- **Industries seeded:** Insurance, Healthcare, Banking, Manufacturing, Technology, Retail. **"Residential Solar" is not seeded** — adding it requires a separate industry-seed task.

**Cleanup applied:** removed unused `StubTab` component and `AlertTriangle` import from `artifacts/capability-economics/src/pages/alpha.tsx` (dead code).
