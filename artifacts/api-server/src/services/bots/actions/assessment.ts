import { db, capabilitiesTable, botActionsTable, botsTable, organizationsTable, type Bot } from "@workspace/db";
import { eq, sql, and, inArray } from "drizzle-orm";
import { botLlmCall, extractJson } from "../llm";
import { buildPersonaSystemPrompt } from "../prompts";
import { getPersona } from "../personas";

interface AssessmentEntry {
  capabilityId: number;
  maturityScore: number; // 0-100
  investmentLevel: "low" | "moderate" | "high" | "strategic";
  strategicImportance: "low" | "medium" | "high" | "critical";
  notes: string;
}

/**
 * Run assessment action: bot scores 3-5 capabilities for its organization,
 * writing real rows to organization_capabilities. This feeds Task #4 (peer
 * benchmarks) immediately because the bot's org has peerOptIn=true.
 *
 * Pick capabilities the bot has recently browsed (signals genuine interest
 * tracked through bot_actions) plus a few additional priority caps from
 * its industry it hasn't browsed yet. LLM scores them in the bot's voice.
 *
 * Uses Sonnet 4.6 — assessment needs depth and the action only runs once
 * per assessmentFrequencyDays (PE Partner = every 14d), so cost is bounded.
 */
export async function runAssessmentAction(bot: Bot): Promise<{ ok: boolean; costCents: number; error?: string; capabilityCount?: number }> {
  try {
    const persona = getPersona(bot.personaKey);
    if (!persona) throw new Error(`No persona for key=${bot.personaKey}`);

    // Pull recently-browsed capability IDs for this bot (signals interest)
    const recent = await db
      .select({ targetId: botActionsTable.targetId })
      .from(botActionsTable)
      .where(and(
        eq(botActionsTable.botId, bot.id),
        eq(botActionsTable.actionType, "browse"),
        sql`${botActionsTable.createdAt} > NOW() - INTERVAL '30 days'`,
      ));
    const recentIds = Array.from(new Set(recent.map(r => Number(r.targetId)).filter(Number.isFinite)));

    // Get the bot's org's industry to seed candidates
    const orgRows = await db.select({ industryId: organizationsTable.industryId }).from(organizationsTable).where(eq(organizationsTable.id, bot.organizationId)).limit(1);
    const industryId = orgRows[0]?.industryId;

    const fromIndustry = industryId != null
      ? await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId)).limit(20)
      : [];
    const fromRecent = recentIds.length > 0
      ? await db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, recentIds))
      : [];

    // Union, dedupe, cap at 5 capabilities to keep prompt size + cost bounded
    const seen = new Set<number>();
    const capabilities = [...fromRecent, ...fromIndustry].filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    }).slice(0, 5);

    if (capabilities.length === 0) {
      return { ok: false, costCents: 0, error: "no candidate capabilities for assessment" };
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    const systemPrompt = buildPersonaSystemPrompt(bot, todayIso);
    const userPrompt = [
      `You are running a capability assessment for your organization (${persona.entityName}).`,
      "For each capability below, return a maturity score (0-100), investment level, strategic importance, and a one-sentence note in your voice.",
      "",
      "Capabilities to assess:",
      capabilities.map(c => `  ${c.id}: ${c.name} — ${c.description ?? "(no description)"}`).join("\n"),
      "",
      "Return JSON of the shape:",
      "{",
      "  \"assessments\": [",
      "    { \"capabilityId\": <id>, \"maturityScore\": <0-100>, \"investmentLevel\": \"low|moderate|high|strategic\", \"strategicImportance\": \"low|medium|high|critical\", \"notes\": \"<one sentence>\" },",
      "    ...",
      "  ]",
      "}",
    ].join("\n");

    const llm = await botLlmCall({
      model: "anthropic/claude-sonnet-4.6",
      systemPrompt,
      userPrompt,
      maxTokens: 2048,
      jsonMode: true,
      personaKey: bot.personaKey,
      actionType: "assessment",
    });

    const parsed = extractJson<{ assessments: AssessmentEntry[] }>(llm.content);
    const entries = Array.isArray(parsed.assessments) ? parsed.assessments : [];
    if (entries.length === 0) {
      throw new Error("LLM returned no assessments");
    }

    // Validate + clamp + upsert (org+cap is unique, so ON CONFLICT updates)
    let written = 0;
    for (const e of entries) {
      const cap = capabilities.find(c => c.id === e.capabilityId);
      if (!cap) continue;
      const score = Math.max(0, Math.min(100, Number(e.maturityScore) || 0));
      const investment = ["low", "moderate", "high", "strategic"].includes(e.investmentLevel) ? e.investmentLevel : "moderate";
      const importance = ["low", "medium", "high", "critical"].includes(e.strategicImportance) ? e.strategicImportance : "medium";

      // Upsert via raw SQL since drizzle's onConflict path varies by version
      await db.execute(sql`
        INSERT INTO organization_capabilities (organization_id, capability_id, maturity_score, investment_level, strategic_importance, notes, assessed_at)
        VALUES (${bot.organizationId}, ${cap.id}, ${score}, ${investment}, ${importance}, ${e.notes ?? null}, NOW())
        ON CONFLICT (organization_id, capability_id) DO UPDATE
          SET maturity_score = EXCLUDED.maturity_score,
              investment_level = EXCLUDED.investment_level,
              strategic_importance = EXCLUDED.strategic_importance,
              notes = EXCLUDED.notes,
              assessed_at = NOW()
      `);
      written++;
    }

    await db.insert(botActionsTable).values({
      botId: bot.id,
      actionType: "assessment",
      targetType: "assessment_session",
      targetId: String(bot.organizationId),
      summary: `Assessed ${written} capabilities for ${persona.entityName}`,
      payload: { capabilityIds: entries.map(e => e.capabilityId), written },
      costCents: llm.costCents,
      succeeded: true,
    });
    await db.update(botsTable).set({ lastActedAt: new Date() }).where(eq(botsTable.id, bot.id));

    return { ok: true, costCents: llm.costCents, capabilityCount: written };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.insert(botActionsTable).values({
      botId: bot.id,
      actionType: "assessment",
      summary: "Assessment failed",
      costCents: 0,
      succeeded: false,
      errorMessage,
    }).catch(() => undefined);
    return { ok: false, costCents: 0, error: errorMessage };
  }
}

/**
 * Was this bot's last assessment more than assessmentFrequencyDays ago?
 * Drives the loop decision of whether to run an assessment this tick.
 */
export async function isAssessmentDue(bot: Bot): Promise<boolean> {
  const persona = getPersona(bot.personaKey);
  if (!persona) return false;
  const cadenceDays = persona.biases.assessmentFrequencyDays;
  const rows = await db.select({ createdAt: botActionsTable.createdAt })
    .from(botActionsTable)
    .where(and(eq(botActionsTable.botId, bot.id), eq(botActionsTable.actionType, "assessment")))
    .orderBy(sql`${botActionsTable.createdAt} DESC`)
    .limit(1);
  if (rows.length === 0) return true;
  const lastMs = rows[0].createdAt.getTime();
  const elapsedDays = (Date.now() - lastMs) / (24 * 60 * 60 * 1000);
  return elapsedDays >= cadenceDays;
}
