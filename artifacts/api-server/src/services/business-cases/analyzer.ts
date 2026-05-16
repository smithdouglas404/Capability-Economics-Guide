import { db } from "@workspace/db";
import {
  businessCasesTable,
  capabilitiesTable,
  cviComponentsTable,
  dvxComponentsTable,
} from "@workspace/db";
import { eq, sql, inArray } from "drizzle-orm";
import { chatWithFallback } from "../llm-fallback";
import { logger } from "../../lib/logger";

const SONNET = "anthropic/claude-sonnet-4.6";
const MAX_INPUT_CHARS = 50_000;

/**
 * Business-case analyzer. For an uploaded business case (PDF text /
 * pasted markdown), produces a red-team report:
 *   - extract 8-20 capabilities the case relies on (Sonnet)
 *   - fuzzy-map each against the capabilities table (Postgres ILIKE
 *     similarity; pg_trgm not yet enabled but the structure is here)
 *   - look up current CVI + DVX for mapped capabilities
 *   - red-team Sonnet pass: identify weaknesses (deps in DVX red zone or
 *     CVI <500), wedges (where the case is well-positioned vs incumbents),
 *     and 3-5 concrete recommendations
 *
 * Runs as a background job triggered by POST /api/business-cases.
 * Status transitions: uploaded → parsing → analyzing → complete | failed.
 *
 * Cost: ~$0.30 per case (Sonnet × 2 calls, ~6K input + 2K output total).
 * Future credit gate: CREDIT_COSTS.BUSINESS_CASE_ANALYSIS = 30.
 */
export async function analyzeBusinessCase(businessCaseId: number): Promise<void> {
  const start = Date.now();

  const [bc] = await db.select().from(businessCasesTable).where(eq(businessCasesTable.id, businessCaseId)).limit(1);
  if (!bc) throw new Error(`Business case ${businessCaseId} not found`);
  if (!bc.extractedText || bc.extractedText.length < 100) {
    await markFailed(businessCaseId, "No extracted text available — paste the case body or wait for file parsing to complete.");
    return;
  }

  const text = bc.extractedText.slice(0, MAX_INPUT_CHARS);

  // ── Step 1 — Extract capabilities ──
  await db.update(businessCasesTable).set({ status: "analyzing", updatedAt: new Date() }).where(eq(businessCasesTable.id, businessCaseId));

  let extracted: Array<{ name: string; description?: string; criticality?: "low" | "medium" | "high" }> = [];
  try {
    const extractPrompt = [
      `Read this business case and extract the 8-20 organizational capabilities it relies on for success.`,
      `Capabilities are operational competencies (e.g. "real-time fraud detection", "AI-assisted underwriting", "agent dispatch optimization") — NOT generic functions like "marketing" or "engineering".`,
      ``,
      `Rate each capability's criticality to the case: "low" (nice to have), "medium" (important), "high" (case fails without it).`,
      ``,
      `Business case:`,
      `"""${text}"""`,
      ``,
      `Return JSON: { "capabilities": [{ "name": "<capability>", "description": "<1 sentence>", "criticality": "low" | "medium" | "high" }] }`,
    ].join("\n");

    const res = await chatWithFallback({
      messages: [{ role: "user", content: extractPrompt }],
      models: [SONNET],
      responseFormat: { type: "json_object" },
      maxTokens: 2048,
      endpoint: "business_case:extract",
    });
    const parsed = parseJson(res.text) as { capabilities?: Array<{ name: string; description?: string; criticality?: "low" | "medium" | "high" }> };
    extracted = Array.isArray(parsed.capabilities) ? parsed.capabilities.slice(0, 25) : [];
  } catch (err) {
    await markFailed(businessCaseId, `Capability extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  if (extracted.length === 0) {
    await markFailed(businessCaseId, "No capabilities extracted — case may be too short or vague.");
    return;
  }

  // ── Step 2 — Fuzzy-map against capabilities table ──
  type MappedCap = {
    name: string;
    description?: string;
    criticality?: "low" | "medium" | "high";
    mappedCapabilityId?: number;
    mappingConfidence?: number;
  };
  const allCaps = await db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name }).from(capabilitiesTable);
  const mapped: MappedCap[] = extracted.map(e => {
    const lower = e.name.toLowerCase();
    let best: { id: number; name: string; score: number } | null = null;
    for (const cap of allCaps) {
      const capLower = cap.name.toLowerCase();
      const score = similarity(lower, capLower);
      if (!best || score > best.score) best = { id: cap.id, name: cap.name, score };
    }
    if (best && best.score >= 0.5) {
      return { ...e, mappedCapabilityId: best.id, mappingConfidence: best.score };
    }
    return { ...e };
  });

  // ── Step 3 — Look up CVI/DVX for mapped capabilities ──
  const mappedIds = mapped.map(m => m.mappedCapabilityId).filter((x): x is number => x != null);
  const cviRows = mappedIds.length > 0
    ? await db.select().from(cviComponentsTable).where(inArray(cviComponentsTable.capabilityId, mappedIds))
    : [];
  const dvxRows = mappedIds.length > 0
    ? await db.select().from(dvxComponentsTable).where(inArray(dvxComponentsTable.capabilityId, mappedIds))
    : [];
  const cviByCap = new Map(cviRows.map(c => [c.capabilityId, c]));
  const dvxByCap = new Map(dvxRows.map(d => [d.capabilityId, d]));

  // ── Step 4 — Red-team synthesis ──
  let analysis: {
    weaknesses: Array<{ capabilityName: string; mappedCapabilityId?: number; cviScore?: number; dvxScore?: number; concern: string }>;
    wedges: Array<{ capabilityName: string; mappedCapabilityId?: number; cviScore?: number; advantage: string }>;
    recommendations: Array<{ action: string; rationale: string; priority: "immediate" | "near" | "watch" }>;
    summary?: string;
  };
  try {
    const enrichedCaps = mapped.map(m => {
      const cvi = m.mappedCapabilityId ? cviByCap.get(m.mappedCapabilityId) : null;
      const dvx = m.mappedCapabilityId ? dvxByCap.get(m.mappedCapabilityId) : null;
      return {
        name: m.name,
        criticality: m.criticality ?? "medium",
        cviScore: cvi?.consensusScore ?? null,
        cviVelocity: cvi?.velocity ?? null,
        dvxScore: dvx?.disruptionScore ?? null,
        dvxMonths: dvx?.monthsToDisplacement ?? null,
        topDisruptors: (dvx?.topDisruptors as string[] | undefined) ?? [],
        mapped: m.mappedCapabilityId != null,
      };
    });

    const redTeamPrompt = [
      `You are a red-team strategist evaluating a business case against the Inflexcvi platform's CVI (current capability value, 0-1000) and DVX (disruption probability, 0-100) data.`,
      ``,
      `Business case (excerpt):`,
      `"""${text.slice(0, 8000)}"""`,
      ``,
      `Capabilities this case depends on, with their current Inflexcvi data:`,
      JSON.stringify(enrichedCaps, null, 2),
      ``,
      `Produce a structured red-team analysis:`,
      `- weaknesses: capabilities the case relies on that are in DVX red zone (≥70) OR CVI <500 OR not mapped to a known capability. For each, explain the concern in 1-2 sentences.`,
      `- wedges: capabilities where this case is well-positioned vs incumbents (CVI gap, fresh tech, etc.). 1-2 sentences each.`,
      `- recommendations: 3-5 concrete actions (build / buy / partner / pivot). Each with rationale + priority ("immediate" | "near" | "watch").`,
      `- summary: 2-3 sentence top-line verdict.`,
      ``,
      `Return JSON: { "weaknesses": [...], "wedges": [...], "recommendations": [...], "summary": "..." }`,
    ].join("\n");

    const res = await chatWithFallback({
      messages: [{ role: "user", content: redTeamPrompt }],
      models: [SONNET],
      responseFormat: { type: "json_object" },
      maxTokens: 3072,
      endpoint: "business_case:red_team",
    });
    analysis = parseJson(res.text) as typeof analysis;
    analysis.weaknesses = Array.isArray(analysis.weaknesses) ? analysis.weaknesses : [];
    analysis.wedges = Array.isArray(analysis.wedges) ? analysis.wedges : [];
    analysis.recommendations = Array.isArray(analysis.recommendations) ? analysis.recommendations : [];
  } catch (err) {
    await markFailed(businessCaseId, `Red-team synthesis failed: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  await db.update(businessCasesTable).set({
    extractedCapabilities: mapped,
    analysisJson: analysis,
    status: "complete",
    updatedAt: new Date(),
  }).where(eq(businessCasesTable.id, businessCaseId));

  logger.info({
    businessCaseId,
    capabilitiesExtracted: extracted.length,
    capabilitiesMapped: mappedIds.length,
    weaknessCount: analysis.weaknesses.length,
    wedgeCount: analysis.wedges.length,
    recommendationCount: analysis.recommendations.length,
    durationMs: Date.now() - start,
  }, "[business-case] analysis complete");
}

async function markFailed(businessCaseId: number, message: string): Promise<void> {
  await db.update(businessCasesTable).set({
    status: "failed",
    errorMessage: message,
    updatedAt: new Date(),
  }).where(eq(businessCasesTable.id, businessCaseId));
}

function parseJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try { return JSON.parse(match[0]); } catch { return {}; }
}

/**
 * Token-based Jaccard similarity (lowercase, word-split). Cheap; good
 * enough to short-list cap matches before LLM gets the final say. When
 * pg_trgm is enabled later, replace this with a real similarity score.
 */
function similarity(a: string, b: string): number {
  const ta = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return intersection / union;
}
