/**
 * Upload-analysis service — Move 6 of the strategic UX overhaul.
 *
 * Pipeline: file upload → text extraction → LLM structured extraction →
 * fuzzy-match-to-catalog → enrichment with current CVI/DVX → save row →
 * return report. The whole thing in one round-trip from the client's POV.
 *
 * The differentiator vs every other "paste your business plan into an LLM"
 * tool: we have a real capability graph. So extracted claims aren't free-text;
 * they're matched against `capabilities` rows with their current CVI score,
 * DVX disruption flag, value-chain stage, and dependency edges. The user's
 * report can say "you claim Customer Data Platform at high maturity, but
 * its DVX is 67 (active disruption) — here's the disruptor pattern and the
 * three companies racing past you on it."
 */
import { z } from "zod";
import { generateObject, sonnet } from "../services/workflows/models";
import { db, capabilitiesTable, industriesTable, cviComponentsTable, dvxComponentsTable } from "@workspace/db";
import { eq, ilike, or, sql } from "drizzle-orm";

/**
 * What the LLM extracts from the uploaded document. Kept tight — schema
 * larger than this slows generation and increases hallucination surface.
 * Claims are intentionally string-typed for capability names; the catalog
 * match happens afterwards in matchCapabilities.
 */
export const ExtractedClaimsSchema = z.object({
  // High-level positioning
  organizationName: z.string().nullable().describe("Name of the company / org described in the document. Null if not present."),
  industrySector: z.string().nullable().describe("Industry the org operates in, e.g. 'banking', 'healthcare'. Null if unclear."),
  oneLineDescription: z.string().nullable().describe("One-sentence summary of what the org does."),

  // Capability claims — the meat
  claimedCapabilities: z.array(z.object({
    name: z.string().describe("The capability or function the document claims to have / be building. Use the document's wording."),
    claimedMaturity: z.enum(["nascent", "developing", "mature", "leading"]).nullable().describe("How developed the document says this capability is. Null if not stated."),
    supportingEvidence: z.string().nullable().describe("A short quote or paraphrase from the document justifying the claim."),
    isCore: z.boolean().describe("True if this is positioned as a core competitive advantage, false if it's a supporting / standard capability."),
  })).describe("Every capability the document claims as part of the org's offering or value prop. Aim for 5-20."),

  // Competitive claims
  competitors: z.array(z.string()).describe("Companies named as competitors or comparison points. Empty if none."),

  // Market sizing claims
  marketSizeClaims: z.array(z.object({
    quote: z.string().describe("Exact text of the market sizing claim."),
    figureUsd: z.number().nullable().describe("USD figure extracted from the claim, or null if it's qualitative."),
  })).describe("Any TAM / SAM / SOM / market-sizing statements. Empty if none."),
});

export type ExtractedClaims = z.infer<typeof ExtractedClaimsSchema>;

/**
 * Stage 1 — text extraction from the uploaded file. The route layer
 * receives the buffer; this function returns the parsed text. PDF via
 * pdf-parse, docx via mammoth, plain text passthrough.
 */
export async function extractTextFromFile(buffer: Buffer, mimeType: string): Promise<string> {
  const mt = mimeType.toLowerCase();
  if (mt.includes("pdf")) {
    // pdf-parse v2 ESM doesn't expose a default export; import the named function.
    const mod = await import("pdf-parse");
    const pdfParse = (mod as unknown as { PDFParse: new (opts: { data: Buffer }) => { getText(): Promise<{ text: string }> } }).PDFParse;
    const parser = new pdfParse({ data: buffer });
    const result = await parser.getText();
    return result.text;
  }
  if (mt.includes("officedocument.wordprocessingml") || mt.includes("docx")) {
    const { default: mammoth } = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  // Plain text / markdown / anything else — assume UTF-8.
  return buffer.toString("utf-8");
}

/**
 * Stage 2 — LLM-driven extraction. Returns structured claims via Vercel
 * AI SDK generateObject (Zod schema enforcement = no JSON repair needed).
 * Capped at the first 25K chars of the source to keep latency reasonable
 * and token cost predictable.
 */
export async function extractClaims(text: string): Promise<ExtractedClaims> {
  const trimmed = text.length > 25_000 ? text.slice(0, 25_000) + "\n...[truncated]" : text;
  const { object } = await generateObject({
    model: sonnet,
    schema: ExtractedClaimsSchema,
    system: `You extract structured capability claims from business documents (business plans, pitch decks, strategy memos, white papers). You are precise and skeptical: only record claims explicitly stated in the document, never invent. If the document is short or has few capabilities, return a short list — don't pad.`,
    prompt: `Document:\n\n${trimmed}`,
    temperature: 0.1,
    maxTokens: 3000,
  });
  return object;
}

/**
 * Stage 3 — match extracted claims against our capability catalog. Uses
 * a two-pass approach: exact name match first (case-insensitive), then
 * substring/prefix match for near-misses. Returns the catalog rows plus
 * the current CVI score, DVX disruption score, and value-chain stage for
 * each matched capability. Unmatched claims are returned with `matchedCap=null`.
 */
export interface MatchedClaim {
  claim: ExtractedClaims["claimedCapabilities"][number];
  matchedCap: {
    id: number;
    name: string;
    industryId: number;
    industryName: string | null;
    valueChainStage: string | null;
    cviScore: number | null;
    cviVelocity: number | null;
    dvxScore: number | null;
    dvxBucket: "stable" | "watch" | "elevated" | "active" | null;
  } | null;
  matchType: "exact" | "fuzzy" | "none";
}

function dvxBucket(score: number | null): MatchedClaim["matchedCap"] extends infer M ? (M extends { dvxBucket: infer D } ? D : never) : never {
  if (score === null) return null;
  if (score >= 70) return "active";
  if (score >= 40) return "elevated";
  if (score >= 20) return "watch";
  return "stable";
}

export async function matchCapabilities(claims: ExtractedClaims["claimedCapabilities"], industryHint: string | null): Promise<MatchedClaim[]> {
  // Pull catalog: just enough fields to render the report. Live-join CVI + DVX
  // by capabilityId. Industry filter narrows down when the claim told us the
  // sector — drops false positives across industries that share generic
  // capability names like "Data Platform."
  let industryId: number | null = null;
  if (industryHint) {
    const [ind] = await db
      .select({ id: industriesTable.id })
      .from(industriesTable)
      .where(or(
        ilike(industriesTable.name, industryHint),
        ilike(industriesTable.slug, industryHint.toLowerCase().replace(/\s+/g, "-")),
      ))
      .limit(1);
    industryId = ind?.id ?? null;
  }

  const catalog = await db
    .select({
      id: capabilitiesTable.id,
      name: capabilitiesTable.name,
      industryId: capabilitiesTable.industryId,
      industryName: industriesTable.name,
      valueChainStage: capabilitiesTable.valueChainStage,
      cviScore: cviComponentsTable.consensusScore,
      cviVelocity: cviComponentsTable.velocity,
      dvxScore: dvxComponentsTable.disruptionScore,
    })
    .from(capabilitiesTable)
    .leftJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId))
    .leftJoin(cviComponentsTable, eq(cviComponentsTable.capabilityId, capabilitiesTable.id))
    .leftJoin(dvxComponentsTable, eq(dvxComponentsTable.capabilityId, capabilitiesTable.id));

  // Pre-build the search-ready catalog. Lowercase + tokenize for fuzzy match.
  const indexedCatalog = catalog.map(c => ({
    ...c,
    normalized: c.name.toLowerCase().trim(),
    tokens: c.name.toLowerCase().split(/[\s&,/]+/).filter(t => t.length > 2),
  }));

  return claims.map(claim => {
    const needle = claim.name.toLowerCase().trim();
    const needleTokens = needle.split(/[\s&,/]+/).filter(t => t.length > 2);

    // Pass 1: exact name match (industry-scoped if we have a hint).
    const exact = indexedCatalog.find(c => c.normalized === needle && (industryId === null || c.industryId === industryId));
    if (exact) {
      return {
        claim,
        matchedCap: enrichMatch(exact),
        matchType: "exact",
      };
    }
    // Pass 2: substring containment — does the needle live inside a catalog name,
    // or does a catalog name live inside the needle?
    const contains = indexedCatalog.find(c => (c.normalized.includes(needle) || needle.includes(c.normalized)) && (industryId === null || c.industryId === industryId));
    if (contains) {
      return { claim, matchedCap: enrichMatch(contains), matchType: "fuzzy" };
    }
    // Pass 3: token overlap (Jaccard ≥ 0.5)
    if (needleTokens.length > 0) {
      const scored = indexedCatalog
        .filter(c => industryId === null || c.industryId === industryId)
        .map(c => {
          const overlap = needleTokens.filter(t => c.tokens.includes(t)).length;
          const union = new Set([...needleTokens, ...c.tokens]).size;
          return { c, score: union > 0 ? overlap / union : 0 };
        })
        .filter(x => x.score >= 0.5)
        .sort((a, b) => b.score - a.score);
      if (scored[0]) {
        return { claim, matchedCap: enrichMatch(scored[0].c), matchType: "fuzzy" };
      }
    }
    return { claim, matchedCap: null, matchType: "none" };
  });
}

function enrichMatch(c: {
  id: number; name: string; industryId: number; industryName: string | null; valueChainStage: string | null;
  cviScore: number | null; cviVelocity: number | null; dvxScore: number | null;
}): NonNullable<MatchedClaim["matchedCap"]> {
  return {
    id: c.id,
    name: c.name,
    industryId: c.industryId,
    industryName: c.industryName,
    valueChainStage: c.valueChainStage,
    cviScore: c.cviScore,
    cviVelocity: c.cviVelocity,
    dvxScore: c.dvxScore,
    dvxBucket: dvxBucket(c.dvxScore),
  };
}

/**
 * Stage 4 — compose the human-readable narrative around the matches.
 * Returns markdown so the report renders directly in the React UI and
 * exports cleanly to the Move 3 Notion / Markdown download.
 */
export async function composeReport(args: {
  claims: ExtractedClaims;
  matches: MatchedClaim[];
}): Promise<string> {
  // Build the matched-claim digest the LLM uses to write the narrative.
  // Keep it tight — only what's load-bearing for the analysis.
  const digest = args.matches.map(m => {
    if (!m.matchedCap) return `- "${m.claim.name}" (claimed ${m.claim.claimedMaturity ?? "unspecified"}) — NO MATCH in our capability graph`;
    return `- "${m.claim.name}" → ${m.matchedCap.name} [${m.matchType}] · CVI=${m.matchedCap.cviScore?.toFixed(1) ?? "—"} · velocity=${m.matchedCap.cviVelocity?.toFixed(2) ?? "—"} · DVX=${m.matchedCap.dvxScore?.toFixed(1) ?? "—"} (${m.matchedCap.dvxBucket ?? "—"}) · industry=${m.matchedCap.industryName ?? "—"} · stage=${m.matchedCap.valueChainStage ?? "—"}`;
  }).join("\n");

  const { object } = await generateObject({
    model: sonnet,
    schema: z.object({
      executiveSummary: z.string().describe("3-5 sentence overall read. Lead with what the document is good at, end with what it should worry about."),
      strongestClaims: z.array(z.string()).describe("Up to 3 short bullets — claims where the matched capability has high CVI + low DVX (proven, defensible)."),
      vulnerableClaims: z.array(z.string()).describe("Up to 3 short bullets — claims where the matched capability has high DVX (active disruption) or low CVI (commodified). These are the risks."),
      missingCapabilities: z.array(z.string()).describe("Up to 3 short bullets — capabilities you'd expect in this industry that the document didn't claim. Use the industry-sector hint to ground this."),
      questionsForFounder: z.array(z.string()).describe("Up to 4 sharp questions a sophisticated investor would ask after reading the document, given the capability gaps and DVX flags."),
    }),
    system: `You write capability-gap analyses for investors and strategists. You are skeptical but constructive — every critique is grounded in the matched capability data, every recommendation cites a specific capability or DVX score. Never invent capabilities not in the digest.`,
    prompt: `Document context:
Organization: ${args.claims.organizationName ?? "unnamed"}
Industry: ${args.claims.industrySector ?? "unstated"}
One-liner: ${args.claims.oneLineDescription ?? "—"}
Competitors named: ${args.claims.competitors.join(", ") || "none"}

Capability claims matched to our graph:
${digest}

Now write the structured analysis.`,
    temperature: 0.3,
    maxTokens: 2000,
  });

  // Compose markdown from the structured object.
  const lines: string[] = [];
  lines.push(`# Capability Analysis — ${args.claims.organizationName ?? "Untitled"}`);
  if (args.claims.industrySector) lines.push(`> Industry: ${args.claims.industrySector}`);
  if (args.claims.oneLineDescription) lines.push(`> ${args.claims.oneLineDescription}`);
  lines.push("");
  lines.push("## Executive summary");
  lines.push(object.executiveSummary);

  if (object.strongestClaims.length > 0) {
    lines.push("");
    lines.push("## Strongest claims");
    object.strongestClaims.forEach(c => lines.push(`- ${c}`));
  }
  if (object.vulnerableClaims.length > 0) {
    lines.push("");
    lines.push("## Vulnerable claims");
    object.vulnerableClaims.forEach(c => lines.push(`- ${c}`));
  }
  if (object.missingCapabilities.length > 0) {
    lines.push("");
    lines.push("## What's missing");
    object.missingCapabilities.forEach(c => lines.push(`- ${c}`));
  }
  if (object.questionsForFounder.length > 0) {
    lines.push("");
    lines.push("## Questions a sophisticated investor would ask");
    object.questionsForFounder.forEach(q => lines.push(`- ${q}`));
  }

  // Append the raw capability matches as a reference table.
  lines.push("");
  lines.push("## Capability match table");
  lines.push("| Claimed | Matched | CVI | DVX | Industry | Stage |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const m of args.matches) {
    if (!m.matchedCap) {
      lines.push(`| ${m.claim.name} | — | — | — | — | — |`);
    } else {
      lines.push(`| ${m.claim.name} | ${m.matchedCap.name} | ${m.matchedCap.cviScore?.toFixed(1) ?? "—"} | ${m.matchedCap.dvxScore?.toFixed(1) ?? "—"} (${m.matchedCap.dvxBucket ?? "—"}) | ${m.matchedCap.industryName ?? "—"} | ${m.matchedCap.valueChainStage ?? "—"} |`);
    }
  }

  return lines.join("\n");
}
