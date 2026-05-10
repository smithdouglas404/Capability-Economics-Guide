# Capability Economics — Naming & Language Spec

**Goal:** stop using SunasiAI's vocabulary (Moneyball, Aged Index, Moat, FEVI…)
which is borrowed, metaphorical, and backward-looking. Replace it with a coherent
CE-native language built from four design rules:

1. **Math-named, not metaphor-named.** Every term is the operation it performs
   (`Posterior`, `Divergence`, `Decay`, `Trajectory`, `Propagation`,
   `Counterfactual`). No baseball, no moats, no castles.
2. **Traceable.** Every term maps 1-to-1 to a column in our warehouse or a pure
   function in a service file. If it cannot be SQL-queried, it cannot be a CE
   term.
3. **Forward-tilted.** Every term takes a derivative — velocity, acceleration,
   trajectory, Δ — not a level. Levels are the floor; *change in levels* is the
   product.
4. **Provenance-bound.** Every term has citation pressure built into it: it
   degrades when evidence is stale, it sharpens when evidence is fresh, it
   carries a confidence band.

---

## 1. The umbrella brand — replaces "Moneyball"

**Capability Forward Index (CFI)**

- A direct foil to SunasiAI's *FEVI* (Forecasted Enterprise Value Index).
- Says what it is in three words: a *capability* signal, *forward* (derivative,
  not level), *indexed* (composite, comparable, rank-ordered).
- Pronounceable, three syllables, three-letter ticker. Goes on slides as
  *"Stripe's CFI is 67.5"* — same cadence as P/E or FCF.
- Replaces "Moneyball" everywhere in product, deck, and codebase.

The CFI is the **composite output** of nine **CE-native scores** (§3) plus four
reference labels (§4).

---

## 2. Linguistic rules — the seven verbs

Every CE-native term is built from one of seven mathematical verbs. This is the
voice of the platform.

| Verb | Meaning | Example term |
|---|---|---|
| **Posterior** | Bayesian point estimate with confidence band | *Posterior Quality*, *Posterior CEI* |
| **Trajectory** | Δ over time of a quantity | *Confidence Trajectory* |
| **Regime** | Δ-of-Δ (acceleration); regime-shift detection | *Velocity Regime* |
| **Propagation** | impact transmitted through a graph (tree, peer, event) | *Shock Propagation*, *Tree Propagation* |
| **Divergence** | stddev / disagreement within a group | *Tree Divergence* |
| **Decay** | time-weighted attenuation | *Evidence Decay*, *Event Decay* |
| **Counterfactual** | output of a model run with a flag toggled | *Counterfactual Resilience* |

**Banned vocabulary** (never used in CE product, deck, or code unless explicitly
quoting SunasiAI): *Moneyball, Moat, Aged, Awareness, Quality of Asset,
Forecasted Value, FEVI, Sensitivity Profile, Risk Profile, Quadrant, Hot/Cool*.
Each has a CE replacement listed below.

---

## 3. The nine CE-native scores — every one ladders into the CFI

Every score below: (a) is built from one of the seven verbs, (b) maps to a
column we will write in `company_scores`, (c) is a pure function in
`services/companies.ts` (the company-scoring "Moneyball block") and
`services/cei-engine.ts` (the Bayesian capability posterior). The §9
implementation footprint plans extracting these into a dedicated
`services/posterior.ts`; until that rename lands, treat `companies.ts`
+ `cei-engine.ts` as the canonical home and read the §3 trace lines as
the contract regardless of file location.

### 3.1 Posterior CEI Coverage `posteriorCeiCoverage`
- **Was:** `ceiWeighted` + `capabilityCoverage` (two overlapping scores).
- **Is now:** Σ(weight × posterior_mean × confidence) / Σ weight, then rebased
  0–100. One score, confidence-aware, Bayesian.
- **Reads like:** "Stripe's posterior CEI coverage is 64.8."
- **Math:** weighted Bayesian posterior on the firm's fingerprint caps.
- **Trace:** `cei_components.consensus_score`, `confidence`,
  `company_capability_fingerprint.weight`.

### 3.2 Velocity Regime `velocityRegime`
- **Was:** SunasiAI's *Forecasted Value* (linear extrapolation of level).
- **Is now:** acceleration — `velocity_30d − velocity_90d`. Tells you the
  thesis is *speeding up* or *slowing down*, not its current speed.
- **Reads like:** "Stripe's velocity regime is +18 (accelerating)."
- **Math:** second-derivative of CEI over time, fingerprint-weighted.
- **Trace:** `cei_components_history` (new table, daily snapshot).

### 3.3 Confidence Trajectory `confidenceTrajectory`
- **New.** No SunasiAI equivalent.
- **Is:** Δ confidence over 30 days, fingerprint-weighted. Score going up =
  thesis solidifying as evidence accumulates.
- **Reads like:** "Stripe's confidence trajectory is +9 — the thesis is
  hardening."
- **Math:** `confidence_today − confidence_30d_ago`.
- **Trace:** `cei_components_history`.

### 3.4 Evidence Decay `evidenceDecay`
- **Was:** unmeasured. Stale consensus and fresh research scored identically.
- **Is now:** how recent the underlying triangulation evidence is. Caps with
  triangulations older than ~67 days score 0; freshly triangulated caps score
  100.
- **Reads like:** "Stripe's evidence decay is 78 — the underlying research is
  fresh."
- **Math:** `max(0, 100 − age_days × 1.5)`, fingerprint-weighted.
- **Trace:** `source_triangulations.queried_at`.

### 3.5 Tree Divergence `treeDivergence`
- **Was:** SunasiAI's *Sensitivity Profile* (top-weight concentration — a
  one-line proxy).
- **Is now:** stddev of children scores within each fingerprint cap. High
  divergence = the firm fingerprinted on a parent that hides internal
  disagreement (Generative AI ≠ Agentic AI under the same parent). Penalises
  vague exposure.
- **Reads like:** "Stripe's tree divergence is 22 — its fingerprint sits on
  parents whose children disagree."
- **Math:** stddev over `children(cap).consensus_score`, fingerprint-weighted.
- **Trace:** `capabilities.parent_capability_id`, `is_leaf`.

### 3.6 Granularity Depth `granularityDepth`
- **New.** Rewards firms whose fingerprint is at leaf level (precise) over
  parent level (coarse). A firm fingerprinted on "Agentic AI" is more
  defensible than one on "AI/ML Ops."
- **Reads like:** "Stripe's granularity depth is 71 — leaf-level fingerprint."
- **Math:** Σ(weight × tree_depth) / Σ(weight × MAX_DEPTH).
- **Trace:** `capabilities.parent_capability_id` (chain).

### 3.7 Shock Propagation `shockPropagation`
- **Was:** SunasiAI's *AI Disruptability* + *Risk Profile* (direct-tag only,
  one event type).
- **Is now:** generalises to all event types and propagates through the
  capability tree — direct hit (1.0×), via-parent (0.6×), via-child (0.8×).
  Decay-weighted by event age.
- **Reads like:** "Stripe's shock propagation is −14 — it's net-exposed to
  the active event set."
- **Math:** Σ events of `severity × decay × sentiment_sign × tree_hit_factor ×
  fingerprint_weight`.
- **Trace:** `macro_events`, parent/child edges.

### 3.8 Crowd-Inverse Moat `crowdInverseMoat`
- **Was:** SunasiAI's *Moat Score* (avg CEI of high-confidence positive caps —
  measures *industry strength*, not *firm uniqueness*).
- **Is now:** inverse fingerprint-cosine density. If 25 peers in your
  industry share your fingerprint vector at cosine > 0.6, you have no moat
  — you're a commodity position. If 0 peers share it, you have monopoly.
- **Reads like:** "Stripe's crowd-inverse moat is 64 — moderately
  defensible."
- **Math:** `100 − clamp(|peers with cosine > 0.6| × 4, 0, 100)`.
- **Trace:** `company_capability_fingerprint` across whole peer universe.

### 3.9 Counterfactual Resilience `counterfactualResilience`
- **Was:** SunasiAI's *Risk Profile* (1 − confidence — a label, not a stress
  test).
- **Is now:** run the CFI twice — once with the active event set live, once
  with all events zeroed. The delta is the firm's transient buoyancy. Low
  delta = enduring; high delta = currently-buoyant but fragile.
- **Reads like:** "Stripe's counterfactual resilience is 87 — its ranking
  doesn't depend on the current event regime."
- **Math:** `100 − min(100, |CFI_live − CFI_naive| × 3)`.
- **Trace:** two `computeCFI` runs with `eventsOff` flag.

---

## 4. Reference labels — kept for the IC, removed from the composite

These are useful at IC stage but are not CE-differentiated; they could be
bought from Crunchbase, SEC EDGAR, or PitchBook. They live on the company
detail page but contribute **zero weight** to the CFI.

| Old name (SunasiAI) | CE label name | Source |
|---|---|---|
| Aged Index | **Provenance Age** (years since founding) | `companies.founded_year` |
| Awareness Score | **Public Footprint** (cite count, ticker, revenue scale) | static |
| Acquisition Probability | **Acquisition Likelihood** (size × ownership) | static |
| Actionability | **Engagement Readiness** (presence of contact + funding) | static |

The detail page presents two clearly-labeled sections:
- **CE-native ranking** — the nine scores in §3 + the CFI composite.
- **Reference labels** — the four above, shown but greyed out from the rank.

---

## 5. The CFI composite formula

```
CFI = 0.20 × posteriorCeiCoverage      ← anchor: where they are now
    + 0.15 × velocityRegime            ← acceleration: where they are heading
    + 0.15 × counterfactualResilience  ← durability: how robust the rank is
    + 0.10 × confidenceTrajectory      ← thesis hardening
    + 0.10 × evidenceDecay             ← fresh research bonus
    + 0.10 × crowdInverseMoat          ← differentiation
    + 0.10 × (100 − shockPropagation)  ← shock-protected
    + 0.05 × granularityDepth          ← precision of fingerprint
    + 0.05 × (100 − treeDivergence)    ← coherence of fingerprint
```

Three anchors (where they are) at 20 %, three derivatives (where they're going)
at 35 %, three structural quality measures at 30 %, two precision measures at
10 %, and zero weight on borrowed-metaphor noise.

---

## 6. Linguistic mapping — the slide / deck / IC voice

| Where you used to say… | Now say… |
|---|---|
| "Stripe's Moneyball composite is 67.5" | "Stripe's CFI is 67.5" |
| "Strong moat" | "Crowd-inverse moat 78" |
| "High forecasted value" | "Velocity regime +22 (accelerating)" |
| "Quality of asset is 71" | "Posterior CEI coverage 71" |
| "Risk profile 28" | "Counterfactual resilience 87" |
| "AI disruptable" | "Shock propagation −18 (exposed)" |
| "Sensitivity profile high" | "Tree divergence 31 — fingerprint sits on
internally split parents" |
| "Aged index 30" | "Provenance age 28 years" |
| "Hot quadrant" | "Velocity regime > 0, posterior CEI > 65" |
| "Cooling capability" | "Velocity trajectory negative, evidence decay > 60
days" |
| "Industry trend" | "Industry posterior" |
| "We re-ran the analysis" | "We refreshed the posterior" |
| "It's a 4-week engagement" | "It's a continuous posterior; query it" |

---

## 7. Why this language is provably better on the four axes

### Math
Seven verbs, each a defined mathematical operation. Every score has a closed-form
formula in §3. SunasiAI's vocabulary (Moat, Quality, Forecasted, Aged) names
*what the score should mean*; ours names *what the score does*. A reader can
re-derive every CE term from the verb table — they cannot re-derive
"Moat Score" without SunasiAI's permission.

### Facts
Every term cites a column or a function. No CE term exists that cannot be SQL'd
— the §3 trace lines are the contract. SunasiAI's terms cite nothing; their
report shows numbers without showing the column they came from.

### Traceability
Provenance is in the verbs themselves: *Posterior* implies a prior + likelihood;
*Decay* implies a timestamp; *Propagation* implies a graph; *Counterfactual*
implies a model toggle. The reader knows what to look up before reading the
formula. With *Moat* / *Quality* / *Awareness*, the reader doesn't even know
what kind of object to expect.

### Forward thinking
Five of the nine CE-native scores are derivatives (Velocity Regime, Confidence
Trajectory, Evidence Decay, Shock Propagation, Counterfactual Resilience).
Only two of SunasiAI's eleven are derivatives (Forecasted Value, Sensitivity).
By construction, our composite is **more than 50 % forward-tilted**; theirs
is < 20 %.

---

## 8. Branding implications (where this lands externally)

- **Product surface:** `/companies` page renames "Top 15 companies — ranked
  by CE composite" → **"Top 15 companies — ranked by CFI."** Column headers
  use the §3 names. Tooltip on each header shows the §3 one-line math.
- **Deck:** the Capability Economics slide deck replaces every instance of
  "Moneyball" with "CFI." Replaces SunasiAI's quadrant slide with a
  velocity-regime × posterior-CEI scatter labelled "Posterior × Velocity
  Regime."
- **Marketing copy:** "We do not run engagements. We expose a continuously
  updated posterior over your industry's capability stack, queryable as a
  REST endpoint and a Postgres warehouse."
- **One-line elevator pitch:** *"Capability Economics is the live posterior
  layer for industry strategy."*
- **Three-word tagline:** *"Posterior. Provenance. Propagation."*

---

## 9. Implementation footprint

This is a vocabulary shift; the math is from the prior redesign spec
(`docs/ce-moneyball-redesign.md`). What changes is naming.

| Change | Effort |
|---|---|
| Rename `services/companies.ts` Moneyball block → `services/posterior.ts` (NOT YET DONE — code currently lives in `companies.ts` + `cei-engine.ts`) | 1 h |
| Rename `company_scores` columns to §3 names (drizzle migration) | 1 h |
| Update `/companies` page column headers + subtitle + tooltips | 1 h |
| Update CE pitch deck slide vocabulary (Moneyball → CFI) | 1 h |
| Update `docs/sunasiai-vs-ce-comparison.md` to use CFI vocabulary | 0.5 h |
| Update `docs/ce-residential-solar-deep-dive.md` to use CFI vocabulary | 0.5 h |
| **Total** | **~5 h** |

Vocabulary migration is reversible; do it as one commit, point a redirect from
old route names to new ones for 30 days.

---

## 10. The one-line summary

> SunasiAI says *Moneyball*. We say *Capability Forward Index*.
> They name what the score should *feel like*; we name what the math *does*.
> Every CE term is a verb you can SQL, a derivative that points forward, and a
> posterior with a confidence band — by construction, on every page.

Say the word and I'll do the rename pass next.
