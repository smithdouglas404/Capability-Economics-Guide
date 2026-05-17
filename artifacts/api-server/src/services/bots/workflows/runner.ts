/**
 * Generic workflow runner. Wraps a `WorkflowDefinition.run()` invocation
 * with DB-row creation + step tracing + budget accounting + final
 * persistence. Callers (the scheduler or the admin manual-trigger route)
 * never construct workflow rows directly — they go through `runWorkflow`.
 */
import { db, botWorkflowRunsTable, botWorkflowStepsTable, type Bot } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getBotBudgetStatus } from "../budget";
import { logger } from "../../../lib/logger";
import type { WorkflowDefinition, WorkflowResult, WorkflowRunContext, WorkflowStepTrace } from "./types";

export interface RunWorkflowOpts {
  definition: WorkflowDefinition;
  bot: Bot | null;
  trigger: string;
}

/**
 * Execute a workflow end-to-end. Creates a `bot_workflow_runs` row
 * up-front, hands the definition a context with budget helpers, and
 * finalizes the row on completion/failure.
 *
 * Returns the run id so callers can render a "started" UI without
 * waiting for completion.
 */
export async function runWorkflow(opts: RunWorkflowOpts): Promise<{ runId: number; result: WorkflowResult }> {
  const { definition, bot, trigger } = opts;
  const startedAt = Date.now();

  // Resolve starting budget. For per-bot workflows, use the bot's remaining cap.
  // For system-wide workflows, treat budget as effectively unlimited (the
  // individual actions still have their own per-bot guards).
  let budgetCapCents: number | null = null;
  let budgetRemainingCents = Number.MAX_SAFE_INTEGER;
  if (bot) {
    const status = await getBotBudgetStatus(bot.id);
    budgetCapCents = status.capCents;
    budgetRemainingCents = Math.max(0, status.capCents - status.mtdCents);
    if (status.overBudget) {
      // Don't even create a run row — record a no-op for diagnostics.
      const [row] = await db.insert(botWorkflowRunsTable).values({
        botId: bot.id,
        workflowKey: definition.key,
        trigger,
        status: "budget_exhausted",
        state: {},
        artifactIds: {},
        costCents: 0,
        budgetCapCentsAtStart: budgetCapCents,
        errorMessage: `Bot over budget before workflow start (mtd=${status.mtdCents}c / cap=${status.capCents}c)`,
        completedAt: new Date(),
        durationMs: 0,
      }).returning();
      return {
        runId: row.id,
        result: {
          status: "budget_exhausted",
          state: {},
          artifactIds: {},
          totalCostCents: 0,
          errorMessage: row.errorMessage ?? "budget exhausted",
        },
      };
    }
  }

  // Create the run row up-front so step traces have something to attach to.
  const [row] = await db.insert(botWorkflowRunsTable).values({
    botId: bot?.id ?? null,
    workflowKey: definition.key,
    trigger,
    status: "in_progress",
    state: {},
    artifactIds: {},
    costCents: 0,
    budgetCapCentsAtStart: budgetCapCents,
  }).returning();
  const runId = row.id;

  let stepIndex = 0;
  const recordStep = async (step: WorkflowStepTrace) => {
    await db.insert(botWorkflowStepsTable).values({
      runId,
      stepName: step.stepName,
      stepIndex: stepIndex++,
      status: step.status,
      costCents: step.costCents,
      durationMs: step.durationMs,
      payload: step.payload ?? {},
      errorMessage: step.errorMessage,
    });
  };

  const hasBudgetFor = async (estimatedCostCents: number): Promise<boolean> => {
    if (!bot) return true; // system-wide workflows always pass
    const status = await getBotBudgetStatus(bot.id);
    const remaining = Math.max(0, status.capCents - status.mtdCents);
    return remaining >= estimatedCostCents;
  };

  const ctx: WorkflowRunContext = {
    runId,
    bot,
    budgetRemainingCents,
    trigger,
    recordStep,
    hasBudgetFor,
  };

  let result: WorkflowResult;
  try {
    result = await definition.run(ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ workflowKey: definition.key, runId, err: msg }, "[bot-workflow] catastrophic error");
    result = {
      status: "failed",
      state: {},
      artifactIds: {},
      totalCostCents: 0,
      errorMessage: msg,
    };
  }

  // Finalize the row.
  const durationMs = Date.now() - startedAt;
  await db.update(botWorkflowRunsTable).set({
    status: result.status,
    state: result.state as Record<string, unknown>,
    artifactIds: result.artifactIds,
    costCents: result.totalCostCents,
    errorMessage: result.errorMessage ?? null,
    completedAt: new Date(),
    durationMs,
  }).where(eq(botWorkflowRunsTable.id, runId));

  logger.info({
    workflowKey: definition.key,
    runId,
    botId: bot?.id ?? null,
    status: result.status,
    costCents: result.totalCostCents,
    durationMs,
    artifactCount: Object.values(result.artifactIds).reduce((sum, arr) => sum + arr.length, 0),
  }, "[bot-workflow] run complete");

  return { runId, result };
}
