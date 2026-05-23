/**
 * One-shot admin endpoint to seed the historical_events table for the
 * backtest harness. Idempotent — skips events whose title already exists.
 *
 * Reuses the SeedEvent definitions from scripts/src/seed-historical-events.ts
 * (single source of truth — the script is canonical, this route just wraps it
 * so prod can be seeded without shell access).
 *
 *   POST /api/admin/seed/historical-events
 *     headers: x-admin-key: $ADMIN_API_KEY
 *     body: (none)
 *     response: { inserted, skipped, total }
 */
import { Router, type Request, type Response } from "express";
import { db, historicalEventsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

// Event definitions — kept inline (not imported from /scripts) because the
// api-server bundle doesn't include the scripts workspace. Update both this
// and scripts/src/seed-historical-events.ts together if events change.
interface SeedEvent {
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
}

const EVENTS: SeedEvent[] = [
  {
    eventDate: "2020-03-11",
    title: "COVID-19 declared pandemic — global shutdown of in-person commerce",
    eventType: "macro_shock",
    severity: 0.95,
    sentimentDirection: "negative",
    decayDays: 365,
    affectedIndustryNames: ["Healthcare", "Retail", "Insurance", "Banking & Financial Services"],
    affectedCapabilities: [
      { name: "Self-Service Claims Management", expectedDirection: "positive", rationale: "Insurers pushed FNOL + claim-status to mobile self-service to keep ops running when offices closed" },
      { name: "First Notice of Loss (FNOL) Intake", expectedDirection: "positive", rationale: "Digital intake replaced in-person + phone overnight; reshaped claims funnel" },
      { name: "Adaptive Store & Digital Experience Design", expectedDirection: "positive", rationale: "Curbside + buy-online-pickup became table stakes in 60 days; chains without it lost share" },
      { name: "Order Fulfillment & Logistics Orchestration", expectedDirection: "positive", rationale: "E-commerce volume jumped 32% YoY in 2020 — decade of growth in 12 months" },
      { name: "Store Compliance & Loss Prevention", expectedDirection: "negative", rationale: "In-store programs paused or restructured around skeleton staffing" },
      { name: "Pricing Model Development & Predictive Underwriting", expectedDirection: "positive", rationale: "Mortality and business-interruption assumptions were re-derived industry-wide" },
      { name: "Behavioral Analytics & Financial Wellness", expectedDirection: "positive", rationale: "Banking shifted to digital-only relationships; behavioral signals became primary risk input" },
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
      { name: "Pricing Model Development & Predictive Underwriting", expectedDirection: "positive", rationale: "LLMs accelerated rate-table iteration + scenario testing across actuarial teams" },
      { name: "First Notice of Loss (FNOL) Intake", expectedDirection: "positive", rationale: "LLM-assisted intake cut FNOL processing time 30-50% at early adopters" },
      { name: "Behavioral Analytics & Financial Wellness", expectedDirection: "positive", rationale: "LLM-driven segmentation + intent inference made BI tools 5x faster" },
      { name: "Cloud Security & Compliance Automation", expectedDirection: "positive", rationale: "LLM-driven anomaly summarization + auto-runbook generation became standard in SOCs" },
      { name: "Credit Risk Modeling & Measurement", expectedDirection: "positive", rationale: "Banks added LLM-derived features (intent, narrative parsing) to risk scoring stacks" },
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
      { name: "Credit Risk Modeling & Measurement", expectedDirection: "negative", rationale: "Underwriting models for venture-backed clients rebuilt with much tighter loss assumptions" },
      { name: "Security & Compliance Engine", expectedDirection: "positive", rationale: "Renewed regulatory + counterparty risk scrutiny across all FIs" },
      { name: "API Security & Consent Management", expectedDirection: "positive", rationale: "Multi-bank cash-management deployments accelerated; API/consent stack got prioritized" },
      { name: "Behavioral Analytics & Financial Wellness", expectedDirection: "positive", rationale: "Mass deposit movement made customer-behavior signals immediate operational priority" },
      { name: "Security Architecture & Resilience", expectedDirection: "positive", rationale: "FedNow / OFAC-style operational resilience moved from compliance to board agenda" },
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
      { name: "Cloud Security & Compliance Automation", expectedDirection: "positive", rationale: "AI governance requires the same control plane — pulled in security/compliance budgets" },
      { name: "Security & Compliance Guardrails", expectedDirection: "positive", rationale: "AI guardrail tooling moved from optional to required for any Annex III use case" },
      { name: "Pricing Model Development & Predictive Underwriting", expectedDirection: "negative", rationale: "Insurance ML pricing fell under high-risk classification; conformity rebuilds required" },
      { name: "Regulatory Compliance & Data Governance Automation", expectedDirection: "positive", rationale: "Data-lineage + auditability became must-have rather than nice-to-have for AI users" },
      { name: "Analytics & Modeling Infrastructure", expectedDirection: "negative", rationale: "High-risk use cases added 6-12 months to deployment timelines; reduced experimentation velocity" },
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
      { name: "Inventory & Logistics Execution", expectedDirection: "negative", rationale: "Offshore-heavy networks took the full tariff hit on through-the-door cost" },
      { name: "Supply Chain Visibility & Control Tower", expectedDirection: "positive", rationale: "Real-time tariff-impact tracking + reroute decisions became operational priorities" },
      { name: "Supply Chain Compliance & Risk Management", expectedDirection: "positive", rationale: "Tariff classification + country-of-origin documentation jumped to critical-path" },
      { name: "Supply Chain Visibility & Risk Management", expectedDirection: "positive", rationale: "Retail importers built scenario-planning + multi-source vendor stacks to absorb shocks" },
      { name: "Order Fulfillment & Logistics Orchestration", expectedDirection: "negative", rationale: "Retail importers absorbed margin compression of 4-9 pts depending on category" },
      { name: "Supply Chain Sustainability Governance", expectedDirection: "negative", rationale: "Lower-cost short-haul sourcing displaced cleaner long-haul vendors in many categories" },
    ],
    description: "Universal 10% reciprocal tariffs plus higher per-country rates on specific exporters. Manufacturing PMI dropped 4.7 pts in Q2. Capabilities tied to localized supply networks gained; offshore-dependent ones lost.",
    citations: [
      "https://www.federalregister.gov/documents/2025/04/07/2025-05951/regulating-imports-with-a-reciprocal-tariff-to-rectify-trade-practices",
      "https://www.bea.gov/news/2025/gross-domestic-product-second-quarter-2025-advance-estimate",
    ],
  },
];

const router = Router();

router.post("/admin/seed/historical-events", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const existing = await db.select({ id: historicalEventsTable.id, title: historicalEventsTable.title }).from(historicalEventsTable);
    const idByTitle = new Map(existing.map((r) => [r.title, r.id]));
    let inserted = 0;
    let updated = 0;
    for (const e of EVENTS) {
      const values = {
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
      };
      const existingId = idByTitle.get(e.title);
      if (existingId) {
        await db.update(historicalEventsTable).set(values).where(eq(historicalEventsTable.id, existingId));
        updated++;
      } else {
        await db.insert(historicalEventsTable).values(values);
        inserted++;
      }
    }
    const finalCount = await db.select({ id: historicalEventsTable.id }).from(historicalEventsTable);
    res.json({ inserted, updated, total: finalCount.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
