import { Router } from "express";
import { db } from "@workspace/db";
import {
  simulationScenariosTable,
  capabilityAlphaTable,
  cviComponentsTable,
  dependencyEdgeScoresTable,
  capabilitiesTable,
  capabilityDependenciesTable,
  industriesTable,
  type MacroEvent,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { resolveSessionToken, forSession, forSessionRow } from "../lib/tenant-scope";
import { computeCVI } from "../services/cvi-engine";

const router = Router();

/**
 * POST /api/simulation/forecast
 *
 * 12-month forward CVI trajectory under a hypothetical shock.
 *
 * Body: { industryId, shockType, shockMagnitude }
 *   - industryId: which industry's CVI trajectory to render
 *   - shockType: free-form label ("interest_rate", "ai_displacement", "macro_event", etc.)
 *   - shockMagnitude: 0..10 severity. Sign convention: positive magnitude = negative shock
 *     (rates rising, AI displacing, etc.) — we project a CVI decline. Frontend can flip
 *     the sign for stimulus-style shocks via "sentimentDirection".
 *
 * Returns: { months: [{ month: 0..11, baselineCvi, shockedCvi }], industryName, baselineCviCurrent }
 *
 * Mechanism: builds a synthetic MacroEvent against the industry's capabilities and runs
 * computeCVI({ persist: false, additionalEvents: [shock] }) for each month, varying the
 * synthetic event's startedAt so its decayFactor decreases over time. Baseline is the
 * same engine call with no synthetic event. This reuses the real CVI engine math
 * (Bayesian posterior, dependency multiplier, GDP weighting) — no separate model.
 */
router.post("/simulation/forecast", async (req, res) => {
  try {
    const { industryId, shockType, shockMagnitude, sentimentDirection } = req.body as {
      industryId: number;
      shockType?: string;
      shockMagnitude: number;
      sentimentDirection?: "positive" | "negative" | "neutral";
    };
    if (!industryId || typeof shockMagnitude !== "number") {
      res.status(400).json({ error: "industryId + shockMagnitude required" });
      return;
    }

    const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId));
    if (!industry) { res.status(404).json({ error: "industry not found" }); return; }

    const caps = await db.select({ id: capabilitiesTable.id })
      .from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId));
    const affectedCapabilityIds = caps.map(c => c.id);
    if (!affectedCapabilityIds.length) { res.status(400).json({ error: "industry has no capabilities" }); return; }

    const direction: "positive" | "negative" | "neutral" = sentimentDirection ?? "negative";
    const severity = Math.max(0, Math.min(10, shockMagnitude));

    // Baseline once — no shock injected.
    const baseline = await computeCVI({ persist: false });
    const baselineIndex = baseline.industryBreakdowns[industry.slug]?.indexValue ?? baseline.overallIndex;

    // Twelve monthly snapshots. Each iteration injects a synthetic event whose
    // startedAt sits N months in the past so decayFactor falls linearly:
    // decayFactor = max(0, 1 - elapsedDays/decayDays). decayDays=365 → month-12 ≈ 0.
    const decayDays = 365;
    const now = Date.now();
    const months: Array<{ month: number; baselineCvi: number; shockedCvi: number }> = [];

    for (let m = 0; m < 12; m++) {
      const startedAt = new Date(now - (m * 30) * 24 * 60 * 60 * 1000);
      const shockEvent: MacroEvent = {
        id: -1,
        eventType: shockType ?? "scenario",
        severity,
        title: `What-if: ${shockType ?? "scenario"} (mag ${severity})`,
        description: "Synthetic scenario event — not persisted.",
        affectedIndustryIds: [industryId],
        affectedCapabilityIds,
        sentimentDirection: direction,
        startedAt,
        decayDays,
        source: "whatif",
        citations: [],
        createdBy: "whatif",
        createdAt: startedAt,
      };
      const shocked = await computeCVI({ persist: false, additionalEvents: [shockEvent] });
      const shockedIndex = shocked.industryBreakdowns[industry.slug]?.indexValue ?? shocked.overallIndex;
      months.push({
        month: m,
        baselineCvi: Math.round(baselineIndex * 10) / 10,
        shockedCvi: Math.round(shockedIndex * 10) / 10,
      });
    }

    res.json({
      industryId,
      industryName: industry.name,
      shockType: shockType ?? "scenario",
      shockMagnitude: severity,
      sentimentDirection: direction,
      baselineCviCurrent: Math.round(baselineIndex * 10) / 10,
      months,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// List scenarios for a session
router.get("/simulation/scenarios", async (req, res) => {
  try {
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
    if (!token) { res.json([]); return; }
    const rows = await db.select().from(simulationScenariosTable)
      .where(forSession("simulation_scenarios", token))
      .orderBy(simulationScenariosTable.createdAt);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get one scenario — must belong to the caller's session.
router.get("/simulation/scenarios/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const token = resolveSessionToken(req);
    if (!token) { res.status(401).json({ error: "sessionToken required" }); return; }
    const [row] = await db.select().from(simulationScenariosTable)
      .where(forSessionRow("simulation_scenarios", token, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Run simulation
router.post("/simulation/run", async (req, res) => {
  try {
    const { sessionToken, name, description, investments } = req.body as {
      sessionToken: string;
      name: string;
      description?: string;
      investments: Array<{ capabilityId: number; investmentUsdMm: number; targetMaturityDelta: number; timelineMonths: number }>;
    };

    if (!investments?.length) { res.status(400).json({ error: "No investments provided" }); return; }

    const capIds = investments.map((i) => i.capabilityId);
    const caps = await db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, capIds));
    const capMap = new Map(caps.map((c) => [c.id, c]));

    // Get current economics for affected capabilities
    const economics = await db.select().from(capabilityAlphaTable)
      .where(inArray(capabilityAlphaTable.capabilityId, capIds));
    const econMap = new Map(economics.map((e) => [e.capabilityId, e]));

    // Get current CVI components
    const components = await db.select().from(cviComponentsTable)
      .where(inArray(cviComponentsTable.capabilityId, capIds));
    const compMap = new Map(components.map((c) => [c.capabilityId, c]));

    // Get dependencies to compute cascade
    const deps = await db.select().from(capabilityDependenciesTable)
      .where(inArray(capabilityDependenciesTable.capabilityId, capIds));

    const edgeIds = deps.map((d) => d.id);
    const edgeScores = edgeIds.length
      ? await db.select().from(dependencyEdgeScoresTable).where(inArray(dependencyEdgeScoresTable.dependencyId, edgeIds))
      : [];
    const edgeMap = new Map(edgeScores.map((e) => [e.dependencyId, e]));

    // Compute simulation results
    const moatChanges: Array<{ capabilityId: number; name: string; before: number; after: number }> = [];
    const fragilityChanges: Array<{ capabilityId: number; name: string; before: number; after: number }> = [];
    const evarReduction: Array<{ capabilityId: number; name: string; before12mo: number; after12mo: number }> = [];
    const cascadeEffects: Array<{ fromId: number; fromName: string; toId: number; toName: string; impactDelta: number }> = [];

    let totalScoreDelta = 0;

    for (const inv of investments) {
      const cap = capMap.get(inv.capabilityId);
      const econ = econMap.get(inv.capabilityId);
      const comp = compMap.get(inv.capabilityId);
      if (!cap) continue;

      const capName = cap.name;
      const currentScore = comp?.consensusScore ?? cap.benchmarkScore;

      // Maturity improvement drives moat improvement — uses actual score, not fabricated
      const matDelta = inv.targetMaturityDelta;
      if (currentScore != null) {
        const halfLife = econ?.halfLifeMonths;
        const moatBefore = halfLife != null
          ? Math.min(100, (halfLife / 60) * 30 + currentScore * 0.25 + 20)
          : currentScore;
        const moatAfter = Math.min(100, moatBefore + matDelta * 0.4);
        moatChanges.push({ capabilityId: inv.capabilityId, name: capName, before: Math.round(moatBefore), after: Math.round(moatAfter) });

        // Fragility decreases with investment
        const fragBefore = Math.max(0, 100 - moatBefore);
        const fragAfter = Math.max(0, 100 - moatAfter);
        fragilityChanges.push({ capabilityId: inv.capabilityId, name: capName, before: Math.round(fragBefore), after: Math.round(fragAfter) });
      }

      // EVaR reduction — only when real economics data exists
      if (econ?.revenueExposureMm != null && econ?.halfLifeMonths != null) {
        const halfLife = econ.halfLifeMonths;
        const revenue = econ.revenueExposureMm;
        const margin = econ.marginStructurePct != null ? econ.marginStructurePct / 100 : 0.3;
        const newHalfLife = halfLife + matDelta * 0.5;
        const evar12Before = revenue * margin * (1 - Math.pow(0.5, 12 / halfLife));
        const evar12After = revenue * margin * (1 - Math.pow(0.5, 12 / newHalfLife));
        evarReduction.push({ capabilityId: inv.capabilityId, name: capName, before12mo: Math.round(evar12Before * 10) / 10, after12mo: Math.round(evar12After * 10) / 10 });
      }

      totalScoreDelta += matDelta * 0.1;

      // Cascade through dependencies — only when edge scores exist
      for (const dep of deps.filter((d) => d.dependsOnId === inv.capabilityId)) {
        const downCap = capMap.get(dep.capabilityId);
        const edge = edgeMap.get(dep.id);
        if (!edge || !downCap) continue;
        const deltaImpact = -matDelta * (edge.disruptionProbability ?? 0) * 0.1;
        cascadeEffects.push({
          fromId: inv.capabilityId, fromName: capName,
          toId: dep.capabilityId, toName: downCap.name,
          impactDelta: Math.round(deltaImpact * 100) / 100,
        });
      }
    }

    // Get baseline CVI
    const allComponents = await db.select().from(cviComponentsTable);
    const baselineCvi = allComponents.length
      ? allComponents.reduce((s, c) => s + c.consensusScore * c.economicMultiplier, 0) / allComponents.length * 10
      : 500;

    const projectedCvi = Math.min(1000, Math.max(0, baselineCvi + totalScoreDelta * 10));

    const enrichedInvestments = investments.map((i) => ({
      ...i,
      capabilityName: capMap.get(i.capabilityId)?.name ?? `Capability ${i.capabilityId}`,
    }));

    const results = { cviDelta: Math.round((projectedCvi - baselineCvi) * 10) / 10, moatChanges, fragilitChanges: fragilityChanges, evarReduction, cascadeEffects };

    const [scenario] = await db.insert(simulationScenariosTable).values({
      sessionToken: sessionToken || null,
      name: name || "Untitled Scenario",
      description,
      baselineCvi: Math.round(baselineCvi * 10) / 10,
      projectedCvi: Math.round(projectedCvi * 10) / 10,
      investments: enrichedInvestments,
      results,
    }).returning();

    res.json(scenario);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Delete scenario — must belong to the caller's session.
router.delete("/simulation/scenarios/:id", async (req, res) => {
  try {
    const token = resolveSessionToken(req);
    if (!token) { res.status(401).json({ error: "sessionToken required" }); return; }
    const deleted = await db.delete(simulationScenariosTable)
      .where(forSessionRow("simulation_scenarios", token, Number(req.params.id)))
      .returning({ id: simulationScenariosTable.id });
    if (deleted.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
