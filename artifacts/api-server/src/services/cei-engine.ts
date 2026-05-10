import { db } from "@workspace/db";
import {
  ceiSnapshotsTable,
  ceiComponentsTable,
  capabilitiesTable,
  industriesTable,
  industryGdpWeightsTable,
  sourceTriangulationsTable,
  ontologyRelationshipsTable,
  type MacroEvent,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { computeGlobalMacroShock, listActiveEvents, expandAffectedCapabilityIds } from "./macro-events";
import { evaluateAfterCEI, snapshotCapStates } from "./subscriptions";

const CEI_SCALE_FACTOR = 10;
const VELOCITY_DECAY = 0.7;
const MULTIPLIER_BASE = 1.0;
const MULTIPLIER_PER_DEPENDENCY = 0.08;
const MULTIPLIER_CAP = 2.0;

// Bayesian prior on a capability's consensus score (0-100 scale).
// Wide prior (σ²=1500 → σ≈38.7) so that with no triangulation evidence the
// posterior CI is intentionally near-uninformative.
const PRIOR_MEAN = 50;
const PRIOR_VARIANCE = 1500;
// Z-score for two-sided 95% credible interval on a Gaussian posterior.
const Z_95 = 1.96;

interface IndustryBreakdown {
  industryName: string;
  indexValue: number;
  // 95% CI on the industry index. null when no scored capabilities exist.
  ciLow: number | null;
  ciHigh: number | null;
  weight: number;
  weightSourceUrl: string | null;
  weightSourceYear: number | null;
  velocity: number;
  capabilityCount: number;
  topMover: string;
  topMoverDelta: number;
}

interface CEIResult {
  overallIndex: number;
  overallCiLow: number | null;
  overallCiHigh: number | null;
  industryBreakdowns: Record<string, IndustryBreakdown>;
  marketSentiment: number;
  volatility: number;
  methodology: string;
  timestamp: string;
}

/**
 * Options for `computeCEI`.
 *
 * - `persist` (default true): when false, the engine runs end-to-end but does
 *   not write to `cei_components` or `cei_snapshots`. Used by the backtesting
 *   harness to call the real engine math (parent/child rollup, posterior
 *   variance, multipliers) without polluting live state.
 * - `additionalEvents`: extra macro events appended to the active-event set
 *   for this run. Used by the backtest harness to inject a single historical
 *   event and measure its propagated impact via the real engine. The events'
 *   `startedAt` should be `new Date()` so `decayFactor` is 1 (peak shock).
 * - `capturePerCap`: when true, the result includes the engine's per-capability
 *   posterior consensusScore map keyed by capabilityId. Required for the
 *   backtest harness to diff baseline vs predicted at the leaf level.
 */
export interface ComputeCEIOptions {
  persist?: boolean;
  additionalEvents?: MacroEvent[];
  capturePerCap?: boolean;
}

export async function computeCEI(opts: ComputeCEIOptions = {}): Promise<CEIResult & { capScores?: Map<number, number> }> {
  const persist = opts.persist !== false;
  const additionalEvents = opts.additionalEvents ?? [];
  const captureMap = opts.capturePerCap ? new Map<number, number>() : null;
  // Snapshot per-cap state BEFORE the new run so subscription hooks can
  // diff against it after persist. Skipped on non-persist (backtest) runs.
  const prevCapStates = persist ? await snapshotCapStates() : null;
  const industries = await db.select().from(industriesTable);
  const allCapabilities = await db.select().from(capabilitiesTable);
  const allRelationships = await db.select().from(ontologyRelationshipsTable);
  const gdpWeightRows = await db.select().from(industryGdpWeightsTable);
  const gdpWeightByIndustry = new Map(gdpWeightRows.map(r => [r.industryId, r]));

  const prevComponents = await db.select().from(ceiComponentsTable);
  const prevMap = new Map<string, typeof prevComponents[0]>();
  for (const c of prevComponents) {
    prevMap.set(`${c.industryId}-${c.capabilityId}`, c);
  }

  const recentTriangulations = await db
    .select()
    .from(sourceTriangulationsTable)
    .orderBy(desc(sourceTriangulationsTable.queriedAt));

  const triMap = new Map<number, Array<{ rawScore: number; weight: number }>>();
  const seenKeys = new Set<string>();
  for (const t of recentTriangulations) {
    const key = `${t.capabilityId}-${t.sourceLabel}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    if (!triMap.has(t.capabilityId)) triMap.set(t.capabilityId, []);
    triMap.get(t.capabilityId)!.push({ rawScore: t.rawScore, weight: t.weight });
  }

  const dependencyCount = new Map<number, number>();
  for (const rel of allRelationships) {
    dependencyCount.set(
      rel.targetCapabilityId,
      (dependencyCount.get(rel.targetCapabilityId) || 0) + 1,
    );
    dependencyCount.set(
      rel.sourceCapabilityId,
      (dependencyCount.get(rel.sourceCapabilityId) || 0) + 1,
    );
  }

  const industryBreakdowns: Record<string, IndustryBreakdown> = {};
  let overallNumerator = 0;        // Σ wᵢ × indexᵢ
  let overallWeightSum = 0;        // Σ wᵢ
  let overallVarNumerator = 0;     // Σ wᵢ² × Var(indexᵢ)
  const allVelocities: number[] = [];

  // Bidirectional macro-event capability shocks. `additionalEvents` lets the
  // backtest harness inject a historical event for replay without persisting
  // it to the live macro_events table.
  const capShockMap = new Map<number, number>();
  const activeEvents = [...await listActiveEvents(), ...additionalEvents];
  for (const evt of activeEvents) {
    const explicit = (evt.affectedCapabilityIds ?? []) as number[];
    if (!explicit.length) continue;
    const expanded = await expandAffectedCapabilityIds(explicit);
    const elapsedDays = (Date.now() - new Date(evt.startedAt).getTime()) / (1000 * 60 * 60 * 24);
    const decayFactor = Math.max(0, 1 - elapsedDays / Math.max(0.1, evt.decayDays));
    if (decayFactor <= 0) continue;
    const sign = evt.sentimentDirection === "positive" ? 1 : evt.sentimentDirection === "negative" ? -1 : 0;
    const shock = evt.severity * sign * decayFactor;
    for (const id of expanded) {
      capShockMap.set(id, (capShockMap.get(id) ?? 0) + shock);
    }
  }

  // Firm rule: NO hardcoded editorial values. Industries without a
  // Perplexity-cited GDP-weight row are EXCLUDED from the overall CEI
  // rollup (their weight is treated as 0). They still receive an industry
  // index — they simply don't contribute to the global aggregate. We
  // collect their names below so the snapshot can surface a warning.
  const missingWeightIndustries: string[] = [];

  for (const industry of industries) {
    const caps = allCapabilities.filter(c => c.industryId === industry.id);
    if (caps.length === 0) continue;

    const weightRow = gdpWeightByIndustry.get(industry.id);
    if (!weightRow) {
      missingWeightIndustries.push(industry.name);
    }

    let industryWeightedSum = 0;            // Σ contributionᵢ
    let industryContribVarSum = 0;          // Σ Var(contributionᵢ)
    let topMover = "";
    let topMoverDelta = 0;

    const leafCaps = caps.filter(c => c.isLeaf);
    const parentCaps = caps.filter(c => !c.isLeaf);
    // Posteriors of leaves keyed by capId — used to roll parents up.
    const leafPosterior = new Map<number, {
      consensusScore: number; confidence: number; velocity: number; variance: number;
    }>();

    for (const cap of leafCaps) {
      const triSources = triMap.get(cap.id);
      let consensusScore: number;
      let confidence: number;
      let posteriorVariance: number;

      if (triSources && triSources.length > 0) {
        let posteriorPrecision = 1 / PRIOR_VARIANCE;
        let weightedMeanNum = PRIOR_MEAN / PRIOR_VARIANCE;
        for (const src of triSources) {
          const obsVariance = 40 / src.weight;
          const obsPrecision = 1 / obsVariance;
          posteriorPrecision += obsPrecision;
          weightedMeanNum += src.rawScore * obsPrecision;
        }
        consensusScore = weightedMeanNum / posteriorPrecision;
        posteriorVariance = 1 / posteriorPrecision;
        const range = triSources.length > 1
          ? Math.max(...triSources.map(t => t.rawScore)) - Math.min(...triSources.map(t => t.rawScore))
          : 30;
        const agreementFactor = Math.max(0, 1 - range / 50);
        const coverageFactor = triSources.length / 4;
        confidence = Math.min(1, agreementFactor * 0.6 + coverageFactor * 0.4);
      } else {
        // Prior-only path: post = prior. Wide CI signals "no evidence yet".
        consensusScore = cap.benchmarkScore;
        confidence = 0.5;
        posteriorVariance = PRIOR_VARIANCE;
      }

      const capShock = capShockMap.get(cap.id);
      if (capShock) {
        consensusScore = Math.max(0, Math.min(100, consensusScore + capShock));
      }

      const prevKey = `${industry.id}-${cap.id}`;
      const prev = prevMap.get(prevKey);
      let velocity = 0;
      if (prev) {
        const rawDelta = (consensusScore - prev.consensusScore) / 100;
        velocity = VELOCITY_DECAY * (prev.velocity || 0) + (1 - VELOCITY_DECAY) * rawDelta;
      }
      velocity = Math.max(-0.5, Math.min(0.5, velocity));

      const deps = dependencyCount.get(cap.id) || 0;
      const economicMultiplier = Math.min(MULTIPLIER_CAP, MULTIPLIER_BASE + deps * MULTIPLIER_PER_DEPENDENCY);

      // Per-capability contribution to the industry sum and its variance under
      // the (locally constant) multiplier × confidence × (1+velocity) coefficient.
      const contribCoeff = (1 + velocity) * economicMultiplier * confidence;
      const capContribution = consensusScore * contribCoeff;
      const capContribVariance = contribCoeff * contribCoeff * posteriorVariance;
      industryWeightedSum += capContribution;
      industryContribVarSum += capContribVariance;
      allVelocities.push(velocity);

      const stddev = Math.sqrt(posteriorVariance);
      const ciLow = Math.max(0, consensusScore - Z_95 * stddev);
      const ciHigh = Math.min(100, consensusScore + Z_95 * stddev);

      const delta = prev ? Math.abs(consensusScore - prev.consensusScore) : 0;
      if (delta > topMoverDelta) {
        topMoverDelta = delta;
        topMover = cap.name;
      }

      const sourceScores = triSources?.map((t, i) => ({
        sourceLabel: `Source ${i + 1}`,
        rawScore: t.rawScore,
        weight: t.weight,
        methodology: "triangulated",
        queriedAt: new Date().toISOString(),
      })) || [{
        sourceLabel: "Seed Data",
        rawScore: cap.benchmarkScore,
        weight: 1.0,
        methodology: "perplexity-seeded",
        queriedAt: new Date().toISOString(),
      }];

      if (persist) {
        if (prev) {
          await db.update(ceiComponentsTable)
            .set({
              consensusScore,
              posteriorVariance,
              ciLow,
              ciHigh,
              confidence,
              velocity,
              economicMultiplier,
              sourceScores,
              updatedAt: new Date(),
            })
            .where(eq(ceiComponentsTable.id, prev.id));
        } else {
          await db.insert(ceiComponentsTable).values({
            capabilityId: cap.id,
            industryId: industry.id,
            consensusScore,
            posteriorVariance,
            ciLow,
            ciHigh,
            confidence,
            velocity,
            economicMultiplier,
            sourceScores,
          });
        }
      }

      if (captureMap) captureMap.set(cap.id, consensusScore);
      leafPosterior.set(cap.id, { consensusScore, confidence, velocity, variance: posteriorVariance });
    }

    // Pass 2: roll up parent capabilities from their children's posteriors.
    // Parents are display-only aggregates and do NOT contribute to the
    // industry index sum (avoid double-counting).
    for (const parent of parentCaps) {
      const childCaps = allCapabilities.filter(c => c.parentCapabilityId === parent.id);
      const childData = childCaps
        .map(c => leafPosterior.get(c.id))
        .filter((d): d is { consensusScore: number; confidence: number; velocity: number; variance: number } => !!d);
      if (childData.length === 0) continue;

      const consensusScore = childData.reduce((s, d) => s + d.consensusScore, 0) / childData.length;
      const dispVariance = childData.reduce((s, d) => s + Math.pow(d.consensusScore - consensusScore, 2), 0) / childData.length;
      const stddev = Math.sqrt(dispVariance);
      // Variance of the mean = (1/n²) × Σ Var(childᵢ).
      const posteriorVariance = childData.reduce((s, d) => s + d.variance, 0) / (childData.length * childData.length);
      const postStd = Math.sqrt(posteriorVariance);
      const ciLow = Math.max(0, consensusScore - Z_95 * postStd);
      const ciHigh = Math.min(100, consensusScore + Z_95 * postStd);
      const avgChildConf = childData.reduce((s, d) => s + d.confidence, 0) / childData.length;
      const confidence = Math.max(0.1, avgChildConf * Math.max(0, 1 - stddev / 50));
      const velocity = childData.reduce((s, d) => s + d.velocity, 0) / childData.length;
      const deps = dependencyCount.get(parent.id) || 0;
      const economicMultiplier = Math.min(MULTIPLIER_CAP, MULTIPLIER_BASE + deps * MULTIPLIER_PER_DEPENDENCY);

      const sourceScores = childCaps
        .filter(c => leafPosterior.has(c.id))
        .map(c => {
          const d = leafPosterior.get(c.id)!;
          return {
            sourceLabel: `child:${c.name}`,
            rawScore: d.consensusScore,
            weight: 1 / childData.length,
            methodology: "rollup_from_children",
            queriedAt: new Date().toISOString(),
          };
        });

      const prevKey = `${industry.id}-${parent.id}`;
      const prev = prevMap.get(prevKey);
      if (persist) {
        if (prev) {
          await db.update(ceiComponentsTable)
            .set({ consensusScore, posteriorVariance, ciLow, ciHigh, confidence, velocity, economicMultiplier, sourceScores, updatedAt: new Date() })
            .where(eq(ceiComponentsTable.id, prev.id));
        } else {
          await db.insert(ceiComponentsTable).values({
            capabilityId: parent.id,
            industryId: industry.id,
            consensusScore,
            posteriorVariance,
            ciLow,
            ciHigh,
            confidence,
            velocity,
            economicMultiplier,
            sourceScores,
          });
        }
      }
      if (captureMap) captureMap.set(parent.id, consensusScore);
    }

    // Industry index uses leaf caps only.
    const denom = leafCaps.length || caps.length;
    const industryIndex = (industryWeightedSum / denom) * CEI_SCALE_FACTOR;
    // Var(industryIndex) = (SCALE/denom)² × Σ Var(contributionᵢ).
    const indexVariance = denom > 0
      ? Math.pow(CEI_SCALE_FACTOR / denom, 2) * industryContribVarSum
      : 0;
    const indexStd = Math.sqrt(indexVariance);
    const industryCiLow = leafCaps.length > 0 ? Math.max(0, industryIndex - Z_95 * indexStd) : null;
    const industryCiHigh = leafCaps.length > 0 ? Math.min(1000, industryIndex + Z_95 * indexStd) : null;
    const avgVelocity = denom > 0
      ? allVelocities.slice(-denom).reduce((s, v) => s + v, 0) / denom
      : 0;

    industryBreakdowns[industry.slug] = {
      industryName: industry.name,
      indexValue: Math.round(industryIndex * 10) / 10,
      ciLow: industryCiLow !== null ? Math.round(industryCiLow * 10) / 10 : null,
      ciHigh: industryCiHigh !== null ? Math.round(industryCiHigh * 10) / 10 : null,
      weight: weightRow ? weightRow.gdpShare : 0,
      weightSourceUrl: weightRow?.sourceUrl ?? null,
      weightSourceYear: weightRow?.sourceYear ?? null,
      velocity: Math.round(avgVelocity * 1000) / 1000,
      capabilityCount: caps.length,
      topMover: topMover || caps[0]?.name || "N/A",
      topMoverDelta: Math.round(topMoverDelta * 10) / 10,
    };

    // Only industries with a Perplexity-cited GDP weight contribute to the
    // overall index. Industries without a weight row are surfaced (with
    // weight=0) but excluded from the rollup — this is the firm rule.
    if (weightRow) {
      overallNumerator += industryIndex * weightRow.gdpShare;
      overallWeightSum += weightRow.gdpShare;
      overallVarNumerator += weightRow.gdpShare * weightRow.gdpShare * indexVariance;
    }
  }

  if (missingWeightIndustries.length > 0) {
    console.warn(
      `[CEI] No Perplexity-cited GDP weight for: ${missingWeightIndustries.join(", ")} ` +
      `— excluded from overall index (run scripts-seed-gdp-weights.mts to add them).`,
    );
  }

  const overallIndex = overallWeightSum > 0
    ? Math.round((overallNumerator / overallWeightSum) * 10) / 10
    : 0;
  // Var(overallIndex) = Σ(wᵢ/Σw)² × Var(industryIndexᵢ).
  const overallVariance = overallWeightSum > 0
    ? overallVarNumerator / (overallWeightSum * overallWeightSum)
    : 0;
  const overallStd = Math.sqrt(overallVariance);
  const overallCiLow = overallWeightSum > 0
    ? Math.max(0, Math.round((overallIndex - Z_95 * overallStd) * 10) / 10)
    : null;
  const overallCiHigh = overallWeightSum > 0
    ? Math.min(1000, Math.round((overallIndex + Z_95 * overallStd) * 10) / 10)
    : null;

  const avgVelocity = allVelocities.length > 0
    ? allVelocities.reduce((s, v) => s + v, 0) / allVelocities.length
    : 0;
  const baseSentiment = 50 + avgVelocity * 100;

  const velocityVariance = allVelocities.length > 1
    ? allVelocities.reduce((s, v) => s + Math.pow(v - avgVelocity, 2), 0) / allVelocities.length
    : 0;
  const baseVolatility = Math.sqrt(velocityVariance);

  let macroShock = { sentimentShock: 0, volatilityBoost: 0, contributingEvents: [] as Array<{ id: number; title: string; severity: number; decayFactor: number; direction: string }> };
  try {
    macroShock = await computeGlobalMacroShock();
  } catch (err) {
    console.warn("[CEI] macro shock unavailable:", err);
  }
  const marketSentiment = Math.max(0, Math.min(100, Math.round((baseSentiment + macroShock.sentimentShock) * 10) / 10));
  const volatility = Math.round((baseVolatility + macroShock.volatilityBoost) * 1000) / 1000;

  const snapshotAt = persist
    ? (await db.insert(ceiSnapshotsTable).values({
        overallIndex,
        overallCiLow,
        overallCiHigh,
        industryBreakdowns,
        marketSentiment,
        volatility,
        methodologyVersion: "1.1",
      }).returning())[0].snapshotAt
    : new Date();

  // Fire subscription evaluation hooks against the just-persisted state.
  // Wrapped in try/catch — alerts must never break the CEI run.
  if (persist && prevCapStates) {
    try {
      await evaluateAfterCEI(prevCapStates);
    } catch (err) {
      console.warn("[CEI] subscription evaluation failed:", err);
    }
  }

  return {
    overallIndex,
    overallCiLow,
    overallCiHigh,
    industryBreakdowns,
    marketSentiment,
    volatility,
    methodology: CEI_METHODOLOGY,
    timestamp: snapshotAt.toISOString(),
    capScores: captureMap ?? undefined,
  };
}

export async function getCEICurrent(): Promise<CEIResult | null> {
  const [latest] = await db
    .select()
    .from(ceiSnapshotsTable)
    .orderBy(desc(ceiSnapshotsTable.snapshotAt))
    .limit(1);

  if (!latest) return null;

  return {
    overallIndex: latest.overallIndex,
    overallCiLow: latest.overallCiLow,
    overallCiHigh: latest.overallCiHigh,
    industryBreakdowns: latest.industryBreakdowns as Record<string, IndustryBreakdown>,
    marketSentiment: latest.marketSentiment || 50,
    volatility: latest.volatility || 0,
    methodology: CEI_METHODOLOGY,
    timestamp: latest.snapshotAt.toISOString(),
  };
}

export async function getCEIHistory(limit = 30): Promise<Array<{
  overallIndex: number;
  overallCiLow: number | null;
  overallCiHigh: number | null;
  timestamp: string;
  industryBreakdowns: Record<string, IndustryBreakdown>;
}>> {
  const snapshots = await db
    .select()
    .from(ceiSnapshotsTable)
    .orderBy(desc(ceiSnapshotsTable.snapshotAt))
    .limit(limit);

  return snapshots.map(s => ({
    overallIndex: s.overallIndex,
    overallCiLow: s.overallCiLow,
    overallCiHigh: s.overallCiHigh,
    timestamp: s.snapshotAt.toISOString(),
    industryBreakdowns: s.industryBreakdowns as Record<string, IndustryBreakdown>,
  }));
}

export const CEI_METHODOLOGY = `## Capability Economics Index (CEI) — Methodology v1.1

### Overview
The CEI is a composite index measuring global capability maturity across industries, inspired by financial market indices but applied to organizational capability economics. Every reported value carries a 95% credible interval (CI) derived from the Bayesian posterior on each capability score.

### Formula
\`\`\`
CEIᵢ      = Σ(Cⱼ × (1 + Vⱼ) × Eⱼ × αⱼ) / nᵢ × Scale          (industry index)
CEI       = Σ(Wᵢ × CEIᵢ) / ΣWᵢ                                (overall index)
Var(CEIᵢ) = (Scale/nᵢ)² × Σ ((1+Vⱼ)·Eⱼ·αⱼ)² × Var(Cⱼ)         (industry variance)
Var(CEI)  = Σ(Wᵢ/ΣW)² × Var(CEIᵢ)                             (overall variance)
CI₉₅      = mean ± 1.96 × √Var
\`\`\`

### Components

**Wᵢ — Industry GDP Weight (Perplexity-cited, no fallback)**
Each industry's weight is the share of nominal world GDP attributable to that
industry, sourced live via Perplexity from the most recent World Bank / IMF /
OECD / IEA publication (or equivalent). Stored in \`industry_gdp_weights\` with
\`source_url\`, \`source_year\`, and the full citation list. Industries without a
cited weight row are EXCLUDED from the overall rollup — there are no editorial
fallback weights.

**Cⱼ — Bayesian Consensus Score (0–100)**
Each capability is scored by querying 4 independent analytical perspectives
through Perplexity:
1. **Consulting Analyst** (30% weight) — McKinsey/BCG/Deloitte frameworks
2. **Market Data Analyst** (30% weight) — Gartner/IDC/Statista adoption metrics
3. **Academic Researcher** (20% weight) — Peer-reviewed CMMI/TDWI models
4. **Industry Practitioner** (20% weight) — CIO surveys and operational benchmarks

Scores are combined under a Gaussian prior (μ=50, σ²=1500). Posterior mean is
the precision-weighted average; posterior variance is 1 / posterior precision.
The 95% CI is mean ± 1.96 × √variance, clamped to [0, 100].

**Vⱼ — Velocity (-0.5 to +0.5)**
Exponential Moving Average of score changes over time. Decay α=0.7.

**Eⱼ — Economic Multiplier (1.0–2.0)**
+0.08 per ontology dependency, capped at 2.0.

**αⱼ — Confidence Factor (0.3–1.0)**
Source agreement factor.

### Variance Propagation
Industry-level variance is the precision-weighted sum of capability-contribution
variances under the local first-order coefficient (1+V)·E·α, scaled by
(Scale/n). Overall variance is the squared-weighted sum of industry variances
normalized by ΣW. This produces tighter CIs as more independent triangulation
sources accumulate per capability.

**Independence caveat.** Aggregate CIs assume capability errors are independent.
In practice the four Perplexity perspectives share an upstream LLM and overlapping
source documents, so residual error is positively correlated. Reported industry
and overall CIs should therefore be treated as a *lower bound* on true uncertainty.

### Scale
Raw scores are multiplied by 10 to produce a 0–1000 index range.

### Market Sentiment
Derived from aggregate velocity: sentiment = 50 + avgVelocity × 100.

### Volatility
Standard deviation of capability velocities. High volatility indicates rapid,
uneven change.`;
