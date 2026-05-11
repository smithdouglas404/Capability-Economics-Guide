import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { recommendStack } from "../services/stack-optimizer";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const Body = z.object({
  targetCapabilityIds: z.array(z.number().int().positive()).min(1).max(50),
  targetScore: z.number().min(0).max(100).optional(),
  currentCapabilityScores: z.record(z.string(), z.number().min(0).max(100)).optional(),
});

router.post("/stack-optimizer", async (req, res) => {
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  try {
    const currentScoresParsed = parsed.data.currentCapabilityScores
      ? Object.fromEntries(
          Object.entries(parsed.data.currentCapabilityScores).map(([k, v]) => [Number(k), v]),
        )
      : undefined;
    const result = await recommendStack({
      targetCapabilityIds: parsed.data.targetCapabilityIds,
      targetScore: parsed.data.targetScore,
      currentCapabilityScores: currentScoresParsed,
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "stack optimizer failed");
    res.status(500).json({ error: "Stack optimization failed" });
  }
});

export default router;
