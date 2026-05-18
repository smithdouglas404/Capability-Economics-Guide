import { db, capabilityFilingsTable, capabilitiesTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { generateObject } from "ai";
import { z } from "zod";
import { haiku } from "../workflows/models";
import { logger } from "../../lib/logger";

/**
 * EDGAR phase 2: Haiku-driven cleanup pass over raw EDGAR search hits.
 *
 * Phase 1 stores the raw EDGAR highlight snippet as the excerpt. Those
 * snippets contain <em> tags, truncated mid-sentence, and don't disclose
 * which section of the filing the match came from.
 *
 * This pass takes the raw highlight + filing metadata and runs a Haiku
 * call (~$0.02 per filing) via Vercel AI SDK `generateObject` (Zod-validated,
 * auto-retried on schema mismatch) to:
 *   - Produce a clean 1-2 sentence excerpt without HTML / truncation
 *   - Classify the section_ref ("1A Risk Factors", "7 MD&A", "8-K Item 4.02",
 *     "Proxy Statement", "Unknown")
 *   - Mark extraction_source = "llm-extracted" so we know which rows have
 *     been through the cleanup vs which are raw search highlights
 *
 * Idempotent: only processes rows where extraction_source = "edgar-search".
 * Re-running is safe.
 */

const ExtractionSchema = z.object({
  cleanedExcerpt: z.string().min(1),
  sectionRef: z.string().default("Unknown"),
  confidence: z.number().min(0).max(1).default(0.5),
});

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

  if (!process.env.OPENROUTER_API_KEY) {
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
      const { object, usage } = await generateObject({
        model: haiku,
        schema: ExtractionSchema,
        system: `You clean up raw EDGAR full-text search snippets. Strip HTML tags. Resolve truncation if obvious from context, otherwise truncate cleanly at a sentence boundary. Classify the source section reference — common values include "1A Risk Factors", "7 MD&A", "7A Quantitative and Qualitative Disclosures", "9A Controls and Procedures", "8-K Item 1.01 Entry into Material Agreement", "8-K Item 2.06 Material Impairment", "8-K Item 4.02 Non-Reliance on Prior Financials", "8-K Item 5.02 Departure of Officers", "DEF 14A Proxy Statement", "Unknown".`,
        prompt: `Form: ${filing.formType}\nCapability: "${cap.name}"\n\nRaw snippet:\n"""${filing.excerpt}"""`,
        temperature: 0.0,
        maxTokens: 512,
      });

      // Haiku 4.5 pricing: $1/MTok in, $5/MTok out
      const costUsd = ((usage.promptTokens ?? 0) / 1_000_000) * 1 + ((usage.completionTokens ?? 0) / 1_000_000) * 5;
      totalCostCents += Math.ceil(costUsd * 100);

      await db.update(capabilityFilingsTable).set({
        excerpt: object.cleanedExcerpt.slice(0, 1000),
        sectionRef: object.sectionRef.slice(0, 80),
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
