/**
 * Admin recovery — mark stuck enrichment_runs / agent_runs as failed.
 *
 *   GET /api/admin/stuck-runs
 *     Returns runs that look stuck: status='running' or 'interrupted'
 *     with startedAt > 30 minutes ago. Both enrichment_runs and
 *     agent_runs are scanned. Operator preview — no writes.
 *
 *   POST /api/admin/stuck-runs/fail
 *     body: { "runIds"?: number[],   // specific enrichment_runs IDs
 *             "agentRunIds"?: number[],
 *             "olderThanMinutes"?: number }  (default 60)
 *     Marks the listed runs (or, if omitted, every run older than the
 *     threshold) as status='failed' with errorMessage="manually marked
 *     stuck by admin". Use this to clear `agent_enrichment: Last run
 *     #X interrupted` style degraded probes after a Railway restart
 *     killed a job mid-flight.
 *
 *   Both routes require x-admin-key.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireAdmin } from "../middlewares/requireAdmin";
import { db, enrichmentRunsTable, agentRunsTable } from "@workspace/db";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

const router: IRouter = Router();

router.get("/admin/stuck-runs", requireAdmin, async (_req: Request, res: Response) => {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000);
  const [enrichment, agent] = await Promise.all([
    db
      .select({
        id: enrichmentRunsTable.id,
        status: enrichmentRunsTable.status,
        startedAt: enrichmentRunsTable.startedAt,
        completedAt: enrichmentRunsTable.completedAt,
      })
      .from(enrichmentRunsTable)
      .where(and(
        or(eq(enrichmentRunsTable.status, "running"), eq(enrichmentRunsTable.status, "interrupted")),
        lt(enrichmentRunsTable.startedAt, cutoff),
      ))
      .limit(50),
    db
      .select({
        id: agentRunsTable.id,
        status: agentRunsTable.status,
        startedAt: agentRunsTable.startedAt,
        completedAt: agentRunsTable.completedAt,
      })
      .from(agentRunsTable)
      .where(and(
        eq(agentRunsTable.status, "running"),
        isNull(agentRunsTable.completedAt),
        lt(agentRunsTable.startedAt, cutoff),
      ))
      .limit(50),
  ]);
  res.json({
    stuckEnrichmentRuns: enrichment.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null })),
    stuckAgentRuns: agent.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null })),
    cutoff: cutoff.toISOString(),
  });
});

const FailBody = z.object({
  runIds: z.array(z.number().int().positive()).optional(),
  agentRunIds: z.array(z.number().int().positive()).optional(),
  olderThanMinutes: z.number().int().min(5).max(60 * 24 * 30).optional(),
});

router.post("/admin/stuck-runs/fail", requireAdmin, async (req: Request, res: Response) => {
  const parsed = FailBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const olderThan = parsed.data.olderThanMinutes ?? 60;
  const cutoff = new Date(Date.now() - olderThan * 60 * 1000);
  const errMsg = "manually marked stuck by admin";
  const now = new Date();

  let enrichmentFailed = 0;
  let agentFailed = 0;

  if (parsed.data.runIds && parsed.data.runIds.length > 0) {
    const r = await db
      .update(enrichmentRunsTable)
      .set({ status: "failed", errors: [errMsg], completedAt: now })
      .where(inArray(enrichmentRunsTable.id, parsed.data.runIds))
      .returning({ id: enrichmentRunsTable.id });
    enrichmentFailed = r.length;
  } else if (!parsed.data.agentRunIds) {
    // Default: bulk-fail every stuck enrichment run older than the threshold.
    const r = await db
      .update(enrichmentRunsTable)
      .set({ status: "failed", errors: [errMsg], completedAt: now })
      .where(and(
        or(eq(enrichmentRunsTable.status, "running"), eq(enrichmentRunsTable.status, "interrupted")),
        lt(enrichmentRunsTable.startedAt, cutoff),
      ))
      .returning({ id: enrichmentRunsTable.id });
    enrichmentFailed = r.length;
  }

  if (parsed.data.agentRunIds && parsed.data.agentRunIds.length > 0) {
    const r = await db
      .update(agentRunsTable)
      .set({ status: "failed", errorMessage: errMsg, completedAt: now })
      .where(inArray(agentRunsTable.id, parsed.data.agentRunIds))
      .returning({ id: agentRunsTable.id });
    agentFailed = r.length;
  } else if (!parsed.data.runIds) {
    const r = await db
      .update(agentRunsTable)
      .set({ status: "failed", errorMessage: errMsg, completedAt: now })
      .where(and(
        eq(agentRunsTable.status, "running"),
        isNull(agentRunsTable.completedAt),
        lt(agentRunsTable.startedAt, cutoff),
      ))
      .returning({ id: agentRunsTable.id });
    agentFailed = r.length;
  }

  res.json({
    ok: true,
    enrichmentFailed,
    agentFailed,
    olderThanMinutes: olderThan,
    errorMessage: errMsg,
  });
});

export default router;
