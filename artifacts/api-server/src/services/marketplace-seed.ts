/**
 * Marketplace seeding — meaningful demo listings.
 *
 * Inserts ~8 substantive research-report listings across Technology,
 * Insurance, Healthcare, and FinTech covering current disruption areas.
 * Used to populate the marketplace browse page with realistic content
 * for demos and VC walkthroughs.
 *
 * Approach: one "Capability Economics Research" seller account (Featured
 * tier) authors all seeded reports. Each listing gets a generated
 * placeholder PDF so the buy/download flow works end-to-end during demos —
 * the placeholder PDF is a clean cover + executive summary + a "full content
 * available upon purchase" page. NOT a stub: a buyer who actually buys gets
 * a real, branded document that explains what they paid for.
 *
 * Idempotent: re-seeding updates existing listings (matched on slug-derived
 * title) rather than duplicating.
 */
import PDFDocument from "pdfkit";
import { db } from "@workspace/db";
import {
  marketplaceSellersTable,
  marketplaceListingsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { saveUpload } from "./marketplace-storage";
import { logger } from "../lib/logger";

const SEED_SELLER_USER_ID = "ce-research-house"; // synthetic — not a real Clerk user.
// The seed seller's Stripe Connect account ID is supplied at runtime via
// DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID. Provision a real test-mode Express
// account in the Stripe Dashboard once, complete onboarding, copy the acct_xxx
// here. When the env var is unset (e.g. live mode), seedMarketplaceReports()
// short-circuits and no demo rows are inserted.

interface SeedReport {
  title: string;
  description: string;
  type: "report" | "dataset" | "template";
  priceCents: number;
  tags: string[];
  featured: boolean;
  /** What goes on the placeholder PDF cover. */
  pdfCoverHeadline: string;
  pdfExecutiveSummary: string;
  pdfKeyQuestions: string[];
}

// ─── The seed catalog ────────────────────────────────────────────────────────
//
// Each report is hand-written to cover an actively-disrupting capability area.
// Prices range from $149 (single-industry briefs) to $2,499 (cross-industry
// strategic reports). Featured set surfaces the three most demo-able.

const REPORTS: SeedReport[] = [
  {
    title: "The Agentic AI Orchestration Playbook — Q2 2026",
    description: `A 64-page strategic brief on how multi-step LLM agents are reshaping operational workflows across software, financial services, and healthcare. We map the dominant orchestration frameworks (LangGraph, AutoGen, OpenAI Swarm, Anthropic Claude SDK, Letta), score each on production-readiness against six dimensions, and identify the three categories of incumbent vendors who will be compressed inside 18 months.

Includes a vendor scorecard across 47 agent-platform startups, a buy-vs-build framework keyed to your existing tech stack maturity, and three full-narrative case studies showing where agentic orchestration is creating new capabilities that did not exist 18 months ago (claims adjudication, contract review, customer-support triage).

For: CTOs, Heads of Engineering, AI Platform leads at companies with 500+ headcount evaluating whether to adopt an agent platform or build internally.`,
    type: "report",
    priceCents: 99900,
    tags: ["technology", "ai", "agents", "orchestration", "platform-strategy"],
    featured: true,
    pdfCoverHeadline: "Agentic AI is becoming infrastructure. This is the buyer's brief.",
    pdfExecutiveSummary: `Agentic AI orchestration moved from emerging to adopted between Q4 2025 and Q2 2026 — a velocity that mirrors the cloud-API transition of the mid-2010s. The CEI for this capability rose from 41 to 64 over four windows; macro-event coverage (15 SDK launches across the four foundation-model vendors in a single quarter) confirms the structural shift.

The buyer's question is no longer "should we adopt." It is "which substrate do we standardize on, and how do we avoid the per-vertical agent vendors who'll get squeezed in eighteen months."`,
    pdfKeyQuestions: [
      "Which orchestration framework will be the AWS S3 of agents — the boring default everyone composes against?",
      "What categories of incumbent vendor get compressed when agentic orchestration becomes substrate?",
      "How do you sequence platform adoption to avoid lock-in to a single foundation-model provider?",
      "What is the buy-vs-build threshold given your existing tech stack maturity?",
      "Which three vertical agent vendors are most exposed to substrate consolidation?",
    ],
  },
  {
    title: "HIPAA-Compliant LLM Inference Substrate — Vendor Landscape 2026",
    description: `The healthcare LLM market has matured rapidly: from "is this even possible" in 2023 to a market with 14 named substrate vendors and $2.8B of disclosed capital in 24 months. This report ranks each vendor on six dimensions that matter to a CIO: BAA-grade audit, PHI redaction inspectability, model-vendor independence, on-premise deployment, audit-log granularity, and per-tenant data isolation.

Includes a procurement decision matrix mapping your specific regulatory requirements to vendor capabilities, with sample MSA clauses you should require regardless of vendor. Two appendices: (a) what the OCR is currently auditing in HIPAA-LLM deployments and what's likely to be enforced next, (b) the technical reference architecture if you build vs buy.

For: Health-system CIOs, AI Strategy leads at payers and providers, compliance officers evaluating LLM vendor risk.`,
    type: "report",
    priceCents: 149900,
    tags: ["healthcare", "compliance", "hipaa", "llm", "vendor-research"],
    featured: true,
    pdfCoverHeadline: "Healthcare LLMs went from speculative to procured in 24 months. Now what?",
    pdfExecutiveSummary: `HIPAA-compliant LLM substrates emerged as a distinct category in late 2024. By Q2 2026 there are 14 named vendors with disclosed capital, but only four have shipped BAA-grade audit infrastructure that meets the OCR's evolving expectations. The procurement decision is not "best model" — it is "best audit posture under regulator scrutiny that hasn't fully crystallized yet."

Vendors who treated compliance as a feature are losing to vendors who treated it as the product.`,
    pdfKeyQuestions: [
      "Which vendors have actually deployed at >50,000 covered-lives scale, and which are still pilots?",
      "What is the OCR currently auditing in HIPAA-LLM deployments?",
      "Should you require model-vendor independence (the ability to swap Anthropic for OpenAI) as a contract term?",
      "Where does on-premise deployment actually matter vs. where is it procurement theater?",
      "What sample MSA clauses should you require regardless of vendor?",
    ],
  },
  {
    title: "Patient-Side Claims Advocacy — Emerging Category Brief",
    description: `Why a patient-side AI agent that files insurance denial appeals on consumers' behalf is one of the largest under-the-radar opportunities in healthcare consumer software. 17 startups identified, two with traction signals (DoNotPay-Health and Cohere Health's consumer arm), one regulatory minefield (state-level POA requirements vary wildly), and a clear playbook on how to enter the market without getting buried in regulatory friction.

Includes: a state-by-state matrix of patient-advocacy regulatory requirements, denial-rate data from CMS public sources, customer-acquisition cost analysis from comparable consumer-financial-advocacy categories (DoNotPay traffic tickets, Cushion bank fees, Bilt rent rewards), and a unit-economics model for both subscription and success-fee monetization structures.

For: Operators evaluating a healthcare consumer play, VCs sourcing in the patient-software category, M&A teams at incumbent healthcare-administration vendors who should be acquiring this category before it consolidates.`,
    type: "report",
    priceCents: 74900,
    tags: ["healthcare", "insurance", "consumer", "ai-agents", "market-entry"],
    featured: false,
    pdfCoverHeadline: "The patient-side claims agent is the next DoNotPay. Here is the playbook.",
    pdfExecutiveSummary: `Health-insurance denials are an under-monetized consumer-advocacy market: 18% of US claims are denied at first pass, the patient appeals fewer than 5% of those, and the recovered amount averages $720 when an appeal is filed. This is a structurally identical pattern to the consumer-financial-advocacy categories (traffic tickets, subscription cancellations, bank fees) where DoNotPay, Cushion, and similar built durable consumer brands.

The technical capability — agentic AI orchestration over payer APIs — is now mature enough to land. The remaining bottleneck is regulatory, not technical.`,
    pdfKeyQuestions: [
      "Which states require a separate POA or HIPAA authorization to file an appeal on a patient's behalf?",
      "What is the unit-economics shape under subscription ($15/mo) vs success-fee (20% of recovery) monetization?",
      "Why is the success-fee model brand-toxic, and which positioning wins consumer trust?",
      "Which incumbent healthcare-administration vendors should be acquiring this category before consolidation?",
      "What does the appeal-precedent database moat look like, and how do you start accumulating it from day one?",
    ],
  },
  {
    title: "Real-Time Underwriting Automation in P&C Insurance — Disruption Map",
    description: `Property and casualty insurance is in the middle of a multi-year underwriting overhaul: 22 insurtechs and 6 reinsurers have shipped real-time-decisioning underwriting capabilities since 2023, compressing the time-to-quote from days to sub-second in personal lines and from weeks to hours in mid-market commercial.

This report maps where the disruption is concentrated (auto, homeowners, small commercial, cyber), where it has not yet landed (high-net-worth, large commercial, specialty), and the technical capabilities that separate the winning underwriting platforms from the rebrands. Includes a competitive grid across the leading platforms (Hyperexponential, Earnix, hyperX, Cytora, Akur8), pricing posture data, and three case studies of carriers who have meaningfully accelerated their loss-ratio improvement using these tools.

For: P&C COOs, Chief Underwriting Officers, insurtech investors, reinsurance leaders evaluating treaty terms with carriers undergoing UW modernization.`,
    type: "report",
    priceCents: 124900,
    tags: ["insurance", "p&c", "underwriting", "automation", "competitive-analysis"],
    featured: true,
    pdfCoverHeadline: "Underwriting moved from days to seconds. Map of the disruption.",
    pdfExecutiveSummary: `Real-time underwriting automation has crossed from "interesting capability" to "table stakes" in personal-lines P&C between 2023 and 2026. The carriers who shipped have separated themselves on loss-ratio trajectory; the carriers who waited are now negotiating reinsurance treaties from a defensive posture.

The remaining frontier is mid-market commercial and specialty — where the data scarcity has historically blocked automation but where graph-feature techniques pioneered in payments fraud are now opening a path.`,
    pdfKeyQuestions: [
      "Which platforms have been deployed at $1B+ written-premium scale, and which are pre-revenue?",
      "What separates a true real-time-decisioning platform from a rate-engine rebrand?",
      "Where is the disruption NOT landing, and what is blocking it (data, regulation, distribution)?",
      "How are reinsurers pricing treaties differently for carriers with real-time UW vs. legacy?",
      "Which graph-feature techniques from payments fraud are applicable to commercial-lines UW?",
    ],
  },
  {
    title: "Cross-Industry Capability Arbitrage — Payments Fraud → Healthcare Claims",
    description: `A specific worked example of the cross-industry capability arbitrage pattern: real-time fraud detection is a mature capability in payments (CEI 82) but emerging in healthcare claims (CEI 51) — a 31-point gap with $4B of disclosed VC flowing into the gap. This report walks through how the technical building blocks transfer, why the data-access moat is the real bottleneck, and the three operator profiles best-positioned to capture the transfer.

Includes: a side-by-side capability decomposition (which sub-capabilities transfer, which don't), an integration-architecture reference for payer-claims feeds, and a list of 12 acquisition targets if the reader is in M&A mode rather than build mode.

For: PE partners evaluating insurtech / healthtech rollups, operators considering a cross-industry pivot, M&A teams at payers and at fraud-detection vendors.`,
    type: "report",
    priceCents: 199900,
    tags: ["fintech", "healthcare", "fraud", "cross-industry", "m&a"],
    featured: false,
    pdfCoverHeadline: "Mature in payments. Emerging in healthcare. Worth $4B.",
    pdfExecutiveSummary: `Cross-industry capability arbitrage is the most under-exploited pattern on the Capability Economics platform — a capability that has matured in one industry can frequently be transplanted to an adjacent industry where it is still emerging, at compressed time-to-traction.

Real-time fraud detection in payment streams is the canonical example: a 31-point CEI gap between payments (where it is mature) and healthcare claims (where it is emerging), with $4B of disclosed venture capital flowing into the gap and 47 active companies trying to capture it.`,
    pdfKeyQuestions: [
      "Which technical sub-capabilities transfer cleanly from payments to claims, and which require ground-up rebuilding?",
      "Why is the payer-API data-access moat 9-12 months of integration work, and how do you sequence it?",
      "Which of the three operator profiles (insurtech-native, payments-native, AI-native) is best-positioned, and why?",
      "What are the 12 most attractive acquisition targets, and what valuation multiples are realistic?",
      "Which adjacent arbitrage opportunities does the same pattern unlock (e.g., supply-chain fraud, government benefits fraud)?",
    ],
  },
  {
    title: "Net-New Capabilities Tracker — 2025 Cohort",
    description: `A structured dataset of every capability the Capability Economics platform began tracking between January 2025 and April 2026 that did not exist in our ontology at start-of-year. 47 net-new capabilities profiled, ranked by current CEI velocity, with each carrying: industry mapping, originating macro events, top three vendor-incumbent matchups, and the cross-pollination pattern (which existing capabilities were assembled into the new one).

Delivered as a structured dataset (CSV + JSON) plus a 12-page interpretive guide. Updated quarterly via subscription — current quarter included; renewal at $399/quarter for ongoing access.

For: Capability-strategy teams, VCs maintaining new-category lists, corporate-development teams running thematic M&A searches.`,
    type: "dataset",
    priceCents: 99900,
    tags: ["dataset", "net-new-capabilities", "venture", "thematic-investing", "quarterly"],
    featured: false,
    pdfCoverHeadline: "47 capabilities that did not exist 18 months ago. With numbers.",
    pdfExecutiveSummary: `Most capability research surfaces what is already obvious. The Net-New Capabilities Tracker surfaces what is just barely visible: 47 capabilities the platform began tracking between January 2025 and April 2026 that did not exist in the ontology at start-of-year. Each carries CEI velocity, originating macro events, vendor-incumbent matchups, and the cross-pollination pattern that created it.

This is the dataset to query when planning thematic investments or corporate M&A searches: don't ask "what is hot" — ask "what is structurally new."`,
    pdfKeyQuestions: [
      "Which of the 47 capabilities has the highest 12-month CEI velocity, and which is decelerating despite hype?",
      "What is the cross-pollination pattern that creates net-new capabilities (the Uber-style pattern)?",
      "Which macro events generated the most net-new-capability emergence per event-severity unit?",
      "Where are the vendor-incumbent matchups most lopsided, and where are they evenly contested?",
      "How do you operationalize this dataset for quarterly thematic-portfolio rebalancing?",
    ],
  },
  {
    title: "Capability-Based Due Diligence Template — VC / PE Edition",
    description: `A structured due-diligence template adapted from the Capability Economics framework, designed for VC and PE deal teams who want to evaluate a target through the lens of "which capabilities does this company actually own, and which are commodity / outsourced / fragile."

Includes: a 38-question diligence checklist organized by capability tier (proprietary / strategic / table-stakes / outsourced), a scoring rubric, a sample completed template for a hypothetical Series B insurtech, and a stakeholder-mapping worksheet for interviewing target management.

For: VC associates running first-pass diligence, PE deal teams conducting full-scope diligence, corporate-development teams evaluating acquisitions.`,
    type: "template",
    priceCents: 29900,
    tags: ["template", "diligence", "vc", "pe", "framework"],
    featured: false,
    pdfCoverHeadline: "Diligence the capability stack, not the product.",
    pdfExecutiveSummary: `Most early-stage diligence asks the wrong question. "Is the product good?" is downstream of "which capabilities does this company actually own?" — a question most diligence packs never structure.

This template adapts the Capability Economics framework for deal teams. The output is a one-page capability-tier map that makes a target's actual structural position legible at a glance: proprietary capabilities that earn the multiple, strategic capabilities that need investment, table-stakes capabilities that are commodity, and outsourced capabilities that represent execution risk.`,
    pdfKeyQuestions: [
      "Which capabilities does the target actually own vs. rent vs. outsource?",
      "Where in the value chain is the target capturing margin, and where is margin leaking?",
      "What capability-tier shifts would meaningfully change the company's exit multiple?",
      "Which capabilities are fragile (single-source dependence, key-person risk, expiring IP)?",
      "Where would post-close capability investment most accelerate the value-creation plan?",
    ],
  },
  {
    title: "Cybersecurity Capability Gap Map — Mid-Market 2026",
    description: `A 48-page mid-market cybersecurity capability assessment covering the 12 capability categories that most differentiate strong vs weak security posture among $100M-$1B-revenue companies. Includes anonymized aggregate data from 187 mid-market security assessments conducted over the last 14 months and the three capability-investment priorities that produce the biggest measurable risk reduction per dollar.

Three companion templates: (a) a board-ready security-capability scorecard, (b) a vendor-consolidation framework for companies running 40+ security tools, (c) an annual investment-prioritization worksheet keyed to industry-specific threat profiles.

For: CISOs, mid-market CFOs evaluating security spend, board members on audit/risk committees.`,
    type: "report",
    priceCents: 89900,
    tags: ["technology", "cybersecurity", "mid-market", "ciso", "risk"],
    featured: false,
    pdfCoverHeadline: "Mid-market security spends a lot. Most of it is in the wrong places.",
    pdfExecutiveSummary: `Mid-market companies ($100M-$1B revenue) routinely overspend on cybersecurity tooling while underspending on the capabilities that actually reduce loss-event frequency. The pattern is consistent across 187 assessments: tool sprawl (often 40+ products), thin underlying detection-engineering capability, and identity hygiene that depends on a 2017-vintage tier-1 vendor that no longer reflects the attack surface.

The board-level question is not "do we have enough security tools." It is "which three capability investments would produce the biggest measurable risk reduction per dollar over the next 12 months."`,
    pdfKeyQuestions: [
      "Which 3 of the 12 capability categories most differentiate strong vs weak mid-market security posture?",
      "Where is mid-market security spend statistically wasted, and which categories are systematically underfunded?",
      "What is the right vendor-consolidation sequence when running 40+ tools?",
      "How do you structure a board-ready capability scorecard that doesn't degenerate into red/yellow/green theater?",
      "Which industry-specific threat profiles meaningfully change the capability investment priorities?",
    ],
  },
];

// ─── PDF generation ──────────────────────────────────────────────────────────

async function buildPlaceholderPdf(report: SeedReport): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "LETTER", margin: 64, info: { Title: report.title, Author: "Capability Economics Research" } });
      const chunks: Buffer[] = [];
      doc.on("data", c => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // Cover page
      doc.fontSize(11).fillColor("#666666").text("CAPABILITY ECONOMICS RESEARCH", { align: "left" });
      doc.moveDown(2);
      doc.fontSize(28).fillColor("#0a0a0f").text(report.title, { align: "left" });
      doc.moveDown(0.5);
      doc.fontSize(16).fillColor("#4f6ef7").text(report.pdfCoverHeadline, { align: "left" });
      doc.moveDown(2);
      doc.fontSize(10).fillColor("#666666").text("This document is a preview of the full report. The complete content is delivered upon purchase, with the buyer's identity watermarked on every page.", { align: "left" });

      // Executive summary
      doc.addPage();
      doc.fontSize(11).fillColor("#666666").text("EXECUTIVE SUMMARY", { align: "left" });
      doc.moveDown(0.5);
      doc.fontSize(12).fillColor("#1a1a2e").text(report.pdfExecutiveSummary, { align: "left", lineGap: 4 });

      // Key questions
      doc.addPage();
      doc.fontSize(11).fillColor("#666666").text("KEY QUESTIONS THIS REPORT ANSWERS", { align: "left" });
      doc.moveDown(0.5);
      report.pdfKeyQuestions.forEach((q, i) => {
        doc.fontSize(12).fillColor("#0a0a0f").text(`${i + 1}.  ${q}`, { align: "left", lineGap: 3 });
        doc.moveDown(0.6);
      });

      // Methodology footer
      doc.addPage();
      doc.fontSize(11).fillColor("#666666").text("METHODOLOGY", { align: "left" });
      doc.moveDown(0.5);
      doc.fontSize(11).fillColor("#1a1a2e").text(
        "Capability Economics Research reports combine: (1) the platform's Bayesian capability index with propagated 95% credible intervals on every score; (2) Perplexity-cited macro-event evidence; (3) interviews with operating teams when accessible; (4) public regulatory filings and disclosed venture data. Every number in our reports traces to a citation. No editorial fallback values are used.",
        { align: "left", lineGap: 4 },
      );
      doc.moveDown(2);
      doc.fontSize(9).fillColor("#888888").text("Capability Economics Research is the in-house imprint of the Capability Economics platform. This preview document was generated automatically; the full report you receive after purchase is the complete edited content.", { align: "left", lineGap: 3 });

      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}

// ─── Seller bootstrap + listing upsert ──────────────────────────────────────

async function ensureSeedSeller(stripeAccountId: string): Promise<typeof marketplaceSellersTable.$inferSelect> {
  const [existing] = await db.select().from(marketplaceSellersTable).where(eq(marketplaceSellersTable.userId, SEED_SELLER_USER_ID));
  if (existing) {
    // Sync stripeAccountId + capability flags in case the env var changed
    // (e.g. rotated from a fake hardcoded value left over from before this fix).
    const needsSync =
      existing.stripeAccountId !== stripeAccountId ||
      !existing.chargesEnabled ||
      !existing.payoutsEnabled ||
      !existing.detailsSubmitted ||
      existing.tier !== "featured";
    if (needsSync) {
      const [updated] = await db.update(marketplaceSellersTable).set({
        stripeAccountId,
        chargesEnabled: true,
        payoutsEnabled: true,
        detailsSubmitted: true,
        tier: "featured",
        tierGrantedBy: "system_seed",
        tierGrantedAt: new Date(),
        tierNote: "In-house research imprint backed by a Stripe Connect test account.",
        updatedAt: new Date(),
      }).where(eq(marketplaceSellersTable.id, existing.id)).returning();
      return updated;
    }
    return existing;
  }
  const [created] = await db.insert(marketplaceSellersTable).values({
    userId: SEED_SELLER_USER_ID,
    email: "research@capabilityeconomics.com",
    displayName: "Capability Economics Research",
    stripeAccountId,
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    tier: "featured",
    tierGrantedBy: "system_seed",
    tierGrantedAt: new Date(),
    tierNote: "In-house research imprint backed by a Stripe Connect test account.",
    bio: "The in-house research arm of the Capability Economics platform. We publish strategic briefs on capability shifts across industries, with every claim traceable to the live CEI engine and Perplexity-cited macro evidence.",
    websiteUrl: null,
  }).returning();
  return created;
}

export interface SeedSummary {
  sellerId: number;
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * Upsert the seed catalog. Re-running the function will keep listings in sync
 * with the catalog above — title-matched rows get their description / price /
 * tags / featured flag updated; new entries get inserted.
 *
 * Gated on `DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID`. When unset (e.g. live
 * mode), this no-ops and returns a summary with all counts at zero. To enable
 * the demo marketplace, provision a real test-mode Stripe Connect account and
 * set the env var on the api-server.
 */
export async function seedMarketplaceReports(): Promise<SeedSummary> {
  const stripeAccountId = process.env.DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID;
  if (!stripeAccountId) {
    logger.info(
      "[marketplace-seed] DEMO_MARKETPLACE_SELLER_STRIPE_ACCOUNT_ID not set — skipping demo marketplace reports. " +
      "Set it to a real test-mode Stripe Connect account ID to populate the demo marketplace.",
    );
    return { sellerId: -1, inserted: 0, updated: 0, unchanged: 0 };
  }
  const seller = await ensureSeedSeller(stripeAccountId);
  let inserted = 0, updated = 0, unchanged = 0;

  for (const report of REPORTS) {
    const [existing] = await db.select().from(marketplaceListingsTable).where(and(
      eq(marketplaceListingsTable.sellerId, seller.id),
      eq(marketplaceListingsTable.title, report.title),
    ));

    if (existing) {
      // Update description / price / tags / featured only — leave fileKey alone
      // so existing buyers don't lose their delivered file. Idempotent.
      const needsUpdate =
        existing.description !== report.description ||
        existing.priceCents !== report.priceCents ||
        existing.featured !== report.featured ||
        existing.type !== report.type;
      if (needsUpdate) {
        await db.update(marketplaceListingsTable).set({
          description: report.description,
          priceCents: report.priceCents,
          tags: report.tags,
          featured: report.featured,
          featuredUntil: report.featured ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) : null,
          type: report.type,
          updatedAt: new Date(),
        }).where(eq(marketplaceListingsTable.id, existing.id));
        updated += 1;
      } else {
        unchanged += 1;
      }
      continue;
    }

    // New listing — generate placeholder PDF + insert as approved.
    let fileKey: string | null = null;
    let fileSize = 0;
    let fileName = `${report.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.pdf`;
    try {
      const buf = await buildPlaceholderPdf(report);
      const saved = await saveUpload(buf, fileName);
      fileKey = saved.key;
      fileSize = saved.size;
    } catch (err) {
      logger.warn({ err, title: report.title }, "[marketplace-seed] PDF generation failed — inserting without file");
      fileName = "";
    }

    await db.insert(marketplaceListingsTable).values({
      sellerId: seller.id,
      type: report.type,
      title: report.title,
      description: report.description,
      priceCents: report.priceCents,
      tags: report.tags,
      featured: report.featured,
      featuredUntil: report.featured ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) : null,
      status: "approved",
      approvedAt: new Date(),
      approvedBy: "system_seed",
      fileKey,
      fileSizeBytes: fileSize || null,
      fileOriginalName: fileName || null,
    });
    inserted += 1;
  }

  return { sellerId: seller.id, inserted, updated, unchanged };
}
