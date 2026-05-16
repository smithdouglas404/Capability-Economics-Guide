import { db, marketplaceSellersTable, marketplaceListingsTable, capabilitiesTable, botActionsTable, botsTable, type Bot } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import crypto from "node:crypto";
import { botLlmCall, extractJson } from "../llm";
import { buildPersonaSystemPrompt } from "../prompts";
import { getPersona } from "../personas";

/**
 * Marketplace listing action: bot publishes a research-report listing
 * positioned around a capability it has recently studied. Listings carry
 * a synthetic seller record (synthetic Stripe Connect acct_* id with
 * chargesEnabled=false) so they're visible but NOT purchasable — bots
 * generate marketplace activity for demo signal, not real commerce.
 *
 * Listing status starts as "draft". Admin promotes to "approved" via the
 * existing review queue if/when the content is judged demo-worthy. This
 * keeps quality control under human eyes before any bot content reaches
 * the public marketplace browse.
 *
 * Synthetic seller convention:
 *   - stripeAccountId: "bot_acct_<persona>_<hex>"
 *   - chargesEnabled: false
 *   - payoutsEnabled: false
 *   - tier: "open" (admin can promote to "analyst" or "featured" manually)
 *
 * Cost: Sonnet 4.6, ~$0.04 per listing (title + description + tags
 * generation in a single call).
 */
export async function runMarketplaceListAction(bot: Bot): Promise<{ ok: boolean; costCents: number; error?: string; listingId?: number }> {
  try {
    const persona = getPersona(bot.personaKey);
    if (!persona) throw new Error(`No persona for key=${bot.personaKey}`);

    // Ensure synthetic seller exists for this bot
    const seller = await getOrCreateBotSeller(bot);

    // Pull recently-browsed capabilities for context
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
      return { ok: false, costCents: 0, error: "no recent browses for listing context" };
    }

    // Avoid duplicate listing on the same capability within 30 days
    const recentListings = await db
      .select({ targetId: botActionsTable.targetId })
      .from(botActionsTable)
      .where(and(
        eq(botActionsTable.botId, bot.id),
        eq(botActionsTable.actionType, "marketplace_list"),
        sql`${botActionsTable.createdAt} > NOW() - INTERVAL '30 days'`,
      ));
    const recentlyListedIds = new Set(recentListings.map(c => Number(c.targetId)).filter(Number.isFinite));

    const candidateIds = recentCapIds.filter(id => !recentlyListedIds.has(id));
    if (candidateIds.length === 0) {
      return { ok: false, costCents: 0, error: "all recent browses already listed" };
    }
    const caps = await db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, candidateIds));
    if (caps.length === 0) {
      return { ok: false, costCents: 0, error: "no capability records for candidate ids" };
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const systemPrompt = buildPersonaSystemPrompt(bot, todayIso);
    const userPrompt = [
      "You're about to publish a research report on the Capability Economics marketplace, drawn from your recent platform activity.",
      "Pick ONE of the capabilities below as the report's focus and propose a title, 2-paragraph description, suggested price (cents, between $4900 and $19900), and 3-5 thematic tags.",
      "Voice: professional, sourced, no hype. The report would deliver your firm's POV on the capability for buyers like other PE/VC/F500/consultancy peers.",
      "",
      "Candidate capabilities (recently studied):",
      caps.map(c => `  ${c.id}: ${c.name} — ${c.description ?? "(no description)"}`).join("\n"),
      "",
      "Return JSON: {",
      "  \"capabilityId\": <id>,",
      "  \"title\": \"<headline, 5-12 words>\",",
      "  \"description\": \"<2 paragraphs of report positioning in your professional voice>\",",
      "  \"priceCents\": <4900-19900>,",
      "  \"tags\": [\"<tag>\", \"<tag>\", \"<tag>\"]",
      "}",
    ].join("\n");

    const llm = await botLlmCall({
      model: "anthropic/claude-sonnet-4.6",
      systemPrompt,
      userPrompt,
      maxTokens: 1536,
      jsonMode: true,
      personaKey: bot.personaKey,
      actionType: "marketplace_list",
    });

    const parsed = extractJson<{
      capabilityId: number;
      title: string;
      description: string;
      priceCents: number;
      tags: string[];
    }>(llm.content);

    const targetCap = caps.find(c => c.id === parsed.capabilityId) ?? caps[0];
    const priceCents = Math.max(4900, Math.min(19900, Number(parsed.priceCents) || 9900));
    const title = String(parsed.title ?? `${persona.entityName} POV: ${targetCap.name}`).slice(0, 200);
    const description = String(parsed.description ?? "").slice(0, 4000);
    const tagsArr = Array.isArray(parsed.tags) ? parsed.tags.map(t => String(t).slice(0, 40)).slice(0, 8) : [];

    if (description.length < 100) {
      throw new Error("LLM returned description too short");
    }

    const [listing] = await db.insert(marketplaceListingsTable).values({
      sellerId: seller.id,
      type: "report",
      title,
      description,
      priceCents,
      status: "draft", // requires admin approval before public visibility
      tags: tagsArr,
    }).returning();

    await db.insert(botActionsTable).values({
      botId: bot.id,
      actionType: "marketplace_list",
      targetType: "marketplace_item",
      targetId: String(targetCap.id),
      summary: `Drafted listing "${title.slice(0, 60)}${title.length > 60 ? "…" : ""}" ($${(priceCents / 100).toFixed(2)}) on ${targetCap.name}`,
      payload: { listingId: listing.id, capabilityId: targetCap.id, priceCents, tags: tagsArr },
      costCents: llm.costCents,
      succeeded: true,
    });
    await db.update(botsTable).set({ lastActedAt: new Date() }).where(eq(botsTable.id, bot.id));

    return { ok: true, costCents: llm.costCents, listingId: listing.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.insert(botActionsTable).values({
      botId: bot.id,
      actionType: "marketplace_list",
      summary: "Listing failed",
      costCents: 0,
      succeeded: false,
      errorMessage,
    }).catch(() => undefined);
    return { ok: false, costCents: 0, error: errorMessage };
  }
}

async function getOrCreateBotSeller(bot: Bot) {
  const existing = await db.select().from(marketplaceSellersTable).where(eq(marketplaceSellersTable.userId, bot.clerkUserId)).limit(1);
  if (existing[0]) return existing[0];

  const persona = getPersona(bot.personaKey);
  const stripeAccountId = `bot_acct_${bot.personaKey}_${crypto.randomBytes(6).toString("hex")}`;

  const [seller] = await db.insert(marketplaceSellersTable).values({
    userId: bot.clerkUserId,
    email: bot.email,
    displayName: bot.displayName,
    stripeAccountId,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    tier: "open",
    bio: persona?.bio ?? bot.bio ?? null,
  }).returning();

  return seller;
}

/**
 * Cadence gate using persona.marketplaceActivityPerWeek as a soft target.
 * Splits between listings (less frequent) and comments (more frequent) —
 * here we approximate listings at ~1/3 the comment cadence.
 */
export async function isListingDue(bot: Bot): Promise<boolean> {
  const persona = getPersona(bot.personaKey);
  if (!persona) return false;
  const desiredPerWeek = Math.max(1, Math.floor(persona.biases.marketplaceActivityPerWeek / 3));
  const rows = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(botActionsTable)
    .where(and(
      eq(botActionsTable.botId, bot.id),
      eq(botActionsTable.actionType, "marketplace_list"),
      eq(botActionsTable.succeeded, true),
      sql`${botActionsTable.createdAt} > NOW() - INTERVAL '7 days'`,
    ));
  return (rows[0]?.n ?? 0) < desiredPerWeek;
}
