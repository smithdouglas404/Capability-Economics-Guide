import { runAgent } from "./graph";
import { emitAgentEvent } from "./events";
import { db } from "@workspace/db";
import { ceiComponentsTable, ceiSnapshotsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const ROUTINE_INTERVAL_MS = 30 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;

const URGENCY_CONFIDENCE_THRESHOLD = 0.35;
const URGENCY_STALE_DAYS = 10;

let routineTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let lastRunAt: Date | null = null;
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
    await executeRun("autonomous");
  }
}

export function startScheduler(): void {
  if (routineTimer) {
    console.log("[Agent] Autonomous monitoring already active");
    return;
  }

  console.log("[Agent] Autonomous monitoring started — routine cycle every 30min, urgency watchdog every 5min");

  routineTimer = setInterval(() => executeRun("routine"), ROUTINE_INTERVAL_MS);
  watchdogTimer = setInterval(() => watchdogCheck(), WATCHDOG_INTERVAL_MS);

  emitAgentEvent({ type: "scheduler_started", intervalMinutes: ROUTINE_INTERVAL_MS / 60000 });

  executeRun("startup");
}

export function stopScheduler(): void {
  if (routineTimer) { clearInterval(routineTimer); routineTimer = null; }
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  console.log("[Agent] Autonomous monitoring stopped");
  emitAgentEvent({ type: "scheduler_stopped" });
}

export function getSchedulerStatus(): {
  active: boolean;
  isRunning: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastRunResult: Awaited<ReturnType<typeof runAgent>> | null;
} {
  return {
    active: routineTimer !== null,
    isRunning,
    intervalMinutes: ROUTINE_INTERVAL_MS / 60000,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    lastRunResult,
  };
}

export async function executeScheduledRun(): Promise<Awaited<ReturnType<typeof runAgent>> | null> {
  return executeRun("routine");
}
