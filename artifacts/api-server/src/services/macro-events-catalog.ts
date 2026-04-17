import { db } from "@workspace/db";
import { industriesTable, capabilitiesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import type { EventType, SentimentDirection } from "./macro-events";

export interface CatalogTemplate {
  key: string;
  title: string;
  description: string;
  eventType: EventType;
  severity: number;
  sentimentDirection: SentimentDirection;
  decayDays: number;
  affectedIndustrySlugs: string[];
  affectedCapabilitySlugs: string[];
  rationale: string;
  citations?: string[];
}

export interface ResolvedCatalogTemplate extends Omit<CatalogTemplate, "affectedIndustrySlugs" | "affectedCapabilitySlugs"> {
  affectedIndustryIds: number[];
  affectedCapabilityIds: number[];
  affectedIndustryNames: string[];
  affectedCapabilityNames: string[];
  unresolvedSlugs: string[];
}

const CATALOG: CatalogTemplate[] = [
  {
    key: "eu-ai-act-enforcement-2026",
    title: "EU AI Act enforcement intensifies",
    description: "EU regulators begin levying penalties for high-risk AI systems lacking conformity assessments. Compliance overhead rises sharply for generative & agentic deployments.",
    eventType: "regulation",
    severity: 6,
    sentimentDirection: "negative",
    decayDays: 90,
    affectedIndustrySlugs: ["technology", "banking", "insurance"],
    affectedCapabilitySlugs: ["ai-ml-ops", "generative-ai-of-41", "agentic-ai-of-41", "regulatory-compliance", "credit-decisioning", "ai-native-underwriting-copilot-mo2qajy0"],
    rationale: "Regulation directly raises cost of deploying AI capabilities and slows velocity in regulated industries.",
    citations: ["https://artificialintelligenceact.eu/"],
  },
  {
    key: "us-china-chip-controls-q2-2026",
    title: "US tightens advanced semiconductor export controls",
    description: "New restrictions on HBM and advanced packaging exports disrupt AI hardware supply for non-allied buyers; cloud capex plans re-priced.",
    eventType: "regulation",
    severity: 7,
    sentimentDirection: "negative",
    decayDays: 60,
    affectedIndustrySlugs: ["technology", "manufacturing"],
    affectedCapabilitySlugs: ["cloud-infrastructure", "iaas-compute-of-42", "ai-ml-ops", "generative-ai-of-41", "supply-chain-mgmt", "supplier-risk-of-32"],
    rationale: "Constrains AI compute supply globally; raises cloud cost-per-token and slows model rollouts.",
  },
  {
    key: "ransomware-healthcare-wave-2026",
    title: "Healthcare ransomware wave (Q2 2026)",
    description: "Coordinated ransomware campaign targeting US/EU hospital systems disrupts revenue cycle and clinical scheduling; payer-provider data flows degraded.",
    eventType: "disaster",
    severity: 8,
    sentimentDirection: "negative",
    decayDays: 30,
    affectedIndustrySlugs: ["healthcare", "technology"],
    affectedCapabilitySlugs: ["telehealth", "revenue-cycle", "health-data-interop", "cybersecurity", "threat-detection-of-43", "iam-of-43"],
    rationale: "Forces emergency security investment and slows digital health rollouts; raises cybersecurity capability demand.",
  },
  {
    key: "real-time-payments-mandate-2026",
    title: "Real-time payments interoperability mandate",
    description: "Major economies move toward mandatory RTP/instant-payment interop. Card-rail dominance erodes; banks accelerate FedNow/SEPA-Instant rollouts.",
    eventType: "regulation",
    severity: 5,
    sentimentDirection: "positive",
    decayDays: 120,
    affectedIndustrySlugs: ["banking"],
    affectedCapabilitySlugs: ["payment-processing", "rtp-fednow-of-23", "card-acquiring-of-23", "open-banking", "payment-initiation-of-29"],
    rationale: "Unlocks growth in real-time payments capabilities; pressures legacy card processing.",
  },
  {
    key: "llm-inference-cost-collapse-2026",
    title: "LLM inference cost collapse (Q1 2026)",
    description: "Frontier LLM token costs drop ~50% as new chip generation + open-weight models hit production. Deployment economics improve across all enterprise AI.",
    eventType: "tech_shift",
    severity: 7,
    sentimentDirection: "positive",
    decayDays: 60,
    affectedIndustrySlugs: ["technology", "banking", "retail", "insurance", "healthcare"],
    affectedCapabilitySlugs: ["ai-ml-ops", "generative-ai-of-41", "agentic-ai-of-41", "nlp-speech-of-41", "personalization-retail", "product-recs-of-50", "ai-native-underwriting-copilot-mo2qajy0", "ai-triage-of-16"],
    rationale: "Lower costs accelerate generative/agentic deployments and downstream personalization.",
  },
  {
    key: "agentic-ai-breakout-2026",
    title: "Agentic AI breakout in enterprise workflows",
    description: "Multi-step autonomous agents move from pilot to production at scale across customer service, ops, and software engineering.",
    eventType: "tech_shift",
    severity: 8,
    sentimentDirection: "positive",
    decayDays: 90,
    affectedIndustrySlugs: ["technology", "banking", "retail", "insurance"],
    affectedCapabilitySlugs: ["agentic-ai-of-41", "developer-experience", "customer-success-tech", "customer-loyalty", "rapid-claims", "ai-native-underwriting-copilot-mo2qajy0"],
    rationale: "Major paradigm shift in how work is decomposed; agentic capability scores diverge sharply from generative.",
  },
  {
    key: "gen-ai-misinfo-incident-2026",
    title: "High-profile generative AI misinformation incident",
    description: "Public incident triggers backlash and emergency content-provenance regulation pressure on generative platforms.",
    eventType: "tech_shift",
    severity: 5,
    sentimentDirection: "negative",
    decayDays: 21,
    affectedIndustrySlugs: ["technology"],
    affectedCapabilitySlugs: ["generative-ai-of-41", "ai-ml-ops"],
    rationale: "Reputational drag on generative AI specifically; agentic less affected.",
  },
  {
    key: "russia-ukraine-prolonged-2026",
    title: "Russia-Ukraine conflict continues into 2026",
    description: "Sustained European energy & supply-chain disruption; defense spending elevated; manufacturing logistics rerouted.",
    eventType: "war",
    severity: 6,
    sentimentDirection: "negative",
    decayDays: 60,
    affectedIndustrySlugs: ["manufacturing", "banking", "technology"],
    affectedCapabilitySlugs: ["supply-chain-mgmt", "supplier-risk-of-32", "logistics-tracking-of-32", "cybersecurity", "threat-detection-of-43"],
    rationale: "Sustained pressure on European supply chains and elevated cyber threat posture.",
  },
  {
    key: "middle-east-shipping-disruption-2026",
    title: "Middle East shipping lane disruption",
    description: "Red Sea / Strait of Hormuz incidents force major reroutings; container rates spike; lead-times extend 10-20 days.",
    eventType: "war",
    severity: 6,
    sentimentDirection: "negative",
    decayDays: 45,
    affectedIndustrySlugs: ["manufacturing", "retail"],
    affectedCapabilitySlugs: ["supply-chain-mgmt", "logistics-tracking-of-32", "supplier-risk-of-32", "supply-chain-retail", "inventory-management-retail", "demand-forecasting-of-32"],
    rationale: "Direct hit on global logistics and retail inventory planning capabilities.",
  },
  {
    key: "taiwan-tensions-spike-2026",
    title: "Taiwan Strait tensions escalate",
    description: "Renewed PLA exercises near Taiwan raise semiconductor and high-end electronics supply risk; cloud hyperscalers update contingency plans.",
    eventType: "war",
    severity: 7,
    sentimentDirection: "negative",
    decayDays: 30,
    affectedIndustrySlugs: ["technology", "manufacturing"],
    affectedCapabilitySlugs: ["cloud-infrastructure", "iaas-compute-of-42", "supply-chain-mgmt", "supplier-risk-of-32", "ai-ml-ops"],
    rationale: "Concentrated risk to advanced semiconductor supply (TSMC) cascades into AI/cloud capacity.",
  },
  {
    key: "fed-rate-cuts-2026",
    title: "Federal Reserve cuts rates 50bps",
    description: "Cooling inflation prints prompt 50bp easing; capex cycle re-accelerates; banks reprice deposits.",
    eventType: "economic",
    severity: 4,
    sentimentDirection: "positive",
    decayDays: 60,
    affectedIndustrySlugs: ["banking", "insurance", "technology", "retail"],
    affectedCapabilitySlugs: ["credit-decisioning", "wealth-advisory", "core-banking", "actuarial-modeling", "personalization-retail"],
    rationale: "Lower rates broadly supportive of capability investment cycles.",
  },
  {
    key: "us-recession-warning-2026",
    title: "US recession warning signals trigger",
    description: "Inverted yield curve + jobs miss raise recession odds; consumer credit and discretionary retail under pressure.",
    eventType: "economic",
    severity: 6,
    sentimentDirection: "negative",
    decayDays: 90,
    affectedIndustrySlugs: ["banking", "retail", "insurance"],
    affectedCapabilitySlugs: ["credit-decisioning", "fraud-prevention-bank", "customer-loyalty", "omnichannel-experience", "rapid-claims"],
    rationale: "Recessionary pressure depresses growth-oriented capabilities; raises fraud/collections demand.",
  },
  {
    key: "glp1-supply-normalization-2026",
    title: "GLP-1 drug supply normalizes",
    description: "Manufacturing capacity catches up to GLP-1 demand; pharmacy benefit dynamics shift; remote weight-management programs scale.",
    eventType: "tech_shift",
    severity: 4,
    sentimentDirection: "positive",
    decayDays: 60,
    affectedIndustrySlugs: ["healthcare"],
    affectedCapabilitySlugs: ["telehealth", "rpm-of-16", "behavioral-telehealth-of-16", "population-health"],
    rationale: "Supply normalization unlocks digital chronic-care programs.",
  },
  {
    key: "stablecoin-regulation-clarity-2026",
    title: "US stablecoin regulation clarified",
    description: "Federal stablecoin framework passes; banks gain clear path to issue/operate stablecoins; on-chain settlement scales.",
    eventType: "regulation",
    severity: 5,
    sentimentDirection: "positive",
    decayDays: 120,
    affectedIndustrySlugs: ["banking"],
    affectedCapabilitySlugs: ["payment-processing", "crypto-settlement-of-23", "cross-border-of-23", "open-banking", "baas-platform-of-29"],
    rationale: "Regulatory clarity unlocks bank participation in stablecoin/crypto settlement rails.",
  },
  {
    key: "major-cloud-outage-2026",
    title: "Major hyperscaler multi-region outage",
    description: "Multi-hour outage at a top-3 cloud provider impacts payments, AI inference, retail e-commerce; multi-cloud and edge architectures revalued.",
    eventType: "disaster",
    severity: 7,
    sentimentDirection: "negative",
    decayDays: 14,
    affectedIndustrySlugs: ["technology", "banking", "retail"],
    affectedCapabilitySlugs: ["cloud-infrastructure", "iaas-compute-of-42", "multi-cloud-of-42", "edge-compute-of-42", "ecommerce-platform", "payment-processing"],
    rationale: "Sharp short-term hit; accelerates multi-cloud capability investment.",
  },
];

export function getCatalogRaw(): CatalogTemplate[] {
  return CATALOG;
}

export async function getResolvedCatalog(): Promise<ResolvedCatalogTemplate[]> {
  const allIndustrySlugs = Array.from(new Set(CATALOG.flatMap(t => t.affectedIndustrySlugs)));
  const allCapSlugs = Array.from(new Set(CATALOG.flatMap(t => t.affectedCapabilitySlugs)));

  const [industries, caps] = await Promise.all([
    allIndustrySlugs.length
      ? db.select().from(industriesTable).where(inArray(industriesTable.slug, allIndustrySlugs))
      : Promise.resolve([] as Array<{ id: number; slug: string; name: string }>),
    allCapSlugs.length
      ? db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.slug, allCapSlugs))
      : Promise.resolve([] as Array<{ id: number; slug: string; name: string }>),
  ]);

  const indBySlug = new Map(industries.map(i => [i.slug, i]));
  const capBySlug = new Map(caps.map(c => [c.slug, c]));

  return CATALOG.map(t => {
    const indMatches = t.affectedIndustrySlugs.map(s => indBySlug.get(s)).filter((x): x is { id: number; slug: string; name: string } => !!x);
    const capMatches = t.affectedCapabilitySlugs.map(s => capBySlug.get(s)).filter((x): x is { id: number; slug: string; name: string } => !!x);
    const unresolvedInd = t.affectedIndustrySlugs.filter(s => !indBySlug.has(s));
    const unresolvedCap = t.affectedCapabilitySlugs.filter(s => !capBySlug.has(s));
    return {
      key: t.key,
      title: t.title,
      description: t.description,
      eventType: t.eventType,
      severity: t.severity,
      sentimentDirection: t.sentimentDirection,
      decayDays: t.decayDays,
      rationale: t.rationale,
      citations: t.citations,
      affectedIndustryIds: indMatches.map(i => i.id),
      affectedCapabilityIds: capMatches.map(c => c.id),
      affectedIndustryNames: indMatches.map(i => i.name),
      affectedCapabilityNames: capMatches.map(c => c.name),
      unresolvedSlugs: [...unresolvedInd, ...unresolvedCap],
    };
  });
}
