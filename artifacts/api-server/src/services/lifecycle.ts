/**
 * Capability lifecycle stage derivation.
 *
 * Bloomberg-style "what stage is this capability at?" label, computed on
 * read from existing posterior fields (consensusScore, velocity) — never
 * stored, so it can never go stale.
 *
 * Five stages, mapped to a colour palette in the UI chip:
 *
 *   Emerging  – low score, climbing fast (early adopters investing).
 *   Adopted   – mid score, still gaining ground (mainstream wave).
 *   Mature    – high score, low |velocity| (table stakes).
 *   Decaying  – any score, sustained negative velocity (industry-wide drift down).
 *   Obsolete  – low score AND negative velocity (capability is being abandoned).
 *
 * Velocity is the EMA-smoothed score change per period in the engine
 * (range −0.5..+0.5). The thresholds below are deliberately conservative
 * so the stage label is stable across CEI runs and only flips on
 * meaningful, sustained movement.
 */

const VEL_FAST_UP = 0.03;     // EMA velocity above this → "growing fast"
const VEL_FAST_DOWN = -0.03;  // below this → "shrinking"
const VEL_STABLE = 0.015;     // |velocity| under this → "stable"
const SCORE_HIGH = 65;        // ≥ this → mature territory
const SCORE_LOW = 40;         // < this → still emerging
const SCORE_OBSOLETE = 30;    // very low + falling → obsolete

export type LifecycleStage = "emerging" | "adopted" | "mature" | "decaying" | "obsolete";

export interface LifecycleInput {
  /** Posterior consensus score (0-100). May be null when no triangulation exists. */
  consensusScore: number | null;
  /** EMA velocity (-0.5..+0.5). May be null when no prior snapshot exists. */
  velocity: number | null;
  /** Fallback baseline used when consensusScore is null. */
  benchmarkScore: number | null;
}

export function deriveLifecycleStage(input: LifecycleInput): LifecycleStage {
  const score = input.consensusScore ?? input.benchmarkScore ?? 50;
  const velocity = input.velocity ?? 0;

  // Obsolete: low score that is also actively losing ground. Strongest signal,
  // checked first so we don't mis-label a freefall as mere "Decaying".
  if (score < SCORE_OBSOLETE && velocity <= VEL_FAST_DOWN) return "obsolete";

  // Decaying: meaningful negative velocity at any score.
  if (velocity <= VEL_FAST_DOWN) return "decaying";

  // Emerging: still below mainstream adoption but moving up fast.
  if (score < SCORE_LOW && velocity >= VEL_FAST_UP) return "emerging";

  // Mature: high score and stable trajectory (table stakes).
  if (score >= SCORE_HIGH && Math.abs(velocity) < VEL_STABLE) return "mature";

  // Default: adopted — between the extremes.
  return "adopted";
}

/**
 * Helper for batched enrichment in API list endpoints. Accepts a per-cap
 * map of {consensusScore, velocity} (typically built from a single
 * `select() from cvi_components`) and returns a Map<capId, stage>.
 */
export function buildLifecycleMap(
  capabilities: Array<{ id: number; benchmarkScore: number | null }>,
  components: Array<{ capabilityId: number; consensusScore: number | null; velocity: number | null }>,
): Map<number, LifecycleStage> {
  const compByCap = new Map<number, { consensusScore: number | null; velocity: number | null }>();
  for (const c of components) compByCap.set(c.capabilityId, { consensusScore: c.consensusScore, velocity: c.velocity });

  const out = new Map<number, LifecycleStage>();
  for (const cap of capabilities) {
    const c = compByCap.get(cap.id);
    out.set(cap.id, deriveLifecycleStage({
      consensusScore: c?.consensusScore ?? null,
      velocity: c?.velocity ?? null,
      benchmarkScore: cap.benchmarkScore,
    }));
  }
  return out;
}

export const LIFECYCLE_STAGE_DOCS: Record<LifecycleStage, { label: string; description: string }> = {
  emerging: {
    label: "Emerging",
    description: "Low maturity score (<40) but climbing fast (velocity ≥ +0.03). Early adopters are investing; expect rapid score gains.",
  },
  adopted: {
    label: "Adopted",
    description: "Mid-range maturity score with positive or neutral momentum. Mainstream adoption is underway but the capability hasn't reached table-stakes yet.",
  },
  mature: {
    label: "Mature",
    description: "High maturity (≥65) and stable trajectory (|velocity| < 0.015). Table stakes — most leaders already operate at this level.",
  },
  decaying: {
    label: "Decaying",
    description: "Sustained negative velocity (≤ -0.03) at any score. Industry-wide score drift downward — capability is losing relevance or being deprioritised.",
  },
  obsolete: {
    label: "Obsolete",
    description: "Low score (<30) AND falling. Capability is being actively abandoned across the industry.",
  },
};

export const LIFECYCLE_THRESHOLDS = {
  VEL_FAST_UP, VEL_FAST_DOWN, VEL_STABLE, SCORE_HIGH, SCORE_LOW, SCORE_OBSOLETE,
};
