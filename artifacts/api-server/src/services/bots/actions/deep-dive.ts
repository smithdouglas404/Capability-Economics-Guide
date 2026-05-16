import { db, capabilitiesTable, capabilityAnnotationsTable, botActionsTable, botsTable, type Bot } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { perplexityChat } from "../../perplexity";
import { botLlmCall, extractJson } from "../llm";
import { buildPersonaSystemPrompt } from "../prompts";
import { getPersona } from "../personas";
import { logger } from "../../../lib/logger";

/**
 * Deep-dive action: bot picks a capability it has been tracking, runs a
 * real Perplexity research call, then synthesizes a long-form analysis
 * essay (~2000 token output) in persona voice. Posts the essay as a
 * capability_annotations row (kind="note") so it appears in the public
 * thread with the SyntheticAgentBadge applied.
 *
 * Highest-cost recurring action by design — this is the work that
 * justifies the bot's existence as a research persona, not just a
 * commentary feed. Combined Perplexity (~$0.08) + Sonnet (~$0.35-0.50)
 * ≈ $0.50 per dive. At persona cadence (weekly per bot), that's
 * ~$2/month per bot — pushes total monthly per-bot spend from the
 * ~$2-3/mo baseline up toward the $10-15/mo target.
 *
 * Cadence gate: once per ~7 days per bot. The expense floor means even
 * a high-cadence persona only fires this once a week.
 */
export async function runDeepDiveAction(bot: Bot): Promise<{ ok: boolean; costCents: number; error?: string; capabilityId?: number }> {
  try {
    const persona = getPersona(bot.personaKey);
    if (!persona) throw new Error(`No persona for key=${bot.personaKey}`);

    // Pick from recent browses, excluding any already deep-dove in the
    // last 30 days
    const recentBrowses = await db
      .select()
      .from(botActionsTable)
      .where(and(
        eq(botActionsTable.botId, bot.id),
        eq(botActionsTable.actionType, "browse"),
        eq(botActionsTable.succeeded, true),
      ))
      .orderBy(desc(botActionsTable.createdAt))
      .limit(10);

    const recentCapIds = Array.from(new Set(recentBrowses.map(r => Number(r.targetId)).filter(Number.isFinite)));
    if (recentCapIds.length === 0) {
      return { ok: false, costCents: 0, error: "no recent browses for deep dive" };
    }

    const recentDeepDives = await db
      .select({ targetId: botActionsTable.targetId })
      .from(botActionsTable)
      .where(and(
        eq(botActionsTable.botId, bot.id),
        eq(botActionsTable.actionType, "deep_dive"),
        sql`${botActionsTable.createdAt} > NOW() - INTERVAL '30 days'`,
      ));
    const recentlyDoneIds = new Set(recentDeepDives.map(c => Number(c.targetId)).filter(Number.isFinite));
    const candidateIds = recentCapIds.filter(id => !recentlyDoneIds.has(id));
    if (candidateIds.length === 0) {
      return { ok: false, costCents: 0, error: "all recent browses already deep-dived" };
    }

    const caps = await db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, candidateIds));
    if (caps.length === 0) {
      return { ok: false, costCents: 0, error: "no capability records for candidates" };
    }

    const target = caps[Math.floor(Math.random() * caps.length)];

    // Step 1: Perplexity research call. ~$0.05-0.10 depending on model.
    let researchText = "";
    let perplexityCostCents = 0;
    try {
      const research = await perplexityChat({
        endpoint: `bot:${persona.key}:deep_dive`,
        model: "sonar-pro",
        context: { capabilityId: target.id, capabilityName: target.name },
        messages: [{
          role: "user",
          content: `Research the capability "${target.name}" from the perspective of a ${persona.title} at ${persona.entityName}. Focus on: (a) the strongest 2-3 economic moats vs. commoditization risks; (b) named real-world vendors / startups / public companies that exemplify the dynamics today; (c) specific $ figures (TAM, deal sizes, valuations, R&D spend); (d) regulatory or macro forces shaping the next 12-24 months. Cite credible sources.`,
        }],
      });
      researchText = research.choices?.[0]?.message?.content ?? "";
      // sonar-pro pricing: $3 in / $15 out per MTok. Response type doesn't
      // expose token counts — estimate from char length (~4 chars/token).
      // Empirical avg: prompt ~700 tok, response ~1500 tok → ~$0.025 each.
      const estOutTok = researchText.length / 4;
      perplexityCostCents = Math.ceil(((700 / 1_000_000) * 3 + (estOutTok / 1_000_000) * 15) * 100);
    } catch (err) {
      logger.warn({ err, botId: bot.id, capId: target.id }, "[deep-dive] perplexity step failed; continuing without research");
    }

    if (!researchText) {
      researchText = `Background: capability "${target.name}" — ${target.description ?? "no description available"}. (Perplexity research call unavailable — Sonnet operating from priors.)`;
    }

    // Step 2: Sonnet long-form synthesis in persona voice
    const todayIso = new Date().toISOString().slice(0, 10);
    const systemPrompt = buildPersonaSystemPrompt(bot, todayIso);
    const userPrompt = [
      `Write a 5-7 paragraph deep-dive analysis of "${target.name}" for posting to the Inflexcvi platform feed.`,
      "Voice: your professional voice (no hype, no headers, no bullet points unless absolutely necessary). Cite specific $ figures, real company names, and concrete forward-looking thesis points.",
      "",
      "Recent research from Perplexity that you should anchor the analysis on:",
      "",
      researchText.slice(0, 8000),
      "",
      "Return JSON: {",
      "  \"title\": \"<8-12 word headline framing your thesis>\",",
      "  \"body\": \"<5-7 paragraphs of analysis>\",",
      "  \"thesisShort\": \"<one-sentence summary of your central claim>\"",
      "}",
    ].join("\n");

    const llm = await botLlmCall({
      model: "anthropic/claude-sonnet-4.6",
      systemPrompt,
      userPrompt,
      maxTokens: 4096,
      jsonMode: true,
      personaKey: bot.personaKey,
      actionType: "deep_dive",
    });

    const parsed = extractJson<{ title: string; body: string; thesisShort: string }>(llm.content);
    const body = (parsed.body ?? "").trim();
    const title = (parsed.title ?? "").trim();
    if (body.length < 500) {
      throw new Error(`LLM returned body too short (${body.length} chars)`);
    }

    // Step 3: Post as an annotation so it surfaces in the existing comment
    // thread with the synthetic-agent badge automatically rendered.
    const formattedBody = `**${title || `${target.name} — deep dive`}**\n\n${body}\n\n— ${parsed.thesisShort ?? ""}`;
    const [annotation] = await db.insert(capabilityAnnotationsTable).values({
      capabilityId: target.id,
      userId: bot.clerkUserId,
      userEmail: bot.email,
      userDisplayName: bot.displayName,
      kind: "note",
      body: formattedBody.slice(0, 8000),
      status: "open",
    }).returning();

    const totalCostCents = llm.costCents + perplexityCostCents;
    await db.insert(botActionsTable).values({
      botId: bot.id,
      actionType: "deep_dive",
      targetType: "capability",
      targetId: String(target.id),
      summary: `Deep dive on ${target.name}: ${title.slice(0, 100) || (parsed.thesisShort?.slice(0, 100) ?? "")}`,
      payload: { annotationId: annotation.id, title, bodyLength: body.length, perplexityCostCents, sonnetCostCents: llm.costCents },
      costCents: totalCostCents,
      succeeded: true,
    });
    await db.update(botsTable).set({ lastActedAt: new Date() }).where(eq(botsTable.id, bot.id));

    return { ok: true, costCents: totalCostCents, capabilityId: target.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.insert(botActionsTable).values({
      botId: bot.id,
      actionType: "deep_dive",
      summary: "Deep dive failed",
      costCents: 0,
      succeeded: false,
      errorMessage,
    }).catch(() => undefined);
    return { ok: false, costCents: 0, error: errorMessage };
  }
}

export async function isDeepDiveDue(bot: Bot): Promise<boolean> {
  const rows = await db
    .select({ createdAt: botActionsTable.createdAt })
    .from(botActionsTable)
    .where(and(eq(botActionsTable.botId, bot.id), eq(botActionsTable.actionType, "deep_dive"), eq(botActionsTable.succeeded, true)))
    .orderBy(desc(botActionsTable.createdAt))
    .limit(1);
  if (rows.length === 0) return true;
  const elapsedDays = (Date.now() - rows[0].createdAt.getTime()) / (24 * 60 * 60 * 1000);
  return elapsedDays >= 7;
}
