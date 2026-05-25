import { Router, type IRouter, type Request, type Response } from "express";
import { db, agentSchedulesTable } from "@workspace/db";
import { asc, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { PER_CYCLE_COST_USD, estimateMonthlyCost } from "../services/agent/scheduling";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use("/admin/agent-schedules", requireAdmin);

/**
 * GET /api/admin/agent-schedules
 * Returns all schedule rows with computed cost estimates so the UI can
 * render "current monthly spend" + "after-change spend" without doing the
 * math client-side.
 *
 * Schedules + per-cycle cost defaults live in services/agent/scheduling.ts.
 */
router.get("/admin/agent-schedules", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(agentSchedulesTable)
      .orderBy(asc(agentSchedulesTable.agentName));
    const enriched = rows.map((r) => ({
      ...r,
      perCycleCostUsd: PER_CYCLE_COST_USD[r.agentName] ?? 0.05,
      estimatedMonthlyCostUsd: estimateMonthlyCost(r.agentName, r.intervalSeconds),
    }));
    const totalMonthly = enriched
      .filter((r) => r.enabled)
      .reduce((sum, r) => sum + r.estimatedMonthlyCostUsd, 0);
    res.json({ schedules: enriched, totalMonthlyEstimateUsd: totalMonthly });
  } catch (err) {
    logger.error({ err }, "GET /admin/agent-schedules failed");
    res.status(500).json({ error: "read failed" });
  }
});

/**
 * PUT /api/admin/agent-schedules/:agentName
 * Body: { intervalSeconds?: number; enabled?: boolean; description?: string }
 *
 * Lower-bound: 60s. We don't enforce an upper bound here, but the static
 * Inngest cron is the actual ceiling — see comments in
 * inngest/functions/agents.ts. Any interval smaller than the cron rate
 * effectively gets rounded UP to the cron rate.
 */
router.put("/admin/agent-schedules/:agentName", async (req: Request, res: Response) => {
  const agentName = String(req.params.agentName ?? "");
  const { intervalSeconds, enabled, description } = req.body ?? {};

  const updates: Partial<{
    intervalSeconds: number;
    enabled: boolean;
    description: string | null;
    updatedAt: Date;
    updatedBy: string;
  }> = {};
  if (typeof intervalSeconds === "number") {
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 60) {
      res.status(400).json({ error: "intervalSeconds must be a finite number >= 60" });
      return;
    }
    updates.intervalSeconds = Math.round(intervalSeconds);
  }
  if (typeof enabled === "boolean") {
    updates.enabled = enabled;
  }
  if (typeof description === "string") {
    updates.description = description;
  }
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "no fields to update" });
    return;
  }

  updates.updatedAt = new Date();
  updates.updatedBy = getAuth(req).userId ?? "unknown";

  try {
    const [updated] = await db
      .update(agentSchedulesTable)
      .set(updates)
      .where(eq(agentSchedulesTable.agentName, agentName))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "no schedule row for that agent" });
      return;
    }
    res.json({
      ok: true,
      schedule: {
        ...updated,
        perCycleCostUsd: PER_CYCLE_COST_USD[updated.agentName] ?? 0.05,
        estimatedMonthlyCostUsd: estimateMonthlyCost(
          updated.agentName,
          updated.intervalSeconds,
        ),
      },
    });
  } catch (err) {
    logger.error({ err, agentName }, "PUT /admin/agent-schedules failed");
    res.status(500).json({ error: "write failed" });
  }
});

export default router;
