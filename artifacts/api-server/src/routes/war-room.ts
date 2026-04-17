import { Router } from "express";
import { db } from "@workspace/db";
import {
  warRoomSessionsTable,
  organizationsTable,
  organizationCapabilitiesTable,
  capabilitiesTable,
  capabilityEconomicsTable,
  ceiComponentsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

const router = Router();

// Get competitive comparison data
router.get("/war-room/compare", async (req, res) => {
  try {
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
    const companyIds = typeof req.query.companyIds === "string"
      ? req.query.companyIds.split(",").map(Number).filter(Boolean)
      : [];

    // Get org and its assessments
    let orgCaps: Array<{ capabilityId: number; maturityScore: number; investmentLevel: string }> = [];
    let orgName = "My Organization";
    let industryId: number | null = null;

    if (token) {
      const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, token));
      if (org) {
        orgName = org.name;
        industryId = org.industryId;
        orgCaps = await db.select({
          capabilityId: organizationCapabilitiesTable.capabilityId,
          maturityScore: organizationCapabilitiesTable.maturityScore,
          investmentLevel: organizationCapabilitiesTable.investmentLevel,
        }).from(organizationCapabilitiesTable)
          .where(eq(organizationCapabilitiesTable.organizationId, org.id));
      }
    }

    // Get capabilities for the industry
    const caps = industryId
      ? await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId))
      : await db.select().from(capabilitiesTable);

    const capIds = caps.map((c) => c.id);

    // Get economics for moat/evar/ai-exposure comparisons
    const economics = capIds.length
      ? await db.select().from(capabilityEconomicsTable).where(inArray(capabilityEconomicsTable.capabilityId, capIds))
      : [];

    const components = capIds.length
      ? await db.select().from(ceiComponentsTable).where(inArray(ceiComponentsTable.capabilityId, capIds))
      : [];

    // Build comparison matrix
    const orgCapMap = new Map(orgCaps.map((c) => [c.capabilityId, c]));
    const econMap = new Map(economics.map((e) => [e.capabilityId, e]));
    const compMap = new Map(components.map((c) => [c.capabilityId, c]));

    const matrix = caps.filter((c) => c.isLeaf !== false).map((cap) => {
      const orgScore = orgCapMap.get(cap.id)?.maturityScore ?? null;
      const benchmark = cap.benchmarkScore ?? 50;
      const econ = econMap.get(cap.id);
      const comp = compMap.get(cap.id);

      return {
        capabilityId: cap.id,
        capabilityName: cap.name,
        myScore: orgScore,
        benchmark,
        gap: orgScore !== null ? orgScore - benchmark : null,
        moatScore: econ ? Math.min(100, ((econ.halfLifeMonths ?? 36) / 60) * 30 + benchmark * 0.25 + 20) : null,
        evar12mo: econ ? (econ.revenueExposureMm ?? 0) * ((econ.marginStructurePct ?? 30) / 100) * (1 - Math.pow(0.5, 12 / (econ.halfLifeMonths ?? 36))) : null,
        aiExposure: econ?.aiExposureScore ?? null,
        velocity: comp?.velocity ?? 0,
        consensusScore: comp?.consensusScore ?? benchmark,
      };
    });

    // Generate alerts
    const alerts: Array<{ type: string; message: string; severity: string; capabilityId: number }> = [];
    for (const row of matrix) {
      if (row.gap !== null && row.gap < -20) {
        alerts.push({ type: "score_move", message: `${row.capabilityName}: you trail benchmark by ${Math.abs(row.gap).toFixed(0)} points`, severity: "critical", capabilityId: row.capabilityId });
      }
      if (row.aiExposure !== null && row.aiExposure > 60) {
        alerts.push({ type: "ai_exposure", message: `${row.capabilityName}: ${row.aiExposure.toFixed(0)}% AI displacement risk`, severity: "warning", capabilityId: row.capabilityId });
      }
      if (row.moatScore !== null && row.moatScore < 30) {
        alerts.push({ type: "moat_gap", message: `${row.capabilityName}: moat score ${row.moatScore.toFixed(0)} — Exposed`, severity: "warning", capabilityId: row.capabilityId });
      }
    }

    res.json({ orgName, industryId, matrix, alerts });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
