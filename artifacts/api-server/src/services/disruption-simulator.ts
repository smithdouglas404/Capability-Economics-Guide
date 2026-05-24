/**
 * Disruption Simulator — time-axis "what happens over the next 36 months"
 * engine. Sibling to disruption-index.ts (point-in-time DI math); this one
 * forward-projects how a hypothetical disruptive capability replaces one
 * or more incumbents under user-defined adoption + capital + regulatory
 * parameters.
 *
 * Public entry: runSimulation(input) → trajectory + cascade + defender
 * options + crossover month + total $ disrupted.
 *
 * MODEL OVERVIEW
 *
 * For each month t = 0..horizon:
 *
 *   1. Bass diffusion gives raw adoption F(t) ∈ [0, 1]:
 *
 *        F(t) = (1 - e^(-(p+q)t)) / (1 + (q/p) * e^(-(p+q)t))
 *
 *      where p = innovation coefficient, q = imitation coefficient.
 *      Curve preset picks {p, q}; capital tier scales p (more cash → faster
 *      early adoption); regulatory friction delays the curve by N months.
 *
 *   2. Entrant strength is F(t) × 100 (so it fits the 0-100 CVI scale for
 *      direct comparison on the chart).
 *
 *   3. Incumbent CVI compresses as entrant captures share:
 *
 *        incumbent(t) = baseline × (1 - F(t) × substitutionFactor)
 *
 *      substitutionFactor controls how perfectly the entrant replaces
 *      incumbent demand. 1.0 = perfect substitute (every customer who
 *      adopts entrant leaves the incumbent), 0.3 = weak substitute (most
 *      customers still also use the incumbent).
 *
 *   4. Margin compression on the incumbent is modeled as a small extra
 *      decay on incumbent(t) when entrant_share > 0.2, capturing the
 *      reflexive death-spiral where lost-margin → less-investment →
 *      worse-product → more-lost-customers.
 *
 *   5. Cumulative $ disrupted = sum over months of (monthly_incumbent_revenue
 *      × delta_share_lost_this_month). Incumbent revenue is pulled from
 *      capability_alpha.revenue_exposure_mm (or a default if missing).
 *
 *   6. Dependency cascade: at horizon end, walk capability_dependencies for
 *      each target cap and decay dependents by (incumbent_decay × edge_weight
 *      × DEPENDENCY_CASCADE_DAMPING). Surfaces second-order disruption.
 *
 *   7. Crossover month: first t where entrant_strength(t) > incumbent(t).
 *      Null if no crossover in horizon.
 *
 *   8. Defender counterfactuals: re-run the simulation under 3 alternative
 *      defender responses (acquire / build / lobby_regulatory) and report
 *      how each shifts the crossover month + estimated cost.
 *
 * Cost discipline: pure-math, no LLM calls. Each simulation completes in
 * milliseconds. The LLM-driven /from-pitch entry point (commit 3) is a
 * separate one-shot call before invoking this engine.
 */
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityAlphaTable,
  capabilityDependenciesTable,
  cviComponentsTable,
  disruptionEnablingTechTable,
  disruptionPlaybookArchetypesTable,
  type DisruptionPlaybookArchetype,
  type SimulationTrajectoryPoint,
  type SimulationCascadePoint,
  type SimulationDefenderOption,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { scoreCapabilityDisruption, matchPlaybooks } from "./disruption-index";

// ─── Curve presets ──────────────────────────────────────────────────────
//
// Each preset's {p, q} comes from published Bass-diffusion fits in the
// product-management literature. Citations in CLAUDE.md (commit 6).

export type AdoptionCurve = "slow_burn" | "standard_b2b_saas" | "viral_b2c" | "stripe_dev";
export type CapitalTier = "bootstrap" | "seed" | "series_b" | "mega_fund";
export type DefenderResponse = "none" | "acquire" | "build" | "lobby_regulatory";

interface CurveParams { p: number; q: number; description: string }

const CURVE_PRESETS: Record<AdoptionCurve, CurveParams> = {
  slow_burn: { p: 0.001, q: 0.18, description: "PE-style rollup, low innovation coefficient, steady accumulation (Smartsheet → ServiceTitan trajectory)" },
  standard_b2b_saas: { p: 0.003, q: 0.30, description: "Typical enterprise SaaS — modest p, strong imitation once 2-3 reference accounts land" },
  viral_b2c: { p: 0.015, q: 0.40, description: "Marketplace / social product where each user's adoption is visible to peers (Airbnb / Uber S-curve)" },
  stripe_dev: { p: 0.020, q: 0.35, description: "Developer-led bottom-up adoption with public API + great docs (Stripe / Vercel / Linear)" },
};

/** Capital tier multiplier on Bass p (innovation coefficient). More cash
 *  buys early-adopter activation (paid acquisition, founder evangelism). */
const CAPITAL_MULTIPLIER: Record<CapitalTier, number> = {
  bootstrap: 0.6,
  seed: 1.0,
  series_b: 1.6,
  mega_fund: 2.4,
};

const DEPENDENCY_CASCADE_DAMPING = 0.5;
const MARGIN_COMPRESSION_KNEE_SHARE = 0.20;
const MARGIN_COMPRESSION_RATE = 0.15;

// ─── Input + output types ────────────────────────────────────────────────

export interface SimulationInput {
  entrantName: string;
  entrantJtbd: string;
  entrantTechIds: number[];
  targetCapabilityIds: number[];
  adoptionCurve: AdoptionCurve;
  capitalTier: CapitalTier;
  regulatoryFrictionMonths: number;
  horizonMonths: number;
  substitutionFactor: number;
  defenderResponse: DefenderResponse;
  /** Optional override on the inferred incumbent baseline CVI. */
  baselineCviOverride?: number;
}

export interface SimulationResult {
  trajectory: SimulationTrajectoryPoint[];
  cascade: SimulationCascadePoint[];
  defenderOptions: SimulationDefenderOption[];
  crossoverMonth: number | null;
  finalEntrantShare: number;
  totalDollarsDisruptedMm: number;
  /** Snapshot of the input baseline state so the UI can render context. */
  context: {
    targets: Array<{ id: number; name: string; baselineCvi: number; revenueExposureMm: number | null }>;
    techNames: string[];
    curveParams: CurveParams;
    capitalMultiplier: number;
    topPlaybookId: number | null;
    topPlaybookName: string | null;
    topPlaybookSimilarity: number;
  };
}

// ─── Core trajectory math ────────────────────────────────────────────────

/** Bass diffusion F(t) for a single month index, with regulatory friction. */
function bassF(t: number, p: number, q: number, regFriction: number): number {
  const effT = Math.max(0, t - regFriction);
  if (effT <= 0) return 0;
  const exp = Math.exp(-(p + q) * effT);
  const num = 1 - exp;
  const den = 1 + (q / p) * exp;
  return Math.max(0, Math.min(1, num / den));
}

function computeTrajectory(
  baselineCvi: number,
  baselineRevenueMm: number,
  input: SimulationInput,
  overrides?: Partial<{ p: number; q: number; regFrictionMonths: number; substitutionFactor: number; baselineCvi: number; baselineRevenueMm: number }>,
): {
  trajectory: SimulationTrajectoryPoint[];
  crossoverMonth: number | null;
  finalEntrantShare: number;
  totalDollarsDisruptedMm: number;
} {
  const curve = CURVE_PRESETS[input.adoptionCurve];
  const p = (overrides?.p ?? curve.p) * CAPITAL_MULTIPLIER[input.capitalTier];
  const q = overrides?.q ?? curve.q;
  const regFriction = overrides?.regFrictionMonths ?? input.regulatoryFrictionMonths;
  const substitutionFactor = overrides?.substitutionFactor ?? input.substitutionFactor;
  const baseCvi = overrides?.baselineCvi ?? baselineCvi;
  const baseRev = overrides?.baselineRevenueMm ?? baselineRevenueMm;

  const trajectory: SimulationTrajectoryPoint[] = [];
  let crossoverMonth: number | null = null;
  let cumulativeDollars = 0;
  let prevShare = 0;

  for (let m = 0; m <= input.horizonMonths; m++) {
    const F = bassF(m, p, q, regFriction);
    const entrantStrength = F * 100;
    const entrantMarketShare = F;

    // Incumbent decay = baseline × (1 - share × substitution) × margin-compression
    let incumbentCvi = baseCvi * (1 - F * substitutionFactor);
    if (F > MARGIN_COMPRESSION_KNEE_SHARE) {
      const excess = F - MARGIN_COMPRESSION_KNEE_SHARE;
      incumbentCvi *= 1 - excess * MARGIN_COMPRESSION_RATE;
    }
    incumbentCvi = Math.max(0, incumbentCvi);

    // Cumulative dollars: marginal share movement × incumbent's annual revenue / 12.
    const deltaShare = entrantMarketShare - prevShare;
    cumulativeDollars += deltaShare * baseRev;
    prevShare = entrantMarketShare;

    trajectory.push({
      month: m,
      entrantStrength,
      incumbentCvi,
      entrantMarketShare,
      cumulativeDollarsDisruptedMm: Math.round(cumulativeDollars * 10) / 10,
    });

    if (crossoverMonth === null && entrantStrength > incumbentCvi && m > 0) {
      crossoverMonth = m;
    }
  }

  return {
    trajectory,
    crossoverMonth,
    finalEntrantShare: trajectory[trajectory.length - 1].entrantMarketShare,
    totalDollarsDisruptedMm: trajectory[trajectory.length - 1].cumulativeDollarsDisruptedMm,
  };
}

// ─── Defender-response counterfactuals ──────────────────────────────────

function computeDefenderOptions(
  baselineCvi: number,
  baselineRevenueMm: number,
  input: SimulationInput,
): SimulationDefenderOption[] {
  if (input.defenderResponse !== "none") {
    // Already applied to the main run; no need to re-counterfactual.
    return [];
  }
  const opts: SimulationDefenderOption[] = [];

  // 1. Acquire — buys the entrant. Crossover pushed to "never" (in scope of
  //    this incumbent's run), but cost is a function of the entrant's
  //    projected share at acquisition time (assumed month 9).
  {
    const acquireMonth = 9;
    const shareAtAcquire = bassF(acquireMonth, CURVE_PRESETS[input.adoptionCurve].p * CAPITAL_MULTIPLIER[input.capitalTier], CURVE_PRESETS[input.adoptionCurve].q, input.regulatoryFrictionMonths);
    const estimatedRevenue = shareAtAcquire * baselineRevenueMm;
    // Typical acquisition multiple: 10x ARR for a high-growth disruptor.
    const estimatedCostMm = Math.round(estimatedRevenue * 10);
    opts.push({
      action: "acquire",
      description: `Acquire the entrant at month ~${acquireMonth} (~${(shareAtAcquire * 100).toFixed(1)}% share). Eliminates crossover entirely. Cost = ~10× projected ARR.`,
      newCrossoverMonth: null,
      estimatedCostUsdMm: estimatedCostMm,
    });
  }

  // 2. Build — the incumbent rebuilds the entrant's stack themselves.
  //    Modeled as an 18-month delay on the entrant's adoption curve (the
  //    incumbent's competing product slows entrant's adoption) BUT cost
  //    is high because the incumbent has to staff/build it.
  {
    const r = computeTrajectory(baselineCvi, baselineRevenueMm, input, { regFrictionMonths: input.regulatoryFrictionMonths + 18 });
    opts.push({
      action: "build",
      description: "Build the entrant's stack in-house. Delays adoption ~18 months but requires sustained ~$50-100MM/year capex over 3 years.",
      newCrossoverMonth: r.crossoverMonth,
      estimatedCostUsdMm: 200, // 3 × ~$70MM/yr
    });
  }

  // 3. Lobby for regulation — adds regulatory friction. Cheap in cash but
  //    only delays the inevitable.
  {
    const r = computeTrajectory(baselineCvi, baselineRevenueMm, input, { regFrictionMonths: input.regulatoryFrictionMonths + 12 });
    opts.push({
      action: "lobby_regulatory",
      description: "Lobby regulators to slow the entrant via licensing / safety / consumer-protection rules. Adds ~12 months of friction. Cheap in cash but reputationally costly.",
      newCrossoverMonth: r.crossoverMonth,
      estimatedCostUsdMm: 10,
    });
  }

  return opts;
}

// ─── Public entry ────────────────────────────────────────────────────────

export async function runSimulation(input: SimulationInput): Promise<SimulationResult> {
  if (input.targetCapabilityIds.length === 0) {
    throw new Error("targetCapabilityIds must include at least one incumbent capability");
  }
  if (input.horizonMonths < 1 || input.horizonMonths > 60) {
    throw new Error("horizonMonths must be between 1 and 60");
  }

  // Load incumbent baselines.
  const targets = await db
    .select({
      id: capabilitiesTable.id,
      name: capabilitiesTable.name,
      benchmarkScore: capabilitiesTable.benchmarkScore,
      industryId: capabilitiesTable.industryId,
    })
    .from(capabilitiesTable)
    .where(inArray(capabilitiesTable.id, input.targetCapabilityIds));

  if (targets.length === 0) {
    throw new Error("No target capabilities found");
  }

  // Pull each target's live CVI (from cviComponents) + revenue exposure (from capabilityAlpha).
  const cvis = await db
    .select({
      capabilityId: cviComponentsTable.capabilityId,
      consensusScore: cviComponentsTable.consensusScore,
    })
    .from(cviComponentsTable)
    .where(inArray(cviComponentsTable.capabilityId, input.targetCapabilityIds));
  const cviByCap = new Map(cvis.map((c) => [c.capabilityId, c.consensusScore]));

  const alphas = await db
    .select({
      capabilityId: capabilityAlphaTable.capabilityId,
      revenueExposureMm: capabilityAlphaTable.revenueExposureMm,
    })
    .from(capabilityAlphaTable)
    .where(inArray(capabilityAlphaTable.capabilityId, input.targetCapabilityIds));
  const revByCap = new Map(alphas.map((a) => [a.capabilityId, a.revenueExposureMm]));

  // Aggregate: simulate against the AVERAGE of selected targets' CVIs +
  // SUM of revenue exposures (treating multi-target as the combined market).
  const targetSummary = targets.map((t) => ({
    id: t.id,
    name: t.name,
    baselineCvi: input.baselineCviOverride ?? cviByCap.get(t.id) ?? t.benchmarkScore ?? 50,
    revenueExposureMm: revByCap.get(t.id) ?? null,
  }));
  const aggregateBaselineCvi = targetSummary.reduce((s, t) => s + t.baselineCvi, 0) / targetSummary.length;
  const aggregateRevenueMm = targetSummary.reduce((s, t) => s + (t.revenueExposureMm ?? 100), 0); // default $100MM/cap if unknown

  // Tech names for display.
  const techRows = input.entrantTechIds.length > 0
    ? await db.select({ id: disruptionEnablingTechTable.id, name: disruptionEnablingTechTable.name }).from(disruptionEnablingTechTable).where(inArray(disruptionEnablingTechTable.id, input.entrantTechIds))
    : [];

  // Compute primary trajectory.
  let primary = computeTrajectory(aggregateBaselineCvi, aggregateRevenueMm, input);

  // If user picked a defender response, fold it into the primary run.
  if (input.defenderResponse === "build") {
    primary = computeTrajectory(aggregateBaselineCvi, aggregateRevenueMm, input, { regFrictionMonths: input.regulatoryFrictionMonths + 18 });
  } else if (input.defenderResponse === "lobby_regulatory") {
    primary = computeTrajectory(aggregateBaselineCvi, aggregateRevenueMm, input, { regFrictionMonths: input.regulatoryFrictionMonths + 12 });
  } else if (input.defenderResponse === "acquire") {
    // Acquire short-circuits the run — entrant is absorbed at month 9, trajectory flattens after.
    const baseRun = computeTrajectory(aggregateBaselineCvi, aggregateRevenueMm, input);
    const acquireMonth = 9;
    primary = {
      trajectory: baseRun.trajectory.map((p) => p.month <= acquireMonth ? p : {
        ...p,
        entrantStrength: baseRun.trajectory[acquireMonth].entrantStrength,
        incumbentCvi: aggregateBaselineCvi,
        entrantMarketShare: baseRun.trajectory[acquireMonth].entrantMarketShare,
        cumulativeDollarsDisruptedMm: baseRun.trajectory[acquireMonth].cumulativeDollarsDisruptedMm,
      }),
      crossoverMonth: null,
      finalEntrantShare: baseRun.trajectory[acquireMonth].entrantMarketShare,
      totalDollarsDisruptedMm: baseRun.trajectory[acquireMonth].cumulativeDollarsDisruptedMm,
    };
  }

  // Defender counterfactuals (only when input is "none" — otherwise the
  // current run already IS a defender response).
  const defenderOptions = computeDefenderOptions(aggregateBaselineCvi, aggregateRevenueMm, input);

  // Dependency cascade — walk each target's downstream and project the
  // dependent caps' CVI shift at horizon end. Damped by edge weight.
  const cascade = await computeDependencyCascade(input.targetCapabilityIds, aggregateBaselineCvi, primary.trajectory[primary.trajectory.length - 1].incumbentCvi);

  // Playbook match — score the entrant as a synthetic DI scenario against
  // the FIRST target capability (proxy for the entrant), then match to
  // archetypes. Reuses scoreCapabilityDisruption with the applied-tech
  // override hook.
  let topPlaybook: DisruptionPlaybookArchetype | null = null;
  let topSimilarity = 0;
  try {
    const proxyScore = await scoreCapabilityDisruption(input.targetCapabilityIds[0], { appliedTechIds: input.entrantTechIds, llmFreeMode: true });
    if (proxyScore) {
      const archetypes = await db.select().from(disruptionPlaybookArchetypesTable);
      const matches = matchPlaybooks(proxyScore.subscores, archetypes);
      if (matches.length > 0) {
        const top = matches[0];
        topPlaybook = archetypes.find((a) => a.id === top.playbookId) ?? null;
        topSimilarity = top.similarity;
      }
    }
  } catch {
    /* Playbook match is informational — failure shouldn't block the simulation. */
  }

  return {
    trajectory: primary.trajectory,
    cascade,
    defenderOptions,
    crossoverMonth: primary.crossoverMonth,
    finalEntrantShare: primary.finalEntrantShare,
    totalDollarsDisruptedMm: primary.totalDollarsDisruptedMm,
    context: {
      targets: targetSummary,
      techNames: techRows.map((t) => t.name),
      curveParams: CURVE_PRESETS[input.adoptionCurve],
      capitalMultiplier: CAPITAL_MULTIPLIER[input.capitalTier],
      topPlaybookId: topPlaybook?.id ?? null,
      topPlaybookName: topPlaybook?.name ?? null,
      topPlaybookSimilarity: topSimilarity,
    },
  };
}

async function computeDependencyCascade(
  targetCapIds: number[],
  baselineIncumbentCvi: number,
  finalIncumbentCvi: number,
): Promise<SimulationCascadePoint[]> {
  // Decay magnitude on the incumbent at horizon end.
  const decayPct = baselineIncumbentCvi > 0 ? (baselineIncumbentCvi - finalIncumbentCvi) / baselineIncumbentCvi : 0;
  if (decayPct <= 0) return [];

  // Find dependents — capabilities that depend on any of the target caps.
  const depRows = await db
    .select({
      capabilityId: capabilityDependenciesTable.capabilityId,
      dependsOnId: capabilityDependenciesTable.dependsOnId,
      strength: capabilityDependenciesTable.strength,
    })
    .from(capabilityDependenciesTable)
    .where(inArray(capabilityDependenciesTable.dependsOnId, targetCapIds));

  if (depRows.length === 0) return [];

  // Hydrate dependent cap names + baselines.
  const dependentIds = Array.from(new Set(depRows.map((r) => r.capabilityId)));
  const depCaps = await db
    .select({ id: capabilitiesTable.id, name: capabilitiesTable.name, benchmarkScore: capabilitiesTable.benchmarkScore })
    .from(capabilitiesTable)
    .where(inArray(capabilitiesTable.id, dependentIds));
  const depCviRows = await db
    .select({ capabilityId: cviComponentsTable.capabilityId, consensusScore: cviComponentsTable.consensusScore })
    .from(cviComponentsTable)
    .where(inArray(cviComponentsTable.capabilityId, dependentIds));
  const depCviByCap = new Map(depCviRows.map((r) => [r.capabilityId, r.consensusScore]));

  // Map text strength → numeric weight 0..1.
  const STRENGTH_WEIGHT: Record<string, number> = { weak: 0.25, moderate: 0.5, strong: 0.8, critical: 1.0 };
  // For each dependent, find its strongest dependency on a target.
  const strongestEdge = new Map<number, number>();
  for (const e of depRows) {
    const w = STRENGTH_WEIGHT[e.strength ?? "moderate"] ?? 0.5;
    const prev = strongestEdge.get(e.capabilityId) ?? 0;
    if (w > prev) strongestEdge.set(e.capabilityId, w);
  }

  return depCaps.flatMap((c) => {
    const baseline = depCviByCap.get(c.id) ?? c.benchmarkScore ?? 50;
    const edge = strongestEdge.get(c.id) ?? 0.5;
    const finalCvi = Math.max(0, baseline * (1 - decayPct * edge * DEPENDENCY_CASCADE_DAMPING));
    const deltaPct = baseline > 0 ? ((finalCvi - baseline) / baseline) * 100 : 0;
    if (Math.abs(deltaPct) < 0.5) return []; // ignore micro-shifts
    return [{
      capabilityId: c.id,
      capabilityName: c.name,
      baselineCvi: baseline,
      finalCvi,
      deltaPct: Math.round(deltaPct * 10) / 10,
    }];
  }).sort((a, b) => a.deltaPct - b.deltaPct);
}

export const SIMULATOR_CURVES = CURVE_PRESETS;
export const SIMULATOR_CAPITAL = CAPITAL_MULTIPLIER;
