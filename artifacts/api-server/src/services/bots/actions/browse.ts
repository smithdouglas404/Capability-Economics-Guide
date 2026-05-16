import { db, capabilitiesTable, capabilityEconomicsTable, botActionsTable, botsTable, organizationsTable, type Bot } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { botLlmCall, extractJson } from "../llm";
import { buildPersonaSystemPrompt } from "../prompts";

interface BrowseChoice {
  capabilityId: number;
  reasonShort: string;
}

/**
 * Browse action: bot picks one capability to "view" weighted by its biases,
 * logs the visit to bot_actions, and (in phase 5) stores an observation
 * memory in Mem0. Output is structured JSON for downstream auditability.
 *
 * Selection candidate pool: 8 random capabilities from the bot's preferred
 * industry that the bot hasn't browsed in the last 14 days. Falls back to
 * cross-industry candidates if the industry pool is exhausted.
 */
export async function runBrowseAction(bot: Bot): Promise<{ ok: boolean; costCents: number; error?: string; capabilityId?: number }> {
  try {
    // Already-browsed-recently filter (14 days). Keeps the bot from
    // re-visiting the same handful over and over.
    const recentlyBrowsed = await db
      .select({ targetId: botActionsTable.targetId })
      .from(botActionsTable)
      .where(and(
        eq(botActionsTable.botId, bot.id),
        eq(botActionsTable.actionType, "browse"),
        sql`${botActionsTable.createdAt} > NOW() - INTERVAL '14 days'`,
      ));
    const recentIds = new Set(recentlyBrowsed.map(r => Number(r.targetId)).filter(Number.isFinite));

    // Pull capabilities from the bot's org's industry first; widen to all
    // industries if too few candidates remain after the recency filter.
    const orgRows = await db.select({ industryId: organizationsTable.industryId }).from(organizationsTable).where(eq(organizationsTable.id, bot.organizationId)).limit(1);
    const industryId = orgRows[0]?.industryId;

    let candidates = industryId != null
      ? await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId))
      : await db.select().from(capabilitiesTable);

    candidates = candidates.filter(c => !recentIds.has(c.id));
    if (candidates.length < 3) {
      // Industry exhausted — widen to all
      const all = await db.select().from(capabilitiesTable);
      candidates = all.filter(c => !recentIds.has(c.id));
    }
    if (candidates.length === 0) {
      return { ok: false, costCents: 0, error: "no capabilities to browse" };
    }

    // Shuffle + cap to 8 candidates for the LLM prompt
    const shortlist = candidates.sort(() => Math.random() - 0.5).slice(0, 8);

    // Pull economic context for the shortlist (quadrant, EVaR, AI exposure)
    // so the LLM's choice can actually reflect persona biases.
    const econRows = shortlist.length > 0
      ? await db.select().from(capabilityEconomicsTable).where(sql`capability_id IN (${sql.join(shortlist.map(c => sql`${c.id}`), sql`, `)})`)
      : [];
    const econByCap = new Map(econRows.map(e => [e.capabilityId, e]));

    const todayIso = new Date().toISOString().slice(0, 10);
    const systemPrompt = buildPersonaSystemPrompt(bot, todayIso);

    const candidateLines = shortlist.map(c => {
      const e = econByCap.get(c.id);
      const tags: string[] = [];
      if (e?.consensusQuadrant) tags.push(`quadrant=${e.consensusQuadrant}`);
      if (e?.aiExposureScore != null) tags.push(`AI=${e.aiExposureScore}`);
      if (e?.halfLifeMonths != null) tags.push(`halflife=${e.halfLifeMonths}mo`);
      if (e?.marginStructurePct != null) tags.push(`margin=${e.marginStructurePct}%`);
      return `  ${c.id}: ${c.name}${tags.length > 0 ? `  [${tags.join(", ")}]` : ""}`;
    }).join("\n");

    const userPrompt = [
      "Pick one capability to study next based on your biases and the brief signals below.",
      "",
      "Candidate capabilities:",
      candidateLines,
      "",
      "Return JSON: {\"capabilityId\": <id>, \"reasonShort\": \"<one sentence explaining your pick in your voice>\"}",
    ].join("\n");

    const llm = await botLlmCall({
      model: "anthropic/claude-haiku-4.5",
      systemPrompt,
      userPrompt,
      maxTokens: 256,
      jsonMode: true,
      personaKey: bot.personaKey,
      actionType: "browse",
    });

    const parsed = extractJson<BrowseChoice>(llm.content);
    const choice = shortlist.find(c => c.id === parsed.capabilityId);
    if (!choice) {
      // LLM hallucinated an id — fall back to first shortlist entry
      const fallback = shortlist[0];
      await db.insert(botActionsTable).values({
        botId: bot.id,
        actionType: "browse",
        targetType: "capability",
        targetId: String(fallback.id),
        summary: `Viewed ${fallback.name} (fallback after LLM picked invalid id)`,
        payload: { llmResponse: parsed, fallbackUsed: true },
        costCents: llm.costCents,
        succeeded: true,
      });
      await db.update(botsTable).set({ lastActedAt: new Date() }).where(eq(botsTable.id, bot.id));
      return { ok: true, costCents: llm.costCents, capabilityId: fallback.id };
    }

    await db.insert(botActionsTable).values({
      botId: bot.id,
      actionType: "browse",
      targetType: "capability",
      targetId: String(choice.id),
      summary: `Viewed ${choice.name}: ${parsed.reasonShort.slice(0, 200)}`,
      payload: { reason: parsed.reasonShort },
      costCents: llm.costCents,
      succeeded: true,
    });
    await db.update(botsTable).set({ lastActedAt: new Date() }).where(eq(botsTable.id, bot.id));

    return { ok: true, costCents: llm.costCents, capabilityId: choice.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.insert(botActionsTable).values({
      botId: bot.id,
      actionType: "browse",
      summary: "Browse failed",
      costCents: 0,
      succeeded: false,
      errorMessage,
    }).catch(() => undefined);
    return { ok: false, costCents: 0, error: errorMessage };
  }
}
