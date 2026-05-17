/**
 * Workflow scheduler. Distinct from the bot-action loop (`bots/loop.ts`).
 *
 * The action loop wakes every active bot hourly and runs DISCRETE actions
 * that are due per persona cadence (browse, comment, assess, …).
 *
 * The workflow scheduler wakes every 30 min and dispatches MULTI-STEP
 * workflows that are due per their own cadence + scope. Per-bot workflows
 * fire for each matching bot; system-wide workflows fire once globally.
 *
 * Due-detection is based on the last successful (or budget-exhausted) run
 * in `bot_workflow_runs` for the same (workflowKey, botId). If no row
 * exists OR the most-recent row is older than the cadence window, the
 * workflow is due.
 */
import { db, botsTable, botWorkflowRunsTable, type Bot } from "@workspace/db";
import { and, desc, eq, isNull, inArray, sql } from "drizzle-orm";
import { logger } from "../../../lib/logger";
import { getRegistry } from "./registry";
import { runWorkflow } from "./runner";
import type { WorkflowCadence, WorkflowDefinition } from "./types";

const CADENCE_MS: Record<Exclude<WorkflowCadence, `event:${string}`>, number> = {
  "daily":     24 * 60 * 60 * 1000,
  "weekly":     7 * 24 * 60 * 60 * 1000,
  "bi-weekly": 14 * 24 * 60 * 60 * 1000,
  "monthly":   30 * 24 * 60 * 60 * 1000,
  "quarterly": 90 * 24 * 60 * 60 * 1000,
};

function cadenceWindowMs(cadence: WorkflowCadence): number | null {
  if (cadence.startsWith("event:")) return null; // event-driven; never time-due
  return CADENCE_MS[cadence as Exclude<WorkflowCadence, `event:${string}`>];
}

/**
 * Check whether a workflow is due to run now for a given (workflowKey, botId).
 * Reads the most recent run row and compares its completion time against
 * the cadence window.
 */
async function isDue(workflowKey: string, botId: number | null, cadence: WorkflowCadence): Promise<boolean> {
  const windowMs = cadenceWindowMs(cadence);
  if (windowMs === null) return false; // event-driven; not time-scheduled
  const rows = await db.select({ completedAt: botWorkflowRunsTable.completedAt, startedAt: botWorkflowRunsTable.startedAt })
    .from(botWorkflowRunsTable)
    .where(and(
      eq(botWorkflowRunsTable.workflowKey, workflowKey),
      botId === null
        ? isNull(botWorkflowRunsTable.botId)
        : eq(botWorkflowRunsTable.botId, botId),
    ))
    .orderBy(desc(botWorkflowRunsTable.startedAt))
    .limit(1);
  if (rows.length === 0) return true;
  const last = rows[0]!.completedAt ?? rows[0]!.startedAt;
  return Date.now() - new Date(last).getTime() >= windowMs;
}

/**
 * One scheduler tick. For each registered workflow, check whether it's
 * due (per-bot or system-wide) and dispatch. Runs are NOT awaited in
 * series — each fires-and-forgets so a slow workflow doesn't block the
 * rest of the tick. Errors are swallowed by the runner.
 *
 * Returns a summary used by the scheduler log line.
 */
export async function workflowSchedulerTick(): Promise<{ dispatched: number; skipped: number; workflowKeysDue: string[] }> {
  const reg = getRegistry();
  let dispatched = 0;
  let skipped = 0;
  const workflowKeysDue: string[] = [];

  // System-wide workflows.
  for (const def of reg.values()) {
    if (def.scope !== "system-wide") continue;
    const due = await isDue(def.key, null, def.cadence);
    if (!due) { skipped++; continue; }
    workflowKeysDue.push(def.key);
    runWorkflow({ definition: def, bot: null, trigger: "scheduled" })
      .catch((err) => logger.error({ key: def.key, err: err instanceof Error ? err.message : String(err) }, "[wf-scheduler] system workflow failed"));
    dispatched++;
  }

  // Per-bot workflows.
  const activeBots = await db.select().from(botsTable).where(eq(botsTable.status, "active"));
  if (activeBots.length === 0) {
    return { dispatched, skipped, workflowKeysDue };
  }
  for (const def of reg.values()) {
    if (def.scope !== "per-bot") continue;
    if (def.appliesToPersonas.length === 0) continue;
    const matching = activeBots.filter((b) => def.appliesToPersonas.includes(b.personaKey));
    for (const bot of matching) {
      const due = await isDue(def.key, bot.id, def.cadence);
      if (!due) { skipped++; continue; }
      workflowKeysDue.push(`${def.key}:bot-${bot.id}`);
      runWorkflow({ definition: def, bot, trigger: "scheduled" })
        .catch((err) => logger.error({ key: def.key, botId: bot.id, err: err instanceof Error ? err.message : String(err) }, "[wf-scheduler] per-bot workflow failed"));
      dispatched++;
    }
  }

  return { dispatched, skipped, workflowKeysDue };
}

/**
 * Manual workflow trigger. Used by the admin route to fire a workflow
 * ad-hoc regardless of cadence. Skips the due check but still respects
 * budget guards inside `runWorkflow`.
 */
export async function manuallyTriggerWorkflow(workflowKey: string, botId: number | null): Promise<{ runId: number }> {
  const reg = getRegistry();
  const def = reg.get(workflowKey);
  if (!def) throw new Error(`No workflow with key ${workflowKey}`);
  let bot: Bot | null = null;
  if (def.scope === "per-bot") {
    if (botId === null) throw new Error(`workflow ${workflowKey} requires a botId`);
    const [row] = await db.select().from(botsTable).where(eq(botsTable.id, botId));
    if (!row) throw new Error(`bot ${botId} not found`);
    bot = row;
  }
  const result = await runWorkflow({ definition: def, bot, trigger: "manual" });
  return { runId: result.runId };
}
