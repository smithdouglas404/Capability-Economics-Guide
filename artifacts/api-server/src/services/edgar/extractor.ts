import { db, capabilityFilingsTable, capabilitiesTable } from "@workspace/db";
import { eq, and, sql, isNull } from "drizzle-orm";
import { logger } from "../../lib/logger";

/**
 * EDGAR phase 2: Haiku-driven cleanup pass over raw EDGAR search hits.
 *
 * Phase 1 (684a6bd) stores the raw EDGAR highlight snippet as the excerpt.
 * Those snippets contain <em> tags, truncated mid-sentence, and don't
 * disclose which section of the filing the match came from (Risk Factors
 * vs MD&A vs 8-K Item).
 *
 * This pass takes the raw highlight + filing metadata and runs a Haiku
 * call (~$0.02 per filing) to:
 *   - Produce a clean 1-2 sentence excerpt without HTML / truncation
 *   - Classify the section_ref ("1A Risk Factors", "7 MD&A", "8-K Item 4.02",
 *     "Proxy Statement", "Unknown")
 *   - Mark extraction_source = "llm-extracted" so we know which rows have
 *     been through the cleanup vs which are raw search highlights
 *
 * Idempotent: only processes rows where extraction_source = "edgar-search".
 * Re-running is safe.
 */

const HAIKU_MODEL = "anthropic/claude-haiku-4.5";

interface ExtractionResult {
  cleanedExcerpt: string;
  sectionRef: string;
  confidence: number;
}

/**
 * Run Haiku extraction on rows that haven't been processed yet. Optionally
 * scoped to a single capability for on-demand quality bumps after a fresh
 * EDGAR fetch.
 */
export async function extractFilingsViaHaiku(opts: { capabilityId?: number; limit?: number } = {}): Promise<{
  processed: number;
  errors: string[];
  totalCostCents: number;
}> {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 20));
  const errors: string[] = [];
  let processed = 0;
  let totalCostCents = 0;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { processed: 0, errors: ["OPENROUTER_API_KEY not set"], totalCostCents: 0 };
  }

  const whereClause = opts.capabilityId != null
    ? and(eq(capabilityFilingsTable.capabilityId, opts.capabilityId), eq(capabilityFilingsTable.extractionSource, "edgar-search"))
    : eq(capabilityFilingsTable.extractionSource, "edgar-search");

  const targets = await db.select().from(capabilityFilingsTable).where(whereClause).limit(limit);
  if (targets.length === 0) return { processed: 0, errors: [], totalCostCents: 0 };

  // Map capability ids → names in one query
  const capIds = Array.from(new Set(targets.map(t => t.capabilityId)));
  const caps = capIds.length > 0
    ? await db.select().from(capabilitiesTable).where(sql`id IN (${sql.join(capIds.map(id => sql`${id}`), sql`, `)})`)
    : [];
  const capById = new Map(caps.map(c => [c.id, c]));

  for (const filing of targets) {
    const cap = capById.get(filing.capabilityId);
    if (!cap) { errors.push(`filing ${filing.id}: capability missing`); continue; }
    if (!filing.excerpt) {
      // No raw excerpt to clean — mark as processed with empty result so we don't keep retrying
      await db.update(capabilityFilingsTable)
        .set({ extractionSource: "llm-extracted-empty", sectionRef: "Unknown" })
        .where(eq(capabilityFilingsTable.id, filing.id));
      processed++;
      continue;
    }

    try {
      const result = await callHaiku(apiKey, cap.name, filing.formType, filing.excerpt);
      totalCostCents += result.costCents;

      await db.update(capabilityFilingsTable).set({
        excerpt: result.extraction.cleanedExcerpt.slice(0, 1000),
        sectionRef: result.extraction.sectionRef.slice(0, 80),
        extractionSource: "llm-extracted",
      }).where(eq(capabilityFilingsTable.id, filing.id));
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`filing ${filing.id}: ${msg}`);
      logger.warn({ filingId: filing.id, err: msg }, "[edgar-extract] haiku call failed");
    }
  }

  logger.info({ processed, errors: errors.length, totalCostCents }, "[edgar-extract] batch complete");
  return { processed, errors, totalCostCents };
}

async function callHaiku(apiKey: string, capabilityName: string, formType: string, rawExcerpt: string): Promise<{ extraction: ExtractionResult; costCents: number }> {
  const prompt = [
    `An EDGAR full-text search returned this raw snippet from a ${formType} filing matching the capability "${capabilityName}":`,
    "",
    `"""${rawExcerpt}"""`,
    "",
    "Clean it up and structure it. Strip HTML tags. Resolve truncation if obvious from context, otherwise truncate cleanly at a sentence boundary.",
    `Classify the source section reference. Common values: "1A Risk Factors", "7 MD&A", "7A Quantitative and Qualitative Disclosures", "9A Controls and Procedures", "8-K Item 1.01 Entry into Material Agreement", "8-K Item 2.06 Material Impairment", "8-K Item 4.02 Non-Reliance on Prior Financials", "8-K Item 5.02 Departure of Officers", "DEF 14A Proxy Statement", "Unknown".`,
    "",
    "Return JSON: {",
    "  \"cleanedExcerpt\": \"<1-2 sentences, no HTML, no truncation marks>\",",
    "  \"sectionRef\": \"<one of the section refs above, or 'Unknown'>\",",
    "  \"confidence\": <0-1 number reflecting how confident you are in the section classification>",
    "}",
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let resp: Response;
  try {
    resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://inflexcvi.ai",
        "X-Title": "Inflexcvi EDGAR Extractor",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 512,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Haiku ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json() as {
    choices?: Array<{ message: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (data.error) throw new Error(`Haiku error: ${data.error.message}`);

  const content = data.choices?.[0]?.message?.content ?? "";
  const cleaned = content.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Haiku returned no JSON object");
  const parsed = JSON.parse(match[0]) as ExtractionResult;
  if (!parsed.cleanedExcerpt) throw new Error("Haiku response missing cleanedExcerpt");

  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  // Haiku 4.5 pricing: $1/MTok in, $5/MTok out
  const costUsd = (inputTokens / 1_000_000) * 1 + (outputTokens / 1_000_000) * 5;
  const costCents = Math.ceil(costUsd * 100);

  return {
    extraction: {
      cleanedExcerpt: String(parsed.cleanedExcerpt),
      sectionRef: parsed.sectionRef ? String(parsed.sectionRef) : "Unknown",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
    },
    costCents,
  };
}
