import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { computeDisruptionRisk, getDisruptionRanking } from "../services/disruption";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/capabilities/:id/disruption-risk", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid capability id" });
    return;
  }
  try {
    const result = await computeDisruptionRisk(id);
    if (!result) {
      res.status(404).json({ error: "Capability not found" });
      return;
    }
    res.set("Cache-Control", "public, max-age=300");
    res.json(result);
  } catch (err) {
    logger.error({ err, id }, "disruption risk failed");
    res.status(500).json({ error: "Failed to compute disruption risk" });
  }
});

const RankingQuery = z.object({
  band: z.enum(["low", "moderate", "high", "critical"]).optional(),
  industryId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

router.get("/disruption/ranking", async (req, res) => {
  const parsed = RankingQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
    return;
  }
  try {
    const result = await getDisruptionRanking();
    let rows = result.rows;
    if (parsed.data.band) rows = rows.filter(r => r.band === parsed.data.band);
    if (parsed.data.industryId !== undefined) rows = rows.filter(r => r.industryId === parsed.data.industryId);
    if (parsed.data.limit) rows = rows.slice(0, parsed.data.limit);
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      generatedAt: result.generatedAt,
      ttlSeconds: result.ttlSeconds,
      rows,
      summary: {
        critical: result.rows.filter(r => r.band === "critical").length,
        high: result.rows.filter(r => r.band === "high").length,
        moderate: result.rows.filter(r => r.band === "moderate").length,
        low: result.rows.filter(r => r.band === "low").length,
      },
    });
  } catch (err) {
    logger.error({ err }, "disruption ranking failed");
    res.status(500).json({ error: "Failed to compute disruption ranking" });
  }
});

export default router;
