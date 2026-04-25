import { db, enrichmentConfigTable, enrichmentIndustryOverridesTable, capabilitiesTable, capabilityEconomicsTable } from "@workspace/db";
import { and, eq, gt, isNull, lt, or, sql, inArray } from "drizzle-orm";
import { Queue, Worker } from "bullmq";
import { enqueueEnrichmentJob } from "./queue";
import { getRedis, isRedisConfigured } from "./redis";
import { logger } from "../../lib/logger";

const TICK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const SCHEDULER_QUEUE = "enrichment-scheduler";
const SCHEDULER_JOB_NAME = "auto-enrich-tick";

let schedulerQueue: Queue | null = null;
let schedulerWorker: Worker | null = null;
let ticking = false;

async function loadConfig() {
  const rows = await db.select().from(enrichmentConfigTable).limit(1);
  if (rows.length > 0) return rows[0];
  const [created] = await db.insert(enrichmentConfigTable).values({ enabled: false, refreshDays: 60 }).returning();
  return created;
}

/**
 * Find capabilities whose economics row is missing or older than the
 * effective `refreshDays` for their industry, then enqueue alpha jobs.
 *
 * Effective config:
 *   - If global `enabled` is false → no industry runs (master kill-switch).
 *   - If a per-industry override row exists, use its `enabled` + `refreshDays`.
 *   - Otherwise fall back to the global `refreshDays`.
 */
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const cfg = await loadConfig();
    if (!cfg.enabled) return;
    if (!isRedisConfigured()) {
      logger.warn("[auto-enrich] config enabled but REDIS_URL not set — skipping tick");
      return;
    }

    // SILENT-FAILURE DETECTOR — at the START of each tick, look at how the
    // PREVIOUS tick ended. If it claimed to enqueue work but produced zero
    // new capability_economics rows since it ran, scream loudly. This is
    // the second silent-failure bug we've hit in this pipeline; the
    // detector ensures any future regression of the same shape is visible
    // in seconds, not days.
    if (cfg.lastRunAt && cfg.lastRunEnqueued > 0) {
      const minutesSince = (Date.now() - cfg.lastRunAt.getTime()) / 60000;
      // Give the previous tick at least 15 min to actually do work before
      // calling it stuck — alpha enrichments take 1-3 min apiece.
      if (minutesSince > 15) {
        const newRows = await db
          .select({ id: capabilityEconomicsTable.id })
          .from(capabilityEconomicsTable)
          .where(gt(capabilityEconomicsTable.generatedAt, cfg.lastRunAt))
          .limit(1);
        if (newRows.length === 0) {
          logger.error({
            lastTickAt: cfg.lastRunAt.toISOString(),
            enqueuedCount: cfg.lastRunEnqueued,
            minutesSinceTick: Math.round(minutesSince),
          }, "[auto-enrich] SILENT FAILURE: previous tick enqueued work but produced zero new economics rows. Worker may be stuck or queue dedupe is broken.");
        }
      }
    }

    // Build the "effective settings per industry" map. Industries without an
    // override row get the global default; industries with override.enabled =
    // false get skipped entirely.
    const overrides = await db.select().from(enrichmentIndustryOverridesTable);
    const overrideByIndustry = new Map(overrides.map(o => [o.industryId, o]));
    const skippedIndustries = new Set(overrides.filter(o => !o.enabled).map(o => o.industryId));

    // Collect all candidate caps (any industry not explicitly disabled), then
    // filter by per-industry refreshDays in JS — simpler than dynamic SQL.
    const candidateCaps = await db
      .select({
        id: capabilitiesTable.id,
        industryId: capabilitiesTable.industryId,
        economicsId: capabilityEconomicsTable.id,
        generatedAt: capabilityEconomicsTable.generatedAt,
      })
      .from(capabilitiesTable)
      .leftJoin(capabilityEconomicsTable, eq(capabilityEconomicsTable.capabilityId, capabilitiesTable.id));

    const now = Date.now();
    const stale: Array<{ id: number; industryId: number }> = [];
    for (const row of candidateCaps) {
      if (skippedIndustries.has(row.industryId)) continue;
      const effectiveDays = overrideByIndustry.get(row.industryId)?.refreshDays ?? cfg.refreshDays;
      const cutoffMs = now - effectiveDays * 24 * 60 * 60 * 1000;
      const isMissing = row.economicsId === null;
      const isOld = row.generatedAt !== null && row.generatedAt.getTime() < cutoffMs;
      if (isMissing || isOld) stale.push({ id: row.id, industryId: row.industryId });
    }

    if (stale.length === 0) {
      logger.info("[auto-enrich] nothing stale — skipping enqueue");
      await db.update(enrichmentConfigTable)
        .set({ lastRunAt: new Date(), lastRunEnqueued: 0 })
        .where(eq(enrichmentConfigTable.id, cfg.id));
      return;
    }

    // Batch the run by industry so one enqueue kicks off one industry's refresh
    const byIndustry = new Map<number, number[]>();
    for (const row of stale) {
      const arr = byIndustry.get(row.industryId) ?? [];
      arr.push(row.id);
      byIndustry.set(row.industryId, arr);
    }

    // Single agentic entry point — fire one graph invocation per tick that
    // covers ALL stale industries in one orchestrated run. The graph handles
    // alpha + detail + quadrants + value chain + companies + memory in a
    // single state machine instead of separate fire-and-forget BullMQ jobs.
    let enqueued = 0;
    const targetIndustryIds = [...byIndustry.keys()];
    try {
      const { runEnrichmentGraph } = await import("./graph-trigger");
      await runEnrichmentGraph(targetIndustryIds);
      enqueued = stale.length;
    } catch (err) {
      logger.error({ err, targetIndustryIds }, "[auto-enrich] graph invocation failed");
    }

    await db.update(enrichmentConfigTable)
      .set({ lastRunAt: new Date(), lastRunEnqueued: enqueued })
      .where(eq(enrichmentConfigTable.id, cfg.id));
    logger.info({ industries: byIndustry.size, enqueued, staleCount: stale.length, skippedIndustries: [...skippedIndustries] }, "[auto-enrich] tick enqueued");
  } catch (err) {
    logger.error({ err }, "[auto-enrich] tick failed");
  } finally {
    ticking = false;
  }
}

/**
 * Register the hourly tick as a BullMQ repeatable job. The schedule lives in
 * Redis, so it survives api-server restarts/redeploys: when any process comes
 * back online, BullMQ picks up the next scheduled fire time. If Redis isn't
 * configured we silently skip — same graceful-degrade behaviour as the rest
 * of the alpha pipeline.
 */
export async function startAutoEnrich(): Promise<void> {
  if (schedulerQueue) return;
  if (!isRedisConfigured()) {
    logger.warn("[auto-enrich] REDIS_URL not set — repeatable scheduler not starting");
    return;
  }

  schedulerQueue = new Queue(SCHEDULER_QUEUE, {
    connection: getRedis(),
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  });

  // Repeatable job. The repeat key is derived from the options + jobId, so
  // calling addRepeatable() with the same args is a no-op — safe to call on
  // every boot. `every` fires hourly from registration time.
  await schedulerQueue.add(SCHEDULER_JOB_NAME, {}, {
    repeat: { every: TICK_INTERVAL_MS },
    jobId: SCHEDULER_JOB_NAME,
  });

  schedulerWorker = new Worker(SCHEDULER_QUEUE, async () => { await tick(); }, {
    connection: getRedis(),
    // One tick at a time across all workers — prevents two replicas from
    // both running the same hourly tick.
    concurrency: 1,
  });
  schedulerWorker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "[auto-enrich] tick worker failed");
  });

  // Post-boot opportunistic kick — gives a freshly-enabled config a fast
  // first run instead of waiting up to an hour for the first repeatable fire.
  setTimeout(() => void tick(), 2 * 60 * 1000);

  logger.info({ intervalMinutes: TICK_INTERVAL_MS / 60000 }, "[auto-enrich] BullMQ repeatable scheduler registered");
}

export async function stopAutoEnrich(): Promise<void> {
  await schedulerWorker?.close();
  await schedulerQueue?.close();
  schedulerWorker = null;
  schedulerQueue = null;
}
