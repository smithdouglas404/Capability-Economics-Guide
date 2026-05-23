/**
 * Dodd-Frank → capability requirement mapping seed.
 *
 * Maps the Dodd-Frank Wall Street Reform and Consumer Protection Act
 * (Public Law 111-203, 2010) to Banking + Insurance capabilities. Key
 * obligation families:
 *   - Title I: FSOC + systemic risk oversight, SIFI designation
 *   - Title II: Orderly Liquidation Authority
 *   - Title VI: Volcker Rule (§619) — proprietary trading + fund
 *     investment restrictions for banking entities
 *   - Title VII: Derivatives (Swaps) clearing + reporting
 *   - Title VIII: Payment, clearing, settlement supervision
 *   - Title X: CFPB + consumer financial protection
 *   - Title XIV: Mortgage reform (ability-to-repay, QM, RESPA/TILA)
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index.
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── Title VI — Volcker Rule (§619) + Title VII Swap Dealer + Whistleblower §922 ──
  // Single (regulation_id, capability_id) row covers the three obligations that
  // all attach to compliance-fraud-risk-monitoring; combined evidence notes.
  {
    capabilitySlug: "compliance-fraud-risk-monitoring-modw1shx-3f",
    requiredMaturity: 75,
    priority: "required",
    article: "Dodd-Frank §619, Title VII, §922-924",
    evidenceNotes: "Volcker Rule compliance program (prohibited prop-trading + covered-fund identification, metrics, CEO attestation for $20B+ entities); Swap Dealer / MSP business-conduct standards with CCO designation + annual compliance report; whistleblower-program governance with anti-retaliation protections.",
  },
  {
    capabilitySlug: "transaction-monitoring-anomaly-detection-modw24yb-3b",
    requiredMaturity: 70,
    priority: "required",
    article: "12 CFR 248 (Volcker Rule metrics)",
    evidenceNotes: "Quantitative metrics for covered trading desks: risk + position limits, VaR, stress VaR, customer-facing trade analysis; daily monitoring with documented limit breaches.",
  },

  // ── Title VII — Derivatives clearing + reporting ──
  {
    capabilitySlug: "transaction-routing-switching-modw1shi-ph",
    requiredMaturity: 75,
    priority: "required",
    article: "Dodd-Frank Title VII (CFTC + SEC rules)",
    evidenceNotes: "Clearing of standardized swaps through DCO/CCP; SEF execution requirements; pre-trade transparency + post-trade reporting to swap-data repositories.",
  },
  // ── Title X — CFPB + consumer protection ──
  {
    capabilitySlug: "regulatory-compliance-fair-lending-modw192p-dt",
    requiredMaturity: 80,
    priority: "required",
    article: "Dodd-Frank Title X §1031 (UDAAP)",
    evidenceNotes: "Unfair, Deceptive, Abusive Acts + Practices: written policies + monitoring across consumer-facing products, services, marketing, servicing, collections.",
  },
  {
    capabilitySlug: "regulatory-explainable-compliance-scoring-modw2js9-pd",
    requiredMaturity: 75,
    priority: "required",
    article: "Dodd-Frank §1071 (Small Business Loan Data)",
    evidenceNotes: "Small business loan data collection + reporting per 12 CFR 1002 (Regulation B amendment, effective phased 2024-2026); 13 data points per application.",
  },
  // Title XIV mortgage rules — ability-to-repay, QM, RESPA/TILA
  {
    capabilitySlug: "credit-decisioning",
    requiredMaturity: 75,
    priority: "required",
    article: "Dodd-Frank Title XIV §1411 (Ability-to-Repay)",
    evidenceNotes: "Ability-to-Repay rule (12 CFR 1026.43): document 8 ATR factors at origination; Qualified Mortgage safe harbor; servicing standards integration.",
  },
  {
    capabilitySlug: "behavioral-affordability-assessment-modw192k-49",
    requiredMaturity: 70,
    priority: "required",
    article: "Dodd-Frank §1411 ATR + §1412 QM",
    evidenceNotes: "Affordability assessment supports ATR: income, assets, employment status, debt obligations, debt-to-income ratio, residual income, credit history.",
  },

  // ── Title I/II — Systemic risk + resolution ──
  {
    capabilitySlug: "operational-risk-resilience-modw2etu-cz",
    requiredMaturity: 75,
    priority: "required",
    article: "Dodd-Frank §165 (Enhanced Prudential Standards)",
    evidenceNotes: "Resolution + recovery planning ('living wills') for SIFIs: rapid-resolution strategy, critical-operations identification, intra-affiliate dependencies mapping.",
  },
  {
    capabilitySlug: "core-processing-engine-modw29uw-h4",
    requiredMaturity: 70,
    priority: "recommended",
    article: "Dodd-Frank §165(d)",
    evidenceNotes: "Core systems continuity in resolution scenarios: documented separability of critical operations + customer access continuity.",
  },

  // ── Title I — SIFI risk-management standards ──
  {
    capabilitySlug: "risk-management-bank",
    requiredMaturity: 80,
    priority: "required",
    article: "Dodd-Frank §165 + 12 CFR 252",
    evidenceNotes: "Enhanced risk-management for BHCs ≥ $100B: independent risk committee, CRO, enterprise risk management framework with credit, market, liquidity, operational, model risk integration.",
  },
  {
    capabilitySlug: "credit-risk-modeling-measurement-modw2etq-22",
    requiredMaturity: 75,
    priority: "required",
    article: "Dodd-Frank §165 + CCAR/DFAST",
    evidenceNotes: "Capital plans + stress tests (CCAR/DFAST): supervisory + idiosyncratic scenarios; capital action approval; post-stress capital ratios above minimums + buffers.",
  },

  // ── Insurance side — FIO + FSOC SIFI designation (now narrowed) ──
  {
    capabilitySlug: "regulatory-compliance-reporting-modvylw9-ow",
    requiredMaturity: 65,
    priority: "recommended",
    article: "Dodd-Frank Title V (Federal Insurance Office)",
    evidenceNotes: "FIO information collection requests; international insurance regulatory coordination; subrogation of insurance treaties through Treasury.",
  },
  {
    capabilitySlug: "regulatory-compliance",
    requiredMaturity: 65,
    priority: "recommended",
    article: "Dodd-Frank Title V + IIPR",
    evidenceNotes: "Nonadmitted + Reinsurance Reform Act (Title V Subtitle B) — uniform surplus lines regulation + reinsurance credit recognition.",
  },

];

proposeRequirements({
  regulationShortCode: "Dodd-Frank",
  proposedBy: "seed:dodd-frank-requirements",
  logLabel: "seed:dodd-frank-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:dodd-frank-reqs] fatal:", err);
    process.exit(1);
  });
