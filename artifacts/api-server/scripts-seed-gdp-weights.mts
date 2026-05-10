/**
 * Seeds the industry_gdp_weights table with Perplexity-cited GDP shares
 * (latest available year, World Bank / IMF sources). Replaces the prior
 * hardcoded INDUSTRY_GDP_WEIGHTS constant in cei-engine.ts.
 *
 * No fallback values: if Perplexity fails to return a numeric gdp_share or
 * a sourceUrl for an industry, that row is SKIPPED and logged. Missing rows
 * cause the engine to fall back to equal-weighting *with a warning* rather
 * than substituting a synthetic number.
 *
 * Idempotent: existing rows for an industry are left in place. Pass
 * `FORCE=1` to overwrite.
 *
 * Run: cd artifacts/api-server && ./node_modules/.bin/tsx scripts-seed-gdp-weights.mts
 */
import { db } from "@workspace/db";
import { industriesTable, industryGdpWeightsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

if (!process.env.PERPLEXITY_API_KEY) {
  console.error("ERROR: PERPLEXITY_API_KEY not set");
  process.exit(1);
}
const FORCE = process.env.FORCE === "1";

interface PerplexityFields {
  gdp_share: number;
  source_url: string;
  source_year: number;
  rationale: string;
}

function extractJson(s: string): unknown {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1]! : s;
  const m = body.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON object in Perplexity response");
  return JSON.parse(m[0]);
}

async function callPerplexity(
  industryName: string,
): Promise<{ parsed: PerplexityFields; citations: string[] }> {
  const prompt = `What share of NOMINAL world GDP did the "${industryName}" industry represent in the most recent year (2020 or later) for which World Bank, IMF, OECD, IEA, BIS, McKinsey Global Institute, or equivalent authoritative source has published data? You MUST return a positive numeric value strictly greater than 0 — null, zero, or unknown is not acceptable; if a direct global figure is unavailable, derive a best estimate from the closest published aggregate (e.g. for "Residential Solar" derive from global residential PV revenue / world GDP) and explain in rationale. Return ONLY a single JSON object with these fields and no prose:
{
  "gdp_share": <number 0..1, e.g. 0.07 for 7%>,
  "source_url": "<URL of the World Bank, IMF, OECD or equivalent statistical agency page you derived this from>",
  "source_year": <integer YYYY>,
  "rationale": "<1-2 sentence explanation citing the specific table/series used>"
}
For sub-industries (e.g. Residential Solar) treat as the share of world GDP attributable to that specific sector, not the parent industry. Do not invent values; if no authoritative source provides a direct number, derive from the closest published aggregate and explain the derivation in the rationale field.`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: "You are a precise economic-data assistant. Output STRICT JSON only — no markdown, no prose outside the JSON." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`Perplexity ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
    const data = (await resp.json()) as {
      choices: Array<{ message: { content: string } }>;
      citations?: string[];
    };
    const content = data.choices[0]?.message?.content ?? "";
    const citations = data.citations ?? [];
    const parsed = extractJson(content) as PerplexityFields;
    return { parsed, citations };
  } finally {
    clearTimeout(timeout);
  }
}

const inds = await db.select().from(industriesTable);
console.log(`Seeding GDP weights for ${inds.length} industries (FORCE=${FORCE ? "yes" : "no"})`);

let inserted = 0;
let skipped = 0;
const errors: string[] = [];

for (const ind of inds) {
  const existing = await db.select().from(industryGdpWeightsTable).where(eq(industryGdpWeightsTable.industryId, ind.id)).limit(1);
  if (existing.length > 0 && !FORCE) {
    console.log(`  [skip] ${ind.name} — already has gdp_share=${existing[0]!.gdpShare} (set FORCE=1 to overwrite)`);
    continue;
  }
  try {
    const { parsed, citations } = await callPerplexity(ind.name);
    // Strict validation: no fallback values. If Perplexity didn't return a
    // numeric share in (0,1] or a non-empty source_url, we skip the row.
    if (typeof parsed.gdp_share !== "number" || !isFinite(parsed.gdp_share) || parsed.gdp_share <= 0 || parsed.gdp_share > 1) {
      errors.push(`${ind.name}: invalid gdp_share=${parsed.gdp_share}`);
      skipped++;
      continue;
    }
    if (typeof parsed.source_url !== "string" || parsed.source_url.length === 0) {
      errors.push(`${ind.name}: missing source_url`);
      skipped++;
      continue;
    }
    if (typeof parsed.source_year !== "number" || parsed.source_year < 2015 || parsed.source_year > new Date().getFullYear()) {
      errors.push(`${ind.name}: invalid source_year=${parsed.source_year}`);
      skipped++;
      continue;
    }
    const row = {
      industryId: ind.id,
      gdpShare: parsed.gdp_share,
      sourceUrl: parsed.source_url,
      sourceYear: parsed.source_year,
      sourceCitations: citations,
      rationale: parsed.rationale ?? null,
    };
    if (existing.length > 0) {
      await db.update(industryGdpWeightsTable).set({ ...row, updatedAt: new Date() }).where(eq(industryGdpWeightsTable.id, existing[0]!.id));
    } else {
      await db.insert(industryGdpWeightsTable).values(row);
    }
    inserted++;
    console.log(`  [ok]   ${ind.name.padEnd(40)} share=${(parsed.gdp_share * 100).toFixed(2)}% year=${parsed.source_year} cites=${citations.length}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`${ind.name}: ${msg.substring(0, 200)}`);
    skipped++;
    console.log(`  [err]  ${ind.name} — ${msg.substring(0, 200)}`);
  }
}

console.log("\n=== summary ===");
console.log(JSON.stringify({ totalIndustries: inds.length, inserted, skipped, errors }, null, 2));
process.exit(skipped > 0 ? 1 : 0);
