/**
 * NAIC Model Audit Rule (MAR) → capability requirement mapping seed.
 *
 * Maps the NAIC Model Audit Rule (Model #205, "Annual Financial
 * Reporting Model Regulation") to Insurance capabilities. Mirrors
 * SOX §404 for insurers, but state-adopted with carrier-size
 * thresholds. Key obligation families:
 *   - §6 Annual financial report by independent CPA (statutory)
 *   - §7-9 Auditor independence + communications + report
 *   - §11 Management's report on internal control over financial
 *     reporting (ICFR) — for insurers ≥ $500M direct + assumed
 *     premiums or as required by domiciliary state
 *   - §10 Audit committee requirements (large insurers)
 *   - §16 Notification of adverse financial condition
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index.
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── ICFR (§11) — analogous to SOX §404 for insurers ──
  {
    capabilitySlug: "regulatory-compliance-reporting-modvylw9-ow",
    requiredMaturity: 80,
    priority: "required",
    article: "NAIC MAR §11 (Management's Report on ICFR)",
    evidenceNotes: "Management's report on internal control over financial reporting filed annually with the domiciliary insurance department; covers design + operating effectiveness of controls over statutory reporting.",
  },
  {
    capabilitySlug: "regulatory-compliance-data-governance-automation-modvywyy-ld",
    requiredMaturity: 75,
    priority: "required",
    article: "NAIC MAR §11 + §6",
    evidenceNotes: "Data governance underpinning ICFR: data lineage from operational systems to statutory financial statements; controls over journal entries, valuation inputs, and accruals.",
  },
  {
    capabilitySlug: "regulatory-compliance",
    requiredMaturity: 75,
    priority: "required",
    article: "NAIC MAR §6 + §11",
    evidenceNotes: "Regulatory compliance framework for the annual financial report filing + ICFR documentation; coordination with independent CPA audit.",
  },

  // ── Premium reserving + technical valuation (the dominant audit areas) ──
  {
    capabilitySlug: "premium-reserving-liability-valuation-modvyret-ec",
    requiredMaturity: 80,
    priority: "required",
    article: "NAIC MAR §6 (Independent CPA Audit) + Schedule P",
    evidenceNotes: "Statutory technical provisions — controls over loss + LAE reserves, IBNR, and premium-deficiency reserves; documentation supports auditor's ability to test reserve adequacy.",
  },
  {
    capabilitySlug: "reserve-estimation-modeling-modvyggg-dp",
    requiredMaturity: 75,
    priority: "required",
    article: "NAIC MAR §6 (claim-reserve testing)",
    evidenceNotes: "Reserve estimation methodology + actuarial governance; backtesting against ultimate losses; documentation feeds the actuarial opinion + memorandum supporting the annual audit.",
  },
  {
    capabilitySlug: "actuarial-modeling",
    requiredMaturity: 75,
    priority: "required",
    article: "NAIC MAR §11 + SAO/AOM (Actuarial Opinion + Memorandum)",
    evidenceNotes: "Actuarial-function controls over statutory reserves; coordination of appointed-actuary opinion with management's ICFR assertions.",
  },

  // ── Audit committee (§10) ──
  {
    capabilitySlug: "regulatory-compliance-risk-management-modw2eu1-jm",
    requiredMaturity: 65,
    priority: "recommended",
    article: "NAIC MAR §10 (Audit Committee)",
    evidenceNotes: "Audit committee composition + independence per insurer size thresholds; pre-approval of audit + non-audit services; whistleblower-handling procedures.",
  },

  // ── Data + financial-systems integrity ──
  {
    capabilitySlug: "data-architecture-infrastructure-operations-modvzpu7-27",
    requiredMaturity: 70,
    priority: "required",
    article: "NAIC MAR §11 (general controls over financial systems)",
    evidenceNotes: "IT general controls supporting statutory reporting: change management, access controls, computer operations + backup, application controls.",
  },
  {
    capabilitySlug: "data-governance-compliance-modvzptq-3f",
    requiredMaturity: 70,
    priority: "required",
    article: "NAIC MAR §11",
    evidenceNotes: "Data-governance over financial-reporting data flows: ownership, classification, quality monitoring, reconciliation controls between operational + statutory systems.",
  },

  // ── Premium + claims operational controls (revenue + benefits cycles) ──
  {
    capabilitySlug: "policy-form-rate-filing-modvz7y1-d3",
    requiredMaturity: 65,
    priority: "recommended",
    article: "NAIC MAR §11 (premium-cycle controls)",
    evidenceNotes: "Premium cycle: rate-filing approvals reconcile to billed + earned premium reported in statutory financials.",
  },
  {
    capabilitySlug: "claims-handling-unfair-practices-modvz7yf-p8",
    requiredMaturity: 65,
    priority: "required",
    article: "NAIC MAR §11 (claims cycle)",
    evidenceNotes: "Claims handling cycle: paid losses + reserves drive Schedule P + Schedule F reporting; controls over claim payment authorization + reserve setting.",
  },

  // ── Notification of adverse condition (§16) ──
  {
    capabilitySlug: "compliance-licensing-operations-modvzjnv-39",
    requiredMaturity: 65,
    priority: "recommended",
    article: "NAIC MAR §16",
    evidenceNotes: "Notification to commissioner of changes in financial condition, material weaknesses in ICFR, or auditor reportable conditions — within prescribed timeframes (typically 5 business days).",
  },
];

proposeRequirements({
  regulationShortCode: "NAIC-MAR",
  proposedBy: "seed:naic-mar-requirements",
  logLabel: "seed:naic-mar-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:naic-mar-reqs] fatal:", err);
    process.exit(1);
  });
