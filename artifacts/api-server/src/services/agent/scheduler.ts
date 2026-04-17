import { runAgent } from "./graph";
import { emitAgentEvent } from "./events";
import { startConsolidator, stopConsolidator } from "./consolidator";
import { rotateTriangulations } from "../triangulation";
import { computeCEI } from "../cei-engine";
import { db } from "@workspace/db";
import { ceiComponentsTable, ceiSnapshotsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const ROUTINE_INTERVAL_MS = 8 * 60 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;
const ROTATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ROTATION_BATCH_SIZE = 10;
const URGENCY_BURST_SIZE = 3;

const URGENCY_CONFIDENCE_THRESHOLD = 0.35;
const URGENCY_STALE_DAYS = 10;

let routineTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let rotationTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let isRotating = false;
let lastRunAt: Date | null = null;
let lastRotationAt: Date | null = null;
let lastRotationResult: { attempted: number; succeeded: number; failed: number } | null = null;
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

export function startScheduler(): void {
  if (routineTimer) {
    console.log("[Agent] Autonomous monitoring already active");
    return;
  }

  const routineHours = ROUTINE_INTERVAL_MS / (60 * 60 * 1000);
  const watchdogMinutes = WATCHDOG_INTERVAL_MS / (60 * 1000);
  console.log(`[Agent] Autonomous monitoring started — routine cycle every ${routineHours}h, urgency watchdog every ${watchdogMinutes}min`);

  routineTimer = setInterval(() => executeRun("routine"), ROUTINE_INTERVAL_MS);
  watchdogTimer = setInterval(() => watchdogCheck(), WATCHDOG_INTERVAL_MS);
  rotationTimer = setInterval(() => executeRotation("daily"), ROTATION_INTERVAL_MS);

  emitAgentEvent({ type: "scheduler_started", intervalMinutes: ROUTINE_INTERVAL_MS / 60000 });

  startConsolidator();

  executeRun("startup");

  setTimeout(() => executeRotation("startup"), 30_000);
}

export function stopScheduler(): void {
  if (routineTimer) { clearInterval(routineTimer); routineTimer = null; }
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  if (rotationTimer) { clearInterval(rotationTimer); rotationTimer = null; }
  stopConsolidator();
  console.log("[Agent] Autonomous monitoring stopped");
  emitAgentEvent({ type: "scheduler_stopped" });
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
} {
  return {
    active: routineTimer !== null,
    isRunning,
    intervalMinutes: ROUTINE_INTERVAL_MS / 60000,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    lastRunResult,
    rotation: {
      isRotating,
      intervalHours: ROTATION_INTERVAL_MS / (60 * 60 * 1000),
      batchSize: ROTATION_BATCH_SIZE,
      lastRotationAt: lastRotationAt?.toISOString() ?? null,
      lastRotationResult,
    },
  };
}

export async function executeScheduledRun(): Promise<Awaited<ReturnType<typeof runAgent>> | null> {
  return executeRun("routine");
}
