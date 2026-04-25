import { Router, type IRouter, type Request, type Response } from "express";
import { db, enrichmentConfigTable, enrichmentIndustryOverridesTable, industriesTable, capabilitiesTable, capabilityEconomicsTable, enrichmentRunsTable } from "@workspace/db";
import { sql, desc, eq, gt, asc, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireReviewer } from "../middlewares/requireReviewer";
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

  // Agent run history — replaces the BullMQ queue depth tile. Reads recent
  // enrichment_runs rows; "running" rows count as "active" runs, completed
  // rows give a lifetime success/failure tally.
  let runs: { running: number; completedToday: number; failedToday: number; lifetimeCompleted: number; lifetimeFailed: number; lastCompletedAt: string | null } = {
    running: 0, completedToday: 0, failedToday: 0, lifetimeCompleted: 0, lifetimeFailed: 0, lastCompletedAt: null,
  };
  let runsError: string | null = null;
  try {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const [running] = await db.select({ c: sql<number>`count(*)::int` }).from(enrichmentRunsTable).where(eq(enrichmentRunsTable.status, "running"));
    const [completedToday] = await db.select({ c: sql<number>`count(*)::int` }).from(enrichmentRunsTable).where(and(eq(enrichmentRunsTable.status, "completed"), gt(enrichmentRunsTable.completedAt, todayStart)));
    const [completedErrToday] = await db.select({ c: sql<number>`count(*)::int` }).from(enrichmentRunsTable).where(and(eq(enrichmentRunsTable.status, "completed_with_errors"), gt(enrichmentRunsTable.completedAt, todayStart)));
    const [failedToday] = await db.select({ c: sql<number>`count(*)::int` }).from(enrichmentRunsTable).where(and(eq(enrichmentRunsTable.status, "failed"), gt(enrichmentRunsTable.completedAt, todayStart)));
    const [lifetimeOk] = await db.select({ c: sql<number>`count(*)::int` }).from(enrichmentRunsTable).where(eq(enrichmentRunsTable.status, "completed"));
    const [lifetimeFail] = await db.select({ c: sql<number>`count(*)::int` }).from(enrichmentRunsTable).where(eq(enrichmentRunsTable.status, "failed"));
    const [lastCompleted] = await db.select({ at: enrichmentRunsTable.completedAt }).from(enrichmentRunsTable).where(eq(enrichmentRunsTable.status, "completed")).orderBy(desc(enrichmentRunsTable.completedAt)).limit(1);
    runs = {
      running: Number(running?.c ?? 0),
      completedToday: Number(completedToday?.c ?? 0) + Number(completedErrToday?.c ?? 0),
      failedToday: Number(failedToday?.c ?? 0),
      lifetimeCompleted: Number(lifetimeOk?.c ?? 0),
      lifetimeFailed: Number(lifetimeFail?.c ?? 0),
      lastCompletedAt: lastCompleted?.at ? lastCompleted.at.toISOString() : null,
    };
  } catch (err) {
    runsError = err instanceof Error ? err.message : String(err);
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

  // Silent-failure detection. The scheduler can claim "I enqueued 128 caps"
  // and the queue can claim "I completed 6 jobs" while the worker silently
  // produces zero new economics rows (the BullMQ-jobid-dedupe bug, the
  // missing-table-throws-silently bug, etc.). Detecting it: if the last
  // tick claimed work and 15+ minutes have passed but zero new economics
  // rows have generated_at > lastRunAt, that's a stuck pipeline.
  let silentFailure: null | {
    lastTickAt: string;
    enqueuedCount: number;
    minutesSinceTick: number;
    newEconomicsSinceTick: number;
    message: string;
  } = null;
  if (config?.lastRunAt && config.lastRunEnqueued > 0) {
    const lastRunAt = new Date(config.lastRunAt);
    const minutesSince = (Date.now() - lastRunAt.getTime()) / 60000;
    if (minutesSince > 15) {
      try {
        const newRows = await db
          .select({ id: capabilityEconomicsTable.id })
          .from(capabilityEconomicsTable)
          .where(gt(capabilityEconomicsTable.generatedAt, lastRunAt))
          .limit(1);
        if (newRows.length === 0) {
          silentFailure = {
            lastTickAt: config.lastRunAt,
            enqueuedCount: config.lastRunEnqueued,
            minutesSinceTick: Math.round(minutesSince),
            newEconomicsSinceTick: 0,
            message: `Tick at ${config.lastRunAt} enqueued ${config.lastRunEnqueued} capabilities ${Math.round(minutesSince)} minutes ago, but zero new economics rows have been written since. Worker is stuck or queue is broken.`,
          };
        }
      } catch { /* ignore */ }
    }
  }

  res.json({
    schema: schema ?? { ok: null, missing: [], note: "boot check has not run yet" },
    capabilities: capStats,
    decompositionParity,
    autoEnrich: { config, configError },
    runs: { ...runs, error: runsError },
    recentErrors,
    silentFailure,
    generatedAt: new Date().toISOString(),
  });
});

export default router;
