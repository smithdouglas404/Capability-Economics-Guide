import { db, botActionsTable, botsTable, type Bot } from "@workspace/db";
import { eq, sql, and, desc } from "drizzle-orm";
import { botLlmCall } from "../llm";
import { buildPersonaSystemPrompt } from "../prompts";
import { getPersona } from "../personas";

/**
 * Weekly reflection action: bot reads its recent activity (browses,
 * assessments, comments, marketplace actions from the last 7 days) and
 * writes a short narrative reflecting on what it's been learning, where
 * its conviction is changing, and what it plans to study next.
 *
 * Stored as a bot_actions row with the reflection text in payload.
 * Future-phase: persisted to the bot's Mem0 namespace as a high-priority
 * memory so subsequent actions can reference past reflections.
 *
 * Runs once per 7 days per bot — driven by isReflectionDue() in this file,
 * dispatched by the loop in services/bots/loop.ts.
 */
export async function runReflectionAction(bot: Bot): Promise<{ ok: boolean; costCents: number; error?: string }> {
  try {
    const persona = getPersona(bot.personaKey);
    if (!persona) throw new Error(`No persona for key=${bot.personaKey}`);

    // Pull last 7 days of actions (excluding previous reflections, which
    // would create a recursive prompt that's net-negative for quality)
    const recent = await db
      .select({
        actionType: botActionsTable.actionType,
        targetType: botActionsTable.targetType,
        targetId: botActionsTable.targetId,
        summary: botActionsTable.summary,
        createdAt: botActionsTable.createdAt,
      })
      .from(botActionsTable)
      .where(and(
        eq(botActionsTable.botId, bot.id),
        sql`${botActionsTable.createdAt} > NOW() - INTERVAL '7 days'`,
        sql`${botActionsTable.actionType} != 'reflection'`,
        eq(botActionsTable.succeeded, true),
      ))
      .orderBy(desc(botActionsTable.createdAt))
      .limit(40);

    if (recent.length === 0) {
      return { ok: false, costCents: 0, error: "no recent activity to reflect on" };
    }

    const activityLines = recent.map(r =>
      `  [${r.createdAt.toISOString().slice(0, 10)}] ${r.actionType}${r.targetType ? ` (${r.targetType}#${r.targetId})` : ""}: ${r.summary ?? ""}`
    ).join("\n");

    const todayIso = new Date().toISOString().slice(0, 10);
    const systemPrompt = buildPersonaSystemPrompt(bot, todayIso);
    const userPrompt = [
      "Look back on your last week of activity on the platform and write a short reflection.",
      "What patterns are you seeing? Where is your conviction shifting? What are you planning to study next?",
      "Write 3-5 paragraphs in your own professional voice — not bullet points, not headers, just your thinking.",
      "",
      "Your activity this week:",
      activityLines,
      "",
      "Return JSON: {",
      "  \"reflection\": \"<3-5 paragraphs of your reflection>\",",
      "  \"convictionShifts\": [\"<one shift in your thinking>\", \"<another>\"],",
      "  \"nextWeek\": [\"<thing you plan to study>\", \"<another>\"]",
      "}",
    ].join("\n");

    const llm = await botLlmCall({
      model: "anthropic/claude-sonnet-4.6",
      systemPrompt,
      userPrompt,
      maxTokens: 2048,
      jsonMode: true,
      personaKey: bot.personaKey,
      actionType: "reflection",
    });

    await db.insert(botActionsTable).values({
      botId: bot.id,
      actionType: "reflection",
      targetType: "memory",
      summary: `Weekly reflection (covered ${recent.length} prior actions)`,
      payload: { rawResponse: llm.content, actionsReviewed: recent.length },
      costCents: llm.costCents,
      succeeded: true,
    });
    await db.update(botsTable).set({ lastActedAt: new Date() }).where(eq(botsTable.id, bot.id));

    return { ok: true, costCents: llm.costCents };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.insert(botActionsTable).values({
      botId: bot.id,
      actionType: "reflection",
      summary: "Reflection failed",
      costCents: 0,
      succeeded: false,
      errorMessage,
    }).catch(() => undefined);
    return { ok: false, costCents: 0, error: errorMessage };
  }
}

/**
 * Has it been >= 7 days since this bot's last reflection? Drives the loop's
 * decision whether to run reflection this tick. Bots with <= 5 prior actions
 * also skip reflection (nothing meaningful to look back on yet).
 */
export async function isReflectionDue(bot: Bot): Promise<boolean> {
  const totalRows = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(botActionsTable)
    .where(and(
      eq(botActionsTable.botId, bot.id),
      sql`${botActionsTable.actionType} != 'budget_skip'`,
      eq(botActionsTable.succeeded, true),
    ));
  if ((totalRows[0]?.n ?? 0) < 5) return false;

  const last = await db
    .select({ createdAt: botActionsTable.createdAt })
    .from(botActionsTable)
    .where(and(eq(botActionsTable.botId, bot.id), eq(botActionsTable.actionType, "reflection")))
    .orderBy(desc(botActionsTable.createdAt))
    .limit(1);
  if (last.length === 0) return true;
  const elapsedDays = (Date.now() - last[0].createdAt.getTime()) / (24 * 60 * 60 * 1000);
  return elapsedDays >= 7;
}
