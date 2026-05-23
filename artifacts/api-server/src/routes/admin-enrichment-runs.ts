/**
 * Admin utilities for the enrichment_runs ledger.
 *
 *   POST /api/admin/enrichment/clear-stale
 *     body: { olderThanMinutes?: number }   (default 10)
 *
 * Updates any enrichment_runs row stuck in status="running" or "interrupted"
 * for more than N minutes to status="failed" with a synthetic completedAt.
 * The probe then reports the next freshly-completed run instead of staying
 * stuck on a long-dead row.
 *
 * Useful after a Railway container restart killed a long-running enrichment
 * mid-cycle and left the ledger inconsistent.
 */
import { Router, type Request, type Response } from "express";
import { db, enrichmentRunsTable } from "@workspace/db";
import { sql, and, inArray, lt } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

router.post("/admin/enrichment/clear-stale", requireAdmin, async (req: Request, res: Response) => {
  try {
    const olderThanMinutes = Number(req.body?.olderThanMinutes) || 10;
    const threshold = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    const updated = await db
      .update(enrichmentRunsTable)
      .set({
        status: "failed",
        completedAt: new Date(),
        errors: sql`COALESCE(${enrichmentRunsTable.errors}, '["auto-cleared: container killed mid-run"]'::jsonb)`,
      })
      .where(and(
        inArray(enrichmentRunsTable.status, ["running", "interrupted"]),
        lt(enrichmentRunsTable.startedAt, threshold),
      ))
      .returning({ id: enrichmentRunsTable.id });
    res.json({ ok: true, cleared: updated.length, ids: updated.map((r) => r.id) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
