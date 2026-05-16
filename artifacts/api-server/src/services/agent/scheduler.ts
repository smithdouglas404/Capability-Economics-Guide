import { runAgent } from "./graph";
import { emitAgentEvent } from "./events";
import { startConsolidator, stopConsolidator } from "./consolidator";
import { rotateTriangulations } from "../triangulation";
import { computeCEI } from "../cei-engine";
import { runWorldScanAllIndustries } from "../macro-events";
import { startMarketplaceAutoArchive, stopMarketplaceAutoArchive } from "../marketplace-auto-archive";
import { runDigestSweep } from "../digest";
import { runDetailEnrichment } from "../alpha/enrich";
import { getTuning } from "../agent-tuning";
import { runAllBotsTick } from "../bots/loop";
import { runCreditExpirySweep } from "../credit-expiry";
import { db } from "@workspace/db";
import { ceiComponentsTable, ceiSnapshotsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

// Routine cadence is read from agent_tuning each tick — the only fixed
// constant here is how often we *check* whether it's time to run.
const ROUTINE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;
// Bot loop tick: every hour we wake all active bots and check whether each
// has actions due per its persona cadence. The runBotTick function is
// internally idempotent — running it more often than actions are due is a
// no-op. Hourly gives quick response after a new bot is spawned without
// over-polling.
const BOT_LOOP_INTERVAL_MS = 60 * 60 * 1000;
// Credit expiry sweep runs daily. Pulls every credit_purchases row whose
// expires_at <= NOW and debits the unused portion of the batch.
const CREDIT_EXPIRY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ROTATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ROTATION_BATCH_SIZE = 10;
const URGENCY_BURST_SIZE = 3;
const WORLD_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Digest sweep ticks every 6 hours; the sweep itself filters to subscriptions
// whose lastSentAt is past their frequency cutoff (weekly/daily). Six hours
// keeps daily-frequency subscribers within their 24h window even when the
// scheduler restarts overnight.
const DIGEST_TICK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const URGENCY_CONFIDENCE_THRESHOLD = 0.35;
const URGENCY_STALE_DAYS = 10;

let routineTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let rotationTimer: ReturnType<typeof setInterval> | null = null;
let worldScanTimer: ReturnType<typeof setInterval> | null = null;
let digestTimer: ReturnType<typeof setInterval> | null = null;
let botLoopTimer: ReturnType<typeof setInterval> | null = null;
let creditExpiryTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let isRotating = false;
let isScanning = false;
let isDigesting = false;
let isBotTicking = false;
let isExpiring = false;
let lastRunAt: Date | null = null;
let lastRotationAt: Date | null = null;
let lastWorldScanAt: Date | null = null;
let lastDigestAt: Date | null = null;
let lastRotationResult: { attempted: number; succeeded: number; failed: number } | null = null;
let lastWorldScanResult: { totalInserted: number; industryCount: number } | null = null;
let lastDigestResult: { attempted: number; succeeded: number; failed: number } | null = null;
let lastRunResult: Awaited<ReturnType<typeof runAgent>> | null = null;

async function detectUrgentConditions(): Promise<{ urgent: boolean; reason: string }> {
  try {
    const components = await db.select().from(ceiComponentsTable);
    const now = Date.now();

    const veryLowConfidence = components.filter(c => c.confidence < URGENCY_CONFIDENCE_THRESHOLD);
    if (veryLowConfidence.length > 0) {
      return { urgent: true, reason: `${veryLowConfidence.length} capabilities with critically low confidence (< ${URGENCY_CONFIDENCE_THRESHOLD})` };
    }

    const veryStale = components.filter(c => {
      const staleDays = (now - new Date(c.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
      return staleDays > URGENCY_STALE_DAYS;
    });
    if (veryStale.length >= 3) {
      return { urgent: true, reason: `${veryStale.length} capabilities stale beyond ${URGENCY_STALE_DAYS} days` };
    }

    const snapshots = await db.select().from(ceiSnapshotsTable)
      .orderBy(desc(ceiSnapshotsTable.snapshotAt)).limit(2);
    if (snapshots.length === 2) {
      const drop = snapshots[1].overallIndex - snapshots[0].overallIndex;
      if (drop > 5) {
        return { urgent: true, reason: `CEI index dropped ${drop.toFixed(1)} points since last snapshot` };
      }
    }

    return { urgent: false, reason: "" };
  } catch {
    return { urgent: false, reason: "" };
  }
}

async function executeRun(trigger: string): Promise<Awaited<ReturnType<typeof runAgent>> | null> {
  if (isRunning) {
    console.log("[Agent] Skipping run — previous cycle still in progress");
    return null;
  }
  isRunning = true;
  try {
    const result = await runAgent(trigger);
    lastRunAt = new Date();
    lastRunResult = result;

    // Deterministic null-detail backfill. The agent (Sonnet) freely skips
    // run_economic_detail when alpha succeeded and sibling caps already have
    // detail rows — same skip pattern documented in commit b261198 for the
    // per-cap rerun path. Without this sweep, capability_economics rows can
    // sit with null summaryNarrative / aiExposureScore indefinitely. Per-cap
    // cost ≈ $0.06 (1 Perplexity + 1 Sonnet). Limit is admin-tunable via
    // agent_tuning.detail_backfill_limit; if 0, the sweep is skipped entirely.
    try {
      const tuning = await getTuning();
      if (tuning.detailBackfillLimit > 0) {
        const detailRes = await runDetailEnrichment({ limit: tuning.detailBackfillLimit });
        if (detailRes.enriched > 0 || detailRes.errors.length > 0) {
          console.log(`[Agent] Detail backfill (${trigger}, limit=${tuning.detailBackfillLimit}): enriched=${detailRes.enriched} errors=${detailRes.errors.length} durationMs=${detailRes.durationMs}`);
        }
      }
    } catch (detailErr) {
      console.warn("[Agent] Detail backfill failed (non-fatal):", detailErr);
    }

    return result;
  } catch (err) {
    console.error("[Agent] Run failed:", err);
    return null;
  } finally {
    isRunning = false;
  }
}

async function watchdogCheck(): Promise<void> {
  if (isRunning) return;

  const minutesSinceLast = lastRunAt
    ? (Date.now() - lastRunAt.getTime()) / 60000
    : Infinity;

  if (minutesSinceLast < 10) return;

  const { urgent, reason } = await detectUrgentConditions();
  if (urgent) {
    console.log(`[Agent] Urgent condition detected — self-triggering: ${reason}`);
    emitAgentEvent({ type: "phase", phase: "self_triggered", message: `Auto-triggered: ${reason}` });

    if (!isRotating) {
      isRotating = true;
      try {
        const stale = await db.select().from(ceiComponentsTable);
        const staleByIndustry = new Map<number, number>();
        for (const c of stale) {
          if (c.confidence < URGENCY_CONFIDENCE_THRESHOLD) {
            staleByIndustry.set(c.industryId, (staleByIndustry.get(c.industryId) || 0) + 1);
          }
        }
        const targetIndustry = [...staleByIndustry.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (targetIndustry) {
          emitAgentEvent({ type: "phase", phase: "urgency_burst", message: `Triangulation burst: ${URGENCY_BURST_SIZE} stale caps in industry ${targetIndustry}` });
          const burst = await rotateTriangulations(URGENCY_BURST_SIZE, targetIndustry);
          console.log(`[Agent] Urgency burst refreshed ${burst.succeeded}/${burst.attempted} caps`);
        }
      } catch (err) {
        console.warn("[Agent] Urgency burst failed:", err);
      } finally {
        isRotating = false;
      }
    }

    await executeRun("autonomous");
  }
}

async function executeWorldScan(trigger: string): Promise<void> {
  if (isScanning) {
    console.log("[World Scan] Skipping — previous scan in progress");
    return;
  }
  isScanning = true;
  emitAgentEvent({ type: "phase", phase: "world_scan_started", message: `World scan (${trigger}): scanning all industries` });
  try {
    const result = await runWorldScanAllIndustries();
    lastWorldScanAt = new Date();
    lastWorldScanResult = { totalInserted: result.totalInserted, industryCount: result.perIndustry.length };
    console.log(`[World Scan] Inserted ${result.totalInserted} events across ${result.perIndustry.length} industries`);
    emitAgentEvent({ type: "phase", phase: "world_scan_complete", message: `World scan: ${result.totalInserted} new events ingested` });

    // Urgency burst gate: only when an industry got at least one *severe* (>=7) event
    // from this scan. Cheaper events (sev 5-6) don't warrant blowing up the rotation queue.
    const burstTarget = result.perIndustry
      .filter(p => p.inserted > 0 && (p.maxSeverity ?? 0) >= 7)
      .sort((a, b) => (b.maxSeverity ?? 0) - (a.maxSeverity ?? 0))[0];
    if (burstTarget && !isRotating) {
      isRotating = true;
      try {
        emitAgentEvent({ type: "phase", phase: "scan_burst", message: `Macro event burst (sev ${burstTarget.maxSeverity}): ${URGENCY_BURST_SIZE} caps in ${burstTarget.industryName}` });
        await rotateTriangulations(URGENCY_BURST_SIZE, burstTarget.industryId);
      } finally {
        isRotating = false;
      }
    }

    if (result.totalInserted > 0) {
      const cei = await computeCEI();
      emitAgentEvent({ type: "cei_updated", overallIndex: cei.overallIndex, message: `CEI recomputed after world scan: ${cei.overallIndex}` });
    }
  } catch (err) {
    console.error("[World Scan] failed:", err);
  } finally {
    isScanning = false;
  }
}

export async function triggerWorldScanNow(): Promise<{ totalInserted: number; industryCount: number }> {
  if (isScanning) throw new Error("World scan already in progress");
  isScanning = true;
  try {
    const result = await runWorldScanAllIndustries();
    lastWorldScanAt = new Date();
    lastWorldScanResult = { totalInserted: result.totalInserted, industryCount: result.perIndustry.length };
    if (result.totalInserted > 0) await computeCEI();
    return lastWorldScanResult;
  } finally {
    isScanning = false;
  }
}

async function executeRotation(trigger: string): Promise<void> {
  if (isRotating) {
    console.log("[Triangulation Rotation] Skipping — previous rotation in progress");
    return;
  }
  isRotating = true;
  emitAgentEvent({ type: "phase", phase: "rotation_started", message: `Triangulation rotation (${trigger}): refreshing ${ROTATION_BATCH_SIZE} oldest caps` });
  try {
    const result = await rotateTriangulations(ROTATION_BATCH_SIZE);
    lastRotationAt = new Date();
    lastRotationResult = { attempted: result.attempted, succeeded: result.succeeded, failed: result.failed };
    emitAgentEvent({
      type: "phase",
      phase: "rotation_complete",
      message: `Rotation complete: ${result.succeeded}/${result.attempted} succeeded`,
    });
    if (result.succeeded > 0) {
      const cei = await computeCEI();
      emitAgentEvent({ type: "cei_updated", overallIndex: cei.overallIndex, message: `CEI recomputed after rotation: ${cei.overallIndex}` });
    }
  } catch (err) {
    console.error("[Triangulation Rotation] failed:", err);
  } finally {
    isRotating = false;
  }
}

/**
 * Daily credit expiry sweep. Pulls every completed credit_purchases row
 * whose expires_at <= NOW and debits the unused portion of the batch from
 * the user's balance. Idempotent (expired_processed flag prevents double-debit).
 */
async function creditExpiryTick(): Promise<void> {
  if (isExpiring) return;
  isExpiring = true;
  try {
    await runCreditExpirySweep();
  } catch (err) {
    console.warn("[CreditExpiry] sweep failed:", err);
  } finally {
    isExpiring = false;
  }
}

/**
 * Bot loop tick: wake all active bots, run any actions due per persona
 * cadence, enforce budget caps. Guarded by isBotTicking so a slow tick
 * doesn't overlap with the next hourly fire.
 */
async function botLoopTick(): Promise<void> {
  if (isBotTicking) {
    console.log("[Bots] Skipping tick — previous tick still in progress");
    return;
  }
  isBotTicking = true;
  try {
    const results = await runAllBotsTick();
    const totalActions = results.reduce((a, r) => a + r.actionsRun, 0);
    const totalSkipped = results.reduce((a, r) => a + r.actionsSkippedBudget, 0);
    const totalCostCents = results.reduce((a, r) => a + r.totalCostCents, 0);
    if (totalActions > 0 || totalSkipped > 0) {
      console.log(`[Bots] Hourly tick: ${results.length} active bot(s), ${totalActions} actions, ${totalSkipped} budget-skips, $${(totalCostCents / 100).toFixed(2)} this tick`);
    }
  } catch (err) {
    console.warn("[Bots] tick failed:", err);
  } finally {
    isBotTicking = false;
  }
}

/**
 * Routine cycle check: read the admin-tunable routine interval and run
 * executeRun("routine") if enough time has elapsed since lastRunAt. Called
 * every ROUTINE_CHECK_INTERVAL_MS — moving away from a fixed setInterval
 * means admins can change the cadence without a deploy and the new value
 * takes effect on the next check tick.
 */
async function routineCheck(): Promise<void> {
  if (isRunning) return;
  try {
    const tuning = await getTuning();
    const intervalMs = tuning.routineIntervalHours * 60 * 60 * 1000;
    const elapsed = lastRunAt ? Date.now() - lastRunAt.getTime() : Infinity;
    if (elapsed >= intervalMs) {
      await executeRun("routine");
    }
  } catch (err) {
    console.warn("[Agent] routineCheck failed (will retry next tick):", err);
  }
}

export function startScheduler(): void {
  if (routineTimer) {
    console.log("[Agent] Autonomous monitoring already active");
    return;
  }

  const checkMinutes = ROUTINE_CHECK_INTERVAL_MS / (60 * 1000);
  const watchdogMinutes = WATCHDOG_INTERVAL_MS / (60 * 1000);
  console.log(`[Agent] Autonomous monitoring started — routine cadence read from agent_tuning every ${checkMinutes}min, urgency watchdog every ${watchdogMinutes}min`);

  routineTimer = setInterval(() => routineCheck(), ROUTINE_CHECK_INTERVAL_MS);
  watchdogTimer = setInterval(() => watchdogCheck(), WATCHDOG_INTERVAL_MS);
  rotationTimer = setInterval(() => executeRotation("daily"), ROTATION_INTERVAL_MS);
  worldScanTimer = setInterval(() => executeWorldScan("daily"), WORLD_SCAN_INTERVAL_MS);
  digestTimer = setInterval(() => executeDigestSweep("routine"), DIGEST_TICK_INTERVAL_MS);
  botLoopTimer = setInterval(() => botLoopTick(), BOT_LOOP_INTERVAL_MS);
  creditExpiryTimer = setInterval(() => creditExpiryTick(), CREDIT_EXPIRY_INTERVAL_MS);

  emitAgentEvent({ type: "scheduler_started", intervalMinutes: ROUTINE_CHECK_INTERVAL_MS / 60000 });

  startConsolidator();
  startMarketplaceAutoArchive();

  executeRun("startup");

  setTimeout(() => executeRotation("startup"), 30_000);
  // Run the digest sweep once at startup but staggered so we don't pile up
  // outbound mail in the first minute after deploy.
  setTimeout(() => executeDigestSweep("startup"), 90_000);
  // Fire one bot tick shortly after boot so a freshly-provisioned bot
  // doesn't have to wait an hour to take its first action.
  setTimeout(() => botLoopTick(), 45_000);
  // Run credit expiry once at startup (staggered) so post-deploy any newly-
  // arrived expirations get processed without waiting 24h.
  setTimeout(() => creditExpiryTick(), 120_000);
}

/**
 * Admin-triggered manual bot tick. Returns a summary so the admin UI can
 * show "fired tick: 2 actions, $0.04 spent" immediately rather than waiting
 * for the next hourly fire.
 */
export async function triggerBotTickNow(): Promise<{ ok: boolean; reason?: string }> {
  if (isBotTicking) return { ok: false, reason: "bot tick already in progress" };
  await botLoopTick();
  return { ok: true };
}

export function stopScheduler(): void {
  if (routineTimer) { clearInterval(routineTimer); routineTimer = null; }
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  if (rotationTimer) { clearInterval(rotationTimer); rotationTimer = null; }
  if (worldScanTimer) { clearInterval(worldScanTimer); worldScanTimer = null; }
  if (digestTimer) { clearInterval(digestTimer); digestTimer = null; }
  if (botLoopTimer) { clearInterval(botLoopTimer); botLoopTimer = null; }
  if (creditExpiryTimer) { clearInterval(creditExpiryTimer); creditExpiryTimer = null; }
  stopConsolidator();
  stopMarketplaceAutoArchive();
  console.log("[Agent] Autonomous monitoring stopped");
  emitAgentEvent({ type: "scheduler_stopped" });
}

/**
 * Sweep the digest_subscriptions table and send digests to anyone whose
 * lastSentAt is past their per-row frequency cutoff. The sweep is internally
 * idempotent — each row is filtered by its own frequency, so calling this
 * every 6h does not double-send. Guarded by isDigesting so a slow sweep
 * doesn't overlap with the next tick.
 */
async function executeDigestSweep(trigger: string): Promise<void> {
  if (isDigesting) {
    console.log("[Digest] Sweep already in progress, skipping tick");
    return;
  }
  isDigesting = true;
  try {
    const result = await runDigestSweep();
    lastDigestAt = new Date();
    lastDigestResult = { attempted: result.attempted, succeeded: result.succeeded, failed: result.failed };
    if (result.attempted > 0) {
      console.log(`[Digest] ${trigger} sweep: attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed}`);
    }
  } catch (err) {
    console.error("[Digest] Sweep failed:", err);
  } finally {
    isDigesting = false;
  }
}

export async function triggerRotationNow(limit?: number, industryId?: number): Promise<{ attempted: number; succeeded: number; failed: number; capabilities: string[] }> {
  if (isRotating) throw new Error("Rotation already in progress");
  isRotating = true;
  try {
    const result = await rotateTriangulations(limit ?? ROTATION_BATCH_SIZE, industryId);
    lastRotationAt = new Date();
    lastRotationResult = { attempted: result.attempted, succeeded: result.succeeded, failed: result.failed };
    if (result.succeeded > 0) await computeCEI();
    return result;
  } finally {
    isRotating = false;
  }
}

export function getSchedulerStatus(): {
  active: boolean;
  isRunning: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastRunResult: Awaited<ReturnType<typeof runAgent>> | null;
  rotation: {
    isRotating: boolean;
    intervalHours: number;
    batchSize: number;
    lastRotationAt: string | null;
    lastRotationResult: { attempted: number; succeeded: number; failed: number } | null;
  };
  worldScan: {
    isScanning: boolean;
    intervalHours: number;
    lastScanAt: string | null;
    lastScanResult: { totalInserted: number; industryCount: number } | null;
  };
  digest: {
    isDigesting: boolean;
    intervalHours: number;
    lastDigestAt: string | null;
    lastDigestResult: { attempted: number; succeeded: number; failed: number } | null;
  };
} {
  return {
    active: routineTimer !== null,
    isRunning,
    // intervalMinutes here reports the check-tick frequency. The actual
    // routine cadence (what admins set in agent_tuning) is exposed via the
    // /admin/agent-tuning endpoint, not the status payload.
    intervalMinutes: ROUTINE_CHECK_INTERVAL_MS / 60000,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    lastRunResult,
    worldScan: {
      isScanning,
      intervalHours: WORLD_SCAN_INTERVAL_MS / (60 * 60 * 1000),
      lastScanAt: lastWorldScanAt?.toISOString() ?? null,
      lastScanResult: lastWorldScanResult,
    },
    rotation: {
      isRotating,
      intervalHours: ROTATION_INTERVAL_MS / (60 * 60 * 1000),
      batchSize: ROTATION_BATCH_SIZE,
      lastRotationAt: lastRotationAt?.toISOString() ?? null,
      lastRotationResult,
    },
    digest: {
      isDigesting,
      intervalHours: DIGEST_TICK_INTERVAL_MS / (60 * 60 * 1000),
      lastDigestAt: lastDigestAt?.toISOString() ?? null,
      lastDigestResult,
    },
  };
}

export async function executeScheduledRun(): Promise<Awaited<ReturnType<typeof runAgent>> | null> {
  return executeRun("routine");
}
