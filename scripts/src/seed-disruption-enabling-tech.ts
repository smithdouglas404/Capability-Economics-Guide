/**
 * Seed the disruption_enabling_tech catalog. Each row is a technology that,
 * when crossed the chasm, lets a new entrant obviate the asset/labor friction
 * of an incumbent capability. The disruption-index scoring service uses
 * these to compute the "enabling_tech_strength" sub-score per capability:
 * for each capability, it asks Claude to pick the top-3 catalog entries that
 * most directly obviate the cap's friction, then weights their contribution
 * by maturity (recently mature → predicts more disruption ahead).
 *
 * Maturity year is the "crossed the chasm" inflection point — not the year
 * the tech was invented, but the year it became cheap + ubiquitous enough
 * for a startup to bet on. Sources cited inline.
 *
 * Idempotent on slug. Safe to re-run.
 */
import { db, disruptionEnablingTechTable } from "@workspace/db";
import { eq } from "drizzle-orm";

type SeedTech = {
  slug: string;
  name: string;
  category: string;
  description: string;
  maturityYear: number;
  exampleDisruptors: string[];
  citations: string[];
};

const TECHS: SeedTech[] = [
  // ─── Mobile + location ───────────────────────────────────────────────
  {
    slug: "smartphone-ubiquity",
    name: "Smartphone ubiquity (GPS + camera + always-on internet)",
    category: "mobile",
    description: "When >50% of adults in a developed market carry a GPS-enabled smartphone with a camera and high-bandwidth radio, any capability requiring location, identity verification, or visual evidence at the edge becomes addressable in real-time without dedicated hardware.",
    maturityYear: 2012,
    exampleDisruptors: ["Uber", "Airbnb", "DoorDash", "Instacart", "Snap"],
    citations: ["https://www.pewresearch.org/internet/fact-sheet/mobile/", "https://www.gsma.com/r/mobileeconomy/"],
  },
  {
    slug: "ambient-sensing-iot",
    name: "Ambient sensing + IoT mesh",
    category: "iot",
    description: "Cheap sensors (temperature, vibration, presence, air quality, soil moisture) backhauled via LPWAN/5G enable continuous-monitoring capabilities that previously required scheduled human inspection.",
    maturityYear: 2020,
    exampleDisruptors: ["Samsara (fleet)", "Augury (industrial)", "Hippo (parametric insurance)", "Climavision"],
    citations: ["https://www.gartner.com/en/newsroom/press-releases/2021-09-13-iot-deployments-forecast"],
  },

  // ─── LLM / AI ─────────────────────────────────────────────────────────
  {
    slug: "general-purpose-llm",
    name: "General-purpose LLMs (GPT-4-class reasoning)",
    category: "llm",
    description: "Foundation models that follow instructions, reason over context, and produce structured output cheap enough to embed in production. Disrupts any capability built around expert text comprehension (legal review, claims adjudication, code generation, customer-service triage).",
    maturityYear: 2023,
    exampleDisruptors: ["OpenAI", "Anthropic", "Harvey (legal)", "Hippocratic (clinical)", "Cursor (code)"],
    citations: ["https://openai.com/research/gpt-4", "https://www.anthropic.com/news/claude-3-family"],
  },
  {
    slug: "multimodal-vision",
    name: "Multimodal vision (image + video understanding)",
    category: "llm",
    description: "VLMs that read screens, charts, photos, and video at human-grade accuracy obviate the human labor inside any capability built around visual inspection (radiology screening, insurance damage assessment, e-commerce SKU enrichment, security camera review).",
    maturityYear: 2024,
    exampleDisruptors: ["Tractable (auto-insurance damage)", "Aidoc (radiology)", "Verkada (security)"],
    citations: ["https://www.tractable.ai/", "https://www.aidoc.com/"],
  },
  {
    slug: "voice-agents",
    name: "Real-time voice agents (sub-300ms latency LLM)",
    category: "llm",
    description: "Sub-second STT→LLM→TTS pipelines let synthetic voice agents handle inbound calls, scheduling, qualification, follow-up. Disrupts any capability built around phone-mediated coordination (medical scheduling, sales SDR, customer support tier-1).",
    maturityYear: 2024,
    exampleDisruptors: ["PolyAI", "Sierra", "Decagon", "Bland.ai"],
    citations: ["https://www.sierra.ai/", "https://poly.ai/"],
  },

  // ─── Distributed compute / cloud ─────────────────────────────────────
  {
    slug: "elastic-cloud-compute",
    name: "Elastic cloud compute (pay-per-second)",
    category: "distributed_compute",
    description: "AWS/GCP/Azure on-demand compute (and the spot-market layer) lets a startup match the asymmetric compute footprint of an incumbent without the capital lock-in. Disrupts any capability dependent on owned data-center scale.",
    maturityYear: 2010,
    exampleDisruptors: ["Netflix (vs Blockbuster)", "Snowflake (vs Teradata)", "Stripe (vs traditional payment processors)"],
    citations: ["https://aws.amazon.com/", "https://cloud.google.com/products"],
  },
  {
    slug: "gpu-inference-at-scale",
    name: "GPU inference at <$0.10 / 1M tokens",
    category: "distributed_compute",
    description: "When inference cost drops below the cost of human labor for the same task, capabilities staffed by trained workers (paralegals, junior radiologists, content moderators, code reviewers) face direct margin disruption.",
    maturityYear: 2024,
    exampleDisruptors: ["Together AI", "Fireworks", "Groq (LPU)", "Inference-as-a-service vendors"],
    citations: ["https://artificialanalysis.ai/"],
  },

  // ─── Payment + identity ─────────────────────────────────────────────
  {
    slug: "mobile-payments",
    name: "Mobile + tokenized payments (Stripe-era)",
    category: "payment",
    description: "Card-on-file + tokenized payments + Stripe-class APIs let any startup take money as a one-line integration. Disrupts any capability where customer billing was previously a multi-week ISO/acquirer dance.",
    maturityYear: 2014,
    exampleDisruptors: ["Stripe", "Square", "Adyen", "Plaid (banking access)"],
    citations: ["https://stripe.com/", "https://plaid.com/"],
  },
  {
    slug: "real-time-payments",
    name: "Real-time / instant settlement rails (FedNow, RTP, UPI, Pix)",
    category: "payment",
    description: "Sub-second account-to-account settlement unlocks capabilities that previously required holding float or pre-funding (instant payroll, instant insurance payout, gig-economy daily-cash, B2B near-cash supply-chain finance).",
    maturityYear: 2023,
    exampleDisruptors: ["Wise", "Brex", "Mercury", "Earnin"],
    citations: ["https://www.frbservices.org/financial-services/fednow"],
  },
  {
    slug: "decentralized-identity",
    name: "Decentralized / verified identity (sumsub-class KYC + reusable credentials)",
    category: "identity",
    description: "Verified-once, present-everywhere identity (Onfido, Persona, sumsub plus reusable Verifiable Credentials) removes the per-transaction KYC cost. Disrupts capabilities built around in-person identity establishment (notary, account opening, KYC-heavy onboarding).",
    maturityYear: 2021,
    exampleDisruptors: ["Persona", "Onfido", "Plaid IDV", "Notarize"],
    citations: ["https://withpersona.com/", "https://www.w3.org/TR/vc-data-model/"],
  },

  // ─── Marketplace + trust mechanisms ──────────────────────────────────
  {
    slug: "two-sided-marketplace-stack",
    name: "Two-sided marketplace stack (matching + escrow + reviews)",
    category: "marketplace",
    description: "The recipe — supply onboarding + dynamic match + escrow payment + bilateral ratings — is now a templated build. Disrupts capabilities where supply was previously fragmented + invisible (home services, freelance labor, instructor-led education, used goods).",
    maturityYear: 2014,
    exampleDisruptors: ["Airbnb", "Uber", "Upwork", "Etsy", "Vinted"],
    citations: ["https://hbr.org/2016/10/pipelines-platforms-and-the-new-rules-of-strategy"],
  },
  {
    slug: "algorithmic-trust-replacement",
    name: "Algorithmic trust replacement (ratings + verified review)",
    category: "trust",
    description: "When ratings + verified-purchase reviews + algorithmic ranking become more trusted than regulatory gatekeeping (medallion, license, brand), any capability where regulation was the moat becomes addressable by an upstart with better software trust.",
    maturityYear: 2016,
    exampleDisruptors: ["Yelp", "TripAdvisor", "Airbnb superhost", "Uber driver rating"],
    citations: ["https://www.nber.org/papers/w20830"],
  },

  // ─── Energy + storage ────────────────────────────────────────────────
  {
    slug: "lithium-cost-decline",
    name: "Lithium-ion battery cost decline (10x in 10 years)",
    category: "energy",
    description: "From $1,000/kWh in 2010 to <$100/kWh by 2024 made BEVs cost-competitive, stationary storage economic, and remote/off-grid sensing viable. Disrupts capabilities dependent on legacy ICE or continuous-grid power.",
    maturityYear: 2020,
    exampleDisruptors: ["Tesla", "BYD", "Form Energy", "Sila Nano"],
    citations: ["https://about.bnef.com/blog/lithium-ion-battery-pack-prices-hit-record-low-of-139-kwh/"],
  },
  {
    slug: "rooftop-solar-parity",
    name: "Rooftop solar grid parity",
    category: "energy",
    description: "Distributed generation at sub-grid cost enables capabilities around self-consumption + virtual power plants + DERMS. Disrupts utility-scale generation moats in deregulated markets.",
    maturityYear: 2018,
    exampleDisruptors: ["Sunrun", "Enphase", "Tesla Energy", "Form Energy"],
    citations: ["https://www.iea.org/reports/renewables-2023"],
  },

  // ─── Logistics + automation ─────────────────────────────────────────
  {
    slug: "last-mile-logistics-density",
    name: "Last-mile logistics density (delivery-as-a-service)",
    category: "logistics",
    description: "When 3PL networks deliver same-day or 1-hour cost-effectively (Amazon FBA, DoorDash Drive, Shopify Fulfillment), capabilities built around physical-retail proximity become rentable rather than owned. Disrupts physical store/branch networks.",
    maturityYear: 2019,
    exampleDisruptors: ["DoorDash", "Instacart", "Amazon FBA", "ShipBob"],
    citations: ["https://www.statista.com/topics/8696/last-mile-delivery/"],
  },
  {
    slug: "warehouse-robotics",
    name: "Warehouse robotics (kiva-class + bin-picking)",
    category: "automation",
    description: "Sub-$50k mobile robots + ML bin-picking obviate the per-pick labor cost in fulfillment. Disrupts capabilities built around human-staffed warehouses.",
    maturityYear: 2022,
    exampleDisruptors: ["Amazon Robotics (Kiva)", "Symbotic", "AutoStore", "Covariant"],
    citations: ["https://ifr.org/img/worldrobotics/Executive_Summary_WR_Service_Robots_2023.pdf"],
  },

  // ─── Crypto / blockchain ────────────────────────────────────────────
  {
    slug: "stablecoin-rails",
    name: "Stablecoin settlement rails",
    category: "blockchain",
    description: "USDC/USDT settlement at near-zero cost across borders disrupts cross-border B2B payments, remittance, and treasury operations dependent on correspondent banking.",
    maturityYear: 2024,
    exampleDisruptors: ["Bridge (acquired by Stripe)", "Mercury Treasury", "Felix Pago"],
    citations: ["https://www.bis.org/publ/qtrpdf/r_qt2403c.htm"],
  },

  // ─── Data + APIs ────────────────────────────────────────────────────
  {
    slug: "open-banking-apis",
    name: "Open Banking APIs (Plaid-class data access)",
    category: "data_access",
    description: "Programmatic read access to consumer + business banking obviates manual document collection for any capability built around financial verification. Disrupts capabilities staffed around statement collection / income verification / credit decisioning.",
    maturityYear: 2019,
    exampleDisruptors: ["Plaid", "Truework", "Pinwheel", "MX"],
    citations: ["https://plaid.com/"],
  },
  {
    slug: "satellite-imagery-eo",
    name: "Sub-meter satellite imagery (Planet, Capella, ICEYE)",
    category: "data_access",
    description: "Daily-revisit, sub-meter optical + SAR imagery obviates ground-truth field visits for any capability built around physical-asset monitoring (crop yield, construction progress, supply-chain congestion, ESG verification).",
    maturityYear: 2021,
    exampleDisruptors: ["Planet Labs", "Orbital Insight", "Indigo Ag", "ICEYE"],
    citations: ["https://www.planet.com/"],
  },

  // ─── Frontier ───────────────────────────────────────────────────────
  {
    slug: "agentic-workflows",
    name: "Agentic LLM workflows (multi-step planning + tool-use)",
    category: "llm",
    description: "LLM agents that decompose a goal into tool calls + retry on failure obviate junior knowledge-worker labor. Disrupts capabilities staffed around researching, summarizing, drafting, scheduling, ticket triage — anything where the work is repetitive synthesis.",
    maturityYear: 2025,
    exampleDisruptors: ["Cursor", "Devin", "Sierra (CX agents)", "Cognition Labs"],
    citations: ["https://arxiv.org/abs/2308.11432", "https://www.cognition.ai/blog/introducing-devin"],
  },
];

async function main() {
  const existing = await db.select({ slug: disruptionEnablingTechTable.slug }).from(disruptionEnablingTechTable);
  const existingSlugs = new Set(existing.map((r) => r.slug));
  let inserted = 0;
  let updated = 0;
  for (const t of TECHS) {
    const values = {
      slug: t.slug,
      name: t.name,
      category: t.category,
      description: t.description,
      maturityYear: t.maturityYear,
      exampleDisruptors: t.exampleDisruptors,
      citations: t.citations,
      updatedAt: new Date(),
    };
    if (existingSlugs.has(t.slug)) {
      await db.update(disruptionEnablingTechTable).set(values).where(eq(disruptionEnablingTechTable.slug, t.slug));
      updated++;
    } else {
      await db.insert(disruptionEnablingTechTable).values(values);
      inserted++;
    }
  }
  const final = await db.select({ slug: disruptionEnablingTechTable.slug }).from(disruptionEnablingTechTable);
  console.log(`seed-disruption-enabling-tech: inserted=${inserted} updated=${updated} total=${final.length}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("seed-disruption-enabling-tech failed:", err);
  process.exit(1);
});
