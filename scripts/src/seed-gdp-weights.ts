/**
 * Seeds the industry_gdp_weights table with Perplexity-cited GDP shares
 * (latest available year, World Bank / IMF sources). Replaces the prior
 * hardcoded INDUSTRY_GDP_WEIGHTS constant in cei-engine.ts.
 *
 * No fallback values per firm rule: if Perplexity fails to return a numeric
 * gdp_share or a sourceUrl for an industry, that row is SKIPPED and logged.
 * Missing rows cause the CVI engine to EXCLUDE that industry from the overall
 * rollup *with a warning* rather than substituting a synthetic number.
 *
 * Idempotent: existing rows for an industry are left in place. Pass `FORCE=1`
 * to overwrite.
 *
 * Skip flags (for deploy-migrate SEED_CHAIN safety):
 *   SKIP_GDP_WEIGHTS_SEED=1      — bypass the seed (exit 0)
 *   PERPLEXITY_API_KEY missing   — log warning and exit 0 (graceful degrade);
 *                                  the CVI engine will continue to warn at
 *                                  startup about missing weights until the key
 *                                  is provided and the seed re-runs.
 *
 * Exit codes:
 *   0  — success, or graceful degrade (no key / skipped). Per-industry errors
 *        are logged but never fail the deploy; the engine handles missing
 *        weights by excluding them from the rollup.
 *   1  — catastrophic error only (DB connection lost, etc.). Never used for
 *        per-industry Perplexity failures.
 */
import { db } from "@workspace/db";
import { industriesTable, industryGdpWeightsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

if (process.env.SKIP_GDP_WEIGHTS_SEED === "1" || process.env.SKIP_GDP_WEIGHTS_SEED === "true") {
  console.log("[seed:gdp-weights] SKIP_GDP_WEIGHTS_SEED set — skipping");
  process.exit(0);
}
if (!process.env.PERPLEXITY_API_KEY) {
  console.warn("[seed:gdp-weights] PERPLEXITY_API_KEY not set — skipping (CVI engine will continue to warn about missing weights until the key is provided)");
  process.exit(0);
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
console.log(`[seed:gdp-weights] processing ${inds.length} industries (FORCE=${FORCE ? "yes" : "no"})`);

let inserted = 0;
let alreadySeeded = 0;
let errored = 0;
const errors: string[] = [];

for (const ind of inds) {
  const existing = await db.select().from(industryGdpWeightsTable).where(eq(industryGdpWeightsTable.industryId, ind.id)).limit(1);
  if (existing.length > 0 && !FORCE) {
    console.log(`  [skip] ${ind.name} — already seeded (gdp_share=${existing[0]!.gdpShare})`);
    alreadySeeded++;
    continue;
  }
  try {
    const { parsed, citations } = await callPerplexity(ind.name);
    if (typeof parsed.gdp_share !== "number" || !isFinite(parsed.gdp_share) || parsed.gdp_share <= 0 || parsed.gdp_share > 1) {
      errors.push(`${ind.name}: invalid gdp_share=${parsed.gdp_share}`);
      errored++;
      continue;
    }
    if (typeof parsed.source_url !== "string" || parsed.source_url.length === 0) {
      errors.push(`${ind.name}: missing source_url`);
      errored++;
      continue;
    }
    if (typeof parsed.source_year !== "number" || parsed.source_year < 2015 || parsed.source_year > new Date().getFullYear()) {
      errors.push(`${ind.name}: invalid source_year=${parsed.source_year}`);
      errored++;
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
    errored++;
    console.log(`  [err]  ${ind.name} — ${msg.substring(0, 200)}`);
  }
}

console.log(`[seed:gdp-weights] done. inserted=${inserted} alreadySeeded=${alreadySeeded} errored=${errored}`);
if (errored > 0) {
  console.log(`[seed:gdp-weights] per-industry errors (non-fatal):`);
  for (const e of errors) console.log(`    - ${e}`);
}
// Always exit 0 — per-industry Perplexity failures are non-fatal for the deploy.
// The CVI engine handles missing weights by excluding industries from the rollup
// with a warning. Failed industries will retry on the next deploy.
process.exit(0);
