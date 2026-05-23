import { db } from "@workspace/db";
import {
  capabilitiesTable,
  industriesTable,
  cviComponentsTable,
  cviSnapshotsTable,
  dvxComponentsTable,
  disruptionPatternsTable,
} from "@workspace/db";
import { sql, inArray, desc } from "drizzle-orm";
import { chatWithFallback } from "../llm-fallback";
import { logger } from "../../lib/logger";

/**
 * Natural-language query RAG pipeline. Replaces the brittle regex-matched
 * handlers in routes/nl-query.ts with a Claude-powered flow:
 *
 *   1. Classify the query (Haiku, fast + cheap) into one of:
 *      capability_lookup, industry_overview, disruption_risk, methodology,
 *      pattern_explanation, other
 *   2. Retrieve context — pull the relevant rows from capabilities,
 *      cvi_components, dvx_components, industries, disruption_patterns,
 *      cvi_snapshots based on the classification + capability/industry
 *      name fuzzy match (pg_trgm similarity).
 *   3. Synthesize via Sonnet 4.6 with the retrieved rows as context. JSON
 *      output for structured response (answer + citations + suggested
 *      follow-ups).
 *
 * Cost target: ~$0.05/query (Haiku class ~$0.001 + Sonnet synthesis
 * ~$0.04). Tagged for credit gating as NL_QUERY_RAG (4 credits).
 */

const HAIKU = "anthropic/claude-haiku-4.5";
const SONNET = "anthropic/claude-sonnet-4.6";

export type QueryCategory =
  | "capability_lookup"
  | "industry_overview"
  | "disruption_risk"
  | "methodology"
  | "pattern_explanation"
  | "other";

export interface RagAnswer {
  classification: QueryCategory;
  answer: string;
  citations: Array<{ label: string; detail?: string }>;
  followUps: string[];
  retrievedContextCount: number;
  costCents: number;
  durationMs: number;
}

export interface RagContext {
  /** Default industry name from session — used as fallback when the classifier
   *  can't extract one from the query text (e.g. "what's changed for me?"). */
  defaultIndustryName?: string | null;
}

export async function runNlQueryRag(query: string, ctx: RagContext = {}): Promise<RagAnswer> {
  const start = Date.now();
  let costCents = 0;

  // Step 1: classify
  const classifyPrompt = [
    `Classify this user query about the Inflexcvi platform into ONE category.`,
    ``,
    `Categories:`,
    `- capability_lookup: asks about a specific named capability (e.g. "what's the CVI for payment processing?")`,
    `- industry_overview: asks about a whole industry's posture (e.g. "how is financial services doing?")`,
    `- disruption_risk: asks about disruption probability / DVX / what's threatening a capability`,
    `- methodology: asks how the platform works / how scores are computed`,
    `- pattern_explanation: asks about a named disruption pattern (Uber/Airbnb/Stripe/Tesla/...)`,
    `- other: doesn't fit any of the above`,
    ``,
    `Also extract any specific capability name(s) or industry name(s) the user mentions.`,
    ``,
    `User query: """${query.slice(0, 1500)}"""`,
    ``,
    `Return JSON: { "category": "<one of above>", "capabilityNames": ["..."], "industryNames": ["..."], "patternSlug": "<slug if pattern_explanation, else null>" }`,
  ].join("\n");

  const classifyResult = await chatWithFallback({
    messages: [{ role: "user", content: classifyPrompt }],
    models: [HAIKU, SONNET],
    responseFormat: { type: "json_object" },
    maxTokens: 256,
    endpoint: "nl_query_rag:classify",
  });
  costCents += estimateCostCents(HAIKU, 400, 100);
  const classifyJson = parseJson(classifyResult.text) as {
    category?: QueryCategory;
    capabilityNames?: string[];
    industryNames?: string[];
    patternSlug?: string | null;
  };
  const classification = (classifyJson.category ?? "other") as QueryCategory;
  const capNames = (classifyJson.capabilityNames ?? []).map(s => s.toLowerCase());
  let industryNames = (classifyJson.industryNames ?? []).map(s => s.toLowerCase());
  // Session-context fallback — if the user's question didn't name an industry
  // but their session is scoped to one, ground the answer there. Lets "what's
  // changed for me this week" resolve against the user's selected industry.
  if (industryNames.length === 0 && ctx.defaultIndustryName) {
    industryNames = [ctx.defaultIndustryName.toLowerCase()];
  }
  const patternSlug = classifyJson.patternSlug ?? null;

  // Step 2: retrieve context based on classification
  const context: Array<{ kind: string; data: Record<string, unknown> }> = [];

  // Capability + CVI + DVX rows for any matching capability names
  if (capNames.length > 0) {
    const matchingCaps = await db
      .select()
      .from(capabilitiesTable)
      .where(sql`LOWER(${capabilitiesTable.name}) IN (${sql.join(capNames.map(n => sql`${n}`), sql`, `)}) OR ${capabilitiesTable.name} ILIKE ANY (${sql.join(capNames.map(n => sql`${"%" + n + "%"}`), sql`, `)})`)
      .limit(10);
    for (const cap of matchingCaps) {
      const [cvi] = await db.select().from(cviComponentsTable).where(sql`capability_id = ${cap.id}`).limit(1);
      const [dvx] = await db.select().from(dvxComponentsTable).where(sql`capability_id = ${cap.id}`).limit(1);
      context.push({
        kind: "capability",
        data: { cap, cvi: cvi ?? null, dvx: dvx ?? null },
      });
    }
  }

  // Industry rows + latest snapshots for any matching industries
  if (industryNames.length > 0) {
    const matchingIndustries = await db
      .select()
      .from(industriesTable)
      .where(sql`LOWER(${industriesTable.name}) IN (${sql.join(industryNames.map(n => sql`${n}`), sql`, `)}) OR ${industriesTable.name} ILIKE ANY (${sql.join(industryNames.map(n => sql`${"%" + n + "%"}`), sql`, `)})`)
      .limit(10);
    for (const ind of matchingIndustries) {
      context.push({ kind: "industry", data: { ind } });
    }
  }

  // Pattern detail if pattern_explanation
  if (patternSlug) {
    const [pattern] = await db.select().from(disruptionPatternsTable).where(sql`slug = ${patternSlug}`).limit(1);
    if (pattern) context.push({ kind: "pattern", data: { pattern } });
  }

  // For industry_overview or disruption_risk with no specific cap, pull top-DVX caps
  if (classification === "disruption_risk" && capNames.length === 0) {
    const topDvx = await db
      .select({
        cap: capabilitiesTable,
        dvx: dvxComponentsTable,
      })
      .from(dvxComponentsTable)
      .innerJoin(capabilitiesTable, sql`${capabilitiesTable.id} = ${dvxComponentsTable.capabilityId}`)
      .orderBy(desc(dvxComponentsTable.disruptionScore))
      .limit(10);
    for (const row of topDvx) {
      context.push({ kind: "top_dvx_capability", data: row });
    }
  }

  if (classification === "industry_overview" || classification === "methodology") {
    const [latestSnap] = await db.select().from(cviSnapshotsTable).orderBy(desc(cviSnapshotsTable.snapshotAt)).limit(1);
    if (latestSnap) context.push({ kind: "latest_cvi_snapshot", data: { snap: latestSnap } });
  }

  // Step 3: synthesize via Sonnet
  const synthesisPrompt = [
    `You are an Inflexcvi platform analyst. The user has asked a question; answer it using only the structured context below.`,
    ``,
    `IMPORTANT:`,
    `- Cite specific scores, capability names, industry names from the context`,
    `- If the context doesn't fully answer, say so explicitly — never invent CVI/DVX scores`,
    `- Inflexcvi terminology: CVI = Capability Value Index (0-1000, current value), DVX = Disruption Velocity Index (0-100, displacement probability with months_to_displacement)`,
    `- Keep the answer 2-4 paragraphs unless the question demands more`,
    ``,
    `Query classification: ${classification}`,
    `Retrieved context (${context.length} rows):`,
    JSON.stringify(context, null, 2).slice(0, 12000),
    ``,
    `User query: """${query.slice(0, 1500)}"""`,
    ``,
    `Return JSON: {`,
    `  "answer": "<2-4 paragraph response>",`,
    `  "citations": [{ "label": "<short label like 'Payment Processing CVI'>", "detail": "<value>" }],`,
    `  "followUps": ["<suggested follow-up question 1>", "<follow-up 2>"]`,
    `}`,
  ].join("\n");

  const synthResult = await chatWithFallback({
    messages: [{ role: "user", content: synthesisPrompt }],
    models: [SONNET, HAIKU],
    responseFormat: { type: "json_object" },
    maxTokens: 2048,
    endpoint: "nl_query_rag:synthesize",
  });
  costCents += estimateCostCents(SONNET, 4000, 1500);

  const synthJson = parseJson(synthResult.text) as {
    answer?: string;
    citations?: Array<{ label: string; detail?: string }>;
    followUps?: string[];
  };

  const result: RagAnswer = {
    classification,
    answer: synthJson.answer ?? "",
    citations: synthJson.citations ?? [],
    followUps: synthJson.followUps ?? [],
    retrievedContextCount: context.length,
    costCents,
    durationMs: Date.now() - start,
  };

  logger.info({
    classification,
    contextCount: context.length,
    costCents,
    durationMs: result.durationMs,
  }, "[nl-query-rag] complete");

  return result;
}

function parseJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try { return JSON.parse(match[0]); } catch { return {}; }
}

function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  // Haiku 4.5: $1/$5 per MTok; Sonnet 4.6: $3/$15 per MTok
  const pricing = model.includes("haiku")
    ? { input: 1, output: 5 }
    : { input: 3, output: 15 };
  const usd = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  return Math.ceil(usd * 100);
}
