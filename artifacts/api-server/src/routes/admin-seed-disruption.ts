/**
 * One-shot admin endpoints to seed the disruption-index catalog tables:
 *
 *   POST /api/admin/seed/disruption-enabling-tech  → seeds the ~20 enabling
 *                                                    technologies
 *   POST /api/admin/seed/disruption-archetypes      → seeds the 8 playbook
 *                                                    archetypes (commit 3)
 *
 * Both upsert by slug. Mirrors the canonical scripts in
 * scripts/src/seed-disruption-{enabling-tech,archetypes}.ts so prod can be
 * seeded without shell access. Update both this and the script when the
 * catalogs evolve.
 */
import { Router, type Request, type Response } from "express";
import { db, disruptionEnablingTechTable, disruptionPlaybookArchetypesTable, type DisruptionSubscoreProfile } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

// ─── Enabling-tech catalog ───────────────────────────────────────────────
// Keep in sync with scripts/src/seed-disruption-enabling-tech.ts.
interface SeedTech {
  slug: string;
  name: string;
  category: string;
  description: string;
  maturityYear: number;
  exampleDisruptors: string[];
  citations: string[];
}

const ENABLING_TECH: SeedTech[] = [
  { slug: "smartphone-ubiquity", name: "Smartphone ubiquity (GPS + camera + always-on internet)", category: "mobile", description: "When >50% of adults in a developed market carry a GPS-enabled smartphone with a camera and high-bandwidth radio, any capability requiring location, identity verification, or visual evidence at the edge becomes addressable in real-time without dedicated hardware.", maturityYear: 2012, exampleDisruptors: ["Uber", "Airbnb", "DoorDash", "Instacart", "Snap"], citations: ["https://www.pewresearch.org/internet/fact-sheet/mobile/", "https://www.gsma.com/r/mobileeconomy/"] },
  { slug: "ambient-sensing-iot", name: "Ambient sensing + IoT mesh", category: "iot", description: "Cheap sensors (temperature, vibration, presence, air quality, soil moisture) backhauled via LPWAN/5G enable continuous-monitoring capabilities that previously required scheduled human inspection.", maturityYear: 2020, exampleDisruptors: ["Samsara (fleet)", "Augury (industrial)", "Hippo (parametric insurance)", "Climavision"], citations: ["https://www.gartner.com/en/newsroom/press-releases/2021-09-13-iot-deployments-forecast"] },
  { slug: "general-purpose-llm", name: "General-purpose LLMs (GPT-4-class reasoning)", category: "llm", description: "Foundation models that follow instructions, reason over context, and produce structured output cheap enough to embed in production. Disrupts any capability built around expert text comprehension (legal review, claims adjudication, code generation, customer-service triage).", maturityYear: 2023, exampleDisruptors: ["OpenAI", "Anthropic", "Harvey (legal)", "Hippocratic (clinical)", "Cursor (code)"], citations: ["https://openai.com/research/gpt-4", "https://www.anthropic.com/news/claude-3-family"] },
  { slug: "multimodal-vision", name: "Multimodal vision (image + video understanding)", category: "llm", description: "VLMs that read screens, charts, photos, and video at human-grade accuracy obviate the human labor inside any capability built around visual inspection (radiology screening, insurance damage assessment, e-commerce SKU enrichment, security camera review).", maturityYear: 2024, exampleDisruptors: ["Tractable (auto-insurance damage)", "Aidoc (radiology)", "Verkada (security)"], citations: ["https://www.tractable.ai/", "https://www.aidoc.com/"] },
  { slug: "voice-agents", name: "Real-time voice agents (sub-300ms latency LLM)", category: "llm", description: "Sub-second STT→LLM→TTS pipelines let synthetic voice agents handle inbound calls, scheduling, qualification, follow-up. Disrupts any capability built around phone-mediated coordination (medical scheduling, sales SDR, customer support tier-1).", maturityYear: 2024, exampleDisruptors: ["PolyAI", "Sierra", "Decagon", "Bland.ai"], citations: ["https://www.sierra.ai/", "https://poly.ai/"] },
  { slug: "elastic-cloud-compute", name: "Elastic cloud compute (pay-per-second)", category: "distributed_compute", description: "AWS/GCP/Azure on-demand compute (and the spot-market layer) lets a startup match the asymmetric compute footprint of an incumbent without the capital lock-in. Disrupts any capability dependent on owned data-center scale.", maturityYear: 2010, exampleDisruptors: ["Netflix (vs Blockbuster)", "Snowflake (vs Teradata)", "Stripe (vs traditional payment processors)"], citations: ["https://aws.amazon.com/", "https://cloud.google.com/products"] },
  { slug: "gpu-inference-at-scale", name: "GPU inference at <$0.10 / 1M tokens", category: "distributed_compute", description: "When inference cost drops below the cost of human labor for the same task, capabilities staffed by trained workers (paralegals, junior radiologists, content moderators, code reviewers) face direct margin disruption.", maturityYear: 2024, exampleDisruptors: ["Together AI", "Fireworks", "Groq (LPU)", "Inference-as-a-service vendors"], citations: ["https://artificialanalysis.ai/"] },
  { slug: "mobile-payments", name: "Mobile + tokenized payments (Stripe-era)", category: "payment", description: "Card-on-file + tokenized payments + Stripe-class APIs let any startup take money as a one-line integration. Disrupts any capability where customer billing was previously a multi-week ISO/acquirer dance.", maturityYear: 2014, exampleDisruptors: ["Stripe", "Square", "Adyen", "Plaid (banking access)"], citations: ["https://stripe.com/", "https://plaid.com/"] },
  { slug: "real-time-payments", name: "Real-time / instant settlement rails (FedNow, RTP, UPI, Pix)", category: "payment", description: "Sub-second account-to-account settlement unlocks capabilities that previously required holding float or pre-funding (instant payroll, instant insurance payout, gig-economy daily-cash, B2B near-cash supply-chain finance).", maturityYear: 2023, exampleDisruptors: ["Wise", "Brex", "Mercury", "Earnin"], citations: ["https://www.frbservices.org/financial-services/fednow"] },
  { slug: "decentralized-identity", name: "Decentralized / verified identity (sumsub-class KYC + reusable credentials)", category: "identity", description: "Verified-once, present-everywhere identity (Onfido, Persona, sumsub plus reusable Verifiable Credentials) removes the per-transaction KYC cost. Disrupts capabilities built around in-person identity establishment (notary, account opening, KYC-heavy onboarding).", maturityYear: 2021, exampleDisruptors: ["Persona", "Onfido", "Plaid IDV", "Notarize"], citations: ["https://withpersona.com/", "https://www.w3.org/TR/vc-data-model/"] },
  { slug: "two-sided-marketplace-stack", name: "Two-sided marketplace stack (matching + escrow + reviews)", category: "marketplace", description: "The recipe — supply onboarding + dynamic match + escrow payment + bilateral ratings — is now a templated build. Disrupts capabilities where supply was previously fragmented + invisible (home services, freelance labor, instructor-led education, used goods).", maturityYear: 2014, exampleDisruptors: ["Airbnb", "Uber", "Upwork", "Etsy", "Vinted"], citations: ["https://hbr.org/2016/10/pipelines-platforms-and-the-new-rules-of-strategy"] },
  { slug: "algorithmic-trust-replacement", name: "Algorithmic trust replacement (ratings + verified review)", category: "trust", description: "When ratings + verified-purchase reviews + algorithmic ranking become more trusted than regulatory gatekeeping (medallion, license, brand), any capability where regulation was the moat becomes addressable by an upstart with better software trust.", maturityYear: 2016, exampleDisruptors: ["Yelp", "TripAdvisor", "Airbnb superhost", "Uber driver rating"], citations: ["https://www.nber.org/papers/w20830"] },
  { slug: "lithium-cost-decline", name: "Lithium-ion battery cost decline (10x in 10 years)", category: "energy", description: "From $1,000/kWh in 2010 to <$100/kWh by 2024 made BEVs cost-competitive, stationary storage economic, and remote/off-grid sensing viable. Disrupts capabilities dependent on legacy ICE or continuous-grid power.", maturityYear: 2020, exampleDisruptors: ["Tesla", "BYD", "Form Energy", "Sila Nano"], citations: ["https://about.bnef.com/blog/lithium-ion-battery-pack-prices-hit-record-low-of-139-kwh/"] },
  { slug: "rooftop-solar-parity", name: "Rooftop solar grid parity", category: "energy", description: "Distributed generation at sub-grid cost enables capabilities around self-consumption + virtual power plants + DERMS. Disrupts utility-scale generation moats in deregulated markets.", maturityYear: 2018, exampleDisruptors: ["Sunrun", "Enphase", "Tesla Energy", "Form Energy"], citations: ["https://www.iea.org/reports/renewables-2023"] },
  { slug: "last-mile-logistics-density", name: "Last-mile logistics density (delivery-as-a-service)", category: "logistics", description: "When 3PL networks deliver same-day or 1-hour cost-effectively (Amazon FBA, DoorDash Drive, Shopify Fulfillment), capabilities built around physical-retail proximity become rentable rather than owned. Disrupts physical store/branch networks.", maturityYear: 2019, exampleDisruptors: ["DoorDash", "Instacart", "Amazon FBA", "ShipBob"], citations: ["https://www.statista.com/topics/8696/last-mile-delivery/"] },
  { slug: "warehouse-robotics", name: "Warehouse robotics (kiva-class + bin-picking)", category: "automation", description: "Sub-$50k mobile robots + ML bin-picking obviate the per-pick labor cost in fulfillment. Disrupts capabilities built around human-staffed warehouses.", maturityYear: 2022, exampleDisruptors: ["Amazon Robotics (Kiva)", "Symbotic", "AutoStore", "Covariant"], citations: ["https://ifr.org/img/worldrobotics/Executive_Summary_WR_Service_Robots_2023.pdf"] },
  { slug: "stablecoin-rails", name: "Stablecoin settlement rails", category: "blockchain", description: "USDC/USDT settlement at near-zero cost across borders disrupts cross-border B2B payments, remittance, and treasury operations dependent on correspondent banking.", maturityYear: 2024, exampleDisruptors: ["Bridge (acquired by Stripe)", "Mercury Treasury", "Felix Pago"], citations: ["https://www.bis.org/publ/qtrpdf/r_qt2403c.htm"] },
  { slug: "open-banking-apis", name: "Open Banking APIs (Plaid-class data access)", category: "data_access", description: "Programmatic read access to consumer + business banking obviates manual document collection for any capability built around financial verification. Disrupts capabilities staffed around statement collection / income verification / credit decisioning.", maturityYear: 2019, exampleDisruptors: ["Plaid", "Truework", "Pinwheel", "MX"], citations: ["https://plaid.com/"] },
  { slug: "satellite-imagery-eo", name: "Sub-meter satellite imagery (Planet, Capella, ICEYE)", category: "data_access", description: "Daily-revisit, sub-meter optical + SAR imagery obviates ground-truth field visits for any capability built around physical-asset monitoring (crop yield, construction progress, supply-chain congestion, ESG verification).", maturityYear: 2021, exampleDisruptors: ["Planet Labs", "Orbital Insight", "Indigo Ag", "ICEYE"], citations: ["https://www.planet.com/"] },
  { slug: "agentic-workflows", name: "Agentic LLM workflows (multi-step planning + tool-use)", category: "llm", description: "LLM agents that decompose a goal into tool calls + retry on failure obviate junior knowledge-worker labor. Disrupts capabilities staffed around researching, summarizing, drafting, scheduling, ticket triage — anything where the work is repetitive synthesis.", maturityYear: 2025, exampleDisruptors: ["Cursor", "Devin", "Sierra (CX agents)", "Cognition Labs"], citations: ["https://arxiv.org/abs/2308.11432", "https://www.cognition.ai/blog/introducing-devin"] },
];

router.post("/admin/seed/disruption-enabling-tech", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const existing = await db.select({ slug: disruptionEnablingTechTable.slug }).from(disruptionEnablingTechTable);
    const existingSlugs = new Set(existing.map((r) => r.slug));
    let inserted = 0, updated = 0;
    for (const t of ENABLING_TECH) {
      const values = {
        slug: t.slug, name: t.name, category: t.category, description: t.description,
        maturityYear: t.maturityYear, exampleDisruptors: t.exampleDisruptors, citations: t.citations,
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
    res.json({ ok: true, inserted, updated, total: final.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Playbook archetypes ─────────────────────────────────────────────────
// Keep in sync with scripts/src/seed-disruption-archetypes.ts (commit 3).
interface SeedArchetype {
  slug: string;
  name: string;
  summary: string;
  subscoreProfile: DisruptionSubscoreProfile;
  canonicalActions: string[];
  exampleCompanies: string[];
  narrativeTemplate: string;
  citations: string[];
}

const ARCHETYPES: SeedArchetype[] = [
  {
    slug: "uber",
    name: "Uber playbook",
    summary: "GPS + smartphone + ratings unlock latent vehicle supply, replacing medallion gatekeeping with two-sided marketplace + dynamic pricing.",
    subscoreProfile: { assetFriction: 95, jtbdAbstractability: 85, enablingTechStrength: 90, trustReplaceability: 90, latentSupplyMultiplier: 95, marginAsymmetry: 75 },
    canonicalActions: [
      "Build a two-sided marketplace app (rider + supplier)",
      "Replace gatekeeping (license/medallion/certification) with bilateral ratings",
      "Use real-time location + dynamic match",
      "Surge / dynamic pricing instead of administered fares",
      "Scale supply by recruiting individuals (not B2B onboarding)",
    ],
    exampleCompanies: ["Uber", "Lyft", "Didi", "Grab", "Bolt"],
    narrativeTemplate: "{capability} in {industry} is currently gated by [credential/asset]. The Uber playbook attacks this by routing demand to latent supply via a smartphone app, replacing [credential] with verified ratings + algorithmic match. Expect a 10-30x supply expansion within 36 months once a credible operator launches.",
    citations: ["https://hbr.org/2014/01/uber-and-the-economics-of-tipping-platforms"],
  },
  {
    slug: "airbnb",
    name: "Airbnb playbook",
    summary: "Photography + escrow + verified ID unlock spare-capacity inventory (homes, rooms, time) that asset-heavy incumbents can't economically address.",
    subscoreProfile: { assetFriction: 90, jtbdAbstractability: 90, enablingTechStrength: 75, trustReplaceability: 95, latentSupplyMultiplier: 95, marginAsymmetry: 90 },
    canonicalActions: [
      "Aggregate fragmented spare capacity into a single marketplace",
      "Standardize listings (photography, structured fields, search filters)",
      "Use escrow + verified ID + reviews instead of brand trust",
      "Software-margin against incumbent real-estate/asset margin",
      "Expand from spare-capacity to dedicated supply once unit economics work",
    ],
    exampleCompanies: ["Airbnb", "Vrbo", "Outdoorsy", "Turo", "Sniff"],
    narrativeTemplate: "{capability} in {industry} is owned by asset-heavy incumbents (real estate, fleet, inventory). The Airbnb playbook surfaces latent spare capacity — people willing to monetize an asset they already own — via standardized listings + software trust. Disruption window opens once verified-ID + escrow + insurance stack mature in the vertical.",
    citations: ["https://www.nber.org/papers/w20830"],
  },
  {
    slug: "google",
    name: "Google playbook",
    summary: "Replace editorial / portal-mediated discovery with an algorithm that uses structural signal (links, behavior, semantic match) as quality.",
    subscoreProfile: { assetFriction: 70, jtbdAbstractability: 95, enablingTechStrength: 95, trustReplaceability: 85, latentSupplyMultiplier: 70, marginAsymmetry: 95 },
    canonicalActions: [
      "Replace human curation with an algorithm using structural signal as quality",
      "Strip UI to the single job-to-be-done (search box)",
      "Build a parallel monetization layer (ad auction) that funds the free product",
      "Use scale of indexing as a defensive moat",
      "Expand the indexed surface (web → images → video → maps → real-world)",
    ],
    exampleCompanies: ["Google", "Perplexity", "OpenAI (chat)", "Spotify (discovery)"],
    narrativeTemplate: "{capability} in {industry} relies on human editorial / portal-style curation. The Google playbook replaces that with algorithmic ranking using structural signal at index time. The job-to-be-done is recast as 'find the answer' rather than 'browse the directory.' Disruption is locked once the algorithm exceeds curator quality on the job's primary metric.",
    citations: ["https://infolab.stanford.edu/pub/papers/google.pdf"],
  },
  {
    slug: "amazon",
    name: "Amazon playbook",
    summary: "Infinite-shelf catalog + customer reviews + logistics density obviate physical retail's location-based moat.",
    subscoreProfile: { assetFriction: 95, jtbdAbstractability: 80, enablingTechStrength: 85, trustReplaceability: 85, latentSupplyMultiplier: 90, marginAsymmetry: 85 },
    canonicalActions: [
      "Build an infinite-shelf catalog (no physical inventory constraint)",
      "Use customer reviews + Q&A as scaled social proof",
      "Drive purchase via personalized recommendations (collaborative filtering)",
      "Build logistics density that lets you fulfill faster than the incumbent",
      "Open the platform to third-party sellers (marketplace flywheel)",
    ],
    exampleCompanies: ["Amazon", "Shopify (enabler)", "MercadoLibre", "Coupang", "JD.com"],
    narrativeTemplate: "{capability} in {industry} is built around physical-store density + branded inventory. The Amazon playbook collapses this with infinite-shelf catalog + reviews + last-mile logistics. The incumbent's real-estate moat becomes a stranded asset. Watch for {industry} verticals where 3PL coverage + return-friendliness now match in-store experience.",
    citations: ["https://www.amazon.com/p/feature/cuwwruopv6tukmm"],
  },
  {
    slug: "stripe",
    name: "Stripe playbook",
    summary: "Hide a multi-step legacy integration behind a one-line API; capture the volume that was lost to integration friction.",
    subscoreProfile: { assetFriction: 75, jtbdAbstractability: 95, enablingTechStrength: 85, trustReplaceability: 70, latentSupplyMultiplier: 85, marginAsymmetry: 80 },
    canonicalActions: [
      "Identify a multi-vendor, multi-week legacy integration",
      "Wrap it in a single, modern API + great developer docs",
      "Price as a low-percentage take rate, no contracts",
      "Sell bottom-up to developers, not top-down to procurement",
      "Expand horizontally as the developer relationship deepens (billing → tax → identity → treasury)",
    ],
    exampleCompanies: ["Stripe", "Plaid", "Twilio", "Adyen", "Persona"],
    narrativeTemplate: "{capability} in {industry} requires a developer to integrate with 3+ legacy systems. The Stripe playbook collapses that to a single API + sells bottom-up to engineering. Disruption is fast (12-24 months) because the buyer is a developer making a one-day decision, not a procurement org making a 9-month one.",
    citations: ["https://stripe.com/atlas/guides"],
  },
  {
    slug: "openai-chat",
    name: "OpenAI / ChatGPT playbook",
    summary: "Apply a foundation model to a knowledge-work capability previously staffed by junior experts; capture margin asymmetry against trained labor.",
    subscoreProfile: { assetFriction: 60, jtbdAbstractability: 90, enablingTechStrength: 100, trustReplaceability: 75, latentSupplyMultiplier: 75, marginAsymmetry: 95 },
    canonicalActions: [
      "Identify knowledge work staffed by trained-but-junior experts",
      "Wrap a foundation model in domain context (RAG, fine-tuning, structured prompts)",
      "Sell to the incumbent's customer at 10-50x lower cost",
      "Add a human-in-the-loop QA layer where stakes are high (initially)",
      "Expand the job scope as trust accrues; eventually the human layer thins",
    ],
    exampleCompanies: ["Harvey (legal)", "Hippocratic AI (clinical)", "Cursor (code)", "Sierra (CX)", "Decagon"],
    narrativeTemplate: "{capability} in {industry} is staffed by trained knowledge workers performing repetitive synthesis. The OpenAI/ChatGPT playbook wraps a foundation model in domain context and sells at 10-50x cost disadvantage to the incumbent. Disruption window is open NOW for any cap whose primary inputs are text/visual that a 2025-class LLM can read.",
    citations: ["https://openai.com/research/gpt-4", "https://hai.stanford.edu/news/ai-index-report-2024"],
  },
  {
    slug: "tesla",
    name: "Tesla playbook",
    summary: "Skip the legacy product architecture entirely; rebuild from first principles using new enabling tech (software-defined, vertically integrated, OTA-updated).",
    subscoreProfile: { assetFriction: 95, jtbdAbstractability: 70, enablingTechStrength: 90, trustReplaceability: 60, latentSupplyMultiplier: 60, marginAsymmetry: 80 },
    canonicalActions: [
      "Rebuild the core product as software-defined, with sensors + computers at center",
      "Vertically integrate the value chain (battery, motor, OS, dealer network)",
      "Distribute updates over-the-air; product gets better post-sale",
      "Bypass the incumbent distribution channel (Tesla had no dealers)",
      "Use direct-to-consumer brand to capture the customer relationship",
    ],
    exampleCompanies: ["Tesla", "Rivian", "Joby", "Anduril", "Figure AI"],
    narrativeTemplate: "{capability} in {industry} relies on legacy product architecture + multi-step distribution. The Tesla playbook rebuilds from first principles using software-defined product + vertical integration + DTC distribution. The incumbent can't follow without abandoning years of capex + channel relationships.",
    citations: ["https://www.tesla.com/elon-musk/biography"],
  },
  {
    slug: "netflix",
    name: "Netflix playbook",
    summary: "Convert a transaction-priced product into an unlimited subscription, then use the data flywheel to produce original supply that incumbents can't access.",
    subscoreProfile: { assetFriction: 80, jtbdAbstractability: 85, enablingTechStrength: 80, trustReplaceability: 65, latentSupplyMultiplier: 70, marginAsymmetry: 75 },
    canonicalActions: [
      "Repackage transactional consumption as flat-rate subscription",
      "Use viewing/usage data to drive personalized recommendation",
      "Reinvest subscription revenue into proprietary supply (originals)",
      "Out-distribute the incumbent globally on streaming, not physical",
      "Make personalized discovery the actual product, not the catalog",
    ],
    exampleCompanies: ["Netflix", "Spotify", "Disney+", "Adobe (Creative Cloud SaaS transition)"],
    narrativeTemplate: "{capability} in {industry} is sold per-transaction or per-unit. The Netflix playbook repackages it as flat-rate subscription, drives engagement through personalization, and reinvests recurring revenue into proprietary supply. The incumbent's per-unit P&L can't follow.",
    citations: ["https://hbr.org/2018/01/the-netflix-recommender-system-algorithms-business-value-and-innovation"],
  },
];

router.post("/admin/seed/disruption-archetypes", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const existing = await db.select({ slug: disruptionPlaybookArchetypesTable.slug }).from(disruptionPlaybookArchetypesTable);
    const existingSlugs = new Set(existing.map((r) => r.slug));
    let inserted = 0, updated = 0;
    for (const a of ARCHETYPES) {
      const values = {
        slug: a.slug, name: a.name, summary: a.summary, subscoreProfile: a.subscoreProfile,
        canonicalActions: a.canonicalActions, exampleCompanies: a.exampleCompanies,
        narrativeTemplate: a.narrativeTemplate, citations: a.citations,
        updatedAt: new Date(),
      };
      if (existingSlugs.has(a.slug)) {
        await db.update(disruptionPlaybookArchetypesTable).set(values).where(eq(disruptionPlaybookArchetypesTable.slug, a.slug));
        updated++;
      } else {
        await db.insert(disruptionPlaybookArchetypesTable).values(values);
        inserted++;
      }
    }
    const final = await db.select({ slug: disruptionPlaybookArchetypesTable.slug }).from(disruptionPlaybookArchetypesTable);
    res.json({ ok: true, inserted, updated, total: final.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
