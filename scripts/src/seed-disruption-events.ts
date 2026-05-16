/**
 * Seed disruption_events with ~25 well-documented historical disruption
 * events across industries. Each event names the disruptor, the incumbents
 * displaced, what capabilities they killed and created, and the playbook
 * pattern they ran.
 *
 * Idempotent — only inserts events whose slug doesn't already exist.
 *
 * The capability id columns (displaced_capability_ids /
 * created_capability_ids) start empty. A separate mapping pass (manual
 * admin curation or agent-resolved) populates them by matching the name
 * arrays against the capabilities table.
 *
 * Skip with SKIP_DISRUPTION_EVENT_SEED=1.
 */
import { db, disruptionEventsTable, type NewDisruptionEvent } from "@workspace/db";
import { eq } from "drizzle-orm";

const EVENTS: NewDisruptionEvent[] = [
  // ── Transportation ──────────────────────────────────────────────────
  {
    slug: "uber-launch-2009",
    title: "Uber launches on-demand black car app",
    headline: "Software dispatch + private cars displaces medallion-protected taxi monopolies.",
    eventYear: 2009,
    disruptorCompany: "Uber",
    disruptorTicker: "UBER",
    incumbentCompanies: ["Yellow Cab Co.", "Medallion fleets (NYC, SF, Chicago)", "Town car services"],
    industriesAffected: ["Transportation", "Local mobility"],
    displacedCapabilityNames: ["Cab dispatch", "Fleet ownership at scale", "Medallion-based supply control"],
    createdCapabilityNames: ["On-demand ride matching", "Driver-side liquidity management", "Two-sided trust graph"],
    patternSlug: "uber",
    severity: "severe",
    narrative: "Uber launched as black-car-on-demand in San Francisco in 2009. By 2012 the UberX product opened the network to private drivers, collapsing the cost-of-supply by an order of magnitude. NYC medallion prices peaked at $1.3M in 2014 and crashed to ~$80K by 2019.",
    evidence: [
      { claim: "NYC medallion price dropped from $1.3M (2014) to ~$80K (2019).", source: "https://www.nytimes.com/2019/05/19/nyregion/taxi-medallions.html" },
      { claim: "Uber surpassed taxi rides in NYC by 2016.", source: "https://toddwschneider.com/posts/taxi-uber-lyft-usage-new-york-city/" },
    ],
    sources: [{ url: "https://hbr.org/2014/01/uber-and-the-economics-of-trust", title: "HBR — Uber and the economics of trust" }],
  },
  {
    slug: "lyft-launch-2012",
    title: "Lyft brings peer-to-peer ridesharing mainstream",
    headline: "Pink-mustache branded P2P rideshare normalizes private cars as taxi substitute.",
    eventYear: 2012,
    disruptorCompany: "Lyft",
    disruptorTicker: "LYFT",
    incumbentCompanies: ["Yellow Cab Co.", "Local cab co-ops"],
    industriesAffected: ["Transportation"],
    displacedCapabilityNames: ["Cab dispatch", "Driver licensing chokepoints"],
    createdCapabilityNames: ["Casual driver onboarding", "Trust-via-photo + rating"],
    patternSlug: "uber",
    severity: "severe",
    narrative: "Lyft launched as Zimride's spin-off in 2012, normalizing private-car rideshare alongside Uber. Together they captured 80%+ of US local transport spend by 2018.",
    evidence: [{ claim: "Lyft + Uber combined US trip volume exceeded taxis by 2017.", source: "https://www.statista.com/statistics/828657/uber-and-lyft-monthly-active-users-in-the-us/" }],
    sources: [],
  },
  {
    slug: "tesla-model-s-2012",
    title: "Tesla Model S validates the EV luxury market",
    headline: "Vertical-integrated EV with software updates displaces ICE luxury sedans.",
    eventYear: 2012,
    disruptorCompany: "Tesla",
    disruptorTicker: "TSLA",
    incumbentCompanies: ["BMW (7-series)", "Mercedes (S-class)", "Audi (A8)"],
    industriesAffected: ["Automotive", "Energy"],
    displacedCapabilityNames: ["ICE drivetrain manufacturing", "Dealer-distributed sales", "Recall-only post-sale updates"],
    createdCapabilityNames: ["OTA software updates for cars", "Direct-to-consumer auto sales", "Vertically-integrated battery + motor"],
    patternSlug: "tesla",
    severity: "moderate",
    narrative: "Model S sales overtook BMW 7-series and Mercedes S-class in the US luxury segment by 2017. By 2023 Tesla led global EV market with ~20% share; legacy OEMs scrambling to retire ICE platforms by 2030-2035.",
    evidence: [{ claim: "Tesla Model S outsold Mercedes S-class + BMW 7-series combined in US, 2017.", source: "https://insideevs.com/news/322737/" }],
    sources: [{ url: "https://hbr.org/2020/02/tesla-is-an-energy-company", title: "HBR — Tesla is an energy company" }],
  },

  // ── Hospitality ─────────────────────────────────────────────────────
  {
    slug: "airbnb-vs-hotels-2010",
    title: "Airbnb crosses 1M bookings; hotels notice",
    headline: "P2P short-term rentals unlock orders-of-magnitude more inventory than hotels can build.",
    eventYear: 2010,
    disruptorCompany: "Airbnb",
    disruptorTicker: "ABNB",
    incumbentCompanies: ["Hotels.com", "Hilton (mid-tier brands)", "Vacation rental agencies"],
    industriesAffected: ["Hospitality", "Travel"],
    displacedCapabilityNames: ["Hotel inventory management", "Mid-tier brand differentiation"],
    createdCapabilityNames: ["P2P lodging trust system", "Host insurance pooling", "Photo-driven listing UX"],
    patternSlug: "airbnb",
    severity: "severe",
    narrative: "Airbnb hit 1M total bookings in early 2011. By 2016 NYC had more Airbnb listings than hotel rooms. Marriott + Hilton ADR (avg daily rate) compressed in markets with high Airbnb penetration.",
    evidence: [
      { claim: "Airbnb listings exceeded NYC hotel rooms by 2016.", source: "https://www.nyc.gov/site/specialenforcement/illegal-rentals/data.page" },
      { claim: "Hotel ADR growth slowed 1-3% annually in high-Airbnb markets per CBRE.", source: "https://www.cbre.com/insights" },
    ],
    sources: [{ url: "https://hbr.org/2015/04/the-airbnb-experiment", title: "HBR — The Airbnb experiment" }],
  },

  // ── Media / Entertainment ───────────────────────────────────────────
  {
    slug: "netflix-streaming-2007",
    title: "Netflix launches streaming; Blockbuster begins decline",
    headline: "On-demand bits replace physical DVD distribution + retail rental moat.",
    eventYear: 2007,
    disruptorCompany: "Netflix",
    disruptorTicker: "NFLX",
    incumbentCompanies: ["Blockbuster Video", "Movie Gallery", "Hollywood Video"],
    industriesAffected: ["Media", "Home entertainment"],
    displacedCapabilityNames: ["DVD-by-mail logistics", "Retail rental real estate", "Late-fee revenue"],
    createdCapabilityNames: ["On-demand video streaming", "Subscription-billed recommendation engine"],
    patternSlug: "blockbuster",
    severity: "extinction",
    narrative: "Netflix launched streaming in January 2007. Blockbuster filed Chapter 11 in 2010 carrying $1.5B in debt and 9,000-store lease obligations. Closed last corporate store in 2014; one franchise location in Bend, OR remains.",
    evidence: [
      { claim: "Blockbuster filed Chapter 11 with $1.5B debt in Sep 2010.", source: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001085734" },
      { claim: "Netflix streaming subscriber count surpassed Blockbuster's at peak DVD-by-mail subs by 2010.", source: "https://www.netflix.com/about" },
    ],
    sources: [{ url: "https://hbr.org/2014/09/strategy-lessons-from-the-collapse-of-blockbuster-video", title: "HBR — Blockbuster strategy lessons" }],
  },
  {
    slug: "spotify-vs-itunes-2011",
    title: "Spotify US launch reshapes music ownership economics",
    headline: "Subscription streaming displaces $1.29/track download as the music consumption default.",
    eventYear: 2011,
    disruptorCompany: "Spotify",
    disruptorTicker: "SPOT",
    incumbentCompanies: ["Apple iTunes Store (download business)", "Pandora (early streaming)"],
    industriesAffected: ["Music", "Media"],
    displacedCapabilityNames: ["A la carte music downloads", "Album bundling economics"],
    createdCapabilityNames: ["Algorithmic playlist curation", "Per-stream royalty payout infrastructure"],
    patternSlug: "blockbuster",
    severity: "severe",
    narrative: "Spotify launched in US July 2011. iTunes download revenue peaked 2012 at ~$2.1B and dropped 60% by 2018 as streaming subscriptions took over. Apple launched Apple Music in 2015 mostly to defend.",
    evidence: [{ claim: "iTunes download revenue dropped from $2.1B (2012) to under $1B by 2018.", source: "https://www.theverge.com/2018/4/15/17239108/apple-itunes-music-download-store-going-away" }],
    sources: [],
  },
  {
    slug: "netflix-house-of-cards-2013",
    title: "Netflix Originals begin — distributor becomes content owner",
    headline: "House of Cards inflects Netflix from licensee to studio competitor.",
    eventYear: 2013,
    disruptorCompany: "Netflix",
    disruptorTicker: "NFLX",
    incumbentCompanies: ["Warner Bros TV", "HBO premium cable", "Traditional film studios"],
    industriesAffected: ["Film", "Television"],
    displacedCapabilityNames: ["Studio-gated content distribution", "Linear weekly release windows"],
    createdCapabilityNames: ["Data-driven content commissioning", "Simultaneous global release"],
    patternSlug: "netflix-originals",
    severity: "severe",
    narrative: "House of Cards (Feb 2013) was Netflix's first major original. By 2020 Netflix Originals were 60%+ of viewing minutes; HBO's relative subscriber growth halved.",
    evidence: [{ claim: "Netflix Originals exceeded 60% of viewing minutes by 2020.", source: "https://www.nielsen.com/insights/2020/" }],
    sources: [{ url: "https://hbr.org/2018/05/how-netflix-changed-the-game", title: "HBR — How Netflix changed the game" }],
  },

  // ── Mobile / Hardware ───────────────────────────────────────────────
  {
    slug: "iphone-vs-blackberry-nokia-2007",
    title: "iPhone reshapes phone industry around touch + apps",
    headline: "Capacitive touchscreen + third-party apps make hardware keyboards and carrier-curated software obsolete.",
    eventYear: 2007,
    disruptorCompany: "Apple",
    disruptorTicker: "AAPL",
    incumbentCompanies: ["BlackBerry (RIM)", "Nokia", "Palm", "Motorola (RAZR era)"],
    industriesAffected: ["Mobile", "Telecommunications"],
    displacedCapabilityNames: ["Hardware QWERTY keyboard design", "Carrier-controlled app deck", "Symbian / BBOS engineering"],
    createdCapabilityNames: ["Capacitive multi-touch UI", "Curated third-party app store", "iOS developer ecosystem"],
    patternSlug: "kodak",
    severity: "extinction",
    narrative: "iPhone launched June 2007. Nokia's smartphone share went from 51% (2007) to 3% (2013). BlackBerry: peak 50M subscribers (2012) → bankruptcy threats by 2016. Motorola sold to Google 2012, then Lenovo 2014.",
    evidence: [
      { claim: "Nokia smartphone market share fell from 51% (2007) to 3% (2013).", source: "https://www.gartner.com/en/newsroom/press-releases/2013-02-14-gartner-says-worldwide-mobile-phone-sales" },
      { claim: "BlackBerry subscribers peaked at 80M in 2013, fell to 23M by 2016.", source: "https://www.bbc.com/news/business-37718682" },
    ],
    sources: [],
  },
  {
    slug: "android-vs-windows-mobile-2008",
    title: "Android launches as open mobile OS alternative",
    headline: "Free + open licensable OS displaces Windows Mobile and forces Nokia/BlackBerry to pick a side.",
    eventYear: 2008,
    disruptorCompany: "Google",
    disruptorTicker: "GOOGL",
    incumbentCompanies: ["Microsoft (Windows Mobile)", "Nokia (Symbian)"],
    industriesAffected: ["Mobile", "Operating systems"],
    displacedCapabilityNames: ["Windows Mobile platform", "Symbian platform"],
    createdCapabilityNames: ["Open-source mobile OS distribution", "Multi-OEM hardware ecosystem"],
    patternSlug: "openai",
    severity: "extinction",
    narrative: "Android 1.0 + HTC Dream launched Sep 2008. Windows Mobile share dropped from 11% (2008) to <1% by 2013. Microsoft acquired Nokia handset division 2014 in failed defensive play; wrote off $7.6B in 2015.",
    evidence: [{ claim: "Microsoft wrote off $7.6B Nokia acquisition in 2015.", source: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000789019" }],
    sources: [],
  },

  // ── Cloud / Infrastructure ──────────────────────────────────────────
  {
    slug: "aws-launch-2006",
    title: "AWS EC2 + S3 launch; colocation business model under pressure",
    headline: "Hourly-billed compute + API-provisioned storage replaces capex servers and 18-month colo contracts.",
    eventYear: 2006,
    disruptorCompany: "Amazon Web Services",
    disruptorTicker: "AMZN",
    incumbentCompanies: ["Equinix (colocation)", "Sun Microsystems (server sales)", "HP (server sales)", "Dell (server sales)"],
    industriesAffected: ["Cloud computing", "Data centers", "Enterprise hardware"],
    displacedCapabilityNames: ["Capex server procurement", "Datacenter colocation contracts", "Enterprise IT capacity planning"],
    createdCapabilityNames: ["Hourly-billed cloud compute", "API-provisioned storage", "DevOps as a discipline"],
    patternSlug: "stripe",
    severity: "severe",
    narrative: "S3 launched March 2006; EC2 August 2006. By 2015 AWS revenue ($7.9B) exceeded Sun Microsystems' all-time peak server sales. Sun acquired by Oracle 2010; HP spun off enterprise division 2015.",
    evidence: [
      { claim: "AWS revenue exceeded Sun's peak server revenue ($7B) by 2015.", source: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001018724" },
      { claim: "Sun Microsystems acquired by Oracle for $7.4B in 2010.", source: "https://www.sec.gov/Archives/edgar/data/1341439/000119312510023679/dex21.htm" },
    ],
    sources: [],
  },
  {
    slug: "snowflake-vs-teradata-2014",
    title: "Snowflake disaggregates storage + compute for data warehouse",
    headline: "Pay-per-query warehouse displaces appliance-bundled Teradata + Oracle Exadata.",
    eventYear: 2014,
    disruptorCompany: "Snowflake",
    disruptorTicker: "SNOW",
    incumbentCompanies: ["Teradata", "Oracle Exadata", "IBM Netezza"],
    industriesAffected: ["Data warehousing", "Enterprise software"],
    displacedCapabilityNames: ["Appliance-based data warehouse", "Storage-compute bundled pricing"],
    createdCapabilityNames: ["Per-query elastic compute", "Multi-cluster data sharing"],
    patternSlug: "stripe",
    severity: "severe",
    narrative: "Snowflake reached $1B ARR in 2020, $2B ARR in 2022. Teradata revenue flat 2014-2022 at ~$1.9B as marquee accounts migrated. IBM divested Netezza in 2019.",
    evidence: [{ claim: "Snowflake reached $1B ARR by Q1 2021.", source: "https://investors.snowflake.com" }],
    sources: [],
  },

  // ── Payments ────────────────────────────────────────────────────────
  {
    slug: "stripe-launch-2011",
    title: "Stripe makes payments a 7-line API integration",
    headline: "Developer-first signup replaces enterprise procurement + custom integration consultants.",
    eventYear: 2011,
    disruptorCompany: "Stripe",
    disruptorTicker: null, // private
    incumbentCompanies: ["Authorize.net", "First Data (Cardtronics)", "Worldpay"],
    industriesAffected: ["Payments", "FinTech"],
    displacedCapabilityNames: ["Enterprise sales for payments integration", "Custom integration consulting"],
    createdCapabilityNames: ["Self-service payments API", "Developer-led B2B adoption"],
    patternSlug: "stripe",
    severity: "severe",
    narrative: "Stripe launched general availability Sep 2011. By 2021 processed $640B+ annually. Authorize.net market share fell from ~25% (2011) to <8% (2020) in new-merchant signups. Worldpay sold to FIS for $43B in 2019.",
    evidence: [{ claim: "Stripe processed $640B in payments in 2021.", source: "https://stripe.com/newsroom" }],
    sources: [{ url: "https://stripe.com/atlas/guides", title: "Stripe Atlas guides" }],
  },
  {
    slug: "square-launch-2009",
    title: "Square dongle opens card acceptance to micro-merchants",
    headline: "$0 hardware + no underwriting unlocks SMB payments incumbents structurally excluded.",
    eventYear: 2009,
    disruptorCompany: "Square (Block)",
    disruptorTicker: "SQ",
    incumbentCompanies: ["Verifone (SMB segment)", "Ingenico (SMB)"],
    industriesAffected: ["Payments", "SMB tooling"],
    displacedCapabilityNames: ["Upfront-underwritten merchant accounts", "Multi-year POS leases"],
    createdCapabilityNames: ["Phone-jack card reader", "Observation-based credit underwriting"],
    patternSlug: "square",
    severity: "severe",
    narrative: "Square launched Oct 2009 with a $10 dongle. By 2020 Verifone SMB segment revenue had compressed ~40% as Square + Toast captured new-merchant flow.",
    evidence: [{ claim: "Verifone went private 2018 at $3.4B valuation, down from $5B peak.", source: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001312073" }],
    sources: [],
  },

  // ── Aerospace ───────────────────────────────────────────────────────
  {
    slug: "spacex-falcon9-reusable-2015",
    title: "SpaceX lands Falcon 9 first stage; reusability becomes real",
    headline: "First propulsive landing of orbital-class booster collapses $/kg-to-orbit by 10x.",
    eventYear: 2015,
    disruptorCompany: "SpaceX",
    disruptorTicker: null, // private
    incumbentCompanies: ["United Launch Alliance (Boeing+Lockheed)", "Arianespace"],
    industriesAffected: ["Aerospace", "Defense", "Satellite communications"],
    displacedCapabilityNames: ["Single-use first-stage manufacturing", "Cost-plus government launch contracting"],
    createdCapabilityNames: ["Reusable first-stage propulsive landing", "Vertical aerospace manufacturing"],
    patternSlug: "spacex",
    severity: "severe",
    narrative: "Falcon 9 landing Dec 2015. By 2020 SpaceX captured 60%+ of commercial launches. ULA Atlas V $/kg ~$10K vs Falcon 9 ~$2K; Starship target $200/kg. Arianespace Ariane 5 retired 2023 with no commercial-competitive successor.",
    evidence: [
      { claim: "Falcon 9 captured 60%+ of commercial launch market by 2020.", source: "https://www.nasaspaceflight.com" },
      { claim: "Arianespace Ariane 5 retired July 2023.", source: "https://www.esa.int" },
    ],
    sources: [],
  },
  {
    slug: "starlink-vs-viasat-2020",
    title: "SpaceX Starlink low-earth-orbit constellation enters consumer broadband",
    headline: "LEO constellation displaces geostationary satellite broadband (Viasat / HughesNet) on latency.",
    eventYear: 2020,
    disruptorCompany: "SpaceX (Starlink)",
    disruptorTicker: null,
    incumbentCompanies: ["Viasat", "HughesNet (EchoStar)"],
    industriesAffected: ["Satellite broadband", "Rural connectivity"],
    displacedCapabilityNames: ["Geostationary satellite broadband at 600ms latency"],
    createdCapabilityNames: ["LEO constellation operations at scale", "User-self-installed satellite dish"],
    patternSlug: "spacex",
    severity: "moderate",
    narrative: "Starlink beta launched Oct 2020. By 2023 surpassed 2M subscribers globally; latency ~25ms vs Viasat ~600ms. Viasat subscriber count flat-to-declining since 2021.",
    evidence: [{ claim: "Starlink exceeded 2M subscribers in 2023.", source: "https://www.starlink.com/" }],
    sources: [],
  },

  // ── Retail / Commerce ───────────────────────────────────────────────
  {
    slug: "amazon-vs-borders-2011",
    title: "Borders Books bankruptcy; Amazon's bookstore moat complete",
    headline: "Online catalog + free shipping + Kindle make physical bookstore lease economics impossible.",
    eventYear: 2011,
    disruptorCompany: "Amazon",
    disruptorTicker: "AMZN",
    incumbentCompanies: ["Borders Books", "Barnes & Noble (severely weakened)"],
    industriesAffected: ["Retail", "Books"],
    displacedCapabilityNames: ["Big-box bookstore real estate", "Physical inventory + returns logistics"],
    createdCapabilityNames: ["Online book catalog with reviews", "Kindle e-book + e-reader"],
    patternSlug: "blockbuster",
    severity: "extinction",
    narrative: "Borders filed Ch 11 Feb 2011 with $1.3B debt and 642 stores; liquidated July 2011. Barnes & Noble store count peaked 798 (2008), down to 600 (2023). Amazon Books retail experiment closed 2022.",
    evidence: [{ claim: "Borders liquidated July 2011 closing 642 stores.", source: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000853230" }],
    sources: [],
  },
  {
    slug: "shopify-vs-magento-2014",
    title: "Shopify hits 100K stores; long-tail ecommerce shifts away from custom builds",
    headline: "Hosted SaaS store builder displaces Magento self-hosting + custom IBM Websphere implementations.",
    eventYear: 2014,
    disruptorCompany: "Shopify",
    disruptorTicker: "SHOP",
    incumbentCompanies: ["Magento (Adobe)", "IBM Websphere Commerce", "Oracle ATG"],
    industriesAffected: ["E-commerce", "Enterprise software"],
    displacedCapabilityNames: ["Self-hosted commerce platform engineering", "Custom enterprise commerce integration"],
    createdCapabilityNames: ["SaaS store template ecosystem", "App-store-style commerce add-ons"],
    patternSlug: "stripe",
    severity: "severe",
    narrative: "Shopify crossed 100K stores Q1 2014; >2M by 2021; >5M by 2024. Magento market share in new SMB ecommerce builds dropped from ~30% (2014) to <5% (2022). Adobe acquired Magento for $1.68B 2018, repositioned as enterprise-only.",
    evidence: [{ claim: "Shopify processed $235B GMV in 2023.", source: "https://investors.shopify.com" }],
    sources: [],
  },

  // ── Software / Productivity ─────────────────────────────────────────
  {
    slug: "google-docs-vs-office-2006",
    title: "Google Docs launches; Office's collaboration moat begins to erode",
    headline: "Browser-native real-time collaboration competes with file-bound Office.",
    eventYear: 2006,
    disruptorCompany: "Google",
    disruptorTicker: "GOOGL",
    incumbentCompanies: ["Microsoft Office (collaboration features specifically)"],
    industriesAffected: ["Productivity software", "Enterprise software"],
    displacedCapabilityNames: ["File-based document sharing via email", "Single-user-at-a-time editing"],
    createdCapabilityNames: ["Real-time collaborative editing in browser", "Native cloud-document storage"],
    patternSlug: "openai",
    severity: "moderate",
    narrative: "Google Docs launched 2006 (from Writely acquisition). Microsoft Office responded with Office 365 (2011) + co-authoring (2013-2016). Office retained dominance at enterprise but ceded the SMB + education segments.",
    evidence: [{ claim: "Google Workspace grew to 3B users by 2023.", source: "https://workspace.google.com" }],
    sources: [],
  },
  {
    slug: "slack-vs-email-2014",
    title: "Slack reshapes internal communications away from email",
    headline: "Channel-based messaging displaces internal email + IRC + Skype for Business at fast-moving companies.",
    eventYear: 2014,
    disruptorCompany: "Slack",
    disruptorTicker: null, // acquired by Salesforce
    incumbentCompanies: ["Microsoft Skype for Business", "HipChat (Atlassian)", "internal email volume"],
    industriesAffected: ["Workplace communication", "Enterprise software"],
    displacedCapabilityNames: ["Skype for Business deployment + admin", "HipChat platform"],
    createdCapabilityNames: ["Channel-based async team messaging", "Workflow integration bot ecosystem"],
    patternSlug: "stripe",
    severity: "severe",
    narrative: "Slack public launch Feb 2014. By 2019 had 12M+ DAU and was acquired by Salesforce for $27.7B (2020). Microsoft launched Teams Mar 2017 explicitly to defend; by 2024 Teams claimed 320M+ MAU vs Slack ~38M.",
    evidence: [{ claim: "Salesforce acquired Slack for $27.7B in 2020.", source: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001108524" }],
    sources: [],
  },

  // ── AI / ML ─────────────────────────────────────────────────────────
  {
    slug: "openai-chatgpt-launch-2022",
    title: "ChatGPT launches; LLM-as-a-service breaks out of research labs",
    headline: "Conversational LLM API commoditizes capabilities that previously required full ML teams.",
    eventYear: 2022,
    disruptorCompany: "OpenAI",
    disruptorTicker: null, // private
    incumbentCompanies: ["Custom NLP consultancies", "Internal ML teams (for many tasks)", "IBM Watson"],
    industriesAffected: ["AI/ML services", "Customer support automation", "Content production", "Software dev tools"],
    displacedCapabilityNames: ["Custom NLP model training pipelines", "Bespoke chatbot engineering"],
    createdCapabilityNames: ["LLM API as integration primitive", "Prompt engineering as discipline", "RAG-pattern architectures"],
    patternSlug: "openai",
    severity: "extinction",
    narrative: "ChatGPT launched Nov 30 2022; 100M users by Jan 2023 (fastest consumer product adoption in history). IBM Watson sold to private equity 2022. Specialized chatbot startups (Drift, Intercom) repositioned around LLM orchestration.",
    evidence: [
      { claim: "ChatGPT reached 100M users in 60 days.", source: "https://www.reuters.com/technology/chatgpt-sets-record-fastest-growing-user-base-analyst-note-2023-02-01/" },
      { claim: "IBM Watson Health sold to Francisco Partners for $1B in 2022.", source: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000051143" },
    ],
    sources: [],
  },
  {
    slug: "github-copilot-vs-snippet-2021",
    title: "GitHub Copilot launches; coding assistant displaces snippet-search habit",
    headline: "Inline AI code completion replaces Stack Overflow lookup + intra-team snippet sharing for boilerplate.",
    eventYear: 2021,
    disruptorCompany: "GitHub (Microsoft)",
    disruptorTicker: "MSFT",
    incumbentCompanies: ["Stack Overflow (Q&A volume)", "TabNine", "Kite (defunct)"],
    industriesAffected: ["Developer tools", "Software engineering productivity"],
    displacedCapabilityNames: ["Snippet copy-paste workflow", "Static autocomplete (intellisense)"],
    createdCapabilityNames: ["Context-aware AI code completion", "In-editor AI pair programming"],
    patternSlug: "openai",
    severity: "moderate",
    narrative: "Copilot tech preview Jun 2021; GA Jun 2022. Stack Overflow site traffic dropped ~40% from peak by 2024. Kite shut down 2022. Cursor + Windsurf launched 2023-2024 as native AI-first editors.",
    evidence: [{ claim: "Stack Overflow traffic dropped ~40% from 2022 peak by 2024.", source: "https://stackoverflow.blog/2024/05/13/the-end-of-programming-as-we-know-it/" }],
    sources: [],
  },

  // ── Imaging ─────────────────────────────────────────────────────────
  {
    slug: "kodak-bankruptcy-2012",
    title: "Kodak files Chapter 11; the company that invented digital photography",
    headline: "Incumbent invents the displacing tech (digital sensor, 1975) but cannot cannibalize own film P&L.",
    eventYear: 2012,
    disruptorCompany: "Sony / Canon / Smartphone OEMs",
    disruptorTicker: null,
    incumbentCompanies: ["Eastman Kodak"],
    industriesAffected: ["Photography", "Consumer imaging"],
    displacedCapabilityNames: ["Film manufacturing", "Retail photo processing", "Specialty photo paper"],
    createdCapabilityNames: ["Phone-integrated camera", "Social-shared image distribution"],
    patternSlug: "kodak",
    severity: "extinction",
    narrative: "Kodak invented the digital camera in 1975 and shelved the patent. Filed Ch 11 Jan 2012 after film revenue collapsed; emerged 2013 as a much smaller printing company.",
    evidence: [{ claim: "Kodak Ch 11 filed Jan 19 2012 with $5.1B debt.", source: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000031235" }],
    sources: [{ url: "https://www.nytimes.com/2012/01/19/business/eastman-kodak-files-for-bankruptcy.html", title: "NYT — Kodak files for bankruptcy" }],
  },

  // ── Financial Services ──────────────────────────────────────────────
  {
    slug: "robinhood-zero-commission-2013",
    title: "Robinhood launches $0 commission trades",
    headline: "Mobile-first zero-commission model forces 100-year-old discount brokers to abandon trade-commission revenue.",
    eventYear: 2013,
    disruptorCompany: "Robinhood",
    disruptorTicker: "HOOD",
    incumbentCompanies: ["Charles Schwab", "TD Ameritrade", "E*TRADE", "Fidelity"],
    industriesAffected: ["Retail brokerage", "FinTech"],
    displacedCapabilityNames: ["Per-trade commission revenue model", "Branch + phone-based brokerage support"],
    createdCapabilityNames: ["Payment-for-order-flow revenue model", "Mobile-first retail brokerage UX"],
    patternSlug: "square",
    severity: "severe",
    narrative: "Robinhood launched Dec 2014. By Oct 2019 Schwab dropped commissions to $0; TD Ameritrade + E*TRADE matched within 24 hours. Schwab acquired TD Ameritrade 2020 ($26B); E*TRADE acquired by Morgan Stanley 2020 ($13B) — industry consolidated under pricing pressure.",
    evidence: [
      { claim: "Schwab dropped trade commissions to $0 on Oct 1 2019 in response to Robinhood.", source: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000316709" },
      { claim: "Schwab + TD Ameritrade merged Oct 2020 in $26B deal.", source: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000316709" },
    ],
    sources: [],
  },

  // ── Healthcare ──────────────────────────────────────────────────────
  {
    slug: "23andme-direct-to-consumer-2007",
    title: "23andMe launches direct-to-consumer genetic testing",
    headline: "Mail-order DNA test bypasses doctor-gated genetic counseling channel.",
    eventYear: 2007,
    disruptorCompany: "23andMe",
    disruptorTicker: "ME",
    incumbentCompanies: ["Hospital genetic counseling departments", "Specialty diagnostic labs"],
    industriesAffected: ["Healthcare", "Genomics"],
    displacedCapabilityNames: ["Physician-gated genetic test ordering"],
    createdCapabilityNames: ["Direct-to-consumer genomic data collection"],
    patternSlug: "stripe",
    severity: "moderate",
    narrative: "23andMe launched Nov 2007 at $999/kit; price dropped to $99 by 2012. FDA briefly halted health-related testing 2013; resumed 2017 with carrier-status reports. By 2020 the consumer genomics market exceeded $1.7B.",
    evidence: [{ claim: "Consumer genomics market exceeded $1.7B by 2020.", source: "https://www.cbinsights.com/research/dna-genomics-tech-companies/" }],
    sources: [],
  },

  // ── Telephony ───────────────────────────────────────────────────────
  {
    slug: "whatsapp-vs-sms-2012",
    title: "WhatsApp displaces carrier SMS revenue globally",
    headline: "Free internet-based messaging eliminates the SMS profit pool for carriers.",
    eventYear: 2012,
    disruptorCompany: "WhatsApp (Meta)",
    disruptorTicker: "META",
    incumbentCompanies: ["AT&T (SMS revenue)", "Verizon (SMS revenue)", "Vodafone", "Carrier SMS interconnect"],
    industriesAffected: ["Telecommunications", "Messaging"],
    displacedCapabilityNames: ["Carrier per-message SMS billing", "Carrier inter-network SMS interconnect"],
    createdCapabilityNames: ["End-to-end encrypted consumer messaging at scale", "Cross-carrier group chat"],
    patternSlug: "openai",
    severity: "severe",
    narrative: "WhatsApp messaging volume surpassed global SMS in 2012. Meta acquired WhatsApp Feb 2014 for $19B. Global carrier SMS revenue fell from ~$120B (2012) to ~$60B (2020), with carriers shifting to A2P (business messaging) for survival.",
    evidence: [
      { claim: "WhatsApp daily message volume surpassed global SMS in 2012.", source: "https://www.bbc.com/news/business-22841548" },
      { claim: "Carrier SMS revenue fell from $120B (2012) to $60B (2020).", source: "https://www.statista.com/statistics/267235/global-revenue-from-sms-services/" },
    ],
    sources: [],
  },
];

async function main() {
  if (process.env.SKIP_DISRUPTION_EVENT_SEED === "1") {
    console.log("SKIP_DISRUPTION_EVENT_SEED=1 — skipping.");
    return;
  }
  let inserted = 0;
  let skipped = 0;
  for (const ev of EVENTS) {
    const [existing] = await db.select().from(disruptionEventsTable).where(eq(disruptionEventsTable.slug, ev.slug)).limit(1);
    if (existing) { skipped++; continue; }
    await db.insert(disruptionEventsTable).values(ev);
    inserted++;
  }
  console.log(`Disruption events: ${inserted} inserted, ${skipped} already existed (${EVENTS.length} total in catalog).`);
}

main().catch(err => {
  console.error("Disruption event seed failed:", err);
  process.exit(1);
});
