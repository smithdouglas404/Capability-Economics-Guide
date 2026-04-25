import { Router, type IRouter, type Request, type Response } from "express";
import { db, enrichmentConfigTable, enrichmentIndustryOverridesTable, industriesTable, capabilitiesTable, capabilityEconomicsTable } from "@workspace/db";
import { sql, desc, eq, isNull, asc } from "drizzle-orm";
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
    .values({ enabled: false, refreshDays: 60 })
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
 * Per-industry override of cadence + per-industry on/off toggle. The endpoint
 * always returns one entry per industry: when there's no override row, the
 * effective cadence is the global default and `enabled` defaults to true.
 */
router.get("/admin/enrichment/industries", async (_req: Request, res: Response) => {
  const cfg = await getOrCreateConfig();
  const industries = await db.select().from(industriesTable).orderBy(asc(industriesTable.id));
  const overrides = await db.select().from(enrichmentIndustryOverridesTable);
  const overrideByIndustry = new Map(overrides.map(o => [o.industryId, o]));

  // Per-industry counts: total caps and how many already have economics rows.
  const counts = await db
    .select({
      industryId: capabilitiesTable.industryId,
      total: sql<number>`count(*)::int`,
      withEconomics: sql<number>`count(${capabilityEconomicsTable.id})::int`,
    })
    .from(capabilitiesTable)
    .leftJoin(capabilityEconomicsTable, eq(capabilityEconomicsTable.capabilityId, capabilitiesTable.id))
    .groupBy(capabilitiesTable.industryId);
  const countByIndustry = new Map(counts.map(c => [c.industryId, c]));

  const rows = industries.map(ind => {
    const o = overrideByIndustry.get(ind.id);
    const c = countByIndustry.get(ind.id);
    return {
      industryId: ind.id,
      industrySlug: ind.slug,
      industryName: ind.name,
      enabled: o?.enabled ?? true,
      refreshDays: o?.refreshDays ?? cfg.refreshDays,
      hasOverride: o !== undefined,
      capabilities: { total: Number(c?.total ?? 0), withEconomics: Number(c?.withEconomics ?? 0) },
    };
  });
  res.json({ globalDefault: { enabled: cfg.enabled, refreshDays: cfg.refreshDays }, industries: rows });
});

const IndustryOverrideBody = z.object({
  enabled: z.boolean().optional(),
  refreshDays: z.number().int().min(1).max(365).optional(),
});

router.put("/admin/enrichment/industries/:industryId", requireReviewer(), async (req: Request, res: Response) => {
  const industryId = Number(req.params.industryId);
  if (!Number.isFinite(industryId)) { res.status(400).json({ error: "bad industryId" }); return; }
  const parsed = IndustryOverrideBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId));
  if (!industry) { res.status(404).json({ error: "industry not found" }); return; }

  const cfg = await getOrCreateConfig();
  const [existing] = await db.select().from(enrichmentIndustryOverridesTable).where(eq(enrichmentIndustryOverridesTable.industryId, industryId));

  if (existing) {
    const [updated] = await db.update(enrichmentIndustryOverridesTable).set({
      enabled: parsed.data.enabled ?? existing.enabled,
      refreshDays: parsed.data.refreshDays ?? existing.refreshDays,
      updatedAt: new Date(),
    }).where(eq(enrichmentIndustryOverridesTable.id, existing.id)).returning();
    res.json({ override: updated });
    return;
  }

  const [created] = await db.insert(enrichmentIndustryOverridesTable).values({
    industryId,
    enabled: parsed.data.enabled ?? true,
    refreshDays: parsed.data.refreshDays ?? cfg.refreshDays,
  }).returning();
  res.status(201).json({ override: created });
});

/**
 * Remove an industry override so the industry falls back to the global
 * default. Useful when an admin wants to revert a custom cadence.
 */
router.delete("/admin/enrichment/industries/:industryId", requireReviewer(), async (req: Request, res: Response) => {
  const industryId = Number(req.params.industryId);
  if (!Number.isFinite(industryId)) { res.status(400).json({ error: "bad industryId" }); return; }
  await db.delete(enrichmentIndustryOverridesTable).where(eq(enrichmentIndustryOverridesTable.industryId, industryId));
  res.json({ ok: true });
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

  // Sub-capability decomposition parity — surfaces dev/staging drift. Counts
  // approved top-level caps that have no children. The boot backfill should
  // drive this to zero on every restart.
  let decompositionParity: { totalTopLevel: number; decomposed: number; missing: number } = {
    totalTopLevel: 0, decomposed: 0, missing: 0,
  };
  try {
    const decompCounts = await db.execute(sql`
      WITH parents AS (
        SELECT id FROM capabilities
        WHERE parent_capability_id IS NULL AND review_status = 'approved'
      ),
      have_children AS (
        SELECT DISTINCT parent_capability_id AS id FROM capabilities WHERE parent_capability_id IS NOT NULL
      )
      SELECT
        (SELECT COUNT(*)::int FROM parents) AS total,
        (SELECT COUNT(*)::int FROM parents p WHERE p.id IN (SELECT id FROM have_children)) AS decomposed
    `);
    const decompRows = (decompCounts as unknown as { rows?: { total: number; decomposed: number }[] }).rows ?? [];
    if (decompRows.length > 0) {
      const r = decompRows[0]!;
      decompositionParity = {
        totalTopLevel: Number(r.total),
        decomposed: Number(r.decomposed),
        missing: Number(r.total) - Number(r.decomposed),
      };
    }
  } catch { /* table may be missing; surfaced via schema check */ }

  res.json({
    schema: schema ?? { ok: null, missing: [], note: "boot check has not run yet" },
    capabilities: capStats,
    decompositionParity,
    autoEnrich: { config, configError },
    queue: { ...queue, error: queueError },
    recentErrors,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
