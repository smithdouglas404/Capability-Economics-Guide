import { Router, type IRouter, type Request, type Response } from "express";
import { db, enrichmentConfigTable, capabilitiesTable, capabilityEconomicsTable } from "@workspace/db";
import { sql, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import { requireReviewer } from "../middlewares/requireReviewer";
import { isRedisConfigured } from "../services/alpha/redis";
import { getQueueStats } from "../services/alpha/queue";
import { getCachedSchemaStatus } from "../lib/schema-check";

const router: IRouter = Router();

async function getOrCreateConfig() {
  const rows = await db.select().from(enrichmentConfigTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db
    .insert(enrichmentConfigTable)
    .values({ enabled: false, refreshDays: 30 })
    .returning();
  return created;
}

/**
 * Read the current auto-enrichment cadence config. Publicly-readable so the
 * admin UI can render state without extra auth plumbing — no secrets.
 */
router.get("/admin/enrichment/config", async (_req: Request, res: Response) => {
  const cfg = await getOrCreateConfig();
  res.json({ config: cfg });
});

const UpdateBody = z.object({
  enabled: z.boolean().optional(),
  refreshDays: z.number().int().min(1).max(365).optional(),
});

// Matches the auth bar on "Enrich Now" (requireReviewer — any signed-in
// Clerk user). The cadence toggle is no more sensitive than triggering a run.
router.put("/admin/enrichment/config", requireReviewer(), async (req: Request, res: Response) => {
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const current = await getOrCreateConfig();
  const [updated] = await db
    .update(enrichmentConfigTable)
    .set({
      enabled: parsed.data.enabled ?? current.enabled,
      refreshDays: parsed.data.refreshDays ?? current.refreshDays,
      updatedAt: new Date(),
    })
    .returning();
  res.json({ config: updated });
});

/**
 * Aggregated enrichment health — the four numbers that answer "is enrichment
 * actually working?" at a glance. Treats `capability_economics` row presence
 * as the source of truth for "enriched", since the historical
 * `enrichment_status` column drifted from reality whenever the synchronous
 * "Rerun economics" button was used.
 */
router.get("/admin/enrichment/health", async (_req: Request, res: Response) => {
  const schema = getCachedSchemaStatus();

  // Capability counts — left join surfaces caps with no economics row, which
  // is the real "needs enrichment" signal regardless of status column state.
  let capStats: { total: number; withEconomics: number; withoutEconomics: number } = {
    total: 0, withEconomics: 0, withoutEconomics: 0,
  };
  try {
    const counts = await db
      .select({
        total: sql<number>`count(*)::int`,
        withEconomics: sql<number>`count(${capabilityEconomicsTable.id})::int`,
      })
      .from(capabilitiesTable)
      .leftJoin(capabilityEconomicsTable, eq(capabilityEconomicsTable.capabilityId, capabilitiesTable.id));
    if (counts.length > 0) {
      const c = counts[0]!;
      capStats = {
        total: Number(c.total),
        withEconomics: Number(c.withEconomics),
        withoutEconomics: Number(c.total) - Number(c.withEconomics),
      };
    }
  } catch (err) {
    // Table missing — schema status will say so; leave counts at 0.
  }

  // Recent failures — most recent error per capability, capped at 5.
  let recentErrors: Array<{ capabilityId: number; name: string; error: string; updatedAt: string | null }> = [];
  try {
    const rows = await db
      .select({
        capabilityId: capabilitiesTable.id,
        name: capabilitiesTable.name,
        error: capabilitiesTable.enrichmentError,
        updatedAt: capabilitiesTable.enrichmentUpdatedAt,
      })
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.enrichmentStatus, "failed"))
      .orderBy(desc(capabilitiesTable.enrichmentUpdatedAt))
      .limit(5);
    recentErrors = rows.map(r => ({
      capabilityId: r.capabilityId,
      name: r.name,
      error: r.error ?? "(no error recorded)",
      updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
    }));
  } catch { /* ignore */ }

  // Auto-enrich config — table may be missing if schema hasn't been pushed.
  let config: { enabled: boolean; refreshDays: number; lastRunAt: string | null; lastRunEnqueued: number } | null = null;
  let configError: string | null = null;
  try {
    const rows = await db.select().from(enrichmentConfigTable).limit(1);
    if (rows.length > 0) {
      const c = rows[0]!;
      config = {
        enabled: c.enabled,
        refreshDays: c.refreshDays,
        lastRunAt: c.lastRunAt ? c.lastRunAt.toISOString() : null,
        lastRunEnqueued: c.lastRunEnqueued,
      };
    }
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
  }

  // Redis queue depth — only if redis is configured AND the queue can be
  // reached. Failure here is informational (the worker just can't run), not
  // fatal for the endpoint.
  let queue: { configured: boolean; waiting: number; active: number; delayed: number; failed: number; completed: number } | null = null;
  let queueError: string | null = null;
  if (isRedisConfigured()) {
    try {
      const stats = await getQueueStats();
      queue = {
        configured: true,
        waiting: stats.waiting,
        active: stats.active,
        delayed: stats.delayed,
        failed: stats.failed,
        completed: stats.completed,
      };
    } catch (err) {
      queueError = err instanceof Error ? err.message : String(err);
      queue = { configured: true, waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };
    }
  } else {
    queue = { configured: false, waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 };
  }

  res.json({
    schema: schema ?? { ok: null, missing: [], note: "boot check has not run yet" },
    capabilities: capStats,
    autoEnrich: { config, configError },
    queue: { ...queue, error: queueError },
    recentErrors,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
