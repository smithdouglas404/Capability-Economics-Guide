import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { findAnalogues } from "../services/analogues";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const Query = z.object({
  industryId: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

router.get("/capabilities/:id/analogues", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid capability id" });
    return;
  }
  const parsed = Query.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
    return;
  }
  try {
    const result = await findAnalogues({
      capabilityId: id,
      targetIndustryId: parsed.data.industryId,
      limit: parsed.data.limit,
    });
    if (!result) { res.status(404).json({ error: "Capability or target industry not found" }); return; }
    res.set("Cache-Control", "public, max-age=300");
    res.json(result);
  } catch (err) {
    logger.error({ err, id, industryId: parsed.data.industryId }, "analogues failed");
    res.status(500).json({ error: "Analogue search failed" });
  }
});

export default router;
