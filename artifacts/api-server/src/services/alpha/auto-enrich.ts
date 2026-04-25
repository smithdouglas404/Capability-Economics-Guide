import { db, enrichmentConfigTable, capabilitiesTable, capabilityEconomicsTable } from "@workspace/db";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
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
  const [created] = await db.insert(enrichmentConfigTable).values({ enabled: false, refreshDays: 30 }).returning();
  return created;
}

/**
 * Find capabilities whose economics row is either missing or older than
 * `refreshDays`. Enqueue alpha jobs (the worker handles rate-limiting and
 * per-capability concurrency).
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

    const cutoff = sql`now() - (${cfg.refreshDays}::int * interval '1 day')`;
    const stale = await db
      .select({ id: capabilitiesTable.id, industryId: capabilitiesTable.industryId })
      .from(capabilitiesTable)
      .leftJoin(capabilityEconomicsTable, eq(capabilityEconomicsTable.capabilityId, capabilitiesTable.id))
      .where(or(
        isNull(capabilityEconomicsTable.id),
        lt(capabilityEconomicsTable.generatedAt, cutoff),
      ));

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

    let enqueued = 0;
    for (const [industryId, capIds] of byIndustry) {
      try {
        await enqueueEnrichmentJob(
          "alpha",
          { industryId, limitCapabilities: capIds.length, limitEdges: 15 },
          { industryId },
        );
        enqueued += capIds.length;
      } catch (err) {
        logger.error({ err, industryId }, "[auto-enrich] enqueue failed");
      }
    }

    await db.update(enrichmentConfigTable)
      .set({ lastRunAt: new Date(), lastRunEnqueued: enqueued })
      .where(eq(enrichmentConfigTable.id, cfg.id));
    logger.info({ industries: byIndustry.size, enqueued, staleCount: stale.length }, "[auto-enrich] tick enqueued");
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
