import { Router, type IRouter, type Request, type Response } from "express";
import { db, systemFlagsTable } from "@workspace/db";
import { getAuth } from "@clerk/express";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  setFlag,
  invalidateFlagCache,
  isLlmEnabled,
  getMaintenanceMessage,
} from "../services/system-flags";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use("/admin/system-flags", requireAdmin);

/**
 * GET /api/admin/system-flags
 * Returns every flag row + computed convenience fields the UI binds to.
 * Always returns 200 even if the table is empty — UI shows fallbacks.
 */
router.get("/admin/system-flags", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(systemFlagsTable);
    const flags = Object.fromEntries(rows.map((r) => [r.flagName, r]));
    res.json({
      flags,
      // Convenience fields — the two flags the maintenance gate cares about.
      llmEnabled: await isLlmEnabled(),
      maintenanceMessage: await getMaintenanceMessage(),
    });
  } catch (err) {
    logger.error({ err }, "GET /admin/system-flags failed");
    // Fall through to a safe default so the admin UI never blocks itself.
    res.json({ flags: {}, llmEnabled: true, maintenanceMessage: "" });
  }
});

/**
 * PUT /api/admin/system-flags/:flagName
 * Body: { flagValue: string, description?: string }
 * Upserts the row. Cache is invalidated immediately so the new value
 * takes effect on the next request.
 */
router.put("/admin/system-flags/:flagName", async (req: Request, res: Response) => {
  const flagName = String(req.params.flagName ?? "");
  const { flagValue, description } = req.body ?? {};
  if (typeof flagValue !== "string") {
    res.status(400).json({ error: "flagValue (string) required" });
    return;
  }
  const userId = getAuth(req).userId ?? "unknown";
  const desc = typeof description === "string" ? description : undefined;
  try {
    await setFlag(flagName, flagValue, userId, desc);
    invalidateFlagCache(flagName);
    res.json({ ok: true, flagName, flagValue });
  } catch (err) {
    logger.error({ err, flagName }, "PUT /admin/system-flags failed");
    res.status(500).json({ error: "write failed" });
  }
});

/**
 * Convenience POST endpoint for the big red kill switch in the UI.
 * Body: { enabled: boolean, message?: string }
 * Sets llm_enabled and (optionally) maintenance_message in one call.
 */
router.post("/admin/system-flags/llm-toggle", async (req: Request, res: Response) => {
  const { enabled, message } = req.body ?? {};
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled (boolean) required" });
    return;
  }
  const userId = getAuth(req).userId ?? "unknown";
  try {
    await setFlag(
      "llm_enabled",
      enabled ? "true" : "false",
      userId,
      "Master kill switch for all LLM calls + maintenance mode",
    );
    if (typeof message === "string" && message.length > 0) {
      await setFlag("maintenance_message", message, userId);
    }
    invalidateFlagCache();
    res.json({ ok: true, llmEnabled: enabled });
  } catch (err) {
    logger.error({ err }, "POST llm-toggle failed");
    res.status(500).json({ error: "write failed" });
  }
});

export default router;
