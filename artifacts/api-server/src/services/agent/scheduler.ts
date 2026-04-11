import { runAgent } from "./graph";
import { emitAgentEvent } from "./events";

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let lastRunAt: Date | null = null;
let lastRunResult: Awaited<ReturnType<typeof runAgent>> | null = null;
let intervalMs = DEFAULT_INTERVAL_MS;

export function startScheduler(customIntervalMs?: number): void {
  if (schedulerTimer) {
    console.log("[Agent Scheduler] Already running");
    return;
  }

  intervalMs = customIntervalMs || DEFAULT_INTERVAL_MS;
  console.log(`[Agent Scheduler] Starting with ${intervalMs / 1000 / 60}min interval`);

  schedulerTimer = setInterval(async () => {
    await executeScheduledRun();
  }, intervalMs);

  emitAgentEvent({ type: "scheduler_started", intervalMinutes: intervalMs / 60000 });
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log("[Agent Scheduler] Stopped");
    emitAgentEvent({ type: "scheduler_stopped" });
  }
}

export async function executeScheduledRun(): Promise<Awaited<ReturnType<typeof runAgent>> | null> {
  if (isRunning) {
    console.log("[Agent Scheduler] Skipping — previous run still in progress");
    return null;
  }

  isRunning = true;
  try {
    const result = await runAgent("scheduled");
    lastRunAt = new Date();
    lastRunResult = result;
    return result;
  } catch (err) {
    console.error("[Agent Scheduler] Run failed:", err);
    return null;
  } finally {
    isRunning = false;
  }
}

export async function triggerManualRun(): Promise<Awaited<ReturnType<typeof runAgent>>> {
  if (isRunning) {
    throw new Error("Agent is already running. Please wait for the current run to complete.");
  }

  isRunning = true;
  try {
    const result = await runAgent("manual");
    lastRunAt = new Date();
    lastRunResult = result;
    return result;
  } finally {
    isRunning = false;
  }
}

export function getSchedulerStatus(): {
  active: boolean;
  isRunning: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastRunResult: Awaited<ReturnType<typeof runAgent>> | null;
} {
  return {
    active: schedulerTimer !== null,
    isRunning,
    intervalMinutes: intervalMs / 60000,
    lastRunAt: lastRunAt?.toISOString() || null,
    lastRunResult,
  };
}
