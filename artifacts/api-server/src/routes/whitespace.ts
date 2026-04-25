import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { capabilitiesTable, ceiComponentsTable, industriesTable, capabilityEconomicsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router: IRouter = Router();

router.get("/whitespace", async (req, res) => {
  try {
    const industryId = req.query.industryId ? parseInt(String(req.query.industryId), 10) : undefined;
    const velocityMin = req.query.velocityMin !== undefined ? Number(req.query.velocityMin) : 0.0;
    const moatMax = req.query.moatMax !== undefined ? Number(req.query.moatMax) : 100;
    const disruptabilityMin = req.query.disruptabilityMin !== undefined ? Number(req.query.disruptabilityMin) : 0;
    const consensusMax = req.query.consensusMax !== undefined ? Number(req.query.consensusMax) : 60;

    const baseQuery = db
      .select({
        capabilityId: capabilitiesTable.id,
        capabilityName: capabilitiesTable.name,
        industryId: capabilitiesTable.industryId,
        industryName: industriesTable.name,
        consensusScore: ceiComponentsTable.consensusScore,
        velocity: ceiComponentsTable.velocity,
        confidence: ceiComponentsTable.confidence,
        halfLifeMonths: capabilityEconomicsTable.halfLifeMonths,
        aiExposureScore: capabilityEconomicsTable.aiExposureScore,
        marginStructurePct: capabilityEconomicsTable.marginStructurePct,
        revenueExposureMm: capabilityEconomicsTable.revenueExposureMm,
        benchmarkScore: capabilitiesTable.benchmarkScore,
        isLeaf: capabilitiesTable.isLeaf,
      })
      .from(capabilitiesTable)
      .leftJoin(ceiComponentsTable, eq(ceiComponentsTable.capabilityId, capabilitiesTable.id))
      .leftJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId))
      .leftJoin(capabilityEconomicsTable, eq(capabilityEconomicsTable.capabilityId, capabilitiesTable.id));

    const rows = industryId
      ? await baseQuery.where(and(eq(capabilitiesTable.industryId, industryId), eq(capabilitiesTable.reviewStatus, "approved")))
      : await baseQuery.where(eq(capabilitiesTable.reviewStatus, "approved"));

    const results = rows
      .filter((r) => r.isLeaf !== false)
      .map((r) => {
        const consensus = r.consensusScore ?? 50;
        const velocity = r.velocity ?? 0;
        const halfLife = r.halfLifeMonths ?? 12;
        const moatScore = Math.min(100, (halfLife / 60) * 30 + (r.benchmarkScore ?? 50) * 0.25 + 20);
        const disruptability = r.aiExposureScore ?? 50;
        const opportunityScore =
          velocity * 50 +
          (100 - consensus) * 0.4 +
          (100 - moatScore) * 0.25 +
          disruptability * 0.2;

        return {
          capabilityId: r.capabilityId,
          capabilityName: r.capabilityName,
          industryId: r.industryId,
          industryName: r.industryName,
          consensusScore: Math.round(consensus * 10) / 10,
          velocity: Math.round(velocity * 1000) / 1000,
          confidence: Math.round((r.confidence ?? 0.5) * 100) / 100,
          moatScore: Math.round(moatScore * 10) / 10,
          aiDisruptability: Math.round(disruptability * 10) / 10,
          revenueExposureMm: r.revenueExposureMm,
          opportunityScore: Math.round(opportunityScore * 10) / 10,
        };
      })
      .filter((r) =>
        r.velocity >= velocityMin &&
        r.moatScore <= moatMax &&
        r.aiDisruptability >= disruptabilityMin &&
        r.consensusScore <= consensusMax
      )
      .sort((a, b) => b.opportunityScore - a.opportunityScore);

    res.json({
      filters: { industryId, velocityMin, moatMax, disruptabilityMin, consensusMax },
      count: results.length,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
