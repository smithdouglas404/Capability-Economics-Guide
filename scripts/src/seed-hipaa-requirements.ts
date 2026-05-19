/**
 * HIPAA → capability requirement mapping seed.
 *
 * Maps HIPAA's Privacy Rule, Security Rule (Administrative / Physical /
 * Technical safeguards), and Breach Notification Rule to specific
 * Healthcare capabilities with a required-maturity threshold, priority
 * level, and the CFR article citation.
 *
 * Lookups by slug (capability) and shortCode (regulation) so the script
 * is portable across environments. Idempotent — uses the
 * (regulation_id, capability_id) unique index to upsert. Re-running
 * refreshes required_maturity / priority / article / evidence_notes to
 * current values without duplicating rows.
 *
 * Exit codes:
 *   0 — success (including idempotent no-op)
 *   1 — DB connection error or HIPAA row missing
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

// Curated against the 54 Healthcare capabilities live in prod 2026-05-19.
// Each maps the dominant HIPAA control family the capability satisfies.
// Higher requiredMaturity = stricter threshold (compliance fails below it).
const REQUIREMENTS: RequirementSeed[] = [
  // ── Privacy Rule (45 CFR 164.502–164.534) ──
  {
    capabilitySlug: "privacy-consent-data-access-control-modw0ycl-bd",
    requiredMaturity: 75,
    priority: "required",
    article: "45 CFR 164.502, 164.508",
    evidenceNotes: "Minimum necessary standard for PHI use and disclosure; patient authorization workflows; consent capture and revocation.",
  },
  {
    capabilitySlug: "patient-experience",
    requiredMaturity: 65,
    priority: "required",
    article: "45 CFR 164.524, 164.526",
    evidenceNotes: "Patient right of access to PHI within 30 days; right to amend; designated record set management.",
  },
  {
    capabilitySlug: "patient-navigation-support-services-modw021v-p4",
    requiredMaturity: 60,
    priority: "recommended",
    article: "45 CFR 164.528",
    evidenceNotes: "Accounting of disclosures upon patient request — supports privacy practice notices and patient rights handling.",
  },

  // ── Security Rule — Administrative Safeguards (45 CFR 164.308) ──
  {
    capabilitySlug: "clinical-governance-audit-modw13nb-l3",
    requiredMaturity: 75,
    priority: "required",
    article: "45 CFR 164.308(a)(1), 164.308(a)(8)",
    evidenceNotes: "Risk analysis and risk management process; periodic technical and non-technical evaluation. Audit controls covering PHI access.",
  },
  {
    capabilitySlug: "credentialing-compliance-lifecycle-modw0t7u-r0",
    requiredMaturity: 70,
    priority: "required",
    article: "45 CFR 164.308(a)(3), 164.308(a)(5)",
    evidenceNotes: "Workforce security: authorization/clearance procedures; termination procedures. Security awareness and training program.",
  },
  {
    capabilitySlug: "adverse-event-reporting-learning-systems-modw13ng-7w",
    requiredMaturity: 70,
    priority: "required",
    article: "45 CFR 164.308(a)(6)",
    evidenceNotes: "Security incident response and reporting procedures — feeds the breach notification rule (164.400 et seq.).",
  },

  // ── Security Rule — Technical Safeguards (45 CFR 164.312) ──
  {
    capabilitySlug: "data-quality-provenance-monitoring-modw0ycp-ic",
    requiredMaturity: 70,
    priority: "required",
    article: "45 CFR 164.312(b), 164.312(c)",
    evidenceNotes: "Audit controls: record and examine activity in information systems containing ePHI. Integrity controls preventing improper alteration.",
  },
  {
    capabilitySlug: "health-data-interop",
    requiredMaturity: 70,
    priority: "required",
    article: "45 CFR 164.312(e)",
    evidenceNotes: "Transmission security: integrity controls and encryption when ePHI is transmitted over an electronic communications network.",
  },
  {
    capabilitySlug: "api-enabled-data-exchange-orchestration-modw0ycg-qs",
    requiredMaturity: 65,
    priority: "recommended",
    article: "45 CFR 164.312(a)(1), 164.312(d)",
    evidenceNotes: "Access control: unique user identification, emergency access procedure, automatic logoff. Person/entity authentication for API consumers.",
  },
  {
    capabilitySlug: "hl7-fhir-standards-implementation-modw0yc7-7j",
    requiredMaturity: 65,
    priority: "recommended",
    article: "45 CFR 164.312(c), 164.314",
    evidenceNotes: "Standards-based interop (FHIR/HL7) supports integrity, business associate agreements, and audit log fidelity for ePHI exchange.",
  },

  // ── Breach Notification Rule (45 CFR 164.400–164.414) ──
  {
    capabilitySlug: "patient-safety-culture-reporting-modw13np-mq",
    requiredMaturity: 60,
    priority: "recommended",
    article: "45 CFR 164.410",
    evidenceNotes: "Reporting culture supports timely workforce identification of suspected breaches; feeds the 60-day notification clock.",
  },

  // ── Records & Documentation (Privacy + Security) ──
  {
    capabilitySlug: "charge-capture-clinical-documentation-modw07fz-d7",
    requiredMaturity: 70,
    priority: "required",
    article: "45 CFR 164.530(j)",
    evidenceNotes: "Designated record set integrity: clinical documentation must maintain accuracy, completeness, and retrievability of PHI.",
  },

  // ── Master Data Management for PHI master record (Security Rule integrity) ──
  {
    capabilitySlug: "master-data-management-mdm-modw0ycc-5n",
    requiredMaturity: 70,
    priority: "required",
    article: "45 CFR 164.312(c)",
    evidenceNotes: "Authoritative single source of truth for patient PHI prevents accidental or unauthorized alteration; supports integrity safeguard.",
  },
];

proposeRequirements({
  regulationShortCode: "HIPAA",
  proposedBy: "seed:hipaa-requirements",
  logLabel: "seed:hipaa-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:hipaa-reqs] fatal:", err);
    process.exit(1);
  });
