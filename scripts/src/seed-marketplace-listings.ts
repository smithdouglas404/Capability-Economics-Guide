import { db, marketplaceSellersTable, marketplaceListingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const SEED_SELLER_USER_ID = "seed_platform_seller";
const SEED_SELLER_DISPLAY_NAME = "Capability Economics Research";
const SEED_SELLER_EMAIL = "research@capability-economics.com";

const day = 24 * 60 * 60 * 1000;
const daysFromNow = (n: number) => new Date(Date.now() + n * day);

type SeedListing = {
  type: "report" | "service" | "template";
  title: string;
  description: string;
  priceCents: number;
  tags: string[];
  expiresInDays: number | null; // null = open-ended
};

const LISTINGS: SeedListing[] = [
  // ───────── Technology ─────────
  {
    type: "report",
    title: "State of Generative AI in Enterprise: 2026 Adoption Benchmarks",
    description: "A 60-page benchmark report on GenAI deployment across 240 enterprises. Includes cost-per-token analysis by workload, build-vs-buy decision frameworks, and adoption curves segmented by sector and company size. Authored by the Capability Economics research team.",
    priceCents: 14900,
    tags: ["technology", "ai", "benchmark", "2026"],
    expiresInDays: 30,
  },
  {
    type: "template",
    title: "Zero Trust Architecture Implementation Playbook",
    description: "Step-by-step playbook for migrating from perimeter-based security to zero trust. Includes vendor-agnostic reference architecture, identity provider migration checklist, network segmentation worksheet, and a 90-day rollout calendar.",
    priceCents: 8900,
    tags: ["technology", "security", "playbook"],
    expiresInDays: null,
  },
  {
    type: "report",
    title: "Kubernetes Cost Optimization: Multi-Cloud Benchmarks",
    description: "Benchmark study covering 80 production K8s clusters across AWS, GCP, and Azure. Quantifies the cost impact of right-sizing, spot/preemptible mix, autoscaler tuning, and cluster consolidation. Includes a calculator spreadsheet.",
    priceCents: 19900,
    tags: ["technology", "cloud", "kubernetes", "cost"],
    expiresInDays: 30,
  },
  {
    type: "template",
    title: "AI Vendor Due Diligence Checklist",
    description: "120-point checklist for evaluating AI/ML vendors covering model provenance, data residency, eval methodology, hallucination guardrails, SOC 2 + ISO 42001 readiness, and contract red-flags. Updated for the EU AI Act.",
    priceCents: 4900,
    tags: ["technology", "ai", "procurement", "checklist"],
    expiresInDays: null,
  },
  {
    type: "report",
    title: "Semiconductor Supply Chain Risk Assessment, Q2 2026",
    description: "Time-sensitive analysis of fabrication capacity, geopolitical pressure points, and lead-time forecasts across leading-edge and mature nodes. Includes a vendor-concentration heatmap and three demand scenarios.",
    priceCents: 34900,
    tags: ["technology", "supply-chain", "semiconductors", "q2-2026"],
    expiresInDays: 14,
  },

  // ───────── Insurance ─────────
  {
    type: "report",
    title: "P&C Reserving Methodologies: Actuarial Deep Dive",
    description: "Comparative analysis of chain-ladder, Bornhuetter-Ferguson, Cape Cod, and ML-augmented reserving methods across long-tail lines. Includes worked examples in Python and a reproducible Jupyter notebook.",
    priceCents: 24900,
    tags: ["insurance", "actuarial", "p&c"],
    expiresInDays: null,
  },
  {
    type: "report",
    title: "Climate Risk Underwriting Framework 2026",
    description: "End-to-end framework for incorporating physical and transition climate risk into property and casualty underwriting decisions. Covers RCP scenario selection, peril modeling vendors, and reinsurance treaty implications.",
    priceCents: 29900,
    tags: ["insurance", "climate", "underwriting", "esg"],
    expiresInDays: 45,
  },
  {
    type: "report",
    title: "Cyber Insurance Policy Benchmarking Study",
    description: "Benchmark of 40 cyber policies across mid-market and enterprise segments. Compares sub-limits, war/exclusion clauses, retention thresholds, and ransom-payment provisions. Includes negotiation talking points.",
    priceCents: 17900,
    tags: ["insurance", "cyber", "benchmark"],
    expiresInDays: 30,
  },
  {
    type: "template",
    title: "Claims Fraud Detection ML Model Templates",
    description: "Production-ready model templates (XGBoost + isolation forests) for first-notice-of-loss anomaly detection, with feature engineering recipes for auto, workers comp, and homeowners. Includes drift monitoring config.",
    priceCents: 39900,
    tags: ["insurance", "fraud", "ml", "claims"],
    expiresInDays: null,
  },
  {
    type: "template",
    title: "Embedded Insurance Go-to-Market Playbook",
    description: "Playbook for launching embedded insurance through merchant partners and fintech platforms. Covers API surface design, regulatory wrappers (MGA vs broker), partner economics, and a 6-month launch sequence.",
    priceCents: 19900,
    tags: ["insurance", "embedded", "go-to-market"],
    expiresInDays: null,
  },

  // ───────── Healthcare ─────────
  {
    type: "template",
    title: "Value-Based Care Contract Structuring Guide",
    description: "Reference contract templates for shared-savings, full-capitation, and bundled-payment arrangements. Includes risk-adjustment methodology, attribution rules, and quality-gate worksheet aligned with current CMS models.",
    priceCents: 24900,
    tags: ["healthcare", "value-based-care", "contracts"],
    expiresInDays: null,
  },
  {
    type: "report",
    title: "Post-Pandemic Telehealth Utilization Trends 2026",
    description: "Analysis of telehealth utilization across 1.2M visits since the public health emergency unwind. Segments by specialty, payer mix, and demographics. Identifies which use cases are sticky vs reverting to in-person care.",
    priceCents: 14900,
    tags: ["healthcare", "telehealth", "utilization"],
    expiresInDays: 30,
  },
  {
    type: "report",
    title: "Medical Device FDA Approval Pathways: Comparative Analysis",
    description: "Side-by-side comparison of 510(k), De Novo, PMA, and Breakthrough Device pathways. Includes timeline benchmarks, predicate-search strategy, and case studies of recent SaMD (Software as a Medical Device) approvals.",
    priceCents: 29900,
    tags: ["healthcare", "regulatory", "fda", "medical-devices"],
    expiresInDays: null,
  },
  {
    type: "report",
    title: "Hospital Revenue Cycle Benchmarking, Q1 2026",
    description: "Benchmarks across 95 health systems on clean-claim rate, days-in-A/R, denial rate, write-off percentage, and cost-to-collect. Includes breakouts for academic medical centers, community hospitals, and critical-access facilities.",
    priceCents: 18900,
    tags: ["healthcare", "revenue-cycle", "benchmark", "q1-2026"],
    expiresInDays: 45,
  },
  {
    type: "report",
    title: "GLP-1 Market Forecast: Payer Impact Analysis",
    description: "Five-year forecast of GLP-1 utilization, prior-auth dynamics, and net-cost impact across commercial, Medicare, and Medicaid books. Includes sensitivity analysis for generics, oral formulations, and obesity-coverage mandates.",
    priceCents: 39900,
    tags: ["healthcare", "pharma", "glp-1", "forecast"],
    expiresInDays: 30,
  },
];

async function seedMarketplaceListings() {
  // The seed seller's Stripe Connect account ID must be a real test-mode acct_xxx
  // that has completed Stripe Express onboarding. Provision once in Stripe
  // Dashboard, set as DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID on the api-server.
  // When unset (e.g. live mode), this seed no-ops — the marketplace starts empty.
  const stripeAccountId = process.env.DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID;
  if (!stripeAccountId) {
    console.log(
      "[seed] DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID not set — skipping demo marketplace listings. " +
      "Set it to a real test-mode Stripe Connect account ID to populate the demo marketplace.",
    );
    return;
  }

  const [existingSeller] = await db
    .select()
    .from(marketplaceSellersTable)
    .where(eq(marketplaceSellersTable.userId, SEED_SELLER_USER_ID));

  let sellerId: number;
  if (existingSeller) {
    sellerId = existingSeller.id;
    // Sync Stripe account ID in case env var changed (e.g. rotated from a fake
    // hardcoded value left over from before this fix).
    if (
      existingSeller.stripeAccountId !== stripeAccountId ||
      !existingSeller.chargesEnabled ||
      !existingSeller.payoutsEnabled
    ) {
      await db.update(marketplaceSellersTable).set({
        stripeAccountId,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        email: SEED_SELLER_EMAIL,
        updatedAt: new Date(),
      }).where(eq(marketplaceSellersTable.id, sellerId));
      console.log(`[seed] Updated existing seed seller (id=${sellerId}) Stripe account → ${stripeAccountId}`);
    } else {
      console.log(`[seed] Reusing existing seed seller (id=${sellerId})`);
    }
  } else {
    const [created] = await db.insert(marketplaceSellersTable).values({
      userId: SEED_SELLER_USER_ID,
      email: SEED_SELLER_EMAIL,
      displayName: SEED_SELLER_DISPLAY_NAME,
      stripeAccountId,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    }).returning();
    sellerId = created.id;
    console.log(`[seed] Created seed seller (id=${sellerId})`);
  }

  const existingTitles = new Set(
    (await db
      .select({ title: marketplaceListingsTable.title })
      .from(marketplaceListingsTable)
      .where(eq(marketplaceListingsTable.sellerId, sellerId))
    ).map(r => r.title)
  );

  const now = new Date();
  const toInsert = LISTINGS
    .filter(l => !existingTitles.has(l.title))
    .map(l => ({
      sellerId,
      type: l.type,
      title: l.title,
      description: l.description,
      priceCents: l.priceCents,
      tags: l.tags,
      status: "approved" as const,
      approvedBy: "seed",
      approvedAt: now,
      expiresAt: l.expiresInDays === null ? null : daysFromNow(l.expiresInDays),
    }));

  if (toInsert.length === 0) {
    console.log("[seed] All seed listings already present — nothing to insert.");
    return;
  }

  const inserted = await db.insert(marketplaceListingsTable).values(toInsert).returning({ id: marketplaceListingsTable.id, title: marketplaceListingsTable.title });
  console.log(`[seed] Inserted ${inserted.length} marketplace listing(s):`);
  for (const r of inserted) console.log(`  - #${r.id}: ${r.title}`);
}

seedMarketplaceListings()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
