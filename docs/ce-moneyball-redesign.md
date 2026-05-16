# CE Moneyball — Where It Is, What It Is Today, What It Should Be

**Purpose:** Stop being a reskin of SunasiAI's metric list. Design a Moneyball
score set that can only exist on the CE platform — because every score
depends on something only CE has (sub-capability decomposition, velocity
history, evidence-freshness timestamps, cross-industry spillover,
counterfactual event-toggling, fingerprint-crowdedness across the company
universe).

---

## 1. Where Moneyball shows up in the platform today

| Surface | Path | Contents |
|---|---|---|
| Service | `artifacts/api-server/src/services/companies.ts` L201-345 (`computeCompanyScores`) | The 13 formulas |
| DB table | `company_scores` | 13 columns + `details` JSON + `last_computed_at` |
| REST | `GET /api/workbench/companies?industryId=N` | Ranked list with all 13 |
| REST | `GET /api/workbench/companies/:id` | Full detail incl. fingerprint |
| REST | `POST /api/workbench/companies/:id/recompute-scores` | Re-run for one firm |
| REST | `POST /api/workbench/companies/_recompute` | Re-run whole industry |
| UI | `/companies` → Shortlist tab | Ranked table showing all 13 |

Trigger path today: Perplexity ingestion → fingerprint alignment → `computeCompanyScores` → `company_scores` upsert.

---

## 2. What our formulas are today — line-by-line, with the "me-too vs CE-native" call

| # | Score | Current formula | Uses SunasiAI's name? | Uses a signal only CE has? |
|---|---|---|---|---|
| 1 | `capabilityCoverage` | `(#high-CVI caps covered / #high-CVI caps in industry) × 200`, clamped 100 | no (ours) | partial (uses CVI which is ours) |
| 2 | `ceiWeighted` | `Σ(weight × CVI) / Σ weight` | no | partial |
| 3 | **`agedIndex`** | `100 − (age − 3)/37 × 100` | **yes — SunasiAI name** | **no — pure foundedYear arithmetic** |
| 4 | **`awarenessScore`** | `citations × 6 + (public?25:0) + log10(revenue) × 5` | **yes** | **no — SEC / press signals, not CE** |
| 5 | **`moatScore`** | `weighted avg CVI of fingerprint caps where conf > 0.65 AND vel > 0` | **yes** | partial (uses CVI+conf+vel) |
| 6 | **`aiDisruptability`** | `Σ (severity × decay × weight) over tech_shift events hitting the fingerprint` | **yes** | **yes** (uses our `macro_events`) |
| 7 | **`actionability`** | `revenue?30 + funding?25 + url?15 + emp?15 + conf×15` | **yes** | **no — presence-flags on static fields** |
| 8 | **`acquisitionProbability`** | `50 − size_penalty + funding_boost + (private?25:0)` | **yes** | **no — just size + funding + listed flag** |
| 9 | `qualityOfAsset` | `ceiWeighted × 0.5 + conf × 30 + moat × 0.2` | yes | partial |
| 10 | `forecastedValue` | `ceiWeighted + velocity × 12` | yes | partial |
| 11 | `riskProfile` | `(1 − conf) × 60 + aiDisrupt × 0.4` | yes | partial |
| 12 | `sensitivityProfile` | `max fingerprint weight × 100` | yes | **no — just the top weight** |
| 13 | `composite` | `0.30 FV + 0.20 QoA + 0.15 moat + 0.15 action + 0.10 acq + 0.10 (100 − risk)` | yes | partial |

**Scorecard:** 10 / 13 names are SunasiAI's. Of the 13 formulas, **only one (aiDisruptability)** genuinely requires the CE live macro-event log. The other twelve could be reproduced by anyone with LinkedIn + Crunchbase + a static capability list. That is the me-too problem.

What we are **leaving on the table** — signals that only CE can compute:

| Signal | Where it lives in CE | Currently used in Moneyball? |
|---|---|---|
| Sub-cap decomposition (59 parents × 297 children) | `capabilities.parent_capability_id`, `is_leaf` | ❌ ignored — we fingerprint at any level with no penalty for coarseness |
| Child score divergence (stddev within a parent) | computable from `cei_components` | ❌ ignored |
| Velocity *regime* (30d vs 90d vs 180d) | history in `source_triangulations.queried_at` | ❌ we use a single 30d velocity |
| Evidence freshness | `source_triangulations.queried_at` | ❌ ignored — stale consensus ≡ fresh evidence |
| Confidence *trajectory* (Δ conf over 30d) | `cei_components_history` (if kept) | ❌ ignored |
| Fingerprint crowdedness (how many peers share your fingerprint) | `company_capability_fingerprint` across all firms | ❌ exists only in `findSimilarCompanies`, never folded into a score |
| Cross-industry spillover (same cap hot in another industry) | `cei_components` × `industry_id` | ❌ ignored |
| Counterfactual event toggle (score with vs without active events) | re-run `computeCompanyScores` twice | ❌ ignored |
| Macro-event blast radius through the tree | `macro_events` + parent/child edges | ❌ we only use direct-hit tags |
| Capability granularity (leaf vs parent fingerprint depth) | `is_leaf` | ❌ ignored |

Every one of these is a free differentiation that the platform already stores but the Moneyball scores never read.

---

## 3. What the Moneyball *should* be — CE-native score set

Rule: **every score must require a signal that only the CE platform produces.** If LinkedIn + Crunchbase + a static capability tree can reproduce it, it is a SunasiAI-me-too and it does not ship.

The new set — 10 scores, every one tied to a platform-only signal:

### 3.1 `TreeDivergenceScore` (0–100)
**What it measures:** when a firm fingerprints a parent capability whose children are *disagreeing*, the firm's thesis is split. High stddev of children scores = the parent is an average of things moving in opposite directions = the firm's exposure is ambiguous.

**Formula:**
```
For each fingerprint row r:
  if r.cap.is_leaf:  divergence_r = 0            # leaf = precise, no divergence
  else:              divergence_r = stddev(children(r.cap).score)
TreeDivergence = 100 − Σ(r.weight × divergence_r) / Σ r.weight × 2
```
Low = firm fingerprinted precisely (at leaves or at coherent parents). High penalty = firm fingerprinted on parents that are internally split.

**Platform-only signal used:** `is_leaf` + child stddev. No external dataset has this.

---

### 3.2 `GranularityScore` (0–100)
**What it measures:** how deep in the tree the firm's fingerprint lives. Fingerprinting at a leaf ("Agentic AI") is more defensible than fingerprinting at the root ("AI/ML Ops"). Reward specificity.

**Formula:**
```
For each fingerprint row r:
  depth_r = distance from cap to root (0 = root, N = deepest leaf)
Granularity = Σ(r.weight × depth_r) / Σ(r.weight × MAX_DEPTH) × 100
```

**Platform-only signal:** tree depth on our hierarchy.

---

### 3.3 `VelocityRegimeScore` (0–100, signed around 50)
**What it measures:** not just the current 30d velocity (what `forecastedValue` uses today) but whether the firm's caps are in an *accelerating*, *decelerating*, or *stable* regime. An acceleration from +0.001 → +0.016 is a different thesis than a flat +0.016.

**Formula:**
```
For each fingerprint cap:
  v30  = velocity over last 30 days
  v90  = velocity over last 90 days
  regime_r = v30 − v90                           # Δ-velocity = acceleration
VelocityRegime = 50 + clamp(Σ(weight × regime_r) / Σ weight × 500, -50, +50)
```

**Platform-only signal:** velocity history (we have `queried_at` on every triangulation).

---

### 3.4 `EvidenceFreshnessScore` (0–100)
**What it measures:** how recent the evidence underlying the firm's fingerprint caps is. A CVI of 70 built on six-month-old triangulations is worth less than a CVI of 65 built on last-week's. Rewards firms whose thesis is grounded in fresh research.

**Formula:**
```
For each fingerprint cap r:
  age_r = days since newest triangulation on r.cap
  fresh_r = max(0, 100 − age_r × 1.5)            # 0 at 67 days
EvidenceFreshness = Σ(weight × fresh_r) / Σ weight
```

**Platform-only signal:** `source_triangulations.queried_at`. External datasets don't expose this.

---

### 3.5 `ConfidenceTrajectoryScore` (0–100)
**What it measures:** is the fingerprint getting *more* or *less* certain over time? A cap whose confidence went 0.40 → 0.65 is a thesis solidifying; 0.65 → 0.45 is a thesis fragmenting.

**Formula:**
```
For each fingerprint cap:
  Δconf = conf_today − conf_30d_ago
ConfidenceTrajectory = 50 + clamp(Σ(weight × Δconf × 100) / Σ weight, -50, +50)
```

**Platform-only signal:** confidence history.

---

### 3.6 `ShockBlastRadiusScore` (0–100, inverse — lower = more protected)
**What it measures:** for each active macro event, how much of the firm's fingerprint is hit — directly, via parent, or via child. Propagation through the tree, not just direct tags. This is the *full* shock attribution, not what `aiDisruptability` does today (direct-tag only, tech_shift only).

**Formula:**
```
For each active event e:
  hits_e = Σ (weight × hit_factor) across fingerprint
     where hit_factor = 1.0 if direct tag
                       = 0.6 if via parent (cap is parent of a tagged child)
                       = 0.8 if via child  (cap is child of a tagged parent)
  shock_e = severity × decay_factor × sentiment_sign × hits_e
ShockBlastRadius = 50 + clamp(Σ shock_e × 5, -50, +50)
```

Replaces `aiDisruptability`, generalises it across all event types, and uses tree propagation that `aiDisruptability` ignores.

**Platform-only signal:** macro_events × parent/child edges × fingerprint.

---

### 3.7 `CrowdednessInverseMoatScore` (0–100)
**What it measures:** genuine moat inverse. If 25 other companies in your industry share your fingerprint vector (cosine > 0.6), you do not have a moat — you have a commodity position. Replaces `moatScore`.

**Formula:**
```
peers = findSimilarCompanies(this, sameIndustry=true, cosine > 0.6)
CrowdednessInverseMoat = 100 − clamp(|peers| × 4, 0, 100)
```

**Platform-only signal:** the entire peer universe's fingerprints (we have 95 companies across 6 industries and growing). A new competitor can't reproduce this without our universe.

---

### 3.8 `CrossIndustrySpilloverScore` (0–100)
**What it measures:** if the firm's fingerprint caps *also* run hot in an adjacent industry, that's optionality / TAM-expansion upside. Smart Factory / IoT is hot in Manufacturing; the same cap also scores in Tech. A firm fingerprinted on such a cap carries spillover.

**Formula:**
```
For each fingerprint cap r:
  otherCei_r = max CVI of the same cap-name across other industries
  home_cei_r = CVI in firm's home industry
  spill_r   = max(0, otherCei_r − home_cei_r)       # extra upside beyond home
Spillover = Σ(weight × spill_r) / Σ weight × 2
```

**Platform-only signal:** cross-industry cap matching. External sources track industry-siloed.

---

### 3.9 `CounterfactualResilienceScore` (0–100)
**What it measures:** run `computeCompanyScores` twice — once with active macro events, once with the events set to zero severity. The firm's **composite delta** between those runs measures how much of its current ranking is *transient* vs *enduring*. Low delta = resilient; high delta = currently-buoyant but fragile.

**Formula:**
```
composite_live   = compute with events on
composite_naive  = compute with events off
CounterfactualResilience = 100 − min(100, |composite_live − composite_naive| × 3)
```

**Platform-only signal:** the event model is live in CE; toggling it is a one-line change. No one else can produce this.

---

### 3.10 `ThesisDurabilityScore` (0–100)
**What it measures:** joint function of decomposition quality, evidence freshness, and confidence trajectory. The "is this score going to still be right in 90 days?" meta-score.

**Formula:**
```
ThesisDurability = 0.35 × EvidenceFreshness
                 + 0.25 × ConfidenceTrajectory
                 + 0.25 × (100 − TreeDivergence penalty)
                 + 0.15 × Granularity
```

**Platform-only signal:** depends on five platform-only inputs.

---

## 4. The new composite

Drop the old `composite` formula (too much overlap with the old inputs). Replace with:

```
Composite_CE = 0.20 × ThesisDurability
             + 0.15 × VelocityRegime
             + 0.15 × CounterfactualResilience
             + 0.10 × CrowdednessInverseMoat
             + 0.10 × CrossIndustrySpillover
             + 0.10 × (100 − ShockBlastRadius)       # protected from shocks
             + 0.10 × ceiWeighted                     # keep current-state anchor
             + 0.10 × GranularityScore
```

Notice what is **not** in the composite:
- `agedIndex` (founded-year arithmetic — buy it from Crunchbase)
- `awarenessScore` (citation / ticker flag — buy it from SEC)
- `acquisitionProbability` (size + private flag — buy it from PitchBook)
- `actionability` (presence flags — buy it from anyone)

These four are *still computed and displayed* in the company detail page, because an IC will want them — but they carry **zero weight in the composite**. They are labels, not rankings. The ranking is driven only by scores that require the CE live platform.

---

## 5. What happens to the old 13?

| Old score | Fate |
|---|---|
| `capabilityCoverage` | Keep, unchanged — it's already CE-native. |
| `ceiWeighted` | Keep, unchanged — anchor. |
| `agedIndex` | **Keep as a label, remove from composite.** |
| `awarenessScore` | **Keep as a label, remove from composite.** |
| `moatScore` | **Replace with `CrowdednessInverseMoatScore`.** |
| `aiDisruptability` | **Replace with `ShockBlastRadiusScore`** (generalises to all event types + tree propagation). |
| `actionability` | **Keep as a label, remove from composite.** |
| `acquisitionProbability` | **Keep as a label, remove from composite.** |
| `qualityOfAsset` | Remove — subsumed by `ThesisDurability` + `ceiWeighted`. |
| `forecastedValue` | **Replace with `VelocityRegimeScore`** (acceleration, not level). |
| `riskProfile` | Remove — inversely implied by `CounterfactualResilience` + `ShockBlastRadius`. |
| `sensitivityProfile` | Remove — replaced by `TreeDivergenceScore` which measures real sensitivity (child disagreement), not top-weight concentration. |
| `composite` | **Redefine** per §4. |

Net: **10 new scores + 2 kept + 4 retained as labels.** Company detail page shows all 16, but ranking is by the new composite.

---

## 6. Implementation plan

### 6.1 Schema additions (minor)

```sql
ALTER TABLE company_scores
  ADD COLUMN tree_divergence_score REAL,
  ADD COLUMN granularity_score REAL,
  ADD COLUMN velocity_regime_score REAL,
  ADD COLUMN evidence_freshness_score REAL,
  ADD COLUMN confidence_trajectory_score REAL,
  ADD COLUMN shock_blast_radius_score REAL,
  ADD COLUMN crowdedness_inverse_moat_score REAL,
  ADD COLUMN cross_industry_spillover_score REAL,
  ADD COLUMN counterfactual_resilience_score REAL,
  ADD COLUMN thesis_durability_score REAL;
```

### 6.2 Velocity / confidence history table (prerequisite for §3.3 and §3.5)

```sql
CREATE TABLE cei_components_history (
  id serial PRIMARY KEY,
  capability_id int NOT NULL,
  industry_id int NOT NULL,
  consensus_score real NOT NULL,
  confidence real NOT NULL,
  velocity real NOT NULL,
  captured_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX idx_ceich_cap_date ON cei_components_history (capability_id, captured_at DESC);
```

Append-only snapshot taken at the end of each triangulation rotation. Enables 30d/90d velocity and Δ-confidence lookups.

### 6.3 Service changes

1. New `services/moneyball-v2.ts` implementing the 10 formulas as pure functions over:
   - fingerprint rows
   - `cei_components_history` slice (last 180 days)
   - `macro_events` active set
   - parent/child edges
   - cross-industry cap-name matching
   - peer universe from `company_capability_fingerprint`
2. `computeCompanyScores` calls `moneyball-v2.computeAll(companyId)`, writes all fields.
3. Counterfactual uses `computeCompanyScores(id, { eventsOff: true })` flag.

### 6.4 UI changes

- Shortlist table: replace the 10 SunasiAI-name columns with the 10 new CE-native ones.
- Company detail: two sections — "CE-native ranking" (the new 10) and "Reference labels" (aged / awareness / acquisition / actionability).
- Each score shows a tooltip with the one-line formula and the signal it depends on.

### 6.5 Copy on the Companies tab

Current subtitle says "transparent Moneyball composites" — change to:

> Every score on this page requires a signal that only the CE platform
> produces — sub-capability divergence, velocity regime, evidence freshness,
> tree-propagated shock radius, fingerprint crowdedness, cross-industry
> spillover, counterfactual resilience. No external dataset can reproduce
> the ranking.

---

## 7. Why this actually differentiates

SunasiAI's pitch is "we have a proprietary list of composites." Our counter-pitch becomes: **"we have a set of composites that are *structurally impossible to produce* without a live capability platform with sub-capability decomposition, velocity history, and active-event propagation."**

A competitor wanting to reproduce this exact ranking has to build:
1. A capability tree with parent/child edges (we have it; SunasiAI has flat).
2. Continuous triangulation with timestamps (we have it; SunasiAI runs engagements).
3. A live macro-event log with decay (we have it; SunasiAI has static slides).
4. A full company universe in the same fingerprint space (we have 95 and growing).
5. Cross-industry cap-name matching (we have it via our 8-stage taxonomy).

That's not a formula advantage — that's a moat. Which is precisely the thing our current `moatScore` fails to measure about ourselves.

---

## 8. Effort estimate

| Phase | Effort | Deliverable |
|---|---|---|
| History table + daily snapshotter | 2 h | `cei_components_history` populated |
| `moneyball-v2.ts` service | 4 h | 10 pure functions, unit-tested on the 95 companies |
| Schema additions + recompute | 1 h | `company_scores` carries all 20 fields |
| UI — shortlist columns swap | 2 h | New columns live on `/companies` |
| UI — detail page split into two sections | 1 h | CE-native ranking vs reference labels |
| Copy updates | 0.5 h | Subtitle + tooltips |
| **Total** | **~10 h** | Fully differentiated Moneyball |

Say the word and I'll do Phase A (history table + service) next.
