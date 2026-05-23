/**
 * HITECH → capability requirement mapping seed.
 *
 * HITECH (Health Information Technology for Economic and Clinical Health
 * Act, 2009) strengthens HIPAA and adds enforceable obligations on
 * business associates. Three primary pillars relevant to capability
 * maturity:
 *   1. Breach Notification Rule (45 CFR 164.400-414)
 *   2. Direct liability for business associates (45 CFR 164.502(e))
 *   3. Meaningful Use of certified EHR technology (CMS programs)
 *
 * Mapped to Healthcare capabilities. Distinct from HIPAA mappings:
 * HIPAA covers the underlying Privacy/Security rules; HITECH adds
 * enforcement and EHR-specific obligations.
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index.
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── Breach Notification Rule (45 CFR 164.400-414) ──
  {
    capabilitySlug: "adverse-event-reporting-learning-systems-modw13ng-7w",
    requiredMaturity: 80,
    priority: "required",
    article: "45 CFR 164.400-414",
    evidenceNotes: "Breach detection + notification process: individual notice within 60 days, HHS notification (immediate for ≥500 affected; annual log for <500), media notice for breaches affecting >500 in a state.",
  },
  {
    capabilitySlug: "data-quality-provenance-monitoring-modw0ycp-ic",
    requiredMaturity: 75,
    priority: "required",
    article: "45 CFR 164.402, 164.412",
    evidenceNotes: "Breach assessment requires evidence of access logs, audit trails, and unauthorized acquisition — provenance + integrity controls inform low-probability-of-compromise determinations.",
  },
  {
    capabilitySlug: "clinical-governance-audit-modw13nb-l3",
    requiredMaturity: 75,
    priority: "required",
    article: "45 CFR 164.408, 164.530(j)",
    evidenceNotes: "Documentation requirements: breach logs maintained 6 years; risk-assessment workflow per 164.402(2); evidence of mitigation steps.",
  },

  // ── Business Associate direct liability (45 CFR 164.502(e), 164.504(e)) ──
  {
    capabilitySlug: "supplier-relationship-contract-management-modw0ivj-5d",
    requiredMaturity: 75,
    priority: "required",
    article: "45 CFR 164.504(e)",
    evidenceNotes: "Business associate agreements (BAAs) with required HITECH provisions: direct liability, breach-notification flow-down, subcontractor BAA cascade, termination for material breach.",
  },
  {
    capabilitySlug: "regulatory-compliance-traceability-modw0ivm-mi",
    requiredMaturity: 70,
    priority: "required",
    article: "45 CFR 164.502(e), 164.530(j)",
    evidenceNotes: "Traceability of business-associate access to ePHI; BAA inventory with current execution dates + last-review timestamps; periodic compliance attestations.",
  },

  // ── Meaningful Use + certified EHR technology (CMS programs) ──
  {
    capabilitySlug: "health-data-interop",
    requiredMaturity: 70,
    priority: "required",
    article: "HITECH Meaningful Use / Promoting Interoperability",
    evidenceNotes: "Use of ONC-certified EHR technology; semantic interoperability via standardized vocabularies (LOINC, SNOMED, RxNorm); patient-record exchange capability.",
  },
  {
    capabilitySlug: "hl7-fhir-standards-implementation-modw0yc7-7j",
    requiredMaturity: 75,
    priority: "required",
    article: "HITECH / 21st Century Cures Act §4002 (Information Blocking)",
    evidenceNotes: "FHIR-based patient access APIs (USCDI data classes); information-blocking compliance; no unreasonable barriers to electronic access by patients or providers.",
  },
  {
    capabilitySlug: "api-enabled-data-exchange-orchestration-modw0ycg-qs",
    requiredMaturity: 75,
    priority: "required",
    article: "HITECH / Cures Act",
    evidenceNotes: "API-driven data exchange supporting patient-mediated access and provider-to-provider exchange per HITECH Meaningful Use Stage 3 and Cures Act provisions.",
  },

  // ── Patient access + portability ──
  {
    capabilitySlug: "patient-experience",
    requiredMaturity: 70,
    priority: "required",
    article: "45 CFR 164.524 (as amended by HITECH §13405)",
    evidenceNotes: "Electronic copy of PHI in machine-readable format; access within 30 days; reasonable cost-based fee only.",
  },
  {
    capabilitySlug: "patient-access-registration-modw07fu-5r",
    requiredMaturity: 65,
    priority: "required",
    article: "45 CFR 164.524",
    evidenceNotes: "Patient access registration captures the right-of-access request; tracks fulfillment deadlines; integrates with portal-based delivery.",
  },

  // ── Security Rule technical safeguards strengthened by HITECH ──
  {
    capabilitySlug: "privacy-consent-data-access-control-modw0ycl-bd",
    requiredMaturity: 75,
    priority: "required",
    article: "45 CFR 164.312 + HITECH §13402",
    evidenceNotes: "Encryption rendering PHI unreadable creates a safe-harbor against breach notification — HITECH explicitly incentivizes encryption + tokenization controls.",
  },
  {
    capabilitySlug: "master-data-management-mdm-modw0ycc-5n",
    requiredMaturity: 70,
    priority: "recommended",
    article: "HITECH §13405, 164.524",
    evidenceNotes: "MDM supports accurate patient-identity resolution required for designated-record-set retrievals and patient-access requests.",
  },
];

proposeRequirements({
  regulationShortCode: "HITECH",
  proposedBy: "seed:hitech-requirements",
  logLabel: "seed:hitech-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:hitech-reqs] fatal:", err);
    process.exit(1);
  });
