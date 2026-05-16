/**
 * Seed the curated historical-event catalog used by the CVI backtesting harness.
 *
 * Each event encodes the model's primary classification (`sentimentDirection`)
 * AND the analyst's per-capability ground-truth verdict (`expectedDirection`).
 * Per-cap verdicts deliberately disagree with the global sentiment in several
 * cases (telehealth POSITIVE during COVID, AI-governance tooling POSITIVE
 * under EU AI Act, etc.) so the harness genuinely tests whether the engine
 * captures these counter-cyclical winners.
 *
 * Idempotent: events are upserted by (eventDate, title).
 */
import { db, historicalEventsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

type Dir = "positive" | "negative" | "neutral";
interface SeedCap { name: string; expectedDirection: Dir; rationale?: string; }
interface SeedEvent {
  eventDate: string;
  title: string;
  eventType: string;
  severity: number;
  sentimentDirection: Dir;
  decayDays: number;
  affectedIndustryNames: string[];
  affectedCapabilities: SeedCap[];
  description: string;
  citations: string[];
}

const SEEDS: SeedEvent[] = [
  {
    eventDate: "2020-03-11",
    title: "WHO declares COVID-19 a pandemic",
    eventType: "disaster",
    severity: 9,
    // Globally negative — health systems were overwhelmed, GDP contracted.
    sentimentDirection: "negative",
    decayDays: 365,
    affectedIndustryNames: ["Healthcare"],
    affectedCapabilities: [
      // Counter-cyclical winner: a naive engine predicts NEGATIVE here, but
      // telehealth was *the* breakout capability of 2020. Catches the model.
      { name: "Behavioral Health Telehealth", expectedDirection: "positive",
        rationale: "38× telehealth surge in 90 days; structural acceleration of virtual care." },
    ],
    description:
      "Lockdowns drove a 38× surge in telehealth utilization in 90 days, structurally accelerating virtual-care capability investment across providers and payers.",
    citations: [
      "https://www.who.int/news/item/27-04-2020-who-timeline---covid-19",
      "https://www.mckinsey.com/industries/healthcare/our-insights/telehealth-a-quarter-trillion-dollar-post-covid-19-reality",
    ],
  },
  {
    eventDate: "2022-11-30",
    title: "OpenAI launches ChatGPT",
    eventType: "tech_shift",
    severity: 9,
    sentimentDirection: "positive",
    decayDays: 720,
    affectedIndustryNames: ["Technology"],
    affectedCapabilities: [
      { name: "AI-Assisted Development & Code Quality", expectedDirection: "positive",
        rationale: "Copilot/Cursor adoption became standard developer practice within 12 months." },
      { name: "Agentic AI", expectedDirection: "positive",
        rationale: "Multi-step agent frameworks emerged industry-wide." },
    ],
    description:
      "ChatGPT's release triggered industry-wide acceleration of LLM tooling. Within 12 months Copilot, Cursor, and similar agents became standard developer practice.",
    citations: [
      "https://openai.com/index/chatgpt/",
      "https://www.anthropic.com/news/the-anthropic-economic-index",
    ],
  },
  {
    eventDate: "2023-03-10",
    title: "Silicon Valley Bank collapses",
    eventType: "economic",
    severity: 7,
    sentimentDirection: "negative",
    decayDays: 180,
    affectedIndustryNames: ["Banking & Financial Services"],
    affectedCapabilities: [
      { name: "Liquidity & Funding Risk Management", expectedDirection: "negative",
        rationale: "Acute capability gap exposed; sector-wide capability score fell." },
      // Counter-cyclical: post-failure regulators forced massive resilience
      // investment. Engine predicts negative; analyst marks positive.
      { name: "Operational Risk & Resilience", expectedDirection: "positive",
        rationale: "Stress-testing and resilience programs accelerated industry-wide post-failure." },
    ],
    description:
      "The second-largest US bank failure exposed deep liquidity-risk and ALM gaps; regulators escalated stress-testing and resilience expectations across regional banks.",
    citations: [
      "https://www.federalreserve.gov/publications/files/svb-review-20230428.pdf",
      "https://www.fdic.gov/news/press-releases/2023/pr23016.html",
    ],
  },
  {
    eventDate: "2022-08-16",
    title: "Inflation Reduction Act signed",
    eventType: "regulation",
    severity: 7,
    sentimentDirection: "positive",
    decayDays: 365,
    affectedIndustryNames: ["Manufacturing"],
    affectedCapabilities: [
      { name: "Energy Efficiency & Renewable Transition", expectedDirection: "positive",
        rationale: "$369B in clean-energy tax credits drove direct investment." },
      { name: "Carbon Footprint Measurement & Accounting", expectedDirection: "positive",
        rationale: "ESG-reporting requirements drove capability buildout." },
    ],
    description:
      "$369B in clean-energy and manufacturing tax credits accelerated US industrial decarbonization investment and ESG-reporting capability buildout.",
    citations: [
      "https://www.congress.gov/bill/117th-congress/house-bill/5376",
      "https://www.whitehouse.gov/cleanenergy/inflation-reduction-act-guidebook/",
    ],
  },
  {
    eventDate: "2024-11-05",
    title: "Trump wins 2024 US presidential election (tariff signal)",
    eventType: "regulation",
    severity: 6,
    sentimentDirection: "negative",
    decayDays: 180,
    affectedIndustryNames: ["Manufacturing"],
    affectedCapabilities: [
      // Counter-cyclical: tariff threat is bad for margins (negative) but
      // forces rapid investment in supply-chain visibility (positive for
      // the capability itself). Engine predicts negative; analyst positive.
      { name: "Logistics & Track-and-Trace", expectedDirection: "positive",
        rationale: "Tariff exposure forced manufacturers to invest in granular supply-chain visibility." },
    ],
    description:
      "Campaign-pledged 10–60% import tariffs forced manufacturers to reprice supply-chain risk and accelerate tariff-engineering / nearshoring planning.",
    citations: [
      "https://www.reuters.com/world/us/trump-wins-us-presidency-after-bruising-campaign-against-harris-2024-11-06/",
      "https://www.piie.com/research/piie-charts/2024/trumps-bigger-better-tariffs-would-cost-typical-american-household-over-2600",
    ],
  },
  {
    eventDate: "2024-08-01",
    title: "EU AI Act enters into force",
    eventType: "regulation",
    severity: 6,
    // Globally negative for vendors (compliance cost burden).
    sentimentDirection: "negative",
    decayDays: 540,
    affectedIndustryNames: ["Technology"],
    affectedCapabilities: [
      // Counter-cyclical: compliance burden drives the very capability needed
      // to comply. Engine predicts negative; analyst positive.
      { name: "API Governance & Security Compliance", expectedDirection: "positive",
        rationale: "Conformity-assessment + model-card requirements drove governance-tooling investment." },
    ],
    description:
      "First comprehensive AI regulation in a major market drove AI-governance, model-card, and conformity-assessment capability investment across software vendors.",
    citations: [
      "https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai",
      "https://eur-lex.europa.eu/eli/reg/2024/1689/oj",
    ],
  },
  {
    eventDate: "2024-02-21",
    title: "Change Healthcare ransomware attack",
    eventType: "disaster",
    severity: 7,
    sentimentDirection: "negative",
    decayDays: 120,
    affectedIndustryNames: ["Healthcare"],
    affectedCapabilities: [
      { name: "Claims Submission & Adjudication", expectedDirection: "negative",
        rationale: "Acute capability impairment — half of US prescription claims halted for weeks." },
    ],
    description:
      "ALPHV ransomware halted ~50% of US prescription claims processing for weeks, exposing systemic single-point-of-failure risk in healthcare claims infrastructure.",
    citations: [
      "https://www.unitedhealthgroup.com/newsroom/2024/2024-02-22-uhg-update-on-change-healthcare-cyberattack.html",
      "https://www.hhs.gov/about/news/2024/03/05/hhs-statement-regarding-the-cyberattack-on-change-healthcare.html",
    ],
  },
  {
    eventDate: "2023-06-15",
    title: "GLP-1 obesity therapeutics break into mainstream",
    eventType: "tech_shift",
    severity: 7,
    sentimentDirection: "positive",
    decayDays: 540,
    affectedIndustryNames: ["Healthcare"],
    affectedCapabilities: [
      { name: "Chronic Disease Management Programs", expectedDirection: "positive",
        rationale: "Reframed care pathways for obesity, T2D, and cardio-metabolic conditions." },
    ],
    description:
      "Wegovy/Ozempic prescribing surge reframed obesity, T2D, and cardio-metabolic care pathways, accelerating capability investment in chronic-disease program design.",
    citations: [
      "https://www.nejm.org/doi/full/10.1056/NEJMoa2306963",
      "https://www.fda.gov/news-events/press-announcements/fda-approves-new-medication-chronic-weight-management",
    ],
  },
  {
    eventDate: "2024-07-19",
    title: "CrowdStrike Falcon outage",
    eventType: "disaster",
    severity: 8,
    sentimentDirection: "negative",
    decayDays: 180,
    affectedIndustryNames: ["Technology"],
    affectedCapabilities: [
      // Counter-cyclical: incident drove industry-wide investment in EDR
      // staged rollout, kernel-isolation, and recovery posture.
      { name: "Cloud Security Posture", expectedDirection: "positive",
        rationale: "Incident triggered industry-wide reassessment + investment in EDR posture." },
    ],
    description:
      "A faulty kernel-mode sensor update bricked ~8.5M Windows hosts globally, prompting industry-wide reassessment of EDR deployment, staged-rollout, and recovery posture.",
    citations: [
      "https://www.crowdstrike.com/falcon-content-update-remediation-and-guidance-hub/",
      "https://blogs.microsoft.com/blog/2024/07/20/helping-our-customers-through-the-crowdstrike-outage/",
    ],
  },
  {
    eventDate: "2023-06-28",
    title: "EU PSD3 / Payment Services Regulation proposal",
    eventType: "regulation",
    severity: 5,
    sentimentDirection: "positive",
    decayDays: 540,
    affectedIndustryNames: ["Banking & Financial Services"],
    affectedCapabilities: [
      { name: "API-First Integration & Open Banking", expectedDirection: "positive",
        rationale: "Sharper API-quality + data-sharing rules pushed open-banking investment." },
    ],
    description:
      "PSD3/PSR proposal sharpened API-quality, data-sharing, and fraud-liability rules, pushing banks to invest more aggressively in open-banking platforms.",
    citations: [
      "https://finance.ec.europa.eu/publications/financial-data-access-and-payments-package_en",
      "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52023PC0367",
    ],
  },
];

async function main() {
  let inserted = 0;
  let updated = 0;
  for (const s of SEEDS) {
    const eventDate = new Date(s.eventDate);
    const existing = await db
      .select()
      .from(historicalEventsTable)
      .where(and(eq(historicalEventsTable.title, s.title), eq(historicalEventsTable.eventDate, eventDate)))
      .limit(1);

    const values = {
      eventType: s.eventType,
      severity: s.severity,
      sentimentDirection: s.sentimentDirection,
      decayDays: s.decayDays,
      affectedIndustryNames: s.affectedIndustryNames,
      affectedCapabilities: s.affectedCapabilities,
      description: s.description,
      citations: s.citations,
    };

    if (existing.length > 0) {
      await db.update(historicalEventsTable).set(values).where(eq(historicalEventsTable.id, existing[0].id));
      updated += 1;
    } else {
      await db.insert(historicalEventsTable).values({ eventDate, title: s.title, ...values });
      inserted += 1;
    }
  }
  console.log(`[seed-historical-events] inserted=${inserted} updated=${updated} total=${SEEDS.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-historical-events] failed:", err);
  process.exit(1);
});
