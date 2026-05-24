/**
 * Capability Disruption Index — scoring engine.
 *
 * Given a capability id (and optional alt-stack of enabling tech ids from
 * the /disruption-lab), computes:
 *
 *   - 6 sub-scores (asset_friction, jtbd_abstractability, enabling_tech_strength,
 *     trust_replaceability, latent_supply_multiplier, margin_asymmetry)
 *   - composite DI score (weighted sum)
 *   - top-3 enabling techs that most contribute
 *   - cosine similarity against all 8 archetypes → top playbook match
 *   - rationale + cited evidence per sub-score
 *
 * Splits responsibility:
 *   - assetFriction + marginAsymmetry: pure DB queries + arithmetic (no LLM)
 *   - jtbdAbstractability + enablingTechStrength + trustReplaceability +
 *     latentSupplyMultiplier: single batched Claude call returning all four
 *     scores + rationale + top-3 enabling tech picks (one LLM round-trip
 *     per cap instead of four)
 *   - Composite + cosine matching: pure math, deterministic
 *
 * The narrative generator is a separate module (commit 5,
 * services/disruption-narrative.ts) so this file stays focused on numbers.
 */
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityAlphaTable,
  industriesTable,
  regulationCapabilityRequirementsTable,
  disruptionEnablingTechTable,
  disruptionPlaybookArchetypesTable,
  type DisruptionSubscoreProfile,
  type DisruptionEnablingTech,
  type DisruptionPlaybookArchetype,
} from "@workspace/db";
import { eq, sql, inArray } from "drizzle-orm";
import { chatWithFallback } from "./llm-fallback";
import { logger } from "../lib/logger";

const SONNET = "anthropic/claude-sonnet-4.6";
const HAIKU = "anthropic/claude-haiku-4.5";

/**
 * Sub-score weights for the composite DI. Tuned to historical disruption
 * fingerprints: capabilities with high asset_friction + enabling_tech +
 * supply expansion historically disrupted faster than ones where margin
 * asymmetry dominated alone. Sum to 1.0.
 *
 * Backtest in commit 4-onwards: validate these weights against the
 * archetype profile vectors — Uber's profile, scored, should land DI in
 * the 85-95 range; Netflix lower; legacy tax-prep higher than legacy
 * pharma manufacturing.
 */
export const DI_WEIGHTS: Record<keyof DisruptionSubscoreProfile, number> = {
  assetFriction: 0.20,
  jtbdAbstractability: 0.15,
  enablingTechStrength: 0.25,
  trustReplaceability: 0.15,
  latentSupplyMultiplier: 0.15,
  marginAsymmetry: 0.10,
};

export interface SubscoreEvidence {
  value: number;
  rationale: string;
  sources: Array<{ label: string; url?: string }>;
}

export interface DisruptionScoreResult {
  capabilityId: number;
  subscores: DisruptionSubscoreProfile;
  compositeDi: number;
  rationale: Record<keyof DisruptionSubscoreProfile, SubscoreEvidence>;
  topPlaybookId: number | null;
  topPlaybookSimilarity: number;
  topPlaybookName: string | null;
  playbookSimilarities: Array<{ playbookId: number; slug: string; name: string; similarity: number }>;
  topEnablingTechIds: number[];
  topEnablingTech: Array<{ id: number; slug: string; name: string; weight: number }>;
}

export interface DisruptionScoreOptions {
  /**
   * Override the inferred enabling-tech set with an explicit list — used by
   * the lab's "what if I apply LLM + mobile + ratings to this cap" mode.
   * When provided, enabling_tech_strength + topEnablingTech reflect the
   * override, and the LLM is asked to score AS IF those techs were applied.
   */
  appliedTechIds?: number[];
  /** Limit which model is used. Defaults to Sonnet (overridable via env LLM_MODEL). */
  model?: string;
  /** Skip the LLM call and use deterministic heuristics only (cheap, lower fidelity). Useful for batch backfill. */
  llmFreeMode?: boolean;
}

// ─── Composite + cosine math ─────────────────────────────────────────────

export function computeComposite(subscores: DisruptionSubscoreProfile): number {
  let sum = 0;
  for (const key of Object.keys(DI_WEIGHTS) as Array<keyof DisruptionSubscoreProfile>) {
    sum += (subscores[key] ?? 0) * DI_WEIGHTS[key];
  }
  return Math.max(0, Math.min(100, sum));
}

/**
 * Pattern similarity — Pearson correlation on the 6-dim sub-score vector.
 * Returns 0..1.
 *
 * Why not pure cosine: cosine on raw magnitudes gives every archetype 0.9+
 * for any moderately-disruptable capability — when all sub-scores are
 * elevated, every vector looks the same. The "top match" became a noisy
 * race where #1 was only 1-2 pts ahead of #5.
 *
 * Pearson correlation matches the SHAPE of the vector — how each cap
 * sub-score deviates from its mean, against how each archetype sub-score
 * deviates from ITS mean. A cap matches Uber only when its profile spikes
 * on the same dimensions Uber's profile spikes on (latent supply +
 * asset friction), regardless of how high the magnitudes are overall.
 * Result: top match is meaningfully #1, archetype with a uniform profile
 * stops matching every cap, and the lab "what if I add this tech" mode
 * produces sharper playbook shifts when the techs only move 1-2 sub-scores.
 *
 * Output is clamped to [0, 1] by mapping the [-1, 1] correlation through
 * (r + 1) / 2 so the UI's "0-100% similarity" framing still reads
 * sensibly (-1 perfect-opposite → 0%, 0 unrelated → 50%, +1 perfect → 100%).
 * For most archetype-vs-cap comparisons r is positive; mapping is just an
 * insurance policy against negative-correlation surprises.
 */
export function cosineSimilarity(a: DisruptionSubscoreProfile, b: DisruptionSubscoreProfile): number {
  const keys = Object.keys(DI_WEIGHTS) as Array<keyof DisruptionSubscoreProfile>;
  let sumA = 0, sumB = 0;
  for (const k of keys) { sumA += a[k] ?? 0; sumB += b[k] ?? 0; }
  const meanA = sumA / keys.length;
  const meanB = sumB / keys.length;

  let num = 0, denA = 0, denB = 0;
  for (const k of keys) {
    const da = (a[k] ?? 0) - meanA;
    const db = (b[k] ?? 0) - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  if (denA === 0 || denB === 0) return 0.5; // degenerate (flat vector) → neutral
  const r = num / (Math.sqrt(denA) * Math.sqrt(denB));
  // Map [-1, 1] → [0, 1] so the UI's "% similarity" framing still works.
  return Math.max(0, Math.min(1, (r + 1) / 2));
}

/** Match a sub-score vector against every loaded archetype, returning sorted similarities. */
export function matchPlaybooks(
  subscores: DisruptionSubscoreProfile,
  archetypes: DisruptionPlaybookArchetype[],
): Array<{ playbookId: number; slug: string; name: string; similarity: number }> {
  return archetypes
    .map((a) => ({
      playbookId: a.id,
      slug: a.slug,
      name: a.name,
      similarity: cosineSimilarity(subscores, a.subscoreProfile),
    }))
    .sort((x, y) => y.similarity - x.similarity);
}

// ─── Deterministic sub-scores (no LLM) ───────────────────────────────────

/**
 * Asset friction: how much of the capability is locked behind physical
 * assets, regulation, capital, or licensed labor. Pure DB + heuristics.
 *
 *   30% from capex intensity (capability_alpha.capex_intensity, mapped to 0-100)
 *   40% from regulatory requirement count (regulation_capability_requirements)
 *   30% from license/cert keywords in capability description
 */
async function computeAssetFriction(capabilityId: number, capabilityDescription: string): Promise<SubscoreEvidence> {
  const [alpha] = await db.select().from(capabilityAlphaTable).where(eq(capabilityAlphaTable.capabilityId, capabilityId)).limit(1);
  // Proxy for capex intensity from existing enriched data: use revenueExposureMm
  // as a rough asset-base signal (higher exposure → more asset commitment), and
  // halfLifeMonths inversely (long-half-life capabilities have entrenched assets).
  const revExposure = alpha?.revenueExposureMm ?? null;
  const halfLife = alpha?.halfLifeMonths ?? null;
  let capexScore = 50; // default midpoint
  let capexEvidence = "No alpha enrichment yet — defaulting capex proxy to midpoint";
  if (revExposure !== null || halfLife !== null) {
    // Map revenue exposure: <$10M → 30, $10-100M → 55, $100M-1B → 75, >$1B → 90
    const rs = revExposure === null ? 50 : revExposure < 10 ? 30 : revExposure < 100 ? 55 : revExposure < 1000 ? 75 : 90;
    // Map half-life: >120mo → 90, 60-120mo → 70, 24-60mo → 50, <24mo → 30
    const hs = halfLife === null ? 50 : halfLife > 120 ? 90 : halfLife > 60 ? 70 : halfLife > 24 ? 50 : 30;
    capexScore = Math.round((rs + hs) / 2);
    capexEvidence = `Capex proxy from revenue_exposure=${revExposure?.toFixed(1) ?? "?"}MM + half_life=${halfLife?.toFixed(0) ?? "?"}mo → ${capexScore}`;
  }

  const regs = await db
    .select({ id: regulationCapabilityRequirementsTable.id })
    .from(regulationCapabilityRequirementsTable)
    .where(eq(regulationCapabilityRequirementsTable.capabilityId, capabilityId));
  const regCount = regs.length;
  // 0 regs → 20, 1-2 → 50, 3-5 → 75, 6+ → 95
  const regScore = regCount === 0 ? 20 : regCount <= 2 ? 50 : regCount <= 5 ? 75 : 95;

  const desc = (capabilityDescription || "").toLowerCase();
  const licenseHits = [
    /\blicensed?\b/.test(desc),
    /\bcertif(ied|ication)\b/.test(desc),
    /\bcredentialed?\b/.test(desc),
    /\baccredit/.test(desc),
    /\bnotari/.test(desc),
    /\bsworn\b/.test(desc),
    /\bregistered\b/.test(desc) && (desc.includes("agent") || desc.includes("nurse") || desc.includes("broker")),
  ].filter(Boolean).length;
  const licenseScore = Math.min(100, licenseHits * 25);

  const value = Math.round(capexScore * 0.3 + regScore * 0.4 + licenseScore * 0.3);
  return {
    value,
    rationale: `${capexEvidence}. ${regCount} regulatory requirement(s) mapped to this capability. License/cert keywords detected in description: ${licenseHits}.`,
    sources: [
      { label: "capability_alpha.capex_intensity" },
      { label: `regulation_capability_requirements (count=${regCount})` },
      { label: "capability.description keyword scan" },
    ],
  };
}

/**
 * Margin asymmetry: gap between incumbent margin (capability_alpha) and a
 * canonical software-disruptor margin (60%). Pure arithmetic.
 */
async function computeMarginAsymmetry(capabilityId: number): Promise<SubscoreEvidence> {
  const [alpha] = await db.select().from(capabilityAlphaTable).where(eq(capabilityAlphaTable.capabilityId, capabilityId)).limit(1);
  const incumbentMargin = alpha?.marginStructurePct ?? null;
  if (incumbentMargin === null) {
    return {
      value: 50,
      rationale: "Margin structure not yet enriched — defaulting to midpoint asymmetry",
      sources: [{ label: "capability_alpha.margin_structure_pct (null)" }],
    };
  }
  const softwareMargin = 60;
  const gap = Math.max(0, softwareMargin - incumbentMargin); // larger gap = more asymmetric
  const value = Math.min(100, Math.round(gap * 1.5)); // 40pt gap → 60, 60pt gap → 90
  return {
    value,
    rationale: `Incumbent margin structure ${incumbentMargin.toFixed(1)}%; canonical software-disruptor margin target ${softwareMargin}%; gap ${gap.toFixed(1)}pt.`,
    sources: [
      { label: `capability_alpha.margin_structure_pct (${incumbentMargin.toFixed(1)}%)` },
      { label: "Reference: software-disruptor 60% margin baseline" },
    ],
  };
}

// ─── LLM-scored sub-scores (batched in one call) ─────────────────────────

interface LlmSubscoresResult {
  jtbdAbstractability: SubscoreEvidence;
  enablingTechStrength: SubscoreEvidence;
  trustReplaceability: SubscoreEvidence;
  latentSupplyMultiplier: SubscoreEvidence;
  /** Top-3 enabling tech ids picked from the catalog. Empty when llmFreeMode. */
  topEnablingTechIds: number[];
  /** Optional supply-multiplier estimate (2x, 10x, 100x) for the rationale string. */
  supplyMultiplierEstimate?: string;
}

async function computeLlmSubscores(
  capabilityName: string,
  capabilityDescription: string,
  industryName: string,
  enablingTechCatalog: DisruptionEnablingTech[],
  appliedTechIds: number[] | undefined,
  modelOverride: string | undefined,
): Promise<LlmSubscoresResult> {
  // Construct the catalog menu the LLM picks from.
  const catalogMenu = enablingTechCatalog
    .map((t) => `  [${t.id}] ${t.name} — ${t.category} — mature since ${t.maturityYear}`)
    .join("\n");

  const appliedTech = appliedTechIds && appliedTechIds.length > 0
    ? enablingTechCatalog.filter((t) => appliedTechIds.includes(t.id))
    : null;

  const appliedTechBlock = appliedTech && appliedTech.length > 0
    ? `\n\nThe user is exploring a scenario where these specific enabling technologies are applied to the capability:\n${appliedTech.map((t) => `  - ${t.name} (${t.category}, mature ${t.maturityYear})`).join("\n")}\n\nScore enabling_tech_strength + top-3 picks AS IF these techs were applied. (Other sub-scores stay grounded in the cap's underlying characteristics.)`
    : "";

  const system = `You are an analyst scoring the "Capability Disruption Index" for the Inflexcvi platform. The DI predicts how disruptable a capability is — i.e., how likely a new entrant could obviate the incumbent. You score 4 of the 6 sub-scores; the other 2 (asset_friction, margin_asymmetry) are computed deterministically from DB data.

Return ONLY valid JSON. No prose outside the JSON.`;

  const user = `## Capability under analysis
**Name:** ${capabilityName}
**Industry:** ${industryName}
**Description:** ${capabilityDescription}${appliedTechBlock}

## Enabling-tech catalog (pick the 3 most directly applicable)
${catalogMenu}

## Sub-scores to compute (each 0-100)

1. **jtbd_abstractability** — How cleanly can this capability be reframed as a Job-To-Be-Done that doesn't require its current implementation? (E.g., "Manage hotel housekeeping" → "Have a clean room when guests arrive" scores high. "Fly a fighter jet" → "Project air power" scores lower.) Higher = the implementation is incidental to the job.

2. **enabling_tech_strength** — How strong are the catalog technologies' ability to obviate this capability's current friction? Weight by maturity (mature longer = less remaining disruption headroom). 0 = no catalog tech helps; 100 = multiple recently-mature techs each directly obviate the cap.

3. **trust_replaceability** — The current capability establishes trust via regulation / brand / certification / professional licensure. How readily can software trust mechanisms (ratings, escrow, ID verification, algorithmic ranking) replace that? 0 = trust is regulatory and won't move (drug approval, weapons systems); 100 = brand/medallion gatekeeping that ratings already replaced in adjacent industries.

4. **latent_supply_multiplier** — If gatekeeping (medallions, licenses, real estate, capital) were removed, by what factor could supply expand? Estimate a multiplier (2x, 5x, 10x, 50x, 100x). Convert to 0-100: 2x→20, 5x→40, 10x→60, 50x→85, 100x+→95.

## Output format
\`\`\`json
{
  "jtbd_abstractability": { "value": 75, "rationale": "1-2 sentence explanation", "supplyMultiplier": "10x" },
  "enabling_tech_strength": { "value": 80, "rationale": "1-2 sentence explanation grounded in named techs from the catalog" },
  "trust_replaceability": { "value": 60, "rationale": "1-2 sentence explanation" },
  "latent_supply_multiplier": { "value": 60, "rationale": "1-2 sentence explanation including the estimated multiplier" },
  "top_enabling_tech_ids": [12, 4, 1]
}
\`\`\`

The 3 ids in top_enabling_tech_ids MUST be from the catalog above, sorted by relevance (most impactful first).`;

  const result = await chatWithFallback({
    models: [modelOverride ?? SONNET, HAIKU],
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    responseFormat: { type: "json_object" },
    maxTokens: 1200,
    endpoint: "disruption_index:subscores",
  });

  let parsed: {
    jtbd_abstractability?: { value?: number; rationale?: string };
    enabling_tech_strength?: { value?: number; rationale?: string };
    trust_replaceability?: { value?: number; rationale?: string };
    latent_supply_multiplier?: { value?: number; rationale?: string; supplyMultiplier?: string };
    top_enabling_tech_ids?: number[];
  };
  try {
    // Strip ```json fences if the model added them despite responseFormat.
    const clean = result.text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    parsed = JSON.parse(clean);
  } catch (err) {
    logger.warn({ err, text: result.text.slice(0, 200) }, "[disruption-index] LLM returned non-JSON, using fallback scores");
    parsed = {};
  }

  const clamp = (n: number | undefined, dflt = 50) => Math.max(0, Math.min(100, Math.round(n ?? dflt)));
  const techCatalogIds = new Set(enablingTechCatalog.map((t) => t.id));
  const topIds = (parsed.top_enabling_tech_ids ?? []).filter((id) => techCatalogIds.has(id)).slice(0, 3);

  return {
    jtbdAbstractability: {
      value: clamp(parsed.jtbd_abstractability?.value),
      rationale: parsed.jtbd_abstractability?.rationale ?? "Score from disruption-index LLM analyst (no rationale returned).",
      sources: [{ label: `LLM analyst (${result.modelUsed})` }],
    },
    enablingTechStrength: {
      value: clamp(parsed.enabling_tech_strength?.value),
      rationale: parsed.enabling_tech_strength?.rationale ?? "Score from disruption-index LLM analyst.",
      sources: [
        { label: `LLM analyst (${result.modelUsed})` },
        ...topIds.map((id) => {
          const t = enablingTechCatalog.find((x) => x.id === id);
          return { label: `disruption_enabling_tech: ${t?.name ?? `#${id}`}` };
        }),
      ],
    },
    trustReplaceability: {
      value: clamp(parsed.trust_replaceability?.value),
      rationale: parsed.trust_replaceability?.rationale ?? "Score from disruption-index LLM analyst.",
      sources: [{ label: `LLM analyst (${result.modelUsed})` }],
    },
    latentSupplyMultiplier: {
      value: clamp(parsed.latent_supply_multiplier?.value),
      rationale: parsed.latent_supply_multiplier?.rationale ?? "Score from disruption-index LLM analyst.",
      sources: [{ label: `LLM analyst (${result.modelUsed})` }],
    },
    topEnablingTechIds: topIds,
    supplyMultiplierEstimate: parsed.latent_supply_multiplier?.supplyMultiplier,
  };
}

// ─── Public entry point ──────────────────────────────────────────────────

export async function scoreCapabilityDisruption(
  capabilityId: number,
  opts: DisruptionScoreOptions = {},
): Promise<DisruptionScoreResult | null> {
  const [cap] = await db
    .select({
      id: capabilitiesTable.id,
      name: capabilitiesTable.name,
      description: capabilitiesTable.description,
      industryId: capabilitiesTable.industryId,
    })
    .from(capabilitiesTable)
    .where(eq(capabilitiesTable.id, capabilityId))
    .limit(1);
  if (!cap) return null;

  const [industry] = await db
    .select({ name: industriesTable.name })
    .from(industriesTable)
    .where(eq(industriesTable.id, cap.industryId))
    .limit(1);

  // Load catalogs in parallel.
  const [enablingTechCatalog, archetypes, assetFriction, marginAsymmetry] = await Promise.all([
    db.select().from(disruptionEnablingTechTable),
    db.select().from(disruptionPlaybookArchetypesTable),
    computeAssetFriction(capabilityId, cap.description ?? ""),
    computeMarginAsymmetry(capabilityId),
  ]);

  if (enablingTechCatalog.length === 0) {
    throw new Error("Enabling-tech catalog is empty — run /api/admin/seed/disruption-enabling-tech first");
  }
  if (archetypes.length === 0) {
    throw new Error("Playbook archetypes table is empty — run /api/admin/seed/disruption-archetypes first");
  }

  // LLM-batched 4 sub-scores + top-3 enabling tech picks.
  const llm = opts.llmFreeMode
    ? heuristicLlmFreeFallback(enablingTechCatalog, opts.appliedTechIds)
    : await computeLlmSubscores(
        cap.name,
        cap.description ?? "",
        industry?.name ?? "Unknown industry",
        enablingTechCatalog,
        opts.appliedTechIds,
        opts.model,
      );

  const subscores: DisruptionSubscoreProfile = {
    assetFriction: assetFriction.value,
    jtbdAbstractability: llm.jtbdAbstractability.value,
    enablingTechStrength: llm.enablingTechStrength.value,
    trustReplaceability: llm.trustReplaceability.value,
    latentSupplyMultiplier: llm.latentSupplyMultiplier.value,
    marginAsymmetry: marginAsymmetry.value,
  };
  const compositeDi = computeComposite(subscores);

  const playbookSimilarities = matchPlaybooks(subscores, archetypes);
  const top = playbookSimilarities[0] ?? null;

  // If user supplied appliedTechIds, those override the LLM's top-3 picks.
  const topEnablingTechIds = opts.appliedTechIds && opts.appliedTechIds.length > 0
    ? opts.appliedTechIds.slice(0, 3)
    : llm.topEnablingTechIds;

  const topEnablingTech = topEnablingTechIds.flatMap((id) => {
    const t = enablingTechCatalog.find((x) => x.id === id);
    if (!t) return [];
    // Maturity weight: more recently mature tech weighs higher (more remaining disruption headroom).
    const yearsSince = Math.max(0, new Date().getUTCFullYear() - t.maturityYear);
    const weight = Math.max(0.3, 1.0 - yearsSince * 0.06);
    return [{ id: t.id, slug: t.slug, name: t.name, weight: Math.round(weight * 100) / 100 }];
  });

  return {
    capabilityId,
    subscores,
    compositeDi,
    rationale: {
      assetFriction,
      jtbdAbstractability: llm.jtbdAbstractability,
      enablingTechStrength: llm.enablingTechStrength,
      trustReplaceability: llm.trustReplaceability,
      latentSupplyMultiplier: llm.latentSupplyMultiplier,
      marginAsymmetry,
    },
    topPlaybookId: top?.playbookId ?? null,
    topPlaybookSimilarity: top?.similarity ?? 0,
    topPlaybookName: top?.name ?? null,
    playbookSimilarities,
    topEnablingTechIds,
    topEnablingTech,
  };
}

/**
 * Cheap deterministic fallback when llmFreeMode=true. Picks the 3
 * most-recently-mature catalog techs as the "applicable" set; assigns
 * mid-range scores; used for fast batch backfill before LLM-grade
 * scoring rolls through.
 */
function heuristicLlmFreeFallback(
  catalog: DisruptionEnablingTech[],
  appliedTechIds: number[] | undefined,
): LlmSubscoresResult {
  const topIds = appliedTechIds && appliedTechIds.length > 0
    ? appliedTechIds.slice(0, 3)
    : [...catalog].sort((a, b) => b.maturityYear - a.maturityYear).slice(0, 3).map((t) => t.id);
  const stock = (label: string): SubscoreEvidence => ({
    value: 55,
    rationale: `Heuristic placeholder — refresh with LLM-grade scoring to ground ${label} in capability text.`,
    sources: [{ label: "heuristic" }],
  });
  return {
    jtbdAbstractability: stock("jtbd_abstractability"),
    enablingTechStrength: stock("enabling_tech_strength"),
    trustReplaceability: stock("trust_replaceability"),
    latentSupplyMultiplier: stock("latent_supply_multiplier"),
    topEnablingTechIds: topIds,
  };
}

// ─── Persistence (called by the agent + admin recompute) ────────────────

import {
  capabilityDisruptionIndexTable,
  disruptionPlaybookMatchesTable,
} from "@workspace/db";

export async function persistDisruptionScore(
  result: DisruptionScoreResult,
  narrative: string | null,
  candidateDisruptors: Array<{ companyId: number; name: string; reason: string }>,
  computedByRunId: number | null,
): Promise<void> {
  const values = {
    capabilityId: result.capabilityId,
    assetFriction: result.subscores.assetFriction,
    jtbdAbstractability: result.subscores.jtbdAbstractability,
    enablingTechStrength: result.subscores.enablingTechStrength,
    trustReplaceability: result.subscores.trustReplaceability,
    latentSupplyMultiplier: result.subscores.latentSupplyMultiplier,
    marginAsymmetry: result.subscores.marginAsymmetry,
    compositeDi: result.compositeDi,
    rationale: result.rationale as unknown as Record<string, { value: number; rationale: string; sources: Array<{ label: string; url?: string }> }>,
    narrative,
    topPlaybookId: result.topPlaybookId,
    topPlaybookSimilarity: result.topPlaybookSimilarity,
    topEnablingTechIds: result.topEnablingTechIds,
    candidateDisruptors,
    computedAt: new Date(),
    computedByRunId,
  };

  // Upsert on capability_id.
  const existing = await db
    .select({ id: capabilityDisruptionIndexTable.id })
    .from(capabilityDisruptionIndexTable)
    .where(eq(capabilityDisruptionIndexTable.capabilityId, result.capabilityId))
    .limit(1);

  if (existing.length > 0) {
    await db.update(capabilityDisruptionIndexTable).set(values).where(eq(capabilityDisruptionIndexTable.id, existing[0].id));
  } else {
    await db.insert(capabilityDisruptionIndexTable).values(values);
  }

  // Refresh the full similarity matrix for this cap.
  await db.delete(disruptionPlaybookMatchesTable).where(eq(disruptionPlaybookMatchesTable.capabilityId, result.capabilityId));
  if (result.playbookSimilarities.length > 0) {
    await db.insert(disruptionPlaybookMatchesTable).values(
      result.playbookSimilarities.map((p) => ({
        capabilityId: result.capabilityId,
        playbookId: p.playbookId,
        similarity: p.similarity,
        computedAt: new Date(),
      })),
    );
  }
}

/** Convenience: list capability ids whose DI is stale (>N days) or unset. */
export async function listStaleCapabilityIds(stalenessDays = 7, limit = 50): Promise<number[]> {
  const cutoff = new Date(Date.now() - stalenessDays * 24 * 60 * 60 * 1000);
  const rows = await db.execute(sql`
    SELECT c.id
    FROM capabilities c
    LEFT JOIN capability_disruption_index di ON di.capability_id = c.id
    WHERE c.is_leaf = true
      AND (di.id IS NULL OR di.computed_at < ${cutoff})
    ORDER BY (di.computed_at IS NULL) DESC, di.computed_at ASC NULLS FIRST
    LIMIT ${limit}
  `);
  const data = (rows.rows ?? rows) as Array<{ id: number }>;
  return data.map((r) => r.id);
}
