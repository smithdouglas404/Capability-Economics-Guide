import { db, botsTable, botActionsTable, type Bot } from "@workspace/db";
import { eq, sql, and, desc } from "drizzle-orm";
import { runBrowseAction } from "./actions/browse";
import { runAssessmentAction, isAssessmentDue } from "./actions/assessment";
import { runReflectionAction, isReflectionDue } from "./actions/reflection";
import { runCommentAction, isCommentDue } from "./actions/comment";
import { getBotBudgetStatus } from "./budget";
import { getPersona } from "./personas";
import { logger } from "../../lib/logger";

/**
 * Run one tick for one bot. Decides which actions are due based on persona
 * cadence, runs them sequentially with budget checks between each. Stops
 * early if budget exhausted mid-tick. Returns a summary suitable for the
 * scheduler log.
 *
 * Cadence logic (per persona):
 *  - capabilityBrowsesPerDay → decide how many browses today (Poisson-ish:
 *    if N hours since last browse > 24/N expected, do one browse)
 *  - assessmentFrequencyDays → isAssessmentDue() returns true iff overdue
 *
 * Budget guard (HARD STOP, not warning):
 *  - Before each action: getBotBudgetStatus(bot.id). If overBudget, abort
 *    the rest of the tick. Logged as a skipped bot_actions row.
 *  - Per-bot cap is bot.monthlyBudgetUsdCap (default $40 USD/mo).
 */
export interface BotTickResult {
  botId: number;
  personaKey: string;
  actionsRun: number;
  actionsSkippedBudget: number;
  totalCostCents: number;
  errors: string[];
}

export async function runBotTick(bot: Bot): Promise<BotTickResult> {
  const result: BotTickResult = {
    botId: bot.id,
    personaKey: bot.personaKey,
    actionsRun: 0,
    actionsSkippedBudget: 0,
    totalCostCents: 0,
    errors: [],
  };

  if (bot.status !== "active") {
    return result;
  }

  const persona = getPersona(bot.personaKey);
  if (!persona) {
    result.errors.push(`no persona template for ${bot.personaKey}`);
    return result;
  }

  // 1. Run an assessment if due (one per tick max — it's heavy)
  if (await isAssessmentDue(bot)) {
    const budget = await getBotBudgetStatus(bot.id);
    if (budget.overBudget) {
      result.actionsSkippedBudget++;
      await logBudgetSkip(bot.id, "assessment", budget.mtdCents, budget.capCents);
    } else {
      const r = await runAssessmentAction(bot);
      if (r.ok) {
        result.actionsRun++;
        result.totalCostCents += r.costCents;
      } else if (r.error) {
        result.errors.push(`assessment: ${r.error}`);
      }
    }
  }

  // 2. Run weekly reflection if due. Pulls last 7 days of bot activity
  //    and writes a narrative reflection in the persona's voice.
  if (await isReflectionDue(bot)) {
    const budget = await getBotBudgetStatus(bot.id);
    if (budget.overBudget) {
      result.actionsSkippedBudget++;
      await logBudgetSkip(bot.id, "reflection", budget.mtdCents, budget.capCents);
    } else {
      const r = await runReflectionAction(bot);
      if (r.ok) {
        result.actionsRun++;
        result.totalCostCents += r.costCents;
      } else if (r.error) {
        result.errors.push(`reflection: ${r.error}`);
      }
    }
  }

  // 3. Run a comment if due (one per tick max — Sonnet, ~$0.005 each)
  if (await isCommentDue(bot)) {
    const budget = await getBotBudgetStatus(bot.id);
    if (budget.overBudget) {
      result.actionsSkippedBudget++;
      await logBudgetSkip(bot.id, "comment", budget.mtdCents, budget.capCents);
    } else {
      const r = await runCommentAction(bot);
      if (r.ok) {
        result.actionsRun++;
        result.totalCostCents += r.costCents;
      } else if (r.error) {
        result.errors.push(`comment: ${r.error}`);
      }
    }
  }

  // 4. Decide how many browses are due today based on cadence
  const browsesToday = await countTodayActions(bot.id, "browse");
  const browsesDesired = persona.biases.capabilityBrowsesPerDay;
  const browsesNeeded = Math.max(0, browsesDesired - browsesToday);

  for (let i = 0; i < browsesNeeded; i++) {
    const budget = await getBotBudgetStatus(bot.id);
    if (budget.overBudget) {
      result.actionsSkippedBudget++;
      await logBudgetSkip(bot.id, "browse", budget.mtdCents, budget.capCents);
      break; // stop trying more actions if we're over
    }
    const r = await runBrowseAction(bot);
    if (r.ok) {
      result.actionsRun++;
      result.totalCostCents += r.costCents;
    } else if (r.error) {
      result.errors.push(`browse: ${r.error}`);
    }
  }

  return result;
}

/**
 * Run a tick across every active bot. Used by the scheduler. Iterates
 * sequentially (not parallel) so OpenRouter rate limits are respected
 * and so a slow bot doesn't pile concurrent load on the DB.
 */
export async function runAllBotsTick(): Promise<BotTickResult[]> {
  const bots = await db.select().from(botsTable).where(eq(botsTable.status, "active")).orderBy(botsTable.id);
  const results: BotTickResult[] = [];
  for (const bot of bots) {
    try {
      const r = await runBotTick(bot);
      if (r.actionsRun > 0 || r.actionsSkippedBudget > 0 || r.errors.length > 0) {
        logger.info({
          botId: r.botId,
          persona: r.personaKey,
          actions: r.actionsRun,
          skipped: r.actionsSkippedBudget,
          costCents: r.totalCostCents,
          errors: r.errors.length,
        }, "[bots] tick complete");
      }
      results.push(r);
    } catch (err) {
      logger.warn({ botId: bot.id, err }, "[bots] tick failed");
      results.push({ botId: bot.id, personaKey: bot.personaKey, actionsRun: 0, actionsSkippedBudget: 0, totalCostCents: 0, errors: [err instanceof Error ? err.message : String(err)] });
    }
  }
  return results;
}

async function countTodayActions(botId: number, actionType: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(botActionsTable)
    .where(and(
      eq(botActionsTable.botId, botId),
      eq(botActionsTable.actionType, actionType),
      sql`${botActionsTable.createdAt} > NOW() - INTERVAL '24 hours'`,
    ));
  return rows[0]?.n ?? 0;
}

async function logBudgetSkip(botId: number, intendedAction: string, mtdCents: number, capCents: number): Promise<void> {
  await db.insert(botActionsTable).values({
    botId,
    actionType: "budget_skip",
    summary: `Skipped ${intendedAction}: monthly budget exhausted ($${(mtdCents / 100).toFixed(2)} of $${(capCents / 100).toFixed(2)})`,
    payload: { intendedAction, mtdCents, capCents },
    costCents: 0,
    succeeded: false,
    errorMessage: "monthly budget cap reached",
  }).catch(() => undefined);
}
