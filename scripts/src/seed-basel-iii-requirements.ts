/**
 * Basel III → capability requirement mapping seed.
 *
 * Maps the Basel III framework (BCBS, phased through Basel III Endgame)
 * to Banking capabilities. Three primary pillars:
 *   1. Minimum capital requirements (CET1, Tier 1, Total) + buffers
 *   2. Supervisory review process (Pillar 2 — ICAAP/ILAAP)
 *   3. Market discipline (Pillar 3 — disclosure)
 * Plus the liquidity framework: LCR (high-quality liquid assets vs.
 * 30-day stressed outflows) and NSFR (stable funding vs. required
 * stable funding over one year). Stress testing per CCAR/DFAST in US.
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index.
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── Capital adequacy + risk-weighted assets (Pillar 1) ──
  {
    capabilitySlug: "credit-risk-modeling-measurement-modw2etq-22",
    requiredMaturity: 85,
    priority: "required",
    article: "Basel III §50-98 (credit risk RWA)",
    evidenceNotes: "Credit risk RWA computation: standardized + IRB approaches; PD/LGD/EAD model governance; capital impact of credit-portfolio composition.",
  },
  {
    capabilitySlug: "portfolio-risk-modeling-validation-modw192g-3j",
    requiredMaturity: 80,
    priority: "required",
    article: "Basel III §99-104 + model validation guidance",
    evidenceNotes: "Independent model validation per SR 11-7 / equivalent; back-testing of PD models against realized defaults; benchmarking across vendor + internal models.",
  },
  {
    capabilitySlug: "operational-risk-resilience-modw2etu-cz",
    requiredMaturity: 80,
    priority: "required",
    article: "Basel III §148-181 (operational risk SMA)",
    evidenceNotes: "Operational risk capital under the Standardized Measurement Approach (Endgame); loss-event collection, business-indicator computation, and ILM application.",
  },
  {
    capabilitySlug: "market-liquidity-risk-governance-modw2ety-bi",
    requiredMaturity: 80,
    priority: "required",
    article: "Basel III §132-147 (market risk FRTB)",
    evidenceNotes: "Market risk capital under the Fundamental Review of the Trading Book — standardized + IMA; trading book / banking book boundary management.",
  },

  // ── Supervisory review + ICAAP/ILAAP (Pillar 2) ──
  {
    capabilitySlug: "risk-management-bank",
    requiredMaturity: 80,
    priority: "required",
    article: "Basel III §725-746 (Pillar 2)",
    evidenceNotes: "Internal Capital Adequacy Assessment Process (ICAAP): risk identification, capital planning, stress testing, governance + documentation for supervisory dialogue.",
  },
  {
    capabilitySlug: "regulatory-compliance-risk-management-modw2eu1-jm",
    requiredMaturity: 75,
    priority: "required",
    article: "Basel III §725-808",
    evidenceNotes: "Regulatory compliance + risk management framework with Pillar 2 ICAAP/ILAAP integration; documented risk appetite + escalation.",
  },
  {
    capabilitySlug: "strategic-esg-risk-oversight-modw2eu7-gj",
    requiredMaturity: 65,
    priority: "recommended",
    article: "BCBS — Principles for climate-related financial risk (2022)",
    evidenceNotes: "Climate + ESG risk integration into Pillar 2 capital adequacy assessments; scenario analysis on physical + transition risk to balance sheet.",
  },

  // ── Liquidity framework (LCR + NSFR) ──
  {
    capabilitySlug: "liquidity-settlement-management-modw1sht-ap",
    requiredMaturity: 80,
    priority: "required",
    article: "Basel III §17-19 + LCR/NSFR standards",
    evidenceNotes: "Liquidity Coverage Ratio (LCR) — HQLA ≥ 100% of 30-day stressed outflows; Net Stable Funding Ratio (NSFR) — stable funding ≥ required stable funding over one year. Daily monitoring.",
  },
  {
    capabilitySlug: "reconciliation-exception-management-modw1shp-db",
    requiredMaturity: 70,
    priority: "required",
    article: "Basel III LCR §50-99 (HQLA classification)",
    evidenceNotes: "Reconciliation of HQLA categories (Level 1 / 2A / 2B) with haircuts; exception management for unencumbered status and intragroup transfers.",
  },

  // ── Stress testing (CCAR/DFAST + EU-wide stress tests) ──
  {
    capabilitySlug: "compliance-fraud-risk-monitoring-modw1shx-3f",
    requiredMaturity: 75,
    priority: "required",
    article: "Basel III §726 + CCAR/DFAST + EBA ST methodology",
    evidenceNotes: "Stress-testing capability across capital + liquidity dimensions; supervisor-defined and internal scenarios; controls + monitoring around model inputs.",
  },

  // ── Disclosure (Pillar 3) ──
  {
    capabilitySlug: "regulatory-compliance-fair-lending-modw192p-dt",
    requiredMaturity: 70,
    priority: "required",
    article: "Basel III §809-836 (Pillar 3)",
    evidenceNotes: "Pillar 3 disclosure: capital structure, RWA breakdown, liquidity ratios, leverage ratio, and risk management; quarterly + annual cadence per templates.",
  },
  {
    capabilitySlug: "regulatory-explainable-compliance-scoring-modw2js9-pd",
    requiredMaturity: 70,
    priority: "required",
    article: "Basel III §809-836 + BCBS-PIT",
    evidenceNotes: "Explainable + reproducible regulatory disclosures with attestation chains; source-to-disclosure lineage for capital + liquidity metrics.",
  },

  // ── Capital + RWA aggregation ──
  {
    capabilitySlug: "data-analytics-fabric-modw29v1-dr",
    requiredMaturity: 70,
    priority: "required",
    article: "BCBS 239 (Risk data aggregation)",
    evidenceNotes: "Risk-data aggregation principles (BCBS 239): accuracy, integrity, completeness, timeliness, adaptability, governance — applies to Basel III reporting infrastructure.",
  },

  // ── Counterparty + concentration ──
  {
    capabilitySlug: "transaction-monitoring-anomaly-detection-modw24yb-3b",
    requiredMaturity: 65,
    priority: "recommended",
    article: "Basel III §105-131 (CCR + CVA)",
    evidenceNotes: "Counterparty credit risk + CVA monitoring — exposure tracking, netting, collateral management, and CVA capital under SA-CVA / BA-CVA.",
  },

  // ── Securitisation framework ──
  {
    capabilitySlug: "portfolio-construction-optimization-modw1yje-fa",
    requiredMaturity: 65,
    priority: "recommended",
    article: "Basel III §539-579 (securitisation)",
    evidenceNotes: "Securitisation framework: due diligence, risk retention, capital under SEC-IRBA / SEC-ERBA / SEC-SA hierarchy with output-floor floors.",
  },
];

proposeRequirements({
  regulationShortCode: "Basel-III",
  proposedBy: "seed:basel-iii-requirements",
  logLabel: "seed:basel-iii-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:basel-iii-reqs] fatal:", err);
    process.exit(1);
  });
