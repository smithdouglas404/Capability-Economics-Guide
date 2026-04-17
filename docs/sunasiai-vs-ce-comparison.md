# SunasiAI Residential-Solar Deep Dive vs. Capability Economics Platform

**Subject report:** *Renewable Energy / Solar Case Study — Residential Solar Deep Dive*
by Ralph Welborn, Vince Kasten, Joe Gallagher (SunasiAI, 2025).

**This document:** an honest, side-by-side read of where the Capability Economics
("CE") platform produces *better* stats and insight than the SunasiAI Workbench
report, where SunasiAI is currently ahead, and a sketch of how the **CE Residential
Solar Deep Dive** would be assembled in our own product.

---

## 1. Where CE produces materially better stats / insight

| Dimension | SunasiAI Workbench (per the case study) | CE Platform | Why ours is stronger |
|---|---|---|---|
| **Capability score type** | Static "Quadrant" bucket (Hot / Cooling / Table-Stakes / Emerging) derived from analyst-curated graph snapshot. Refresh cadence not disclosed; case study describes a 4-week deep dive engagement. | Continuous **CEI score (0–100)** per capability with **Bayesian posterior + 95 % CI**, recomputed every 6 h from multi-source triangulation. | Quadrants are a 2×2; CEI is a number with a confidence interval and a velocity. You can rank, threshold, alert, and back-test on it. |
| **Provenance** | "Graph analytics, GNN, agentic AI engines" — no per-score citation surfaced in the deck. | Every score links to the **Perplexity sonar triangulation record**: 3–8 distinct sources per capability, each with URL, publish date, confidence weight, and a one-line "what this source asserted." | Defensible to an IC. A PE associate can click any number and read the underlying source within two clicks. |
| **Score movement** | Captured by re-running the engagement; no real-time drift signal in the report. | **Velocity** field per capability (Δscore / 30 d) plus an **age-of-evidence** badge. Stale caps are auto-rotated for re-triangulation; urgent caps jump the queue. | You see a capability heating *while* it heats, not in the next deck. |
| **Macro-event integration** | None visible in the case study. The "changing economic logic per stage" table is a static snapshot of patents / capital flow / start-ups. | Live **Macro Event ingestion** (Iran/Strait of Hormuz, US CPI, AI rout, private-credit liquidity, etc.) with severity 0–10, decay window, and **per-capability shock map**. Each shock propagates **bidirectionally** through the parent ↔ child capability tree. | A war or rate-cut measurably moves the relevant capabilities the same day, with a red impact bubble on the UI explaining *why*. SunasiAI has no equivalent in the report. |
| **Granularity of "AI"** | Treated as one capability per value-chain stage (e.g. "Mixed-Signal Designs" sits next to "Biodegradable Electronics" as siblings; AI itself is not decomposed in the report). | **Sub-capability decomposition** — every parent capability spawns 5–7 children (Generative AI ≠ Agentic AI ≠ Foundation Models ≠ RLHF). Parent score = weighted roll-up of children; children diverge over time as evidence rotates. | The report's "1,500+ granular capabilities" is one flat layer. Ours is a hierarchy where Generative AI today scores 39.66 and Agentic AI scores 42.43 — same parent, different futures. |
| **Cross-capability propagation** | "Ripple Effects" diagram is qualitative. | Quantitative **bidirectional shock propagation** — a shock to "Battery Storage Cell Chemistry" recomputes both its parent ("Energy Storage") and its siblings via the dependency graph, factually (not proportionally). | Auditable cause-and-effect in the index, not a McKinsey-style influence diagram. |
| **C-suite relevance** | Not surfaced as a first-class lens. | Each capability tagged with **C-suite relevance** weights (CEO / CFO / CIO / CISO / COO / CRO / CMO). The dashboard rewrites the same data per role. | A CFO sees the same residential-solar deal through a treasury / capex lens; a CISO sees supply-chain attack surface. SunasiAI's Workbench is one view for all roles. |
| **Project / Investment simulation** | Implicit — comes out of the analyst engagement. | **VCE (Value-Capability Economics) simulator**: define a hypothetical investment / divestiture and the dashboard renders before/after radar charts, Δ-CEI per capability, and Δ-confidence. | Self-service "what if we acquire this design firm" without a 4-week engagement. |
| **Confidence transparency** | Not surfaced per capability in the deck. | Every score ships with **N sources used, posterior std-dev, and an explicit confidence band**. Caps below a confidence floor are visually muted. | An IC can immediately separate "we know this" from "we're guessing." |
| **Refresh cost & cadence** | Custom engagement (4 weeks for the residential-solar deep dive). | **Always-on** — 6-hour rotation across ~600 caps, ~$5–8/day Perplexity spend, plus a 24-hour world-scan for macro events. | The cost of a single SunasiAI engagement covers a year of the CE platform running continuously. |
| **Auditability** | Output is a slide deck. | Output is a **typed REST API** + a Postgres warehouse that can be queried with SQL. Every score, source, and event lives in `source_triangulations`, `macro_events`, `capabilities`, etc. | LPs / auditors / data-room reviewers get raw evidence, not screenshots. |

---

## 2. Where SunasiAI is currently ahead of us (honest gaps)

We do not currently match these capabilities of the SunasiAI Workbench, and any
"our version" of the residential-solar deep dive should be candid about it:

1. **Explicit value-chain stage model.** SunasiAI decomposes residential solar
   into 10 stages (Extract → Design → Make → Test → Service → Dispose + 3
   enabling). CE today models industries as a flat capability set per industry;
   we have parent ↔ child trees but not yet a *value-chain stage* dimension.
   **Fix path:** add a `value_chain_stage` enum on `capabilities`
   (extract / design / make / test / service / dispose / enable-1..3) and a
   per-stage roll-up view. Roughly a one-day change.
2. **Company entity layer.** SunasiAI's Workbench pivots on companies — they
   short-listed 5,000 → 100 firms by capability fingerprint with 30+ filters
   (Aged Index, Acquisition Probability Score, Awareness Score, Moat Score,
   AI Disruptability Score). CE has no `companies` table yet; we score
   capabilities, not firms.
   **Fix path:** add `companies` and `company_capability_fingerprint` tables
   plus a Perplexity ingestion route ("for {industry}, list all venture-backed
   firms with capability fingerprint") and replicate their Moneyball scores
   on top. Two-to-three days of work.
3. **Patents / capital flow / start-up counts per stage.** SunasiAI shows
   patents (882 / 1 231 / 2 494 / 408 / 293 / 124), VC capital ($2 b / $111 b /
   $29 b / $2.5 b / $7 b / $413 m), and start-up counts per stage. We don't
   ingest patent or VC data today.
   **Fix path:** USPTO + Crunchbase / PitchBook ingestion (or the
   Perplexity equivalent) keyed by capability; nightly batch.
4. **"Companies-like" similarity search.** Their Workbench finds firms whose
   capability fingerprint resembles a target. We can compute this once a
   company entity exists (cosine-similarity on the capability vector); blocked
   only on (2).
5. **Quadrant chart UI.** Theirs is the recognisable 2×2; we have a radar.
   Trivially addable as an alternate view.
6. **Acquisition Probability / Actionability scores.** Bespoke firm-level
   composites. Replicable once we have the company layer.

> **Net read:** SunasiAI is ahead on the *firm-level* deal-sourcing layer.
> CE is ahead on the *capability-level* signal layer — scoring rigour, real-time
> macro reactivity, sub-capability granularity, and confidence transparency.
> The two are complementary; the cleanest "our version" of their report fuses
> CE's rigour underneath their value-chain-by-firm presentation.

---

## 3. The CE Residential Solar Deep Dive (our version of their report)

What follows is the structure we would publish if a PE Renewable Energy Fund
asked CE the same question SunasiAI was asked. Sections are tagged
**[live]** if the platform produces them today, or **[gap → fix]** if they
require the additions in §2.

### 3.1 Executive read in three numbers
- **Industry CEI for Renewable Energy / Residential Solar today.** Single
  GDP-weighted score with 95 % CI and Δ vs. 30 days ago. **[live]**
- **Top 5 macro shocks currently moving residential solar**, with severity,
  decay countdown, and the specific capabilities each shock is hitting.
  Pulled from the live macro-event table; today the ones that would surface
  include the Iran / Strait of Hormuz disruption (polysilicon import lanes),
  US CPI / inflation print (residential financing cost-of-capital), and the
  AI tech rout (downstream effect on home-energy-management software
  multiples). **[live]**
- **Top 5 hottest sub-capabilities and top 5 cooling**, ranked by velocity
  (Δscore / 30 d) with confidence overlay so an IC sees only high-confidence
  movers. **[live — sub-capability tree exists; residential-solar parents
  to be seeded.]**

### 3.2 Value-chain stage profile [gap → fix needed]
Replicate SunasiAI's six-stage table (Extract / Design / Make / Test /
Service / Dispose) but populate every cell from CE's own evidence base:

| Stage | # capabilities | Avg CEI | Avg confidence | Active macro shocks | Top 3 capabilities by velocity | Top patents (ext) | Top VC capital (ext) |
|---|---|---|---|---|---|---|---|
| Extract / Source | … | … | … | Iran shock = ✗ | Polysilicon refining, CFRP, Rare-earth recovery | …  | … |
| Design | … | … | … |  | Mixed-signal design, Bifacial-cell modelling, Microinverter topology | … | … |
| Make | … | … | … |  | Heterojunction cells, TOPCon, Perovskite tandem | … | … |
| Test | … | … | … |  | Acoustic micro-imaging, EL imaging, IV-curve robotics | … | … |
| Service | … | … | … | CPI shock = ✓ | Energy harvesting, Fleet O&M agents, Predictive soiling | … | … |
| Dispose | … | … | … |  | Module recycling, Glass / Si separation, Component salvage | … | … |

Three columns are CE-native (capability count, CEI, confidence, shocks,
velocity). The patent / VC columns come from the company-and-patent
ingestion in §2-3.

### 3.3 Hot / Cooling / Emerging quadrant [live, alternate view]
Same 2×2 as the SunasiAI Quadrant chart, but populated from CE's velocity
(x-axis) × current CEI (y-axis), with bubble size = confidence and bubble
colour = sentiment-shock direction. Hover shows the underlying triangulation
sources. Re-renders every 6 hours.

### 3.4 Sub-capability decomposition [live, our differentiator]
For each parent capability in residential solar (e.g. "Energy Storage",
"Power Electronics", "Home Energy Management Software"), expand into the
5–7 children. For each child show: CEI, CI, velocity, age of evidence, and
which macro events are touching it. Children diverge — the report can show
that "LFP cell chemistry" and "Sodium-ion cell chemistry" are siblings under
"Battery Storage" with very different CEI trajectories. **SunasiAI's report
collapses this layer.**

### 3.5 Macro-disruption blast radius [live, our differentiator]
For each active macro event affecting residential solar, render the
impacted-capability list with the *via* attribution (directly tagged / via
parent / via child) and the underlying news citations. This is the panel
that today shows 45 capabilities flagged across the platform; for the
solar slice it would be filtered to that industry's caps.

### 3.6 Company short-list [gap → fix needed]
Replicate the SunasiAI funnel (5 000 → 100 → 10) but use CE's capability
fingerprint as the matcher:
- Universe pulled from a Perplexity scan ("US-based residential-solar firms
  with > $5 m revenue").
- Each firm tagged with a capability fingerprint (which of our caps it claims
  to do).
- Score = Σ (firm-cap weight × cap CEI × cap velocity × cap confidence).
- Filters mirror SunasiAI's Moneyball-like attributes (Aged Index, Quality
  of Asset, Actionability, Awareness, AI Disruptability) — each implemented
  as a deterministic function of the underlying CE evidence so an IC can read
  *why* a firm is in the top 10.

### 3.7 Stress test / VCE simulator [live, our differentiator]
For each top-10 firm, run a what-if: "We acquire firm X. Recompute the
fund's portfolio CEI, capability coverage gaps, and exposure to currently
active macro events." Output is a before/after radar plus a one-line
delta-of-deltas summary. Nothing equivalent in the SunasiAI report.

### 3.8 Audit & data-room appendix [live]
Auto-generated from the Postgres warehouse:
- Every score in §3.1–3.5 with source URLs, publish dates, and the
  triangulation record ID.
- Every macro event with the Perplexity citation set.
- Every sub-capability spawn record (which model decomposed which parent,
  on which date, at what confidence).

---

## 4. Bottom line

The SunasiAI report is a high-quality consulting deliverable: a value-chain
decomposition of residential solar with a curated company short-list and
qualitative ripple-effect commentary. It is one snapshot, produced by analysts
in roughly four weeks.

CE produces the same value-chain and short-list output but adds:

1. A **continuously updated, confidence-banded numeric index** for every
   capability instead of a quadrant bucket.
2. **Live macro-event reactivity** with per-capability shock attribution and
   citations — none of which exists in the SunasiAI deck.
3. **True hierarchical decomposition** (Generative AI vs Agentic AI as
   siblings under AI; LFP vs sodium-ion as siblings under Battery Storage)
   with bidirectional roll-up.
4. **Self-service VCE simulation** for what-if deals.
5. A **fully auditable Postgres warehouse + REST API** under the dashboard.

The two short-term build items that close our remaining gaps to SunasiAI are
(a) the value-chain-stage dimension on capabilities and (b) the company entity
layer with patent / VC ingestion. Both are scoped in §2; combined they are
roughly a working week of effort. After that, the CE Residential Solar Deep
Dive in §3 supersedes the SunasiAI report on every axis it currently leads on,
*and* matches it on the firm-level deal-sourcing axes where it leads today.
