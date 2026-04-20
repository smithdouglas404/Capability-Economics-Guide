import { db, enrichmentConfigTable, capabilitiesTable, capabilityEconomicsTable } from "@workspace/db";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { enqueueEnrichmentJob } from "./queue";
import { isRedisConfigured } from "./redis";
import { logger } from "../../lib/logger";

const TICK_INTERVAL_MS = 60 * 60 * 1000; // hourly

let timer: ReturnType<typeof setInterval> | null = null;
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

export function startAutoEnrich(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
  // Fire an opportunistic check 2 minutes after boot so a freshly-enabled
  // config doesn't wait an hour for its first run.
  setTimeout(() => void tick(), 2 * 60 * 1000);
  logger.info({ intervalMinutes: TICK_INTERVAL_MS / 60000 }, "[auto-enrich] scheduler started");
}

export function stopAutoEnrich(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
