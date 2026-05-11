import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { runWhatIf } from "../services/whatif";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const Body = z.object({
  eventType: z.string().min(1).max(60),
  severity: z.number().min(0).max(10),
  sentimentDirection: z.enum(["positive", "negative", "neutral"]),
  decayDays: z.number().min(1).max(365).default(30),
  affectedIndustryIds: z.array(z.number().int().positive()).default([]),
  affectedCapabilityIds: z.array(z.number().int().positive()).default([]),
}).refine(d => d.affectedIndustryIds.length > 0 || d.affectedCapabilityIds.length > 0, {
  message: "Must specify at least one affected industry or capability id",
});

router.post("/whatif/macro", async (req, res) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  try {
    const result = await runWhatIf(parsed.data);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "whatif simulation failed");
    res.status(500).json({ error: "Simulation failed" });
  }
});

export default router;
