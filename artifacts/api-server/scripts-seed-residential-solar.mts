/**
 * One-shot seed: add "Residential Solar" industry + ~15 capabilities, then
 * call Perplexity ONCE per capability to fetch real economics, quadrant
 * classification, and citations. Inserts rows into capability_economics
 * and capability_quadrants using the Perplexity-derived numbers + citations.
 *
 * Idempotent: skips industry/capabilities/economics/quadrants that already
 * exist for this slug.
 *
 * Run: tsx artifacts/api-server/scripts-seed-residential-solar.mts
 * Env:  DATABASE_URL, PERPLEXITY_API_KEY
 */
import {
  db,
  industriesTable,
  capabilitiesTable,
  capabilityEconomicsTable,
  capabilityQuadrantsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const log = (...args: unknown[]) =>
  console.error(
    `[${new Date().toISOString().slice(11, 19)}] ${args
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
      .join(" ")}`,
  );

const INDUSTRY = {
  slug: "residential-solar",
  name: "Residential Solar",
  description:
    "Distributed photovoltaic systems sold and installed at single-family homes, including financing, permitting, equipment, installation, monitoring, and lifecycle services.",
  icon: "Sun",
};

interface CapSeed {
  slug: string;
  name: string;
  description: string;
  traditionalView: string;
  economicView: string;
}

const CAPS: CapSeed[] = [
  {
    slug: "lead-generation",
    name: "Lead Generation",
    description: "Top-of-funnel demand creation for residential solar buyers via digital, door-to-door, and referral channels.",
    traditionalView: "Treated as a marketing spend line item bought from lead aggregators per qualified prospect.",
    economicView: "A compounding distribution moat whose unit economics swing project IRR by 200-400 bps.",
  },
  {
    slug: "site-survey-and-design",
    name: "Site Survey & Design",
    description: "Roof measurement, shading analysis, structural review, and PV system design (string sizing, panel layout).",
    traditionalView: "Engineering checklist work bundled into installation cost.",
    economicView: "Where 80% of post-sale rework cost is locked in; design accuracy directly drives kWh yield and warranty exposure.",
  },
  {
    slug: "permitting-and-interconnection",
    name: "Permitting & Interconnection",
    description: "Securing AHJ permits and utility interconnection approvals so the system can legally export power.",
    traditionalView: "Administrative paperwork handled by a back-office permit team.",
    economicView: "Cycle-time bottleneck that dominates cash conversion and customer cancellation rates.",
  },
  {
    slug: "equipment-procurement",
    name: "Equipment Procurement",
    description: "Sourcing modules, inverters, racking, batteries, and BoS components from global supply chains.",
    traditionalView: "Commodity purchasing optimized on $/Wdc and lead time.",
    economicView: "Tariff-, FX-, and tariff-exemption-sensitive margin lever; 30-50% of installed cost.",
  },
  {
    slug: "installation-crew-operations",
    name: "Installation Crew Operations",
    description: "Field labor scheduling, vehicle routing, and rooftop installation execution.",
    traditionalView: "Hourly labor cost line.",
    economicView: "Throughput constraint that caps revenue growth and dictates fixed-cost absorption.",
  },
  {
    slug: "inverter-and-battery-integration",
    name: "Inverter & Battery Integration",
    description: "Power electronics commissioning, battery storage integration, and grid-services configuration.",
    traditionalView: "Equipment install task.",
    economicView: "Gateway to recurring storage + VPP revenue and a moat against pure-PV competitors.",
  },
  {
    slug: "financing-origination",
    name: "Financing Origination (PPA/Lease/Loan)",
    description: "Underwriting and closing third-party-owned (TPO) leases/PPAs and host-owned solar loans.",
    traditionalView: "Loan-officer back office.",
    economicView: "The actual product being sold — captures ITC monetization spread, securitization arbitrage, and customer LTV.",
  },
  {
    slug: "customer-acquisition-cost-optimization",
    name: "Customer Acquisition Cost Optimization",
    description: "Unit-economic engineering of CAC across channels (digital, D2D, partner, referral).",
    traditionalView: "Marketing analytics function.",
    economicView: "Single largest swing factor in installer profitability — Sunrun, Sunnova, and SunPower live or die on $/W of CAC.",
  },
  {
    slug: "net-metering-and-tariff-management",
    name: "Net-Metering & Tariff Management",
    description: "Designing systems to optimize net-energy-metering, time-of-use, and successor tariffs (e.g., NEM 3.0).",
    traditionalView: "Compliance task per utility.",
    economicView: "Determines residential payback periods and market viability state-by-state.",
  },
  {
    slug: "om-and-monitoring",
    name: "O&M and Monitoring",
    description: "Remote monitoring, fault detection, truck-roll dispatch, and preventive maintenance over 25-year asset life.",
    traditionalView: "Cost-of-warranty support.",
    economicView: "Recurring high-margin revenue stream and a data moat for fleet-level performance optimization.",
  },
  {
    slug: "warranty-and-recall-management",
    name: "Warranty/Recall Management",
    description: "Managing module/inverter/battery warranty claims, manufacturer recalls, and serial-number tracking.",
    traditionalView: "Reactive customer service.",
    economicView: "Liability tail that can wipe out 5-10 years of installer profit if mismanaged (e.g., LG Chem battery recalls).",
  },
  {
    slug: "recycling-and-eol",
    name: "Recycling/EOL",
    description: "End-of-life take-back, module recycling, and battery second-life logistics.",
    traditionalView: "Future regulatory cost.",
    economicView: "Emerging compliance lever and material-recovery revenue stream as 1st-wave installs reach EOL.",
  },
  {
    slug: "software-platform-and-apps",
    name: "Software Platform & Apps",
    description: "Customer mobile/web apps, installer field apps, design CAD tools, and dealer-portal SaaS.",
    traditionalView: "IT cost.",
    economicView: "Platform scale leverage — Aurora, OpenSolar, and Enphase App turn software into the actual product.",
  },
  {
    slug: "workforce-training",
    name: "Workforce Training",
    description: "NABCEP, OSHA-10, electrical, and rooftop-safety training pipeline for installers and electricians.",
    traditionalView: "HR cost center.",
    economicView: "The binding constraint on industry growth — IRA tax credits hinge on apprenticeship hours.",
  },
  {
    slug: "channel-partner-management",
    name: "Channel Partner Management",
    description: "Managing dealer / sub-installer / EPC partner networks for distribution and fulfillment scale.",
    traditionalView: "Sales channel management.",
    economicView: "Capital-light scale lever (Sunrun dealer model, Enphase installer network) that decouples growth from owned headcount.",
  },
];

interface PerplexityFields {
  tam_usd_mm: number | null;
  sam_usd_mm: number | null;
  margin_structure_pct: number | null;
  half_life_months: number | null;
  commoditization_velocity: number | null;
  revenue_exposure_mm: number | null;
  consensus_quadrant: "hot" | "emerging" | "cooling" | "table_stakes";
  consensus_confidence: number | null;
  consensus_summary: string | null;
  rationale: string | null;
  ce_quadrant: "hot" | "emerging" | "cooling" | "table_stakes";
  economic_impact_score: number;
  adoption_momentum_score: number;
  disruption_intensity: number;
  quadrant_rationale: string;
}

function clamp(n: number | null | undefined, lo: number, hi: number): number | null {
  if (n == null || Number.isNaN(n)) return null;
  return Math.min(hi, Math.max(lo, n));
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }
  throw new Error("No JSON object in Perplexity response");
}

async function callPerplexity(cap: CapSeed): Promise<{ parsed: PerplexityFields; citations: string[] }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not set");
  const system =
    "You are a capability economics research analyst for the U.S. residential solar industry. " +
    "Reply with a SINGLE strict JSON object only, no prose, no markdown. " +
    "All numeric fields must be real 2024-2026 estimates with cited sources. " +
    "Use null only if no credible figure exists.";
  const user =
    `Capability: "${cap.name}" — ${cap.description}\n` +
    `Industry: U.S. Residential Solar (rooftop PV, behind-the-meter).\n\n` +
    `Return strict JSON with these exact keys:\n` +
    `{\n` +
    `  "tam_usd_mm": number|null,                       // global TAM USD millions\n` +
    `  "sam_usd_mm": number|null,                       // serviceable addressable market USD millions\n` +
    `  "margin_structure_pct": number|null,             // typical gross margin % for providers (0-100)\n` +
    `  "half_life_months": number|null,                 // months until commoditized to table-stakes (6-120)\n` +
    `  "commoditization_velocity": number|null,         // 0-1, fraction of differentiation lost per year\n` +
    `  "revenue_exposure_mm": number|null,              // industry revenue currently dependent on this capability USD millions\n` +
    `  "consensus_quadrant": "hot"|"emerging"|"cooling"|"table_stakes",  // street/analyst consensus today\n` +
    `  "consensus_confidence": number,                  // 0-1\n` +
    `  "consensus_summary": string,                     // 2 sentences of street consensus\n` +
    `  "rationale": string,                             // 2-3 sentences economics reasoning\n` +
    `  "ce_quadrant": "hot"|"emerging"|"cooling"|"table_stakes",  // capability-economics quadrant placement\n` +
    `  "economic_impact_score": number,                 // 0-100 dollar-impact magnitude\n` +
    `  "adoption_momentum_score": number,               // 0-100 industry adoption momentum\n` +
    `  "disruption_intensity": number,                  // 0-100 disruption / change rate\n` +
    `  "quadrant_rationale": string                     // 2-3 sentences justifying ce_quadrant + scores\n` +
    `}\n` +
    `Cite real 2024-2026 sources (Wood Mackenzie, SEIA, EIA, LBNL, 10-K filings of Sunrun/Sunnova/SunPower/Enphase/SolarEdge, IRS, NREL).`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
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
    // No fallback editorial values: caller is responsible for skipping
    // capabilities whose Perplexity response lacks consensus_quadrant
    // or ce_quadrant. We only validate the value is one of the allowed
    // labels — never substitute a synthetic quadrant.
    const allowed = ["hot", "emerging", "cooling", "table_stakes", "declining"];
    if (parsed.consensus_quadrant && !allowed.includes(parsed.consensus_quadrant)) {
      parsed.consensus_quadrant = undefined as unknown as PerplexityFields["consensus_quadrant"];
    }
    if (parsed.ce_quadrant && !allowed.includes(parsed.ce_quadrant)) {
      parsed.ce_quadrant = undefined as unknown as PerplexityFields["ce_quadrant"];
    }
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

// 1. Industry
let industryId: number;
const existingInd = await db.select().from(industriesTable).where(eq(industriesTable.slug, INDUSTRY.slug)).limit(1);
if (existingInd.length > 0) {
  industryId = existingInd[0]!.id;
  log(`Industry "${INDUSTRY.name}" already exists (id=${industryId}) — reusing`);
} else {
  const inserted = await db.insert(industriesTable).values(INDUSTRY).returning({ id: industriesTable.id });
  industryId = inserted[0]!.id;
  log(`Inserted industry "${INDUSTRY.name}" (id=${industryId})`);
}

// 2. Capabilities
const existingCaps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId));
const existingBySlug = new Map(existingCaps.map((c) => [c.slug, c]));
let capabilitiesAdded = 0;
const capRows: { id: number; slug: string; name: string }[] = [];
for (const seed of CAPS) {
  const existing = existingBySlug.get(seed.slug);
  if (existing) {
    capRows.push({ id: existing.id, slug: existing.slug, name: existing.name });
    continue;
  }
  const ins = await db
    .insert(capabilitiesTable)
    .values({
      industryId,
      slug: seed.slug,
      name: seed.name,
      description: seed.description,
      traditionalView: seed.traditionalView,
      economicView: seed.economicView,
      benchmarkScore: 50,
      submittedBy: "seed-residential-solar",
    })
    .returning({ id: capabilitiesTable.id, slug: capabilitiesTable.slug, name: capabilitiesTable.name });
  capRows.push(ins[0]!);
  capabilitiesAdded++;
}
log(`Capabilities: ${capRows.length} present, ${capabilitiesAdded} newly inserted`);

// 3. Per-capability Perplexity enrichment
const existingEcon = await db
  .select({ capabilityId: capabilityEconomicsTable.capabilityId })
  .from(capabilityEconomicsTable)
  .where(eq(capabilityEconomicsTable.industryId, industryId));
const econDoneSet = new Set(existingEcon.map((r) => r.capabilityId));

const existingQuad = await db
  .select({ capabilityId: capabilityQuadrantsTable.capabilityId })
  .from(capabilityQuadrantsTable)
  .where(eq(capabilityQuadrantsTable.industryId, industryId));
const quadDoneSet = new Set(existingQuad.map((r) => r.capabilityId));

let economicsAdded = 0;
let quadrantsAdded = 0;
let perplexityCallsMade = 0;
const errors: string[] = [];

for (let i = 0; i < capRows.length; i++) {
  const cap = capRows[i]!;
  const needEcon = !econDoneSet.has(cap.id);
  const needQuad = !quadDoneSet.has(cap.id);
  if (!needEcon && !needQuad) {
    log(`  [${i + 1}/${capRows.length}] ${cap.name} — already has econ + quadrant, skipping`);
    continue;
  }
  const seed = CAPS.find((c) => c.slug === cap.slug)!;
  const t = Date.now();
  try {
    const { parsed, citations } = await callPerplexity(seed);
    perplexityCallsMade++;

    if (needEcon) {
      // Skip insert if Perplexity didn't deliver the consensus quadrant —
      // we will not fabricate one. The cap can be re-attempted on rerun.
      if (!parsed.consensus_quadrant) {
        errors.push(`[cap${cap.id}] econ skipped: Perplexity returned no consensus_quadrant`);
      } else {
        await db.insert(capabilityEconomicsTable).values({
          capabilityId: cap.id,
          industryId,
          tamUsdMm: parsed.tam_usd_mm ?? null,
          samUsdMm: parsed.sam_usd_mm ?? null,
          marginStructurePct: clamp(parsed.margin_structure_pct, 0, 100),
          halfLifeMonths: clamp(parsed.half_life_months, 6, 120),
          commoditizationVelocity: clamp(parsed.commoditization_velocity, 0, 1),
          revenueExposureMm: parsed.revenue_exposure_mm ?? null,
          consensusQuadrant: parsed.consensus_quadrant,
          consensusConfidence: clamp(parsed.consensus_confidence, 0, 1),
          consensusSummary: parsed.consensus_summary ?? null,
          consensusSources: citations,
          rationale: parsed.rationale ?? null,
        });
        economicsAdded++;
      }
    }

    if (needQuad) {
      // Same posture: no synthetic quadrant; require all three Perplexity-
      // sourced numeric scores to be valid 0-100 before inserting. Missing
      // = skip and let the rerun retry.
      const eco = clamp(parsed.economic_impact_score, 0, 100);
      const mom = clamp(parsed.adoption_momentum_score, 0, 100);
      const dis = clamp(parsed.disruption_intensity, 0, 100);
      if (!parsed.ce_quadrant || eco == null || mom == null || dis == null) {
        errors.push(
          `[cap${cap.id}] quadrant skipped: missing ce_quadrant or score (q=${parsed.ce_quadrant}, eco=${eco}, mom=${mom}, dis=${dis})`,
        );
      } else {
        await db.insert(capabilityQuadrantsTable).values({
          capabilityId: cap.id,
          industryId,
          quadrant: parsed.ce_quadrant,
          economicImpactScore: eco,
          adoptionMomentumScore: mom,
          disruptionIntensity: dis,
          rationale: parsed.quadrant_rationale ?? parsed.rationale ?? "Perplexity-derived quadrant placement",
          perplexitySources: citations,
        });
        quadrantsAdded++;
      }
    }

    log(`  [${i + 1}/${capRows.length}] ${cap.name} ✓ (${Math.round((Date.now() - t) / 1000)}s) — quad=${parsed.ce_quadrant} cites=${citations.length}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`${cap.name}: ${msg.substring(0, 200)}`);
    log(`  [${i + 1}/${capRows.length}] ${cap.name} ✗ (${Math.round((Date.now() - t) / 1000)}s) — ${msg.substring(0, 200)}`);
  }
}

const summary = {
  industryId,
  capabilitiesAdded,
  economicsAdded,
  quadrantsAdded,
  perplexityCallsMade,
  errors: errors.length,
  durationSec: Math.round((Date.now() - totalStart) / 1000),
};
log(`\n=== SUMMARY ===`);
console.log(JSON.stringify(summary, null, 2));
if (errors.length > 0) {
  log(`Errors:`);
  for (const e of errors) log(`  - ${e}`);
}
process.exit(0);
