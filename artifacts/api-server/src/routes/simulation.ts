import { Router } from "express";
import { db } from "@workspace/db";
import {
  simulationScenariosTable,
  capabilityEconomicsTable,
  ceiComponentsTable,
  dependencyEdgeScoresTable,
  capabilitiesTable,
  capabilityDependenciesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

const router = Router();

// List scenarios for a session
router.get("/simulation/scenarios", async (req, res) => {
  try {
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
    if (!token) { res.json([]); return; }
    const rows = await db.select().from(simulationScenariosTable)
      .where(eq(simulationScenariosTable.sessionToken, token))
      .orderBy(simulationScenariosTable.createdAt);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get one scenario
router.get("/simulation/scenarios/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [row] = await db.select().from(simulationScenariosTable).where(eq(simulationScenariosTable.id, id));
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
    const economics = await db.select().from(capabilityEconomicsTable)
      .where(inArray(capabilityEconomicsTable.capabilityId, capIds));
    const econMap = new Map(economics.map((e) => [e.capabilityId, e]));

    // Get current CEI components
    const components = await db.select().from(ceiComponentsTable)
      .where(inArray(ceiComponentsTable.capabilityId, capIds));
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

    // Get baseline CEI
    const allComponents = await db.select().from(ceiComponentsTable);
    const baselineCei = allComponents.length
      ? allComponents.reduce((s, c) => s + c.consensusScore * c.economicMultiplier, 0) / allComponents.length * 10
      : 500;

    const projectedCei = Math.min(1000, Math.max(0, baselineCei + totalScoreDelta * 10));

    const enrichedInvestments = investments.map((i) => ({
      ...i,
      capabilityName: capMap.get(i.capabilityId)?.name ?? `Capability ${i.capabilityId}`,
    }));

    const results = { ceiDelta: Math.round((projectedCei - baselineCei) * 10) / 10, moatChanges, fragilitChanges: fragilityChanges, evarReduction, cascadeEffects };

    const [scenario] = await db.insert(simulationScenariosTable).values({
      sessionToken: sessionToken || null,
      name: name || "Untitled Scenario",
      description,
      baselineCei: Math.round(baselineCei * 10) / 10,
      projectedCei: Math.round(projectedCei * 10) / 10,
      investments: enrichedInvestments,
      results,
    }).returning();

    res.json(scenario);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Delete scenario
router.delete("/simulation/scenarios/:id", async (req, res) => {
  try {
    await db.delete(simulationScenariosTable).where(eq(simulationScenariosTable.id, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
