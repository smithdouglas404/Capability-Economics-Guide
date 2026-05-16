import { db, botsTable, botActionsTable } from "@workspace/db";
import { eq, gte, and, sql } from "drizzle-orm";

/**
 * Month-to-date LLM cost for a single bot, in USD cents. Computed from
 * bot_actions.cost_cents — every action the bot takes logs its accumulated
 * LLM spend, and this sum is the authoritative monthly figure.
 */
export async function getBotMtdSpendCents(botId: number): Promise<number> {
  const monthStart = startOfMonthUtc(new Date());
  const rows = await db
    .select({ total: sql<number>`COALESCE(SUM(${botActionsTable.costCents}), 0)::int` })
    .from(botActionsTable)
    .where(and(eq(botActionsTable.botId, botId), gte(botActionsTable.createdAt, monthStart)));
  return rows[0]?.total ?? 0;
}

export interface BotBudgetStatus {
  botId: number;
  capCents: number;
  mtdCents: number;
  remainingCents: number;
  pctUsed: number;
  overBudget: boolean;
}

/**
 * Per-bot budget snapshot for the admin dashboard and the action-loop guard.
 */
export async function getBotBudgetStatus(botId: number): Promise<BotBudgetStatus> {
  const [bot] = await db.select().from(botsTable).where(eq(botsTable.id, botId)).limit(1);
  if (!bot) throw new Error(`Bot ${botId} not found`);
  const capCents = Math.round(bot.monthlyBudgetUsdCap * 100);
  const mtdCents = await getBotMtdSpendCents(botId);
  return {
    botId,
    capCents,
    mtdCents,
    remainingCents: Math.max(0, capCents - mtdCents),
    pctUsed: capCents > 0 ? mtdCents / capCents : 0,
    overBudget: mtdCents >= capCents,
  };
}

/**
 * Aggregate budget summary across all active bots. The action-loop checks
 * this before each tick: if total MTD spend exceeds the system-wide cap
 * (sum of per-bot caps for active bots), the loop short-circuits the
 * action and the admin dashboard surfaces a warning.
 */
export async function getSystemBudgetStatus(): Promise<{
  capCents: number;
  mtdCents: number;
  remainingCents: number;
  perBot: BotBudgetStatus[];
}> {
  const activeBots = await db.select().from(botsTable).where(eq(botsTable.status, "active"));
  const perBot = await Promise.all(activeBots.map(b => getBotBudgetStatus(b.id)));
  const capCents = perBot.reduce((a, b) => a + b.capCents, 0);
  const mtdCents = perBot.reduce((a, b) => a + b.mtdCents, 0);
  return {
    capCents,
    mtdCents,
    remainingCents: Math.max(0, capCents - mtdCents),
    perBot,
  };
}

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}
