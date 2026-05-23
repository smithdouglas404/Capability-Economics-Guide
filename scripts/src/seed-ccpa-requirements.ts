/**
 * CCPA / CPRA → capability requirement mapping seed.
 *
 * Maps the California Consumer Privacy Act (2018, as amended by CPRA
 * 2020 / effective 2023) to capabilities across all six industries.
 * Core consumer rights:
 *   - Right to know (Civ. Code §1798.110)
 *   - Right to delete (§1798.105)
 *   - Right to correct (§1798.106)
 *   - Right to opt out of sale/sharing (§1798.120)
 *   - Right to limit use of sensitive personal info (§1798.121)
 *   - Right to non-discrimination (§1798.125)
 * Plus business obligations: notice at collection, service-provider
 * + contractor contracts, risk assessments + cybersecurity audits
 * (per CPPA regs, phased in 2026-2027).
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index.
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── Retail (industry 6) ── most-cited CCPA industry
  {
    capabilitySlug: "privacy-consent-compliance-management-modw72iv-i7",
    requiredMaturity: 80,
    priority: "required",
    article: "Cal. Civ. Code §1798.100, .110, .120, .130",
    evidenceNotes: "Notice at collection + privacy policy disclosures; right-to-know and right-to-delete request handling within 45 days; opt-out of sale/sharing including the Global Privacy Control signal.",
  },
  {
    capabilitySlug: "consent-privacy-compliant-segmentation-modw5sg1-jr",
    requiredMaturity: 75,
    priority: "required",
    article: "§1798.121 + CPPA Reg. §7026",
    evidenceNotes: "Limit-the-use-of-sensitive-personal-information (SPI) right; granular consent for cross-context behavioral advertising; segmentation respects opt-out signals.",
  },
  {
    capabilitySlug: "unified-customer-data-platform-modw5mww-e5",
    requiredMaturity: 70,
    priority: "required",
    article: "§1798.105, .106, .130",
    evidenceNotes: "CDP supports the right to delete + correct: identifies all systems holding the consumer's data; orchestrates deletion + correction propagation downstream.",
  },
  {
    capabilitySlug: "customer-data-retail",
    requiredMaturity: 65,
    priority: "required",
    article: "§1798.100",
    evidenceNotes: "Right-to-know fulfillment: produce the categories + specific pieces of personal info collected, sources, purposes, and third-party recipients in the prior 12 months.",
  },

  // ── Technology (industry 5) ──
  {
    capabilitySlug: "data-protection-privacy-compliance-modw4q8j-gx",
    requiredMaturity: 75,
    priority: "required",
    article: "§1798.150 + CPPA Reg. (cybersecurity audits, 2027 phase-in)",
    evidenceNotes: "Reasonable security obligations enforceable via private right of action for breaches; CPRA cybersecurity audit requirement applies to high-risk processors.",
  },
  {
    capabilitySlug: "data-governance-lineage-modw51e4-oq",
    requiredMaturity: 70,
    priority: "required",
    article: "§1798.110 + CPPA Reg. §7011",
    evidenceNotes: "Data inventory + lineage supports verified right-to-know responses; identifies sources, purposes, and third-party disclosures with system-level traceability.",
  },
  {
    capabilitySlug: "identity-access-governance-modw4q8c-ig",
    requiredMaturity: 70,
    priority: "required",
    article: "§1798.150 reasonable security",
    evidenceNotes: "Access governance contributes to reasonable security — least-privilege, MFA, deprovisioning. Failure may be cited in breach private-right-of-action claims.",
  },

  // ── Banking (industry 3) ──
  // Note: GLBA-covered information has a partial CCPA exemption (§1798.145(e))
  // but non-GLBA banking activities (marketing, behavioral analytics) remain in scope.
  {
    capabilitySlug: "customer-data-platform-modw29vd-fa",
    requiredMaturity: 70,
    priority: "required",
    article: "§1798.100-130 (non-GLBA scope)",
    evidenceNotes: "Marketing + behavioral customer-data activities outside GLBA exemption: CDP supports right-to-know, right-to-delete, and opt-out-of-sale/sharing handling.",
  },
  {
    capabilitySlug: "api-security-consent-management-modw2paf-36",
    requiredMaturity: 65,
    priority: "required",
    article: "§1798.121",
    evidenceNotes: "Consent management at API boundaries — limit SPI use signals propagated to downstream consumers (analytics, ad platforms).",
  },

  // ── Insurance (industry 1) ──
  {
    capabilitySlug: "consumer-data-privacy-security-modvz7y6-9q",
    requiredMaturity: 70,
    priority: "required",
    article: "§1798.100, .121, .150",
    evidenceNotes: "Consumer data privacy + security program covering policyholder PII not exempt under GLBA; sensitive-PI handling per §1798.121.",
  },
  {
    capabilitySlug: "regulatory-compliance-data-governance-automation-modvywyy-ld",
    requiredMaturity: 65,
    priority: "required",
    article: "§1798.130 + CPPA Reg.",
    evidenceNotes: "Automated workflows for verifiable consumer requests, service-provider contract management, and CPPA-required disclosures.",
  },

  // ── Healthcare (industry 2) ──
  // PHI under HIPAA is exempt from CCPA (§1798.146(a)(1)), but non-PHI health
  // info (wellness app data, marketing) is in scope.
  {
    capabilitySlug: "privacy-consent-data-access-control-modw0ycl-bd",
    requiredMaturity: 65,
    priority: "recommended",
    article: "§1798.146(a)(1) — non-PHI carve-out",
    evidenceNotes: "Distinguish HIPAA-PHI (exempt) from non-PHI personal information (in scope). Wellness, marketing, and de-identified data flows fall under CCPA.",
  },
  {
    capabilitySlug: "patient-experience",
    requiredMaturity: 60,
    priority: "recommended",
    article: "§1798.100, §1798.105",
    evidenceNotes: "Patient-facing portals collecting non-PHI (marketing preferences, satisfaction surveys) must support right-to-know and right-to-delete.",
  },

  // ── Manufacturing (industry 4) ──
  // Limited direct exposure (B2B), but employee + applicant data is fully in scope per CPRA.
  {
    capabilitySlug: "safety-training-competency-certification-modw3qg6-4g",
    requiredMaturity: 55,
    priority: "recommended",
    article: "§1798.100 (employees + applicants in scope per CPRA)",
    evidenceNotes: "Employee personal info in HR/training systems falls under full CCPA scope (no carve-out post-CPRA); right-to-know + right-to-delete handling required.",
  },
  {
    capabilitySlug: "supply-chain-compliance-risk-management-modw35nf-fl",
    requiredMaturity: 55,
    priority: "recommended",
    article: "§1798.140 service-provider definitions",
    evidenceNotes: "Service-provider + contractor contracts must contain CCPA-required terms (purpose limitation, no sale, deletion flow-down).",
  },
];

proposeRequirements({
  regulationShortCode: "CCPA",
  proposedBy: "seed:ccpa-requirements",
  logLabel: "seed:ccpa-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:ccpa-reqs] fatal:", err);
    process.exit(1);
  });
