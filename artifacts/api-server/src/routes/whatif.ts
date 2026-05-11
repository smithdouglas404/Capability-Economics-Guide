import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { runWhatIf } from "../services/whatif";
import { listActiveEvents } from "../services/macro-events";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * GET /api/whatif/presets
 *
 * Up to 5 recent active macro events for the "Suggested" quick-select
 * buttons on /whatif. Replaces the hardcoded SUGGESTED_EVENTS array in
 * pages/whatif.tsx:65-71. Sourced from the macro_events table that the
 * world-scanner populates. Empty array when no events exist yet — the
 * frontend should hide the suggestions section in that case.
 */
router.get("/whatif/presets", async (_req, res) => {
  try {
    const events = await listActiveEvents();
    const presets = events
      .slice(0, 5)
      .map((e: any) => ({
        label: e.title ?? e.eventType,
        eventType: e.eventType,
        severity: e.severity ?? 5,
        direction: e.sentimentDirection ?? "negative",
        decayDays: e.decayDays ?? 90,
      }));
    res.json({ presets });
  } catch (err) {
    logger.error({ err }, "[whatif/presets] failed");
    res.status(500).json({ presets: [], error: "failed" });
  }
});

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
