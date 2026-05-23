/**
 * MiFID II → capability requirement mapping seed.
 *
 * Maps the EU Markets in Financial Instruments Directive II
 * (Directive 2014/65/EU + Regulation 600/2014 MiFIR) to Banking +
 * Insurance capabilities. Key obligation families:
 *   - Investor protection: suitability + appropriateness, product
 *     governance, costs and charges disclosure, inducement rules
 *   - Market structure: transparency (pre/post-trade), best execution,
 *     algorithmic + high-frequency trading controls
 *   - Transaction reporting (MiFIR Art. 26) + reference data (RTS 22)
 *   - Organizational: record-keeping (5 years), management body
 *     suitability, conflicts of interest, complaints handling
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index.
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── Banking (industry 3) — investment services scope ──
  // Suitability + appropriateness (Art. 25)
  {
    capabilitySlug: "wealth-advisory",
    requiredMaturity: 80,
    priority: "required",
    article: "MiFID II Art. 25 + RTS",
    evidenceNotes: "Suitability assessment for advised + portfolio-management services: client profile (knowledge, experience, financial situation, objectives, risk tolerance); written suitability statement.",
  },
  {
    capabilitySlug: "goal-based-financial-planning-modw1yja-e2",
    requiredMaturity: 75,
    priority: "required",
    article: "MiFID II Art. 24-25",
    evidenceNotes: "Goal-based financial planning supports the suitability framework — documented client objectives + risk tolerance drive product recommendations.",
  },
  {
    capabilitySlug: "behavioral-coaching-client-engagement-modw1yji-o8",
    requiredMaturity: 70,
    priority: "recommended",
    article: "MiFID II Art. 24(4) — costs + charges disclosure",
    evidenceNotes: "Client-engagement workflows surface costs + charges + impact-on-return disclosures ex-ante and ex-post, in a comprehensible aggregated form.",
  },

  // Product governance (Art. 16(3), 24(2))
  {
    capabilitySlug: "portfolio-construction-optimization-modw1yje-fa",
    requiredMaturity: 75,
    priority: "required",
    article: "MiFID II Art. 16(3), 24(2)",
    evidenceNotes: "Product governance: target-market identification, distribution strategy, ongoing review of financial instruments throughout their lifecycle.",
  },
  {
    capabilitySlug: "alternative-private-market-access-modw1yjq-oj",
    requiredMaturity: 70,
    priority: "required",
    article: "MiFID II Art. 24(11), Art. 25(4)",
    evidenceNotes: "Complex / non-standard products — additional disclosure obligations and target-market screening; restrictions on selling complex products without advice.",
  },

  // Best execution (Art. 27)
  {
    capabilitySlug: "transaction-routing-switching-modw1shi-ph",
    requiredMaturity: 75,
    priority: "required",
    article: "MiFID II Art. 27 + RTS 27/28",
    evidenceNotes: "Best-execution policy + monitoring: price, costs, speed, likelihood of execution + settlement, size, nature. Annual top-5 execution venues + quality reports.",
  },
  {
    capabilitySlug: "real-time-decisioning-scoring-modw192c-dp",
    requiredMaturity: 70,
    priority: "required",
    article: "MiFID II Art. 17 (algo + HFT)",
    evidenceNotes: "Algorithmic + HFT controls: pre-trade risk checks, kill-switch, throttling, market-making obligations where designated.",
  },

  // Transaction reporting (MiFIR Art. 26)
  {
    capabilitySlug: "transaction-monitoring-anomaly-detection-modw24yb-3b",
    requiredMaturity: 75,
    priority: "required",
    article: "MiFIR Art. 26 + RTS 22",
    evidenceNotes: "T+1 transaction reporting to competent authority covering 65 fields per RTS 22; data-quality controls; reconciliation against trading + position records.",
  },
  {
    capabilitySlug: "data-normalization-interoperability-modw2pak-ky",
    requiredMaturity: 70,
    priority: "required",
    article: "MiFIR Art. 26 + RTS 22",
    evidenceNotes: "Normalization to ESMA reporting schema; LEI capture for issuer + counterparty; instrument reference data via FIRDS / FITRS.",
  },

  // Record-keeping (Art. 16(6), RTS 6)
  {
    capabilitySlug: "compliance-fraud-risk-monitoring-modw1shx-3f",
    requiredMaturity: 75,
    priority: "required",
    article: "MiFID II Art. 16(6), 16(7), RTS 6",
    evidenceNotes: "5-year record-keeping (7 if requested) of all services + transactions including telephone + electronic communications; tamper-evident archiving with retrieval SLAs.",
  },

  // Conflicts of interest + organizational (Art. 16, 23)
  {
    capabilitySlug: "regulatory-compliance-risk-management-modw2eu1-jm",
    requiredMaturity: 75,
    priority: "required",
    article: "MiFID II Art. 16, 23",
    evidenceNotes: "Conflicts-of-interest policy + register; organisational requirements: management-body suitability, risk + compliance + internal audit independence.",
  },

  // ── Insurance (industry 1) — Insurance Distribution Directive (IDD) intersects with MiFID II for IBIPs ──
  {
    capabilitySlug: "agent-enablement",
    requiredMaturity: 70,
    priority: "required",
    article: "MiFID II Art. 24-25 (via IDD Art. 30 for IBIPs)",
    evidenceNotes: "Distribution of insurance-based investment products (IBIPs): suitability + appropriateness assessment, costs + charges disclosure, inducement rules.",
  },
  {
    capabilitySlug: "regulatory-compliance",
    requiredMaturity: 70,
    priority: "required",
    article: "IDD Art. 30 cross-reference to MiFID II",
    evidenceNotes: "Regulatory compliance workflows for IBIP distribution: target-market matching, training + competence of distributors, complaints handling.",
  },
  {
    capabilitySlug: "compliance-licensing-operations-modvzjnv-39",
    requiredMaturity: 70,
    priority: "required",
    article: "MiFID II Art. 16 + IDD Art. 10",
    evidenceNotes: "Licensing + continuing-education operations covering MiFID II / IDD requirements; record-keeping of training completion + product-specific competence.",
  },
];

proposeRequirements({
  regulationShortCode: "MIFID-II",
  proposedBy: "seed:mifid-ii-requirements",
  logLabel: "seed:mifid-ii-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:mifid-ii-reqs] fatal:", err);
    process.exit(1);
  });
