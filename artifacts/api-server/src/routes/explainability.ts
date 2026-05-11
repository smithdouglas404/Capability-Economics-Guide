import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { explainCapabilityChange } from "../services/explainability";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const Query = z.object({
  windowDays: z.coerce.number().int().min(1).max(365).optional(),
});

router.get("/capabilities/:id/explain", async (req, res) => {
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
    const result = await explainCapabilityChange(id, parsed.data.windowDays ?? 30);
    if (!result) {
      res.status(404).json({ error: "Capability not found" });
      return;
    }
    res.set("Cache-Control", "public, max-age=300");
    res.json(result);
  } catch (err) {
    logger.error({ err, id }, "explain capability failed");
    res.status(500).json({ error: "Failed to compute explanation" });
  }
});

export default router;
