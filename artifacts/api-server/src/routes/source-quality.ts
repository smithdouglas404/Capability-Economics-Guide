import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { getSourceQualityAudit, getCapabilityQuality } from "../services/source-quality";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ListQuery = z.object({
  industryId: z.coerce.number().int().positive().optional(),
  severity: z.enum(["critical", "warning", "ok"]).optional(),
  flag: z.enum([
    "stale",
    "single_source",
    "no_consulting_corroboration",
    "low_confidence",
    "wide_credible_interval",
    "seed_only",
    "no_evidence",
  ]).optional(),
  leafOnly: z.union([z.literal("1"), z.literal("true")]).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

router.get("/admin/source-quality", requireAdmin, async (req, res) => {
  try {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
      return;
    }
    const audit = await getSourceQualityAudit();
    let rows = audit.capabilities;
    const q = parsed.data;
    if (q.industryId !== undefined) rows = rows.filter(r => r.industryId === q.industryId);
    if (q.severity) rows = rows.filter(r => r.severity === q.severity);
    if (q.flag) rows = rows.filter(r => r.flags.includes(q.flag!));
    if (q.leafOnly === "1" || q.leafOnly === "true") rows = rows.filter(r => r.isLeaf);
    if (q.limit) rows = rows.slice(0, q.limit);

    res.json({
      generatedAt: audit.generatedAt,
      ttlSeconds: audit.ttlSeconds,
      summary: audit.summary,
      capabilities: rows,
    });
  } catch (err) {
    logger.error({ err }, "source-quality audit failed");
    res.status(500).json({ error: "Failed to compute source quality" });
  }
});

router.get("/capabilities/:id/quality", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid capability id" });
    return;
  }
  try {
    const row = await getCapabilityQuality(id);
    if (!row) {
      res.status(404).json({ error: "Capability not found" });
      return;
    }
    res.set("Cache-Control", "public, max-age=300");
    res.json(row);
  } catch (err) {
    logger.error({ err, id }, "capability quality failed");
    res.status(500).json({ error: "Failed to compute capability quality" });
  }
});

export default router;
