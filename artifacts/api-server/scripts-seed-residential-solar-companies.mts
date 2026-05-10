/**
 * One-shot seed: insert ~12 real Residential Solar / adjacent companies into
 * company_capability_profiles (industryId=7) and create capability mappings
 * via Perplexity sonar. NO synthetic fallback for fevi/cdi/quadrant/strength.
 *
 * Run: cd artifacts/api-server && ./node_modules/.bin/tsx scripts-seed-residential-solar-companies.mts
 * Env: DATABASE_URL, PERPLEXITY_API_KEY
 */
import {
  db,
  capabilitiesTable,
  companyCapabilityProfilesTable,
  companyCapabilityMappingsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

const INDUSTRY_ID = 7;

const COMPANIES: string[] = [
  "Sunrun",
  "SunPower",
  "Tesla Energy",
  "Sunnova",
  "Enphase Energy",
  "SolarEdge",
  "Vivint Solar",
  "Palmetto",
  "Freedom Forever",
  "ADT Solar",
  "Aurora Solar",
  "Generac",
  "NextEra Energy Resources Residential",
  "Maxeon Solar Technologies",
];

const ALLOWED_QUADRANTS = new Set(["hot", "emerging", "cooling", "table_stakes"]);
const ALLOWED_STRENGTHS = new Set(["core", "strong", "emerging", "adjacent"]);
const ALLOWED_FUNDING = new Set(["seed", "series_a", "series_b", "growth", "public", "private"]);

const log = (...args: unknown[]) =>
  console.error(
    `[${new Date().toISOString().slice(11, 19)}] ` +
      args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "),
  );

// ── Tokenize / Jaccard ─────────────────────────────────────────────────────
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "onto",
  "of", "in", "on", "at", "to", "by", "an", "a", "or", "amp",
]);
function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
  );
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }
  throw new Error("No JSON object in Perplexity response");
}

interface PerplexityFields {
  description?: string;
  naics_sector?: string;
  naics_code?: string;
  funding_stage?: string;
  fevi_score?: number;
  cdi_score?: number;
  quadrant?: string;
  capability_mappings?: Array<{
    capability_slug?: string;
    strength?: string;
    rationale?: string;
  }>;
}

async function callPerplexity(
  companyName: string,
  capCatalog: Array<{ slug: string; name: string }>,
): Promise<{ parsed: PerplexityFields; citations: string[] }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not set");

  const slugList = capCatalog.map((c) => `${c.slug} (${c.name})`).join("\n  - ");

  const system =
    "You are a capability-economics research analyst covering U.S. residential solar. " +
    "Reply ONLY with a single strict JSON object, no prose, no markdown fences. " +
    "All numeric scores must be real numbers in [0,1]. Use citations from 10-K filings, " +
    "earnings calls, SEIA / Wood Mackenzie / EIA reports.";

  const user =
    `Company: "${companyName}" (residential solar / adjacent). Country: USA.\n\n` +
    `Return strict JSON with EXACTLY these keys:\n` +
    `{\n` +
    `  "description": string,                 // 1-2 sentences citing 10-K / earnings\n` +
    `  "naics_sector": string,                // exact sector name\n` +
    `  "naics_code": string,                  // 4-6 digit NAICS code\n` +
    `  "funding_stage": "seed"|"series_a"|"series_b"|"growth"|"public"|"private",\n` +
    `  "fevi_score": number,                  // 0-1, forecasted economic value index (capability strength + financial momentum)\n` +
    `  "cdi_score": number,                   // 0-1, capability disruption index (how disruption-exposed)\n` +
    `  "quadrant": "hot"|"emerging"|"cooling"|"table_stakes",\n` +
    `  "capability_mappings": [\n` +
    `    { "capability_slug": "<one of the slugs below>", "strength": "core"|"strong"|"emerging"|"adjacent", "rationale": "1 sentence" }\n` +
    `  ]\n` +
    `}\n\n` +
    `capability_slug MUST be one of these residential-solar capability slugs:\n  - ${slugList}\n\n` +
    `Return 4-8 capability_mappings reflecting where the company actually operates. ` +
    `If you can't justify a capability with a real source, omit it. No prose outside the JSON object.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`Perplexity ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
    }
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

// ── Main ───────────────────────────────────────────────────────────────────
const totalStart = Date.now();
if (!process.env.PERPLEXITY_API_KEY) {
  console.error("ERROR: PERPLEXITY_API_KEY not set");
  process.exit(1);
}

const caps = await db
  .select({ id: capabilitiesTable.id, slug: capabilitiesTable.slug, name: capabilitiesTable.name })
  .from(capabilitiesTable)
  .where(eq(capabilitiesTable.industryId, INDUSTRY_ID));

// Restrict to the 15 base seed slugs (the script intentionally targets the
// canonical Residential Solar caps, not the auto-generated sub-capabilities).
const BASE_SLUGS = new Set([
  "lead-generation",
  "site-survey-and-design",
  "permitting-and-interconnection",
  "equipment-procurement",
  "installation-crew-operations",
  "inverter-and-battery-integration",
  "financing-origination",
  "customer-acquisition-cost-optimization",
  "net-metering-and-tariff-management",
  "om-and-monitoring",
  "warranty-and-recall-management",
  "recycling-and-eol",
  "software-platform-and-apps",
  "workforce-training",
  "channel-partner-management",
]);
const baseCaps = caps.filter((c) => BASE_SLUGS.has(c.slug));
const capBySlug = new Map(baseCaps.map((c) => [c.slug, c]));
const capPool = baseCaps.map((c) => ({ id: c.id, slug: c.slug, tokens: tokenize(`${c.slug.replace(/-/g, " ")} ${c.name}`) }));

log(`Base caps for industry ${INDUSTRY_ID}: ${baseCaps.length}`);

let companiesInserted = 0;
let mappingsInserted = 0;
let perplexityCalls = 0;
let skippedCompanies = 0;
let skippedMappings = 0;
const errors: string[] = [];

for (let i = 0; i < COMPANIES.length; i++) {
  const name = COMPANIES[i]!;
  const t = Date.now();

  // Idempotency: check existing
  const existing = await db
    .select()
    .from(companyCapabilityProfilesTable)
    .where(and(
      eq(companyCapabilityProfilesTable.industryId, INDUSTRY_ID),
      eq(companyCapabilityProfilesTable.name, name),
    ))
    .limit(1);

  let companyId: number | undefined = existing[0]?.id;
  let parsed: PerplexityFields | undefined;
  let citations: string[] = [];

  // We always call Perplexity to compute mappings (whether we insert or not),
  // unless the company already has mappings.
  if (companyId) {
    const existingMaps = await db
      .select({ id: companyCapabilityMappingsTable.id })
      .from(companyCapabilityMappingsTable)
      .where(eq(companyCapabilityMappingsTable.companyId, companyId));
    if (existingMaps.length > 0) {
      log(`  [${i + 1}/${COMPANIES.length}] ${name} — already has profile + ${existingMaps.length} mappings, skipping`);
      continue;
    }
  }

  try {
    const r = await callPerplexity(name, baseCaps.map((c) => ({ slug: c.slug, name: c.name })));
    perplexityCalls++;
    parsed = r.parsed;
    citations = r.citations;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`[${name}] perplexity error: ${msg.substring(0, 200)}`);
    log(`  [${i + 1}/${COMPANIES.length}] ${name} ✗ perplexity: ${msg.substring(0, 200)}`);
    continue;
  }

  // Insert profile if not existing.
  if (!companyId) {
    const fevi = typeof parsed.fevi_score === "number" ? parsed.fevi_score : null;
    const cdi = typeof parsed.cdi_score === "number" ? parsed.cdi_score : null;
    const quadrant = typeof parsed.quadrant === "string" ? parsed.quadrant : null;

    if (fevi == null || cdi == null || !quadrant || !ALLOWED_QUADRANTS.has(quadrant)) {
      skippedCompanies++;
      errors.push(`[${name}] profile skipped: missing/invalid fevi=${fevi} cdi=${cdi} quadrant=${quadrant}`);
      log(`  [${i + 1}/${COMPANIES.length}] ${name} ✗ profile skipped (missing scores/quadrant)`);
      continue;
    }
    const fundingStage = typeof parsed.funding_stage === "string" && ALLOWED_FUNDING.has(parsed.funding_stage)
      ? parsed.funding_stage
      : null;

    const ins = await db
      .insert(companyCapabilityProfilesTable)
      .values({
        name,
        country: "USA",
        naicsCode: typeof parsed.naics_code === "string" ? parsed.naics_code : null,
        naicsSector: typeof parsed.naics_sector === "string" ? parsed.naics_sector : null,
        industryId: INDUSTRY_ID,
        feviScore: Math.min(1, Math.max(0, fevi)),
        cdiScore: Math.min(1, Math.max(0, cdi)),
        quadrant,
        fundingStage,
        description: typeof parsed.description === "string" ? parsed.description : `Residential solar company: ${name}`,
        perplexitySources: citations,
      })
      .returning({ id: companyCapabilityProfilesTable.id });
    companyId = ins[0]?.id;
    if (companyId) companiesInserted++;
  }

  if (!companyId) {
    log(`  [${i + 1}/${COMPANIES.length}] ${name} ✗ no companyId after insert`);
    continue;
  }

  // Insert mappings
  const items = Array.isArray(parsed.capability_mappings) ? parsed.capability_mappings : [];
  let mappedHere = 0;
  for (const m of items) {
    const slug = typeof m?.capability_slug === "string" ? m.capability_slug.trim() : "";
    const strength = typeof m?.strength === "string" ? m.strength.trim().toLowerCase() : "";
    if (!slug) { skippedMappings++; continue; }
    if (!ALLOWED_STRENGTHS.has(strength)) {
      skippedMappings++;
      errors.push(`[${name}] mapping skipped: invalid/missing strength for slug=${slug}`);
      continue;
    }

    let cap = capBySlug.get(slug);
    if (!cap) {
      // Fuzzy match
      const candTokens = tokenize(slug.replace(/-/g, " "));
      let best: { id: number; slug: string; score: number } | null = null;
      for (const p of capPool) {
        const sc = jaccard(candTokens, p.tokens);
        if (sc >= 0.5 && (!best || sc > best.score)) {
          best = { id: p.id, slug: p.slug, score: sc };
        }
      }
      if (!best) {
        skippedMappings++;
        continue;
      }
      cap = capBySlug.get(best.slug)!;
    }

    // Avoid duplicate (companyId, capabilityId)
    const dup = await db
      .select({ id: companyCapabilityMappingsTable.id })
      .from(companyCapabilityMappingsTable)
      .where(and(
        eq(companyCapabilityMappingsTable.companyId, companyId),
        eq(companyCapabilityMappingsTable.capabilityId, cap.id),
      ))
      .limit(1);
    if (dup.length > 0) continue;

    await db.insert(companyCapabilityMappingsTable).values({
      companyId,
      capabilityId: cap.id,
      strength,
    });
    mappingsInserted++;
    mappedHere++;
  }

  log(`  [${i + 1}/${COMPANIES.length}] ${name} ✓ (${Math.round((Date.now() - t) / 1000)}s) — mappings=${mappedHere} cites=${citations.length}`);
}

const summary = {
  companiesInserted,
  mappingsInserted,
  perplexityCalls,
  skippedCompanies,
  skippedMappings,
  errors: errors.length,
  durationSec: Math.round((Date.now() - totalStart) / 1000),
};
log(`\n=== SUMMARY ===`);
console.log(JSON.stringify({ ...summary, errors: errors }, null, 2));
process.exit(0);
