import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  dvxComponentsTable,
  dvxSnapshotsTable,
  dvxCapabilityHistoryTable,
  capabilitiesTable,
  disruptionPatternsTable,
} from "@workspace/db";
import { eq, and, desc, gte, asc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { computeDVX } from "../services/dvx-engine";

const router: IRouter = Router();

/** Latest global DVX snapshot. */
router.get("/dvx/overall", async (_req, res) => {
  try {
    const [latest] = await db.select().from(dvxSnapshotsTable).orderBy(desc(dvxSnapshotsTable.snapshotAt)).limit(1);
    res.json(latest ?? { overallIndex: null, industryBreakdowns: {}, snapshotAt: null });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch DVX" });
  }
});

/** DVX time-series — for the global "how disrupted is the market overall" chart. */
router.get("/dvx/history", async (req, res) => {
  try {
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 90));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db.select({
      snapshotAt: dvxSnapshotsTable.snapshotAt,
      overallIndex: dvxSnapshotsTable.overallIndex,
    }).from(dvxSnapshotsTable).where(gte(dvxSnapshotsTable.snapshotAt, since)).orderBy(asc(dvxSnapshotsTable.snapshotAt));
    res.json({ series: rows, days });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch history" });
  }
});

/** Per-capability DVX detail — score + top disruptors + matched pattern. */
router.get("/capabilities/:id/dvx", async (req, res) => {
  const idRaw = req.params.id;
  const capId = parseInt(Array.isArray(idRaw) ? (idRaw[0] ?? "") : idRaw, 10);
  if (!Number.isFinite(capId)) { res.status(400).json({ error: "Invalid capability id" }); return; }
  try {
    const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, capId)).limit(1);
    if (!cap) { res.status(404).json({ error: "Capability not found" }); return; }

    const [dvx] = await db.select().from(dvxComponentsTable)
      .where(and(eq(dvxComponentsTable.capabilityId, capId), eq(dvxComponentsTable.industryId, cap.industryId)))
      .limit(1);
    if (!dvx) {
      res.json({ capabilityId: capId, industryId: cap.industryId, disruptionScore: null, message: "DVX not yet computed for this capability — wait for the next agent cycle." });
      return;
    }

    // Resolve matched pattern detail (slug → full pattern row)
    let matchedPattern: typeof disruptionPatternsTable.$inferSelect | null = null;
    if (dvx.matchedPatternSlug) {
      const [p] = await db.select().from(disruptionPatternsTable).where(eq(disruptionPatternsTable.slug, dvx.matchedPatternSlug)).limit(1);
      matchedPattern = p ?? null;
    }
    res.json({
      ...dvx,
      matchedPattern,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch DVX detail" });
  }
});

/** Per-capability DVX history (time-series sparkline). */
router.get("/capabilities/:id/dvx-history", async (req, res) => {
  const idRaw = req.params.id;
  const capId = parseInt(Array.isArray(idRaw) ? (idRaw[0] ?? "") : idRaw, 10);
  if (!Number.isFinite(capId)) { res.status(400).json({ error: "Invalid capability id" }); return; }
  try {
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 90));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const series = await db.select({
      snapshotAt: dvxCapabilityHistoryTable.snapshotAt,
      disruptionScore: dvxCapabilityHistoryTable.disruptionScore,
      velocity: dvxCapabilityHistoryTable.velocity,
    }).from(dvxCapabilityHistoryTable)
      .where(and(eq(dvxCapabilityHistoryTable.capabilityId, capId), gte(dvxCapabilityHistoryTable.snapshotAt, since)))
      .orderBy(asc(dvxCapabilityHistoryTable.snapshotAt));
    res.json({ capabilityId: capId, days, series });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch DVX history" });
  }
});

/**
 * C-Suite recommendation for a capability, framed to a specific persona.
 * Reads cached row if fresh; regenerates via LLM if stale (DVX moved
 * ≥10pt OR row >30 days old) or forceFresh=1.
 */
router.get("/capabilities/:id/recommendations", async (req, res) => {
  const idRaw = req.params.id;
  const capId = parseInt(Array.isArray(idRaw) ? (idRaw[0] ?? "") : idRaw, 10);
  if (!Number.isFinite(capId)) { res.status(400).json({ error: "Invalid capability id" }); return; }
  const personaRaw = String(req.query.persona ?? "ceo").toLowerCase();
  if (!["cfo", "coo", "cto", "chro", "ceo"].includes(personaRaw)) {
    res.status(400).json({ error: "persona must be one of cfo|coo|cto|chro|ceo" });
    return;
  }
  try {
    const { getOrGenerateCsuiteRecommendation } = await import("../services/recommendations/csuite-translator");
    const result = await getOrGenerateCsuiteRecommendation(capId, personaRaw as "cfo" | "coo" | "cto" | "chro" | "ceo", {
      forceFresh: req.query.forceFresh === "1",
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch recommendation" });
  }
});

/** Admin: regenerate top-N DVX capabilities' recs across all personas. */
router.post("/admin/dvx/refresh-recommendations", requireAdmin, async (req, res) => {
  try {
    const { refreshTopDvxRecommendations } = await import("../services/recommendations/csuite-translator");
    const topN = typeof req.body?.topN === "number" ? req.body.topN : undefined;
    const r = await refreshTopDvxRecommendations({ topN });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Refresh failed" });
  }
});

/** Admin manual recompute trigger. */
router.post("/admin/dvx/recompute", requireAdmin, async (_req, res) => {
  try {
    const result = await computeDVX();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Recompute failed" });
  }
});

export default router;
