import { db } from "@workspace/db";
import {
  capabilitiesTable,
  industriesTable,
  cviComponentsTable,
  dvxComponentsTable,
  csuiteRecommendationsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { chatWithFallback, EDITORIAL_FALLBACK_CHAIN } from "../llm-fallback";
import { logger } from "../../lib/logger";

/**
 * C-Suite recommendation translator. For a given (capability, persona),
 * generates a 1-paragraph framing of "what does the DVX score + top
 * disruptors mean for THIS persona's decision-making".
 *
 * Personas: cfo / coo / cto / chro / ceo. Persona-specific system prompts
 * shape the voice + focus areas.
 *
 * Caching: rows persist in csuite_recommendations. Regenerated when the
 * cap's DVX score has moved ≥ 10 points since last generation OR when the
 * row is older than 30 days OR on admin manual trigger.
 *
 * Cost: ~$0.03 per (cap, persona) (Sonnet 4.6, ~800/600 token prompt/output).
 */

export type CsuitePersona = "cfo" | "coo" | "cto" | "chro" | "ceo";
export const CSUITE_PERSONAS: CsuitePersona[] = ["cfo", "coo", "cto", "chro", "ceo"];

const PERSONA_FRAMING: Record<CsuitePersona, string> = {
  cfo: `You are advising a Chief Financial Officer. Frame the analysis around:
- $ exposure and revenue at risk over 12/24/36 month windows
- Capex vs M&A allocation tradeoffs
- Hurdle rates and ROI thresholds for defensive moves
- Earnings-call language the CFO should be ready to use
Be specific about dollars whenever the score warrants. Avoid technology jargon.`,
  coo: `You are advising a Chief Operating Officer. Frame the analysis around:
- Operational continuity risk if the capability is displaced
- Vendor / supplier transition plans
- Headcount and process redesign implications
- Operational KPIs that would degrade in a displacement scenario
Be specific about timelines and workflow impact. Avoid financial jargon.`,
  cto: `You are advising a Chief Technology Officer. Frame the analysis around:
- The specific technology shifts driving the disruption
- Architecture decisions that should change in light of the disruption probability
- Build vs buy vs partner for the named disruptors
- Technical debt that the disruption will expose
Be specific about named technologies, vendors, and architectural patterns.`,
  chro: `You are advising a Chief Human Resources Officer. Frame the analysis around:
- Skills the org will need to acquire or transition away from
- Roles that will be reduced or eliminated if displacement occurs
- Change management and culture implications
- Internal mobility opportunities created by the shift
Be specific about role titles, headcount impact, and reskilling tracks.`,
  ceo: `You are advising a Chief Executive Officer. Frame the analysis around:
- The strategic narrative for the board and shareholders
- Capital allocation between defending the capability vs investing in disruptors
- Competitive positioning (where to lead, where to follow)
- The 18-month decision that defines the strategic outcome
Be specific about the strategic bet and the cost of inaction.`,
};

const PERSONA_TITLE: Record<CsuitePersona, string> = {
  cfo: "Chief Financial Officer",
  coo: "Chief Operating Officer",
  cto: "Chief Technology Officer",
  chro: "Chief Human Resources Officer",
  ceo: "Chief Executive Officer",
};

const REGEN_DVX_DELTA = 10;
const REGEN_AGE_DAYS = 30;

export interface TranslationResult {
  capabilityId: number;
  persona: CsuitePersona;
  body: string;
  headline: string | null;
  cached: boolean;
  costCents?: number;
}

/**
 * Get or generate a recommendation for (capability, persona). Returns cached
 * row if fresh; else generates a new one via LLM.
 */
export async function getOrGenerateCsuiteRecommendation(
  capabilityId: number,
  persona: CsuitePersona,
  opts: { forceFresh?: boolean } = {},
): Promise<TranslationResult> {
  const [existing] = await db
    .select()
    .from(csuiteRecommendationsTable)
    .where(and(eq(csuiteRecommendationsTable.capabilityId, capabilityId), eq(csuiteRecommendationsTable.personaSlug, persona)))
    .limit(1);

  const [dvx] = await db.select().from(dvxComponentsTable).where(eq(dvxComponentsTable.capabilityId, capabilityId)).limit(1);
  const currentScore = dvx ? Math.round(dvx.disruptionScore) : null;

  // Cache freshness check
  if (!opts.forceFresh && existing) {
    const ageDays = (Date.now() - existing.generatedAt.getTime()) / (24 * 60 * 60 * 1000);
    const scoreDrifted = currentScore != null && existing.dvxScoreAtGeneration != null
      && Math.abs(currentScore - existing.dvxScoreAtGeneration) >= REGEN_DVX_DELTA;
    if (ageDays < REGEN_AGE_DAYS && !scoreDrifted) {
      return {
        capabilityId,
        persona,
        body: existing.body,
        headline: existing.headline,
        cached: true,
      };
    }
  }

  // Generate fresh
  const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, capabilityId)).limit(1);
  if (!cap) throw new Error(`Capability ${capabilityId} not found`);
  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, cap.industryId)).limit(1);
  const [cvi] = await db.select().from(cviComponentsTable).where(eq(cviComponentsTable.capabilityId, capabilityId)).limit(1);

  const dvxLine = dvx
    ? `DVX disruption score: ${dvx.disruptionScore.toFixed(0)}/100 with ${dvx.monthsToDisplacement ?? "unknown"} months to displacement. Top disruptors identified: ${(dvx.topDisruptors as string[] | undefined ?? []).slice(0, 5).join(", ") || "none yet"}.`
    : "DVX not yet computed for this capability.";
  const cviLine = cvi
    ? `Current CVI value: ${cvi.consensusScore.toFixed(0)}/1000 with velocity ${cvi.velocity > 0 ? "+" : ""}${cvi.velocity.toFixed(2)}.`
    : "CVI not yet computed.";

  const systemPrompt = PERSONA_FRAMING[persona];
  const userPrompt = [
    `Capability: "${cap.name}" in the ${industry?.name ?? "unknown"} industry.`,
    cap.description ? `Description: ${cap.description}` : "",
    cviLine,
    dvxLine,
    "",
    `Write a single paragraph (3-5 sentences) of recommendation in the voice of an advisor speaking directly to the ${PERSONA_TITLE[persona]}. Concrete, specific, no hedging. End with a clear next action. Do NOT use bullet points or headers.`,
    "",
    `Return JSON: { "headline": "<one short action-verb-led headline, max 12 words>", "body": "<the paragraph>" }`,
  ].filter(Boolean).join("\n");

  const result = await chatWithFallback({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    models: EDITORIAL_FALLBACK_CHAIN,
    responseFormat: { type: "json_object" },
    maxTokens: 800,
    endpoint: `csuite_translator:${persona}`,
  });

  const raw = result.text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Translator returned non-JSON");
  const parsed = JSON.parse(match[0]) as { headline?: string; body?: string };
  const body = (parsed.body ?? "").trim();
  const headline = (parsed.headline ?? "").trim() || null;
  if (body.length < 50) throw new Error("Translator returned body too short");

  // Upsert
  if (existing) {
    await db.update(csuiteRecommendationsTable).set({
      body,
      headline,
      dvxScoreAtGeneration: currentScore,
      generatedAt: new Date(),
    }).where(eq(csuiteRecommendationsTable.id, existing.id));
  } else {
    await db.insert(csuiteRecommendationsTable).values({
      capabilityId,
      personaSlug: persona,
      body,
      headline,
      dvxScoreAtGeneration: currentScore,
    });
  }

  return {
    capabilityId,
    persona,
    body,
    headline,
    cached: false,
  };
}

/**
 * Nightly cron: regenerate recommendations for the top-N highest-DVX
 * capabilities across all 5 personas. Default N=50 → 250 (cap, persona)
 * cells regenerated per night = ~$7.50/day at $0.03 each, capped.
 */
export async function refreshTopDvxRecommendations(opts: { topN?: number; personas?: CsuitePersona[] } = {}): Promise<{ generated: number; cached: number; errors: string[]; durationMs: number }> {
  const start = Date.now();
  const topN = Math.max(1, Math.min(500, opts.topN ?? 50));
  const personas = opts.personas ?? CSUITE_PERSONAS;
  const errors: string[] = [];
  let generated = 0;
  let cached = 0;

  const topCaps = await db
    .select({ capabilityId: dvxComponentsTable.capabilityId })
    .from(dvxComponentsTable)
    .orderBy(desc(dvxComponentsTable.disruptionScore))
    .limit(topN);

  for (const { capabilityId } of topCaps) {
    for (const persona of personas) {
      try {
        const result = await getOrGenerateCsuiteRecommendation(capabilityId, persona, { forceFresh: false });
        if (result.cached) cached++;
        else generated++;
      } catch (err) {
        errors.push(`cap=${capabilityId} persona=${persona}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  logger.info({ generated, cached, errors: errors.length, durationMs: Date.now() - start }, "[csuite-translator] refresh complete");
  return { generated, cached, errors, durationMs: Date.now() - start };
}
