/**
 * Perplexity-backed research for a real company's capability transformation,
 * structured into the economics_breakdown shape used by the homepage analogy
 * card (and any other featured-case-study surface).
 *
 * Backs:
 *   - scripts/src/seed-case-study-economics.ts (idempotent seed for 6 cos)
 *   - POST /api/admin/case-studies/:id/regenerate-economics-breakdown
 *
 * The Perplexity API doesn't have native JSON mode, so we ask the model to
 * emit JSON and parse defensively. Anything that can't be parsed or doesn't
 * carry sources is rejected — we never persist made-up numbers.
 */
import { logger } from "../lib/logger";

export interface EconomicsBreakdown {
  companyName: string;
  eventTitle: string;
  costBreakdown: Array<{ label: string; amountUsdMm: number }>;
  valueGeneratedUsdMm: number;
  unlockedUsdMm: number;
  sources: Array<{ url: string; title: string }>;
}

export interface ResearchRequest {
  companyName: string;
  industryName: string;
  /** Optional hint for the headline event/transformation (e.g. "Snapshot UBI program"). */
  transformationHint?: string;
}

const SYSTEM_PROMPT = `You are a financial research analyst sourcing structured economics from public filings (10-K, annual reports, investor presentations, vendor press releases).

You will be asked to research one company's documented capability transformation and return ONLY a single JSON object — no prose, no markdown, no commentary.

The JSON shape is:

{
  "companyName": string,
  "eventTitle": string,
  "costBreakdown": [
    { "label": "Total IT / digital investment (latest disclosed FY)", "amountUsdMm": number },
    { "label": "Capability-specific allocation (specific program)", "amountUsdMm": number }
  ],
  "valueGeneratedUsdMm": number,
  "unlockedUsdMm": number,
  "sources": [
    { "url": "https://...", "title": "..." },
    { "url": "https://...", "title": "..." }
  ]
}

STRICT RULES:
1. All dollar values are in millions of USD. (USD 1.5B → 1500.)
2. Every number must be traceable to a public source you cite in the sources array.
3. If you cannot source a number from a public filing or press release, set it to null in the JSON — do not invent figures.
4. valueGeneratedUsdMm = the dollar-value flow attributable to the capability (revenue uplift, loss-ratio savings, cost avoided, etc.) per the latest disclosed full year.
5. unlockedUsdMm = valueGeneratedUsdMm - capability-specific cost. Mark null if either input is null.
6. costBreakdown should contain exactly two rows: the broad cost center first ("Total IT budget", "Total digital transformation spend", etc.), the capability-specific allocation second.
7. At least 2 sources, each with a real URL to an SEC filing, an annual-report PDF, or a major-publication article. No URLs like "see-page-22-of-the-pdf"; full canonical URLs only.
8. Return the JSON object alone. No \`\`\`json fences, no introduction, no trailing comments.`;

/**
 * Build the per-company prompt.
 */
function buildPrompt(req: ResearchRequest): string {
  const hint = req.transformationHint
    ? ` (focus on: ${req.transformationHint})`
    : "";
  return `Research ${req.companyName}'s most documented capability transformation${hint} in the ${req.industryName} industry.

Pull figures from their latest available 10-K (or 20-F / annual report for non-US issuers), the investor day deck for the relevant program, and major-publication reporting (Bloomberg, WSJ, FT, Reuters).

Return the JSON object as specified.`;
}

const NUMBER_OR_NULL = /^null|-?\d+(\.\d+)?$/;

function isValidEconomicsBreakdown(obj: unknown): obj is EconomicsBreakdown {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  if (typeof o.companyName !== "string" || o.companyName.length === 0) return false;
  if (typeof o.eventTitle !== "string" || o.eventTitle.length === 0) return false;
  if (!Array.isArray(o.costBreakdown) || o.costBreakdown.length === 0) return false;
  for (const c of o.costBreakdown) {
    if (!c || typeof c !== "object") return false;
    const cc = c as Record<string, unknown>;
    if (typeof cc.label !== "string") return false;
    if (typeof cc.amountUsdMm !== "number" || !Number.isFinite(cc.amountUsdMm)) return false;
  }
  if (typeof o.valueGeneratedUsdMm !== "number" || !Number.isFinite(o.valueGeneratedUsdMm)) return false;
  if (typeof o.unlockedUsdMm !== "number" || !Number.isFinite(o.unlockedUsdMm)) return false;
  if (!Array.isArray(o.sources) || o.sources.length < 2) return false;
  for (const s of o.sources) {
    if (!s || typeof s !== "object") return false;
    const ss = s as Record<string, unknown>;
    if (typeof ss.url !== "string" || !/^https?:\/\//.test(ss.url)) return false;
    if (typeof ss.title !== "string" || ss.title.length === 0) return false;
  }
  return true;
}

function extractJsonObject(text: string): string | null {
  // Strip ```json fences if present.
  const stripped = text.replace(/```json\s*/g, "").replace(/```\s*$/g, "").trim();
  // Find first { and last } and slice — defensive against trailing prose.
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return stripped.slice(start, end + 1);
}

export async function researchEconomicsBreakdown(req: ResearchRequest): Promise<EconomicsBreakdown | null> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    logger.warn("[case-study-economics-research] PERPLEXITY_API_KEY not set — skipping");
    return null;
  }
  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-deep-research",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(req) },
        ],
        temperature: 0.1,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.error(
        { status: resp.status, body: text.slice(0, 240), company: req.companyName },
        "[case-study-economics-research] Perplexity returned non-2xx",
      );
      return null;
    }
    const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data?.choices?.[0]?.message?.content ?? "";
    const jsonStr = extractJsonObject(content);
    if (!jsonStr) {
      logger.error({ company: req.companyName, contentPreview: content.slice(0, 240) }, "[case-study-economics-research] no JSON object in response");
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (err) {
      logger.error({ company: req.companyName, err: (err as Error).message, jsonStr: jsonStr.slice(0, 240) }, "[case-study-economics-research] JSON.parse failed");
      return null;
    }
    if (!isValidEconomicsBreakdown(parsed)) {
      logger.error({ company: req.companyName, parsedKeys: Object.keys(parsed as object) }, "[case-study-economics-research] response failed validation");
      return null;
    }
    return parsed;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), company: req.companyName }, "[case-study-economics-research] unexpected error");
    return null;
  }
}
