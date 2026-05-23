import { Router } from "express";
import { db } from "@workspace/db";
import {
  warRoomSessionsTable,
  organizationsTable,
  organizationCapabilitiesTable,
  capabilitiesTable,
  capabilityAlphaTable,
  cviComponentsTable,
  sourceTriangulationsTable,
  cviCapabilityHistoryTable,
} from "@workspace/db";
import { eq, and, inArray, avg, count, gte, asc } from "drizzle-orm";
import { deriveLifecycleStage } from "../services/lifecycle";

const router = Router();

// Get competitive comparison data.
//
// Modes:
//   1. ?sessionToken=…  → user's own org scored vs benchmarks (the original mode).
//   2. ?industryId=N    → "industry average" mode: aggregates maturityScore across all
//                         reference organizations in that industry. This is what an
//                         anonymous visitor sees on the Capability Scorecard so the
//                         page is never empty (Task #21).
router.get("/war-room/compare", async (req, res) => {
  try {
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
    const queriedIndustryId = typeof req.query.industryId === "string" ? Number(req.query.industryId) : NaN;
    const companyIds = typeof req.query.companyIds === "string"
      ? req.query.companyIds.split(",").map(Number).filter(Boolean)
      : [];

    let orgCaps: Array<{ capabilityId: number; maturityScore: number; investmentLevel: string }> = [];
    let orgName: string | null = null;
    let industryId: number | null = null;
    let mode: "user" | "industry-average" = "user";
    let aggregatedFromOrgs = 0;

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

    // Industry-average fallback for anonymous users.
    if (!token && Number.isFinite(queriedIndustryId)) {
      industryId = queriedIndustryId;
      mode = "industry-average";
      const refOrgs = await db.select({ id: organizationsTable.id })
        .from(organizationsTable)
        .where(eq(organizationsTable.industryId, queriedIndustryId));
      aggregatedFromOrgs = refOrgs.length;
      if (refOrgs.length > 0) {
        const refOrgIds = refOrgs.map((o) => o.id);
        const aggregated = await db
          .select({
            capabilityId: organizationCapabilitiesTable.capabilityId,
            maturityScore: avg(organizationCapabilitiesTable.maturityScore).mapWith(Number),
            sampleSize: count(organizationCapabilitiesTable.id).mapWith(Number),
          })
          .from(organizationCapabilitiesTable)
          .where(inArray(organizationCapabilitiesTable.organizationId, refOrgIds))
          .groupBy(organizationCapabilitiesTable.capabilityId);
        orgCaps = aggregated.map((r) => ({
          capabilityId: r.capabilityId,
          maturityScore: r.maturityScore,
          investmentLevel: "moderate",
        }));
        orgName = `Industry Average (${refOrgs.length} reference orgs)`;
      }
    }

    // Get capabilities for the industry
    const caps = industryId
      ? await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId))
      : await db.select().from(capabilitiesTable);

    const capIds = caps.map((c) => c.id);

    // Get economics for moat/evar/ai-exposure comparisons
    const economics = capIds.length
      ? await db.select().from(capabilityAlphaTable).where(inArray(capabilityAlphaTable.capabilityId, capIds))
      : [];

    const components = capIds.length
      ? await db.select().from(cviComponentsTable).where(inArray(cviComponentsTable.capabilityId, capIds))
      : [];

    // Pull triangulation citations so each row can expose Perplexity source URLs.
    const triRows = capIds.length
      ? await db.select({
          capabilityId: sourceTriangulationsTable.capabilityId,
          sourceLabel: sourceTriangulationsTable.sourceLabel,
          citations: sourceTriangulationsTable.citations,
          queriedAt: sourceTriangulationsTable.queriedAt,
        }).from(sourceTriangulationsTable).where(inArray(sourceTriangulationsTable.capabilityId, capIds))
      : [];
    const citationsByCap = new Map<number, { urls: Set<string>; sources: Set<string> }>();
    for (const t of triRows) {
      let e = citationsByCap.get(t.capabilityId);
      if (!e) { e = { urls: new Set(), sources: new Set() }; citationsByCap.set(t.capabilityId, e); }
      e.sources.add(t.sourceLabel);
      for (const u of (t.citations ?? [])) if (u) e.urls.add(u);
    }

    // 90-day delta lookup. One bulk query against cvi_capability_history;
    // for each cap, take the oldest snapshot within the window as the
    // baseline. Surfaces "what changed" so the scorecard isn't a flat
    // snapshot view.
    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const histRows = capIds.length
      ? await db.select({
          capabilityId: cviCapabilityHistoryTable.capabilityId,
          consensusScore: cviCapabilityHistoryTable.consensusScore,
          snapshotAt: cviCapabilityHistoryTable.snapshotAt,
        })
          .from(cviCapabilityHistoryTable)
          .where(and(inArray(cviCapabilityHistoryTable.capabilityId, capIds), gte(cviCapabilityHistoryTable.snapshotAt, since90)))
          .orderBy(asc(cviCapabilityHistoryTable.snapshotAt))
      : [];
    const oldestByCap = new Map<number, number>();
    for (const r of histRows) {
      // First row per cap due to ascending order is the oldest in-window
      if (!oldestByCap.has(r.capabilityId)) oldestByCap.set(r.capabilityId, r.consensusScore);
    }

    // Build comparison matrix
    const orgCapMap = new Map(orgCaps.map((c) => [c.capabilityId, c]));
    const econMap = new Map(economics.map((e) => [e.capabilityId, e]));
    const compMap = new Map(components.map((c) => [c.capabilityId, c]));

    const matrix = caps.filter((c) => c.isLeaf !== false).map((cap) => {
      const orgScore = orgCapMap.get(cap.id)?.maturityScore ?? null;
      const benchmark = cap.benchmarkScore;
      const econ = econMap.get(cap.id);
      const comp = compMap.get(cap.id);
      const tri = citationsByCap.get(cap.id);
      const citationUrls = tri ? Array.from(tri.urls).slice(0, 12) : [];
      const sourceCount = tri?.sources.size ?? (comp?.sourceScores?.length ?? 0);
      const sourceBreakdown = (comp?.sourceScores ?? []).map(s => ({
        sourceLabel: s.sourceLabel,
        rawScore: s.rawScore,
        weight: s.weight,
        methodology: s.methodology,
      }));

      return {
        capabilityId: cap.id,
        capabilityName: cap.name,
        myScore: orgScore,
        benchmark,
        gap: orgScore !== null && benchmark != null ? orgScore - benchmark : null,
        moatScore: econ?.halfLifeMonths != null && benchmark != null
          ? Math.min(100, (econ.halfLifeMonths / 60) * 30 + benchmark * 0.25 + 20)
          : null,
        evar12mo: econ?.revenueExposureMm != null && econ?.halfLifeMonths != null && econ?.marginStructurePct != null
          ? econ.revenueExposureMm * (econ.marginStructurePct / 100) * (1 - Math.pow(0.5, 12 / econ.halfLifeMonths))
          : null,
        aiExposure: econ?.aiExposureScore ?? null,
        velocity: comp?.velocity ?? null,
        consensusScore: comp?.consensusScore ?? benchmark ?? null,
        // Provenance — surfaced for ScoreWithProvenance tooltips.
        confidence: comp?.confidence ?? null,
        ciLow: comp?.ciLow ?? null,
        ciHigh: comp?.ciHigh ?? null,
        lastUpdatedAt: comp?.updatedAt?.toISOString() ?? null,
        sourceCount,
        citations: citationUrls,
        sourceBreakdown,
        lifecycleStage: deriveLifecycleStage({
          consensusScore: comp?.consensusScore ?? null,
          velocity: comp?.velocity ?? null,
          benchmarkScore: benchmark,
        }),
        delta90: (() => {
          const oldest = oldestByCap.get(cap.id);
          const current = comp?.consensusScore ?? benchmark ?? null;
          if (oldest == null || current == null) return null;
          return current - oldest;
        })(),
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

    res.json({ orgName, industryId, mode, aggregatedFromOrgs, matrix, alerts });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
