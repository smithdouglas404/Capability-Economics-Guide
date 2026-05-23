import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { runWhatIf } from "../services/whatif";
import { listActiveEvents } from "../services/macro-events";
import { logger } from "../lib/logger";
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityDependenciesTable,
  capabilityAlphaTable,
  cviComponentsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const router: IRouter = Router();

/**
 * GET /api/whatif/presets
 *
 * Up to 5 recent active macro events for the "Suggested" quick-select
 * buttons on /whatif. Replaces the hardcoded SUGGESTED_EVENTS array in
 * pages/whatif.tsx:65-71. Sourced from the macro_events table that the
 * world-scanner populates. Empty array when no events exist yet — the
 * frontend should hide the suggestions section in that case.
 */
router.get("/whatif/presets", async (_req, res) => {
  try {
    const events = await listActiveEvents();
    const presets = events
      .slice(0, 5)
      .map((e: any) => ({
        label: e.title ?? e.eventType,
        eventType: e.eventType,
        severity: e.severity ?? 5,
        direction: e.sentimentDirection ?? "negative",
        decayDays: e.decayDays ?? 90,
      }));
    res.json({ presets });
  } catch (err) {
    logger.error({ err }, "[whatif/presets] failed");
    res.status(500).json({ presets: [], error: "failed" });
  }
});

const Body = z.object({
  eventType: z.string().min(1).max(60),
  severity: z.number().min(0).max(10),
  sentimentDirection: z.enum(["positive", "negative", "neutral"]),
  decayDays: z.number().min(1).max(365).default(30),
  affectedIndustryIds: z.array(z.number().int().positive()).default([]),
  affectedCapabilityIds: z.array(z.number().int().positive()).default([]),
}).refine(d => d.affectedIndustryIds.length > 0 || d.affectedCapabilityIds.length > 0, {
  message: "Must specify at least one affected industry or capability id",
});

router.post("/whatif/macro", async (req, res) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  try {
    const result = await runWhatIf(parsed.data);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "whatif simulation failed");
    res.status(500).json({ error: "Simulation failed" });
  }
});

/**
 * POST /api/whatif/capability-improvement
 *
 * "What if I improved capability X to score N?" — propagates the improvement
 * through `capability_dependencies` (dependents of X benefit) and returns:
 *   • per-dependent EVaR(12m) before/after using the half-life formula from
 *     services/recommendations/trade-theses.ts (revenue × margin × (1 − 0.5^(12/HL))),
 *     where HL extends linearly with the propagated score uplift.
 *   • org-level CVI delta estimated as the weighted-average score uplift across
 *     the cap + its dependents (back-of-envelope; the full Bayesian re-roll lives
 *     in computeCVI, but for a UI "delta preview" this stays sub-second).
 *
 * The shape is intentionally simple (a flat list of impacted nodes) so the
 * frontend can render it as a sankey or a nested list without a graph layout.
 */
const ImprovementBody = z.object({
  capabilityId: z.number().int().positive(),
  targetScore: z.number().min(0).max(100),
});

router.post("/whatif/capability-improvement", async (req, res) => {
  const parsed = ImprovementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  try {
    const { capabilityId, targetScore } = parsed.data;
    const [root] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, capabilityId));
    if (!root) { res.status(404).json({ error: "capability not found" }); return; }

    // Current score for the root — prefer Bayesian posterior from cvi_components,
    // fall back to the cap's seed benchmarkScore.
    const [rootComp] = await db.select().from(cviComponentsTable).where(eq(cviComponentsTable.capabilityId, capabilityId));
    const currentScore = rootComp?.consensusScore ?? root.benchmarkScore;
    const scoreDelta = Math.max(0, targetScore - currentScore);
    if (scoreDelta <= 0) {
      res.json({
        capabilityId, capabilityName: root.name, currentScore, targetScore,
        scoreDelta: 0, dependents: [], orgCviDelta: 0,
        narrative: `${root.name} already at or above target score ${targetScore.toFixed(1)}.`,
      });
      return;
    }

    // BFS the dependency graph: anyone with depends_on_id = capId benefits.
    // Strength multiplier collapses to {strong: 1.0, moderate: 0.6, weak: 0.3}.
    const STRENGTH: Record<string, number> = { strong: 1.0, moderate: 0.6, weak: 0.3 };
    const allDeps = await db.select().from(capabilityDependenciesTable);

    type Hop = { capId: number; via: number; strengthMul: number; hops: number };
    const visited = new Map<number, Hop>(); // capId → cumulative info
    const queue: Hop[] = [{ capId: capabilityId, via: capabilityId, strengthMul: 1, hops: 0 }];
    visited.set(capabilityId, queue[0]);
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur.hops >= 3) continue; // cap traversal depth — anything > 3 hops gets noise-dominated
      for (const d of allDeps) {
        if (d.dependsOnId !== cur.capId) continue;
        const sMul = STRENGTH[d.strength] ?? 0.6;
        const nextMul = cur.strengthMul * sMul * 0.7; // distance decay
        if (visited.has(d.capabilityId)) {
          const prev = visited.get(d.capabilityId)!;
          if (nextMul > prev.strengthMul) visited.set(d.capabilityId, { capId: d.capabilityId, via: cur.capId, strengthMul: nextMul, hops: cur.hops + 1 });
          continue;
        }
        const next: Hop = { capId: d.capabilityId, via: cur.capId, strengthMul: nextMul, hops: cur.hops + 1 };
        visited.set(d.capabilityId, next);
        queue.push(next);
      }
    }

    const impactedIds = Array.from(visited.keys());
    const caps = await db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, impactedIds));
    const capMap = new Map(caps.map(c => [c.id, c]));
    const alphas = await db.select().from(capabilityAlphaTable).where(inArray(capabilityAlphaTable.capabilityId, impactedIds));
    const alphaMap = new Map(alphas.map(a => [a.capabilityId, a]));
    const comps = await db.select().from(cviComponentsTable).where(inArray(cviComponentsTable.capabilityId, impactedIds));
    const compMap = new Map(comps.map(c => [c.capabilityId, c]));

    const dependents = impactedIds
      .filter(id => id !== capabilityId)
      .map(id => {
        const cap = capMap.get(id);
        const hop = visited.get(id)!;
        const baseScore = compMap.get(id)?.consensusScore ?? cap?.benchmarkScore ?? 50;
        const propagatedDelta = scoreDelta * hop.strengthMul;
        const newScore = Math.min(100, baseScore + propagatedDelta);
        const a = alphaMap.get(id);
        let evarBeforeMm: number | null = null;
        let evarAfterMm: number | null = null;
        if (a?.revenueExposureMm != null && a?.marginStructurePct != null && a?.halfLifeMonths != null) {
          const hl = Math.max(6, a.halfLifeMonths);
          // Half-life extends ~0.5 months per maturity point — same assumption as routes/simulation.ts existing run path.
          const newHl = hl + propagatedDelta * 0.5;
          evarBeforeMm = a.revenueExposureMm * (a.marginStructurePct / 100) * (1 - Math.pow(0.5, 12 / hl));
          evarAfterMm = a.revenueExposureMm * (a.marginStructurePct / 100) * (1 - Math.pow(0.5, 12 / newHl));
        }
        const viaCap = capMap.get(hop.via);
        return {
          capabilityId: id,
          capabilityName: cap?.name ?? `#${id}`,
          via: viaCap?.name ?? root.name,
          hops: hop.hops,
          strengthMultiplier: Math.round(hop.strengthMul * 1000) / 1000,
          currentScore: Math.round(baseScore * 10) / 10,
          projectedScore: Math.round(newScore * 10) / 10,
          scoreDelta: Math.round(propagatedDelta * 100) / 100,
          evarBeforeMm: evarBeforeMm == null ? null : Math.round(evarBeforeMm * 10) / 10,
          evarAfterMm: evarAfterMm == null ? null : Math.round(evarAfterMm * 10) / 10,
          evarDeltaMm: evarBeforeMm == null || evarAfterMm == null ? null : Math.round((evarBeforeMm - evarAfterMm) * 10) / 10,
        };
      })
      .sort((a, b) => b.strengthMultiplier - a.strengthMultiplier);

    // Org-level CVI delta — leverage how computeCVI scales (consensus 0-100 → 0-1000).
    // Approx: weighted average score uplift × 10. Weights = strengthMultiplier (root=1).
    const totalUpliftWeighted = scoreDelta * 1 + dependents.reduce((s, d) => s + d.scoreDelta * 1, 0);
    const totalWeight = 1 + dependents.length;
    const orgCviDelta = totalWeight > 0 ? Math.round((totalUpliftWeighted / totalWeight) * 10 * 10) / 10 : 0;

    const totalEvarReductionMm = dependents.reduce((s, d) => s + (d.evarDeltaMm ?? 0), 0);
    const narrative =
      `Improving ${root.name} from ${currentScore.toFixed(1)} to ${targetScore.toFixed(1)} ` +
      `cascades to ${dependents.length} downstream ${dependents.length === 1 ? "capability" : "capabilities"}. ` +
      `Estimated org-level CVI uplift: +${orgCviDelta.toFixed(1)} points. ` +
      (totalEvarReductionMm > 0 ? `Total 12-month EVaR reduction: $${totalEvarReductionMm.toFixed(1)}M.` : `EVaR economics not modeled for the affected nodes.`);

    res.json({
      capabilityId,
      capabilityName: root.name,
      currentScore: Math.round(currentScore * 10) / 10,
      targetScore,
      scoreDelta: Math.round(scoreDelta * 10) / 10,
      dependents,
      orgCviDelta,
      totalEvarReductionMm: Math.round(totalEvarReductionMm * 10) / 10,
      narrative,
    });
  } catch (err) {
    logger.error({ err }, "[whatif/capability-improvement] failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Simulation failed" });
  }
});

export default router;
