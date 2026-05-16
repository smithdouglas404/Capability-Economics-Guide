/**
 * Seed the disruption_patterns table with 10 historical patterns used as
 * the matching library for the DVX (Disruption Velocity Index) Pattern
 * Match Confidence factor.
 *
 * The DVX engine calls services/agent/tools.ts:generateDisruptorsTool which
 * asks Claude to classify an incumbent capability against these patterns
 * and return a Bayesian confidence score 0-1 that the current market
 * structure matches one of them. That confidence × 100 contributes 30%
 * of the final DVX score.
 *
 * Idempotent — inserts only patterns whose slug doesn't already exist.
 * Re-runnable safely. Skip with SKIP_DISRUPTION_PATTERN_SEED=1.
 */
import { db, disruptionPatternsTable, type NewDisruptionPattern } from "@workspace/db";
import { eq } from "drizzle-orm";

const PATTERNS: NewDisruptionPattern[] = [
  {
    slug: "uber",
    title: "Uber — The asset-light network aggregator",
    headline: "Capital-heavy regulated inventory displaced by a software layer that aggregates pre-existing supply.",
    disruptorCompany: "Uber",
    incumbentsDisplaced: ["Yellow Cab Co.", "Medallion-owned taxi fleets", "Black-car dispatch operators"],
    industriesAffected: ["Transportation", "Local mobility", "Logistics"],
    existingCapabilitiesUsed: ["GPS routing", "Mobile payments", "Two-sided marketplace UX", "Real-time dispatch"],
    newCapabilityCreated: "On-demand ride matching at metro scale without owning vehicles",
    crossIndustryAnalogues: ["Airbnb (lodging)", "DoorDash (food)", "Instacart (grocery)", "Rover (pet care)"],
    narrative: "Incumbents in taxi/limo owned the capital (vehicles, medallions, dispatch real estate). Uber built none of it — instead it built a software aggregation layer that turned existing private cars + smartphones into the supply side. The disruption signal: incumbents could not respond without dismantling their own moat (capital ownership = the very thing the platform made irrelevant).",
    whatToLookFor: [
      "Capability requires capital-heavy assets (fleet, real estate, inventory)",
      "Existing supply exists outside the regulated channel (private cars, spare rooms)",
      "Software + smartphone + GPS enables a new coordination layer",
      "Incumbent's moat IS the cost structure that becomes obsolete",
    ],
    sources: [{ url: "https://hbr.org/2014/01/uber-and-the-economics-of-trust", title: "HBR — Uber and the economics of trust" }],
    featured: true,
  },
  {
    slug: "airbnb",
    title: "Airbnb — P2P long-tail unlocking regulated supply",
    headline: "Regulated hotel inventory bypassed by trust-graph + insurance turning every spare room into bookable supply.",
    disruptorCompany: "Airbnb",
    incumbentsDisplaced: ["Hotels.com", "Hilton (mid-tier brands)", "Vacation rental agencies"],
    industriesAffected: ["Hospitality", "Travel", "Real estate"],
    existingCapabilitiesUsed: ["Photo-based listing UX", "Stripe-style payment escrow", "Two-sided review trust system", "Liability insurance pooling"],
    newCapabilityCreated: "Bookable lodging from any private residence, globally, with trust + insurance baked in",
    crossIndustryAnalogues: ["Vrbo", "Turo (cars)", "Splacer (event venues)", "Tend (pet boarding)"],
    narrative: "Hotels controlled regulated inventory. Airbnb unlocked the much larger pool of private residences by solving two problems incumbents thought impossible: stranger-trust (reviews + verified profiles) and liability (host insurance). The displacement vector was not better hotels; it was a different supply curve. Bookings on Airbnb represent inventory hotels can never economically build.",
    whatToLookFor: [
      "Regulated inventory is small relative to a much larger informal pool",
      "Trust is the missing component, solvable via reviews + identity verification",
      "Liability/insurance is solvable via pooled risk",
      "Disruptor never asks for regulatory parity — operates under different rules",
    ],
    sources: [{ url: "https://hbr.org/2015/04/the-airbnb-experiment", title: "HBR — The Airbnb experiment" }],
    featured: true,
  },
  {
    slug: "kodak",
    title: "Kodak — The incumbent that owned the new tech but failed to commercialize",
    headline: "Owning the technology that displaces you doesn't help if you protect the existing P&L instead of cannibalizing it.",
    disruptorCompany: "Sony, Canon, smartphone OEMs",
    incumbentsDisplaced: ["Eastman Kodak (own film business)"],
    industriesAffected: ["Photography", "Consumer imaging", "Film processing"],
    existingCapabilitiesUsed: ["CCD sensor manufacturing (Kodak invented it 1975)", "Image processing", "Mass consumer distribution"],
    newCapabilityCreated: "Instant, zero-cost digital image capture + storage + sharing",
    crossIndustryAnalogues: ["BlackBerry (smartphone keyboard incumbent)", "Xerox PARC (GUI inventor)", "GM (EV-1, then killed)"],
    narrative: "Kodak invented the digital camera in 1975 — and shelved it because film was their cash cow. The disruptor wasn't external; it was their own inability to cannibalize. By the time they brought digital products to market, the camera capability had migrated to phones (a market they had no foothold in). The pattern is: incumbent owns the displacing tech, refuses to commercialize, watches it commoditize from someone else.",
    whatToLookFor: [
      "Incumbent has the displacing tech in R&D but won't ship it",
      "Existing high-margin business depends on the to-be-disrupted process",
      "New capability requires writing off the legacy P&L",
      "Adjacent industries (e.g. mobile) can absorb the displacing capability faster than the incumbent industry",
    ],
    sources: [{ url: "https://www.nytimes.com/2012/01/19/business/eastman-kodak-files-for-bankruptcy.html", title: "NYT — Kodak bankruptcy" }],
    featured: false,
  },
  {
    slug: "blockbuster",
    title: "Blockbuster — Physical distribution displaced by streaming",
    headline: "Owning the retail real-estate moat became the liability when distribution shifted to bits.",
    disruptorCompany: "Netflix",
    incumbentsDisplaced: ["Blockbuster Video", "Movie Gallery", "Hollywood Video", "Mom-and-pop video stores"],
    industriesAffected: ["Home entertainment", "Media distribution"],
    existingCapabilitiesUsed: ["DVD-by-mail logistics", "Recommendation algorithms", "Subscription billing", "CDN streaming infrastructure"],
    newCapabilityCreated: "On-demand video streaming with subscription economics + recommendation personalization",
    crossIndustryAnalogues: ["Spotify (music)", "Audible (audiobooks)", "Kindle (books)", "Steam (games)"],
    narrative: "Blockbuster's moat was 9,000 retail locations and DVD inventory. Netflix bypassed both: first via DVD-by-mail (no late fees, no store visit), then via streaming (no DVD at all). At each turn, Blockbuster's existing assets — stores, inventory, lease obligations — turned from moats into liabilities. They couldn't shrink fast enough.",
    whatToLookFor: [
      "Capability is bundled with physical real estate / inventory",
      "Substitute capability ships pure bits with marginal cost ~0",
      "Incumbent cost structure has long fixed-cost tail (leases, payroll)",
      "Disruptor has subscription / consumption economics instead of per-unit",
    ],
    sources: [{ url: "https://hbr.org/2014/09/strategy-lessons-from-the-collapse-of-blockbuster-video", title: "HBR — Strategy lessons from Blockbuster" }],
    featured: false,
  },
  {
    slug: "spacex",
    title: "SpaceX — State-protected industry displaced by vertical integration + reusability",
    headline: "Cost-plus contracting and single-use hardware displaced by reusable rockets and end-to-end vertical control.",
    disruptorCompany: "SpaceX",
    incumbentsDisplaced: ["Boeing-Lockheed United Launch Alliance", "Arianespace", "Roscosmos commercial"],
    industriesAffected: ["Aerospace", "Satellite launch", "Defense"],
    existingCapabilitiesUsed: ["Liquid rocket propulsion", "Avionics", "Software-defined hardware control", "Iterative engineering culture (from software)"],
    newCapabilityCreated: "First-stage reusability at scale → 10× cost reduction in $/kg to orbit",
    crossIndustryAnalogues: ["Tesla (automotive vertical integration)", "Apple (silicon)", "Anduril (defense)"],
    narrative: "Launch was protected by 50 years of cost-plus contracting and regulatory capture. SpaceX bypassed by (a) vertical integration — owning their own engines, avionics, manufacturing — and (b) reusability — turning the first stage from a write-off into an amortizable asset. Result: $/kg to orbit dropped from ~$10K (incumbents) to ~$1.5K (Falcon 9), then ~$500 projected (Starship). Incumbents couldn't follow without dismantling their entire supplier ecosystem.",
    whatToLookFor: [
      "Industry depends on cost-plus / regulated contracting",
      "Incumbent capability is fragmented across many suppliers (each profit center)",
      "Disruptor owns the full stack including manufacturing",
      "Single-use → reusable changes the asset economics",
    ],
    sources: [{ url: "https://www.nasaspaceflight.com/2020/05/spacex-economics-launch", title: "NASA Spaceflight — SpaceX launch economics" }],
    featured: true,
  },
  {
    slug: "netflix-originals",
    title: "Netflix Originals — Distributor becomes the content producer",
    headline: "Distribution platform vertically integrates into content, displacing the studios whose movies they used to license.",
    disruptorCompany: "Netflix",
    incumbentsDisplaced: ["Traditional film studios (as exclusive content owners)", "HBO premium cable"],
    industriesAffected: ["Film", "Television", "Premium cable"],
    existingCapabilitiesUsed: ["Viewer data + recommendation algos", "Direct subscriber relationship", "Global distribution at marginal cost", "Capital markets access"],
    newCapabilityCreated: "Data-driven original-content commissioning + simultaneous global release",
    crossIndustryAnalogues: ["Amazon Basics (private label)", "Costco Kirkland", "Apple Music originals", "Spotify podcasts"],
    narrative: "Netflix started as a licensee of studio content. As the studios saw the threat and started pulling their catalogs, Netflix used (a) viewer data to make smarter content bets and (b) capital markets to fund original production. House of Cards (2013) was the inflection. By 2020, Netflix Originals were >60% of viewing minutes. The studios had created their own competitor by gating their content.",
    whatToLookFor: [
      "Distribution platform has direct customer relationship + data the supplier doesn't",
      "Supplier (content owner) tries to gate distribution → forces platform to vertically integrate",
      "Distribution platform has capital access to fund production",
      "Data advantage produces structurally better commissioning decisions",
    ],
    sources: [{ url: "https://hbr.org/2018/05/how-netflix-changed-the-game", title: "HBR — How Netflix changed the game" }],
    featured: false,
  },
  {
    slug: "stripe",
    title: "Stripe — Developer-first API displaces enterprise sales gates",
    headline: "Payments was a procurement project. Stripe made it 7 lines of code, accessible without anyone signing a contract.",
    disruptorCompany: "Stripe",
    incumbentsDisplaced: ["First Data", "Worldpay (legacy)", "Authorize.net", "Internal-IT integration teams"],
    industriesAffected: ["Payments processing", "FinTech infrastructure", "E-commerce platforms"],
    existingCapabilitiesUsed: ["Card-network connectivity (Visa, MC)", "Fraud detection ML", "PCI compliance abstraction", "Developer docs as marketing"],
    newCapabilityCreated: "Self-service payments-as-an-API with sub-week integration",
    crossIndustryAnalogues: ["Twilio (telephony)", "Plaid (bank data)", "AWS (compute)", "Shopify (storefront)"],
    narrative: "Payments was a 6-month enterprise procurement: lawyers, integration consultants, custom contracts, signed agreements with each card network. Stripe collapsed all of that into a developer signing up, copying 7 lines of code, and processing live transactions in hours. The incumbents weren't slower at payments — they were slower at the right thing (developer experience). Two-developer startups suddenly had Visa-grade payments without ever talking to a salesperson.",
    whatToLookFor: [
      "Existing capability requires enterprise procurement (lawyers, custom contracts)",
      "Underlying technology can be exposed as a simple API",
      "Developer-led adoption bypasses purchasing entirely",
      "Documentation + free-tier = marketing motion incumbents can't run",
    ],
    sources: [{ url: "https://stripe.com/atlas/guides", title: "Stripe Atlas — How Stripe approaches payments" }],
    featured: true,
  },
  {
    slug: "square",
    title: "Square — SME unbanked-by-incumbents served by mobile-first reader",
    headline: "Card processing was minimum $400/mo + 18-month contracts. Square made it pay-as-you-go for a $10 dongle.",
    disruptorCompany: "Square (now Block)",
    incumbentsDisplaced: ["Verifone", "Ingenico (SMB segment)", "Wells Fargo Merchant Services"],
    industriesAffected: ["SMB payments", "POS systems", "Mobile commerce"],
    existingCapabilitiesUsed: ["Smartphone audio jack", "Card network connectivity", "Underwriting via observed transaction stream", "Mobile checkout UX"],
    newCapabilityCreated: "Card acceptance with zero minimums, zero contracts, $10 hardware",
    crossIndustryAnalogues: ["Lendio (SME lending)", "Brex (SME credit cards)", "Mercury (SME banking)", "QuickBooks Capital"],
    narrative: "Card acceptance had a regressive cost structure: large merchants paid 1.5%, smallest merchants couldn't get accepted at all because incumbents wouldn't underwrite them. Square offered any SMB a card reader with no underwriting questions and inferred creditworthiness from observed transactions. This unlocked the entire long tail of SMB payments — food trucks, market stalls, freelancers — that incumbents had structurally excluded.",
    whatToLookFor: [
      "Incumbent capability is gated by upfront underwriting incumbents won't do for small customers",
      "Disruptor can replace upfront underwriting with usage-based observation",
      "Hardware cost is the wedge — make it negligible or free",
      "Long tail unlocked is much larger than the served market",
    ],
    sources: [{ url: "https://www.bloomberg.com/news/articles/2014-04-17/square-takes-on-banks", title: "Bloomberg — Square takes on banks" }],
    featured: false,
  },
  {
    slug: "openai",
    title: "OpenAI — Research-lab capability commoditizes via API",
    headline: "Models that previously required a research team are now an HTTP POST that any junior dev can call.",
    disruptorCompany: "OpenAI (then Anthropic, etc.)",
    incumbentsDisplaced: ["Custom ML consultancies", "Internal data science teams (for many tasks)", "Niche language-AI vendors"],
    industriesAffected: ["AI/ML services", "Software development", "Customer support", "Content"],
    existingCapabilitiesUsed: ["Foundation model training", "Transformer architecture", "GPU compute at scale", "API-first product design"],
    newCapabilityCreated: "General-purpose language reasoning as a stateless HTTP API",
    crossIndustryAnalogues: ["Twilio (telephony AI used to require carriers)", "Plaid (bank data integration)", "AWS (compute)"],
    narrative: "Until 2022, integrating natural-language capabilities into an app meant hiring an ML team, collecting training data, and building bespoke models. OpenAI's API made it a function call — and the resulting capability was often better than what most in-house teams could produce. The disruption isn't to a single industry; it's to the capability called \"NLP engineering.\" Customer support, copywriting, code generation, document summarization — all collapsed into a few tokens of prompt.",
    whatToLookFor: [
      "Capability previously required specialist talent + bespoke training data",
      "Disruptor offers it via stateless API with broad applicability",
      "Talent-intensive incumbent capability becomes \"call the API\"",
      "Cross-industry generalization: same capability replaces many vertical specialists",
    ],
    sources: [{ url: "https://openai.com/research/", title: "OpenAI Research" }],
    featured: true,
  },
  {
    slug: "tesla",
    title: "Tesla — Vertical integration + software-first car",
    headline: "Auto industry split horizontally across suppliers. Tesla owned the stack and treated the car as a software product.",
    disruptorCompany: "Tesla",
    incumbentsDisplaced: ["GM, Ford (legacy ICE assemblers)", "Bosch / Continental (Tier-1 suppliers, on some functions)", "Auto dealers (sales model)"],
    industriesAffected: ["Automotive", "Energy storage", "Direct retail"],
    existingCapabilitiesUsed: ["Lithium-ion cell chemistry", "Over-the-air software update", "Vertical integration (battery, motor, infotainment)", "Direct-sales model"],
    newCapabilityCreated: "EV with software-driven feature unlocks + direct-to-consumer sales",
    crossIndustryAnalogues: ["Apple iPhone (vertical integration)", "Anduril (defense)", "Rivian"],
    narrative: "The auto industry was structurally horizontal: assemblers bought from suppliers, sold through dealers, updated cars only via recalls. Tesla built vertically: own batteries, own motors, own retail, own software. The car became a software-updatable platform — adding self-driving, performance modes, even seat heaters via OTA. Incumbents couldn't replicate without breaking dealer franchise laws + supplier contracts.",
    whatToLookFor: [
      "Industry is structurally horizontal with profit captured by intermediaries",
      "Disruptor goes vertical across the entire stack",
      "Product can be updated post-sale (software-defined)",
      "Distribution channel (e.g. dealers) protected by law/contracts — disruptor avoids them entirely",
    ],
    sources: [{ url: "https://hbr.org/2020/02/tesla-is-an-energy-company", title: "HBR — Tesla is an energy company" }],
    featured: false,
  },
];

async function main() {
  if (process.env.SKIP_DISRUPTION_PATTERN_SEED === "1") {
    console.log("SKIP_DISRUPTION_PATTERN_SEED=1 — skipping.");
    return;
  }

  let inserted = 0;
  let skipped = 0;
  for (const pattern of PATTERNS) {
    const [existing] = await db.select().from(disruptionPatternsTable).where(eq(disruptionPatternsTable.slug, pattern.slug)).limit(1);
    if (existing) {
      skipped++;
      continue;
    }
    await db.insert(disruptionPatternsTable).values(pattern);
    inserted++;
  }
  console.log(`Disruption patterns: ${inserted} inserted, ${skipped} already existed.`);
}

main().catch(err => {
  console.error("Disruption pattern seed failed:", err);
  process.exit(1);
});
