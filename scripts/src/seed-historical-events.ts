/**
 * Seed the historical_events table with curated real-world disruptions for
 * the CVI backtest harness. Each event:
 *
 *   - Has a primary sentimentDirection (what world-scan would tag the event as)
 *   - Lists affected industries by NAME (matches industriesTable rows)
 *   - Lists affected capabilities by NAME with PER-CAP expectedDirection
 *
 * The per-cap directions deliberately disagree with the event's overall
 * sentiment where reality did (COVID negative globally but POSITIVE for
 * telehealth + e-commerce; EU AI Act negative for unregulated AI but
 * POSITIVE for AI governance tooling). The backtest predicts each cap's
 * delta sign from sentimentDirection alone, then scores against the
 * per-cap ground truth — that's what makes the harness genuinely diagnostic
 * instead of trivially correct.
 *
 * Capability names below are verbatim from the live capability catalog
 * (queried 2026-05-23). The backtest matches exact, case-insensitive — typos
 * here mean the cap won't get scored.
 *
 * Idempotent: skips rows whose title already exists.
 */
import { db, historicalEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type SeedEvent = {
  eventDate: string;
  title: string;
  eventType: string;
  severity: number;
  sentimentDirection: "positive" | "negative" | "neutral";
  decayDays?: number;
  affectedIndustryNames: string[];
  affectedCapabilities: Array<{ name: string; expectedDirection: "positive" | "negative" | "neutral"; rationale?: string }>;
  description: string;
  citations: string[];
};

export const EVENTS: SeedEvent[] = [
  {
    eventDate: "2020-03-11",
    title: "COVID-19 declared pandemic — global shutdown of in-person commerce",
    eventType: "macro_shock",
    severity: 0.95,
    sentimentDirection: "negative",
    decayDays: 365,
    affectedIndustryNames: ["Healthcare", "Retail", "Insurance", "Banking & Financial Services"],
    affectedCapabilities: [
      { name: "Telehealth & Virtual Care", expectedDirection: "positive", rationale: "Virtual visits jumped from ~1% to ~40% of healthcare encounters in 60 days" },
      { name: "Population Health Management", expectedDirection: "positive", rationale: "Pandemic surveillance + risk stratification became Tier 1 capability" },
      { name: "Clinical Workforce Management", expectedDirection: "negative", rationale: "In-person staffing models broke; PPE + scheduling capabilities overwhelmed" },
      { name: "E-Commerce Platform", expectedDirection: "positive", rationale: "Online retail grew 32% YoY in 2020 — decade of growth in 12 months" },
      { name: "Store Operations Excellence", expectedDirection: "negative", rationale: "Physical store traffic collapsed; mall vacancies hit 11.4% by Q4 2020" },
      { name: "Digital Banking Platform", expectedDirection: "positive", rationale: "Branch traffic collapsed; mobile-first banks captured the share" },
      { name: "Actuarial Modeling", expectedDirection: "positive", rationale: "Mortality + business-interruption models had to be redrawn industry-wide" },
    ],
    description: "WHO pandemic declaration triggered global lockdowns. Industries that had invested in digital + remote capabilities outperformed peers by 20-40 pts on revenue retention.",
    citations: [
      "https://www.who.int/news/item/27-04-2020-who-timeline---covid-19",
      "https://www.mckinsey.com/industries/retail/our-insights/digital-strategy-in-a-time-of-crisis",
    ],
  },
  {
    eventDate: "2022-11-30",
    title: "ChatGPT launches — LLM-as-a-service breaks out of research labs",
    eventType: "technology_breakthrough",
    severity: 0.9,
    sentimentDirection: "positive",
    decayDays: 540,
    affectedIndustryNames: ["Technology", "Insurance", "Banking & Financial Services", "Healthcare"],
    affectedCapabilities: [
      { name: "AI/ML Operations", expectedDirection: "positive", rationale: "Every Fortune 500 announced an LLM strategy within 6 months; MLOps spend doubled in 2023" },
      { name: "Product Development", expectedDirection: "positive", rationale: "Copilot-class tools cut engineering time-to-market by reported 20-40%" },
      { name: "Customer Analytics", expectedDirection: "positive", rationale: "LLM-driven segmentation + intent inference made BI tools 5x faster" },
      { name: "Clinical Decision Support", expectedDirection: "positive", rationale: "First wave of LLM-grounded diagnostic assistants entered clinical pilots" },
      { name: "Rapid Claims Resolution", expectedDirection: "positive", rationale: "Insurers using LLM-assisted intake cut FNOL processing time 30-50%" },
    ],
    description: "ChatGPT reached 100M users in 60 days — fastest consumer adoption ever. Every enterprise software vendor pivoted within two quarters; capabilities adjacent to AI got immediate uplift.",
    citations: [
      "https://www.reuters.com/technology/chatgpt-sets-record-fastest-growing-user-base-analyst-note-2023-02-01/",
      "https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai",
    ],
  },
  {
    eventDate: "2023-03-10",
    title: "Silicon Valley Bank collapse — second-largest US bank failure",
    eventType: "financial_crisis",
    severity: 0.85,
    sentimentDirection: "negative",
    decayDays: 270,
    affectedIndustryNames: ["Banking & Financial Services", "Technology"],
    affectedCapabilities: [
      { name: "Credit Decisioning", expectedDirection: "negative", rationale: "Underwriting models for venture-backed clients got rebuilt with much tighter loss assumptions" },
      { name: "Fraud Prevention", expectedDirection: "positive", rationale: "Renewed regulatory + counterparty risk scrutiny across all FIs" },
      { name: "Wealth Management & Advisory", expectedDirection: "positive", rationale: "Mass exodus to top-5 banks drove unprecedented wealth-management mandate growth" },
      { name: "Core Banking Modernization", expectedDirection: "positive", rationale: "Regulators flagged 30-year-old systems at SVB; modernization budgets unlocked sector-wide" },
      { name: "Cybersecurity", expectedDirection: "positive", rationale: "Treasury teams accelerated multi-bank cash-management deployments — security overhead spiked" },
    ],
    description: "SVB held $209B in assets, collapsed in 36 hours after a Twitter-fueled bank run. Triggered the most aggressive consolidation in US regional banking since 2008.",
    citations: [
      "https://www.fdic.gov/news/press-releases/2023/pr23019.html",
      "https://www.federalreserve.gov/publications/files/svb-review-20230428.pdf",
    ],
  },
  {
    eventDate: "2024-05-21",
    title: "EU AI Act passes — first comprehensive AI regulation in major economy",
    eventType: "regulatory_shift",
    severity: 0.75,
    sentimentDirection: "negative",
    decayDays: 540,
    affectedIndustryNames: ["Technology", "Healthcare", "Insurance"],
    affectedCapabilities: [
      { name: "AI/ML Operations", expectedDirection: "negative", rationale: "Compliance overhead added 6-12 months to high-risk AI deployments" },
      { name: "Cybersecurity", expectedDirection: "positive", rationale: "AI governance requires the same control plane FIs use for data — pulled in security teams" },
      { name: "Clinical Decision Support", expectedDirection: "negative", rationale: "Healthcare-AI vendors required to redo conformity assessments under Annex III" },
      { name: "Data & Analytics Platform", expectedDirection: "positive", rationale: "Data-lineage + auditability tooling became must-have rather than nice-to-have" },
      { name: "Actuarial Modeling", expectedDirection: "negative", rationale: "Insurers using ML for pricing fell under high-risk classification; rebuilds required" },
    ],
    description: "EU AI Act categorized AI systems into 4 risk tiers. High-risk uses (credit scoring, medical, employment) face conformity assessments, registration, and post-market monitoring. Sets global baseline since EU is the largest market for most enterprises.",
    citations: [
      "https://artificialintelligenceact.eu/the-act/",
      "https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai",
    ],
  },
  {
    eventDate: "2025-04-02",
    title: "US reciprocal tariff wave — sharpest trade-policy shift since 1971",
    eventType: "trade_policy",
    severity: 0.8,
    sentimentDirection: "negative",
    decayDays: 365,
    affectedIndustryNames: ["Manufacturing", "Retail"],
    affectedCapabilities: [
      { name: "Supply Chain Management", expectedDirection: "negative", rationale: "Existing offshore-heavy networks took the full tariff hit on through-the-door cost" },
      { name: "Supply Chain & Logistics", expectedDirection: "negative", rationale: "Retail importers absorbed margin compression of 4-9 pts depending on category" },
      { name: "Smart Factory / IoT", expectedDirection: "positive", rationale: "Domestic reshoring made automated US production economically viable — capex surge" },
      { name: "Inventory Optimization", expectedDirection: "positive", rationale: "Pre-tariff stockpiling + dynamic safety-stock rebalancing became operational priorities" },
      { name: "Sustainability & ESG", expectedDirection: "negative", rationale: "Lower-cost short-haul sourcing displaced cleaner long-haul vendors in many categories" },
    ],
    description: "Universal 10% reciprocal tariffs plus higher per-country rates on specific exporters. Manufacturing PMI dropped 4.7 pts in Q2. Capabilities tied to localized supply networks gained; offshore-dependent ones lost.",
    citations: [
      "https://www.federalregister.gov/documents/2025/04/07/2025-05951/regulating-imports-with-a-reciprocal-tariff-to-rectify-trade-practices",
      "https://www.bea.gov/news/2025/gross-domestic-product-second-quarter-2025-advance-estimate",
    ],
  },
];

async function main() {
  const existing = await db.select({ title: historicalEventsTable.title }).from(historicalEventsTable);
  const existingTitles = new Set(existing.map((r) => r.title));
  let inserted = 0;
  let skipped = 0;
  for (const e of EVENTS) {
    if (existingTitles.has(e.title)) {
      skipped++;
      continue;
    }
    await db.insert(historicalEventsTable).values({
      eventDate: new Date(e.eventDate),
      title: e.title,
      eventType: e.eventType,
      severity: e.severity,
      sentimentDirection: e.sentimentDirection,
      decayDays: e.decayDays ?? 30,
      affectedIndustryNames: e.affectedIndustryNames,
      affectedCapabilities: e.affectedCapabilities,
      description: e.description,
      citations: e.citations,
    });
    inserted++;
    console.log(`✓ ${e.title}`);
  }
  console.log(`\nseed-historical-events: inserted=${inserted} skipped=${skipped} total=${existing.length + inserted}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("seed-historical-events failed:", err);
  process.exit(1);
});
