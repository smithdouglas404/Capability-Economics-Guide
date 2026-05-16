/**
 * Public-facing disruption + net-new capability feeds. Both are read-only
 * derivations of existing data (cvi_components + capabilities + macro_events).
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { getDisruptionWatch } from "../services/disruption";
import { getNewCapabilityWatch } from "../services/new-capabilities";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const WatchQuery = z.object({
  minBand: z.enum(["low", "moderate", "high", "critical"]).optional(),
  minVelocity: z.coerce.number().optional(),
  requireMacroEvent: z.union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")]).optional(),
  maxAgeMonths: z.coerce.number().int().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get("/disruption/watch", async (req, res) => {
  const parsed = WatchQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
    return;
  }
  try {
    const requireMacro = parsed.data.requireMacroEvent === undefined
      ? undefined
      : parsed.data.requireMacroEvent === "1" || parsed.data.requireMacroEvent === "true";
    const result = await getDisruptionWatch({
      minBand: parsed.data.minBand,
      minVelocity: parsed.data.minVelocity,
      requireMacroEvent: requireMacro,
      maxAgeMonths: parsed.data.maxAgeMonths,
      limit: parsed.data.limit,
    });
    res.set("Cache-Control", "public, max-age=300");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "disruption watch failed");
    res.status(500).json({ error: "Watch failed" });
  }
});

const NewQuery = z.object({
  maxAgeMonths: z.coerce.number().int().min(1).max(120).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  industryId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

router.get("/capabilities/new", async (req, res) => {
  const parsed = NewQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
    return;
  }
  try {
    const result = await getNewCapabilityWatch(parsed.data);
    res.set("Cache-Control", "public, max-age=300");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "new-capability watch failed");
    res.status(500).json({ error: "Watch failed" });
  }
});

export default router;
