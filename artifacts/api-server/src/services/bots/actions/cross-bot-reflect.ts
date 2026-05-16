import { db, botsTable, botActionsTable, capabilityAnnotationsTable, marketplaceListingsTable, marketplaceSellersTable, type Bot } from "@workspace/db";
import { eq, and, sql, desc, ne } from "drizzle-orm";
import { botLlmCall } from "../llm";
import { buildPersonaSystemPrompt } from "../prompts";
import { getPersona } from "../personas";

/**
 * Cross-bot reflection — phase 5 dynamics. Once a fortnight per bot, the
 * bot reads aggregated activity from OTHER active bots (their recent
 * comments, deep dives, marketplace listings) and writes a reflection
 * noting where peer thinking is converging or diverging from its own.
 *
 * The output is a self-targeted note (not posted publicly) stored in
 * bot_actions.payload. Future phase 6 reads these across time to surface
 * emergent specialization in the admin observability dashboard.
 *
 * Cadence: once per 14 days per bot. Skipped entirely when fewer than 2
 * bots are active (nothing to reflect on).
 *
 * Cost: Sonnet 4.6 ~$0.10 per reflection (1500 input + 1500 output tokens
 * for a meaty cross-bot prompt).
 */
export async function runCrossBotReflectAction(bot: Bot): Promise<{ ok: boolean; costCents: number; error?: string }> {
  try {
    const persona = getPersona(bot.personaKey);
    if (!persona) throw new Error(`No persona for key=${bot.personaKey}`);

    // Need at least one other active bot
    const peers = await db.select().from(botsTable).where(and(eq(botsTable.status, "active"), ne(botsTable.id, bot.id)));
    if (peers.length === 0) {
      return { ok: false, costCents: 0, error: "no peer bots to reflect on" };
    }

    // Pull peer activity from last 14 days: top comments + deep dives +
    // marketplace listings
    const peerIds = peers.map(p => p.id);
    const peerActions = await db
      .select({
        botId: botActionsTable.botId,
        actionType: botActionsTable.actionType,
        summary: botActionsTable.summary,
        targetType: botActionsTable.targetType,
        targetId: botActionsTable.targetId,
        createdAt: botActionsTable.createdAt,
      })
      .from(botActionsTable)
      .where(and(
        sql`${botActionsTable.botId} IN (${sql.join(peerIds.map(id => sql`${id}`), sql`, `)})`,
        eq(botActionsTable.succeeded, true),
        sql`${botActionsTable.actionType} IN ('comment', 'deep_dive', 'marketplace_list', 'assessment')`,
        sql`${botActionsTable.createdAt} > NOW() - INTERVAL '14 days'`,
      ))
      .orderBy(desc(botActionsTable.createdAt))
      .limit(50);

    if (peerActions.length === 0) {
      return { ok: false, costCents: 0, error: "no peer activity in last 14d" };
    }

    // Resolve bot names for context
    const peerById = new Map(peers.map(p => [p.id, p]));

    const activityLines = peerActions.map(a => {
      const p = peerById.get(a.botId);
      const persona = p ? getPersona(p.personaKey) : null;
      const label = persona ? `${persona.displayName} (${persona.title})` : `bot#${a.botId}`;
      return `  [${a.createdAt.toISOString().slice(0, 10)}] ${label} · ${a.actionType}: ${a.summary ?? ""}`;
    }).join("\n");

    const todayIso = new Date().toISOString().slice(0, 10);
    const systemPrompt = buildPersonaSystemPrompt(bot, todayIso);
    const userPrompt = [
      "Look at what your peers on the platform have been doing over the last two weeks.",
      "Write 3-4 paragraphs reflecting on what their activity tells you about how their thinking compares to yours. Where is consensus emerging? Where do you see things differently? Are there capabilities your peers are circling that you haven't paid enough attention to?",
      "",
      "Peer activity this period:",
      activityLines,
      "",
      "Return JSON: {",
      "  \"reflection\": \"<3-4 paragraphs of your reflection on peer activity>\",",
      "  \"convergences\": [\"<area where your peers are converging with you>\", \"<another>\"],",
      "  \"divergences\": [\"<area where you disagree with peer consensus>\", \"<another>\"],",
      "  \"newAttention\": [\"<capability or theme worth watching that your peers have surfaced>\", \"<another>\"]",
      "}",
    ].join("\n");

    const llm = await botLlmCall({
      model: "anthropic/claude-sonnet-4.6",
      systemPrompt,
      userPrompt,
      maxTokens: 2048,
      jsonMode: true,
      personaKey: bot.personaKey,
      actionType: "cross_bot_reflect",
    });

    await db.insert(botActionsTable).values({
      botId: bot.id,
      actionType: "cross_bot_reflect",
      targetType: "memory",
      summary: `Cross-bot reflection on ${peerActions.length} peer actions from ${peers.length} bot(s)`,
      payload: {
        rawResponse: llm.content,
        peerCount: peers.length,
        peerActionCount: peerActions.length,
      },
      costCents: llm.costCents,
      succeeded: true,
    });
    await db.update(botsTable).set({ lastActedAt: new Date() }).where(eq(botsTable.id, bot.id));

    return { ok: true, costCents: llm.costCents };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.insert(botActionsTable).values({
      botId: bot.id,
      actionType: "cross_bot_reflect",
      summary: "Cross-bot reflection failed",
      costCents: 0,
      succeeded: false,
      errorMessage,
    }).catch(() => undefined);
    return { ok: false, costCents: 0, error: errorMessage };
  }
}

export async function isCrossBotReflectDue(bot: Bot): Promise<boolean> {
  const peerCount = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(botsTable)
    .where(and(eq(botsTable.status, "active"), ne(botsTable.id, bot.id)));
  if ((peerCount[0]?.n ?? 0) === 0) return false;

  const rows = await db
    .select({ createdAt: botActionsTable.createdAt })
    .from(botActionsTable)
    .where(and(eq(botActionsTable.botId, bot.id), eq(botActionsTable.actionType, "cross_bot_reflect"), eq(botActionsTable.succeeded, true)))
    .orderBy(desc(botActionsTable.createdAt))
    .limit(1);
  if (rows.length === 0) return true;
  const elapsedDays = (Date.now() - rows[0].createdAt.getTime()) / (24 * 60 * 60 * 1000);
  return elapsedDays >= 14;
}
