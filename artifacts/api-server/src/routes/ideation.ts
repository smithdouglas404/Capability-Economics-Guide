/**
 * Ideation generation endpoint. Auth required (no anonymous Claude calls).
 * Per-user-per-day rate limit handled by the global rateLimit middleware;
 * additionally we cap the body size to a reasonable bound to prevent abuse.
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { getAuth } from "@clerk/express";
import { runIdeation, type IdeationKind } from "../services/ideation";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const Kind: z.ZodEnum = z.enum([
  "generate_applications",
  "find_analogues",
  "critique_idea",
  "what_to_invent",
  "lifecycle_outlook",
]);

const Body = z.object({
  kind: Kind,
  capabilityName: z.string().min(1).max(200),
  capabilityDescription: z.string().min(1).max(2000),
  industryName: z.string().min(1).max(120),
  lifecycleStage: z.string().max(40).optional(),
  consensusScore: z.number().min(0).max(100).nullable().optional(),
  velocity: z.number().nullable().optional(),
  userPrompt: z.string().max(2000).optional(),
  targetIndustryName: z.string().max(120).optional(),
  targetMarketDescription: z.string().max(2000).optional(),
});

router.post("/ideation/generate", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  try {
    const result = await runIdeation(parsed.data.kind as IdeationKind, parsed.data);
    res.json(result);
  } catch (err) {
    logger.error({ err, kind: parsed.data.kind, userId: auth.userId }, "ideation generation failed");
    res.status(500).json({ error: "Ideation failed", message: (err as Error).message });
  }
});

export default router;
