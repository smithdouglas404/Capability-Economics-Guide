/**
 * Regulation enforcement-intensity forecaster.
 *
 * For each regulation in the catalog, asks Perplexity whether enforcement of
 * the regulation has been getting stricter, steady, or softer over the last
 * ~12 months and writes the structured forecast to
 * `regulation_enforcement_forecasts`. Used by GET /api/regulations/overview
 * to render the forward-looking enforcement chip next to each row.
 *
 * Cadence: weekly via the scheduler — these signals do not move daily.
 *
 * Graceful-degrade: when `PERPLEXITY_API_KEY` is unset, the forecaster logs
 * once and skips. Existing rows remain (until their validUntil passes); the
 * overview endpoint simply returns `null` for unforecast regulations.
 */
import { db } from "@workspace/db";
import {
  regulationsTable,
  regulationEnforcementForecastsTable,
  type RegulationEnforcementForecastDirection,
} from "@workspace/db";
import { perplexityChat } from "./perplexity";

interface ForecasterStats {
  considered: number;
  forecast: number;
  skipped: number;
  errors: number;
}

const VALID_DIRECTIONS: RegulationEnforcementForecastDirection[] = ["stricter", "steady", "softer"];
const VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;

interface RawForecast {
  direction: string;
  confidence: number;
  summary: string;
  citations?: string[];
}

function parseForecast(content: string): RawForecast | null {
  if (!content) return null;
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(cleaned.substring(start, end + 1)) as Partial<RawForecast>;
    if (typeof parsed.direction !== "string") return null;
    if (typeof parsed.confidence !== "number") return null;
    if (typeof parsed.summary !== "string") return null;
    return {
      direction: parsed.direction.toLowerCase().trim(),
      confidence: parsed.confidence,
      summary: parsed.summary.trim(),
      citations: Array.isArray(parsed.citations) ? parsed.citations.filter((c) => typeof c === "string") : [],
    };
  } catch {
    return null;
  }
}

export async function runRegulationEnforcementForecaster(): Promise<ForecasterStats> {
  const stats: ForecasterStats = { considered: 0, forecast: 0, skipped: 0, errors: 0 };

  if (!process.env.PERPLEXITY_API_KEY) {
    console.warn("[regulation-enforcement-forecaster] PERPLEXITY_API_KEY not set — skipping forecast run");
    return stats;
  }

  const regs = await db.select().from(regulationsTable);
  stats.considered = regs.length;
  if (regs.length === 0) return stats;

  for (const reg of regs) {
    try {
      const sysPrompt =
        "You are a regulatory-affairs analyst. Return ONLY a single JSON object — no prose, no code fences. Base your answer on enforcement actions, fines, official guidance, or regulator pronouncements you can cite.";
      const userPrompt = `Has enforcement of ${reg.shortCode} (${reg.name}) by the relevant ${reg.jurisdiction} regulator been getting stricter, staying steady, or getting softer over the last 12 months? Cite recent fines, regulatory pronouncements, or guidance.

Return this exact JSON shape:
{
  "direction": "stricter" | "steady" | "softer",
  "confidence": <0..1 float>,
  "summary": "<exactly two sentences explaining the trend and evidence>",
  "citations": ["<url1>", "<url2>", "..."]
}`;

      const resp = await perplexityChat({
        model: "sonar",
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userPrompt },
        ],
        endpoint: "regulation-enforcement-forecaster",
        context: { regulationId: reg.id, shortCode: reg.shortCode },
      });

      const content = resp.choices[0]?.message?.content ?? "";
      const parsed = parseForecast(content);
      if (!parsed || !VALID_DIRECTIONS.includes(parsed.direction as RegulationEnforcementForecastDirection)) {
        stats.skipped++;
        continue;
      }

      const confidence = Math.max(0, Math.min(1, parsed.confidence));
      const citations = (parsed.citations && parsed.citations.length > 0
        ? parsed.citations
        : resp.citations ?? []
      ).slice(0, 8);

      await db.insert(regulationEnforcementForecastsTable).values({
        regulationId: reg.id,
        direction: parsed.direction,
        confidence,
        summary: parsed.summary.slice(0, 800),
        sourceCitations: citations,
        validUntil: new Date(Date.now() + VALIDITY_MS),
      });
      stats.forecast++;
    } catch (err) {
      stats.errors++;
      console.warn(
        `[regulation-enforcement-forecaster] failed for ${reg.shortCode}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return stats;
}
