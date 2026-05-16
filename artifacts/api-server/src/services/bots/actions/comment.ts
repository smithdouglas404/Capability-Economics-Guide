import { db, capabilitiesTable, capabilityAnnotationsTable, botActionsTable, botsTable, type Bot } from "@workspace/db";
import { eq, sql, and, desc, inArray } from "drizzle-orm";
import { botLlmCall, extractJson } from "../llm";
import { buildPersonaSystemPrompt } from "../prompts";
import { getPersona } from "../personas";

interface CommentChoice {
  capabilityId: number;
  body: string;
  kind?: "note" | "dispute";
}

/**
 * Comment action: bot writes an annotation on a capability it has recently
 * browsed. Uses Sonnet 4.6 to produce a 2-4 sentence note in the persona's
 * voice, picking from the bot's last 5 browses so the comment reflects
 * actual viewed content rather than random selection.
 *
 * Comments are written to capability_annotations with the bot's clerk_user_id
 * + display name, so the existing annotation surface renders them with the
 * SyntheticAgentBadge (clerk_user_id starts with "bot_" — see
 * components/synthetic-agent-badge.tsx isSyntheticAgent helper).
 *
 * Kind defaults to "note". Persona prompt may emit kind="dispute" when it
 * disagrees with the score it sees — adds variety to the feed.
 */
export async function runCommentAction(bot: Bot): Promise<{ ok: boolean; costCents: number; error?: string; capabilityId?: number }> {
  try {
    const persona = getPersona(bot.personaKey);
    if (!persona) throw new Error(`No persona for key=${bot.personaKey}`);

    // Pull last 5 browses for context — bot should comment on something it
    // actually looked at, not a random pick.
    const recent = await db
      .select()
      .from(botActionsTable)
      .where(and(
        eq(botActionsTable.botId, bot.id),
        eq(botActionsTable.actionType, "browse"),
        eq(botActionsTable.succeeded, true),
      ))
      .orderBy(desc(botActionsTable.createdAt))
      .limit(5);

    if (recent.length === 0) {
      return { ok: false, costCents: 0, error: "no recent browses to comment on" };
    }

    const recentCapIds = Array.from(new Set(recent.map(r => Number(r.targetId)).filter(Number.isFinite)));
    const caps = await db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, recentCapIds));
    if (caps.length === 0) {
      return { ok: false, costCents: 0, error: "no capability records for recent browses" };
    }

    // Avoid commenting twice on the same capability within 14 days
    const recentComments = await db
      .select({ targetId: botActionsTable.targetId })
      .from(botActionsTable)
      .where(and(
        eq(botActionsTable.botId, bot.id),
        eq(botActionsTable.actionType, "comment"),
        sql`${botActionsTable.createdAt} > NOW() - INTERVAL '14 days'`,
      ));
    const recentlyCommentedIds = new Set(recentComments.map(c => Number(c.targetId)).filter(Number.isFinite));
    const candidates = caps.filter(c => !recentlyCommentedIds.has(c.id));
    if (candidates.length === 0) {
      return { ok: false, costCents: 0, error: "all recent browses already commented on" };
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const systemPrompt = buildPersonaSystemPrompt(bot, todayIso);
    const userPrompt = [
      "You've recently viewed several capabilities on the platform. Pick ONE that's most worth leaving a comment on and write a 2-4 sentence note in your professional voice.",
      "Use kind='note' for a general observation, or kind='dispute' if you actively disagree with how the capability is positioned.",
      "",
      "Recently viewed capabilities:",
      candidates.map(c => `  ${c.id}: ${c.name} — ${c.description ?? "(no description)"}`).join("\n"),
      "",
      "Return JSON: { \"capabilityId\": <id>, \"body\": \"<2-4 sentence comment>\", \"kind\": \"note\" | \"dispute\" }",
    ].join("\n");

    const llm = await botLlmCall({
      model: "anthropic/claude-sonnet-4.6",
      systemPrompt,
      userPrompt,
      maxTokens: 1024,
      jsonMode: true,
      personaKey: bot.personaKey,
      actionType: "comment",
    });

    const parsed = extractJson<CommentChoice>(llm.content);
    const targetCap = candidates.find(c => c.id === parsed.capabilityId) ?? candidates[0];
    const kind = parsed.kind === "dispute" ? "dispute" : "note";
    const body = (parsed.body ?? "").trim();
    if (body.length < 20) {
      throw new Error("LLM returned body too short to publish");
    }

    const [annotation] = await db.insert(capabilityAnnotationsTable).values({
      capabilityId: targetCap.id,
      userId: bot.clerkUserId,
      userEmail: bot.email,
      userDisplayName: bot.displayName,
      kind,
      body,
      status: "open",
    }).returning();

    await db.insert(botActionsTable).values({
      botId: bot.id,
      actionType: "comment",
      targetType: "capability",
      targetId: String(targetCap.id),
      summary: `Commented on ${targetCap.name} (${kind}): ${body.slice(0, 120)}${body.length > 120 ? "…" : ""}`,
      payload: { annotationId: annotation.id, kind, bodyLength: body.length },
      costCents: llm.costCents,
      succeeded: true,
    });
    await db.update(botsTable).set({ lastActedAt: new Date() }).where(eq(botsTable.id, bot.id));

    return { ok: true, costCents: llm.costCents, capabilityId: targetCap.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.insert(botActionsTable).values({
      botId: bot.id,
      actionType: "comment",
      summary: "Comment failed",
      costCents: 0,
      succeeded: false,
      errorMessage,
    }).catch(() => undefined);
    return { ok: false, costCents: 0, error: errorMessage };
  }
}

/**
 * Cadence gate: comments fire when the bot has at least 2 unbrowsed-recently
 * candidates AND has written fewer than expected for the week. Looks at the
 * persona's marketplaceActivityPerWeek (used as a general "comment + market
 * activity" proxy in absence of a dedicated commentsPerWeek bias).
 */
export async function isCommentDue(bot: Bot): Promise<boolean> {
  const persona = getPersona(bot.personaKey);
  if (!persona) return false;
  const desiredPerWeek = Math.max(1, persona.biases.marketplaceActivityPerWeek);
  const rows = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(botActionsTable)
    .where(and(
      eq(botActionsTable.botId, bot.id),
      eq(botActionsTable.actionType, "comment"),
      eq(botActionsTable.succeeded, true),
      sql`${botActionsTable.createdAt} > NOW() - INTERVAL '7 days'`,
    ));
  const thisWeek = rows[0]?.n ?? 0;
  return thisWeek < desiredPerWeek;
}
