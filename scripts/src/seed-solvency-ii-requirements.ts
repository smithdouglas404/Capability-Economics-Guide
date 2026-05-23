/**
 * Solvency II → capability requirement mapping seed.
 *
 * Maps the EU Solvency II framework (Directive 2009/138/EC, as amended)
 * to Insurance capabilities. Three pillars:
 *   1. Quantitative capital requirements — SCR (99.5% VaR / 1-year)
 *      and MCR; standard formula or partial/full internal model
 *   2. Qualitative requirements — system of governance, ORSA, fit +
 *      proper, key functions (risk management, compliance, actuarial,
 *      internal audit), prudent person principle
 *   3. Supervisory reporting + public disclosure — RSR, QRTs, SFCR
 *
 * Solvency II Review (2024 EU amendments) introduces proportionality
 * tweaks, sustainability risk integration, and revised long-term
 * guarantee measures.
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index.
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── Pillar 1 — Quantitative capital requirements ──
  // SCR computation (standard formula + internal models)
  {
    capabilitySlug: "solvency-capital-requirements-modvz7yb-r4",
    requiredMaturity: 85,
    priority: "required",
    article: "Solvency II Art. 100-127 (SCR + MCR)",
    evidenceNotes: "Solvency Capital Requirement (99.5% VaR / 1-year) and Minimum Capital Requirement; standard formula or approved internal model; daily monitoring with reporting at year-end.",
  },
  // Technical provisions (Best Estimate + Risk Margin)
  {
    capabilitySlug: "premium-reserving-liability-valuation-modvyret-ec",
    requiredMaturity: 80,
    priority: "required",
    article: "Solvency II Art. 76-86 (technical provisions)",
    evidenceNotes: "Best Estimate of liabilities (probability-weighted future cash flows) + Risk Margin (cost-of-capital approach); economic balance sheet under Solvency II valuation.",
  },
  {
    capabilitySlug: "stochastic-scenario-modeling-capital-adequacy-modvyrep-6o",
    requiredMaturity: 80,
    priority: "required",
    article: "Solvency II Art. 121 (internal model standards)",
    evidenceNotes: "Internal-model standards: statistical quality, calibration, profit + loss attribution, validation, documentation, use test. Approval by supervisor required.",
  },
  // Mortality + morbidity for life
  {
    capabilitySlug: "mortality-morbidity-experience-analysis-modvyrel-5c",
    requiredMaturity: 75,
    priority: "required",
    article: "Solvency II Art. 75 + Art. 80",
    evidenceNotes: "Assumption-setting for life mortality + morbidity backed by experience analysis; sensitivity testing and disclosure of methodology in actuarial function report.",
  },
  // Catastrophe modeling for non-life
  {
    capabilitySlug: "catastrophe-modeling-accumulation-management-modvzehg-hs",
    requiredMaturity: 75,
    priority: "required",
    article: "Solvency II Art. 105(2) — Non-Life CAT sub-module",
    evidenceNotes: "Catastrophe risk in non-life underwriting risk: standard formula scenarios (Nat-Cat, Man-Made), accumulation tracking, reinsurance recoverables modeling.",
  },
  // Reinsurance management
  {
    capabilitySlug: "alternative-risk-transfer-capital-strategy-modvzeho-k6",
    requiredMaturity: 70,
    priority: "required",
    article: "Solvency II Art. 130 (own funds — risk transfer)",
    evidenceNotes: "Capital-relief structures (reinsurance, ART): documentation of risk transfer effectiveness; counterparty default risk to ceded reinsurance recoverables.",
  },
  {
    capabilitySlug: "reinsurance-optimization",
    requiredMaturity: 70,
    priority: "required",
    article: "Solvency II Art. 76-86 + Art. 209",
    evidenceNotes: "Reinsurance optimization within Solvency II constraints: counterparty default risk module impact, treaty effectiveness, run-off provisions.",
  },

  // ── Pillar 2 — Governance + ORSA ──
  {
    capabilitySlug: "regulatory-compliance-data-governance-automation-modvywyy-ld",
    requiredMaturity: 80,
    priority: "required",
    article: "Solvency II Art. 41-49 (system of governance)",
    evidenceNotes: "System of governance: written policies for risk management, internal control, internal audit, outsourcing; review at least annually; fit + proper for key function holders.",
  },
  {
    capabilitySlug: "regulatory-compliance",
    requiredMaturity: 75,
    priority: "required",
    article: "Solvency II Art. 46 (compliance function)",
    evidenceNotes: "Compliance function: identifies + assesses compliance risk, advises management body, ensures regulatory obligations are met; reports independently.",
  },
  // ORSA (Art. 45)
  {
    capabilitySlug: "assumption-setting-sensitivity-testing-modvyrf1-5k",
    requiredMaturity: 75,
    priority: "required",
    article: "Solvency II Art. 45 (ORSA)",
    evidenceNotes: "Own Risk + Solvency Assessment (ORSA): forward-looking assessment of overall solvency needs, ongoing compliance with capital requirements, deviation of risk profile from SCR assumptions.",
  },
  // Sustainability risk integration (2024 Review)
  {
    capabilitySlug: "strategic-esg-risk-oversight-modw2eu7-gj",
    requiredMaturity: 65,
    priority: "recommended",
    article: "Solvency II 2024 Review — Art. 44 (sustainability)",
    evidenceNotes: "Sustainability-risk integration into risk-management system; climate-change scenario analysis in ORSA; long-term scenario analysis with 2-3 prescribed scenarios.",
  },
  // Underwriting governance
  {
    capabilitySlug: "actuarial-modeling",
    requiredMaturity: 80,
    priority: "required",
    article: "Solvency II Art. 48 (actuarial function)",
    evidenceNotes: "Actuarial function obligations: coordinate technical provisions, ensure data quality, assess sufficiency + quality of data; reinsurance arrangement opinion; underwriting policy opinion.",
  },
  {
    capabilitySlug: "pricing-model-development-predictive-underwriting-modvyrex-4",
    requiredMaturity: 75,
    priority: "required",
    article: "Solvency II Art. 47 (risk management) + Art. 48",
    evidenceNotes: "Pricing-model governance ties to actuarial function opinion on underwriting policy; documented model risk management aligned with SR 11-7-style standards.",
  },

  // ── Pillar 3 — Reporting + disclosure ──
  {
    capabilitySlug: "regulatory-compliance-reporting-modvylw9-ow",
    requiredMaturity: 80,
    priority: "required",
    article: "Solvency II Art. 35, 51 (supervisory reporting + SFCR)",
    evidenceNotes: "Quarterly + annual Quantitative Reporting Templates (QRTs); annual Regular Supervisory Report (RSR), public Solvency + Financial Condition Report (SFCR); narrative + quantitative content.",
  },

  // ── Data quality (Art. 82) — foundational to all three pillars ──
  {
    capabilitySlug: "data-architecture-infrastructure-operations-modvzpu7-27",
    requiredMaturity: 70,
    priority: "required",
    article: "Solvency II Art. 82 (data quality)",
    evidenceNotes: "Data-quality requirements for technical-provision calculations: completeness, accuracy, appropriateness. Documented data-governance process with independent review.",
  },
  {
    capabilitySlug: "data-governance-compliance-modvzptq-3f",
    requiredMaturity: 70,
    priority: "required",
    article: "Solvency II Art. 82",
    evidenceNotes: "Data-governance program covering Solvency II reporting data lineage; sign-off on data appropriateness for SCR + technical provisions calculations.",
  },
];

proposeRequirements({
  regulationShortCode: "Solvency-II",
  proposedBy: "seed:solvency-ii-requirements",
  logLabel: "seed:solvency-ii-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:solvency-ii-reqs] fatal:", err);
    process.exit(1);
  });
