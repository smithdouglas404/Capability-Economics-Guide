/**
 * FDA 21 CFR Part 11 → capability requirement mapping seed.
 *
 * Maps the FDA's electronic records + electronic signatures rule
 * (21 CFR Part 11, 1997; updated guidance 2003) to Healthcare +
 * Manufacturing capabilities. Applies to FDA-regulated industries
 * (pharma, biotech, medical devices, food) using electronic records
 * to satisfy predicate-rule requirements.
 *
 * Core obligations:
 *   - §11.10 Controls for closed systems (validation, audit trails,
 *     record protection, system access controls)
 *   - §11.30 Controls for open systems (encryption, digital signatures)
 *   - §11.50 Signature manifestations (printed name, date/time, meaning)
 *   - §11.70 Signature/record linking
 *   - §11.100-300 Electronic signatures requirements
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index.
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── §11.10(a) — System validation + §11.10(e) audit trails (combined) ──
  {
    capabilitySlug: "clinical-governance-audit-modw13nb-l3",
    requiredMaturity: 80,
    priority: "required",
    article: "21 CFR Part 11 §11.10(a), §11.10(e)",
    evidenceNotes: "Validation of systems handling electronic records (IQ/OQ/PQ + CSV per GAMP 5); secure computer-generated, time-stamped audit trails recording date + time of operator entries + actions, preserved for record-retention period; change-control with re-validation triggers.",
  },

  // ── §11.10(b) — Accurate + complete copies + §11.10(k) record integrity ──
  {
    capabilitySlug: "data-quality-provenance-monitoring-modw0ycp-ic",
    requiredMaturity: 80,
    priority: "required",
    article: "21 CFR Part 11 §11.10(b), §11.10(c), §11.10(k)",
    evidenceNotes: "Generation of accurate + complete copies in human-readable + electronic form; protection of records during retention period; recovery + restoration testing; provenance (WHO/WHAT/WHEN/WHY) for each record change.",
  },

  // ── §11.10(d-g) — System access + authority checks ──
  {
    capabilitySlug: "privacy-consent-data-access-control-modw0ycl-bd",
    requiredMaturity: 80,
    priority: "required",
    article: "21 CFR Part 11 §11.10(d), §11.10(g)",
    evidenceNotes: "Limiting system access to authorized individuals; authority checks for system operations + electronic-signature application; role-based access aligned to job function.",
  },

  // ── §11.10(e) — Audit trails (consolidated into the two upstream caps above
  // via expanded evidence notes; this section intentionally has no new rows
  // because (regulation, capability) uniqueness would deduplicate them).

  // ── §11.10(h-k) — Device checks, training, signature controls ──
  {
    capabilitySlug: "credentialing-compliance-lifecycle-modw0t7u-r0",
    requiredMaturity: 75,
    priority: "required",
    article: "21 CFR Part 11 §11.10(i)",
    evidenceNotes: "Determination of personnel competence: education, training, experience documented; periodic training refresh; access tied to completion records.",
  },

  // ── §11.50 — Signature manifestations ──
  {
    capabilitySlug: "charge-capture-clinical-documentation-modw07fz-d7",
    requiredMaturity: 70,
    priority: "required",
    article: "21 CFR Part 11 §11.50, §11.70",
    evidenceNotes: "Signed electronic records contain printed name of signer, date+time of execution, meaning of signature; record/signature linking prevents removal/copy.",
  },

  // ── §11.100-300 — Electronic signatures ──
  {
    capabilitySlug: "identity-verification-authentication-modw24yj-km", // healthcare adjacent — use a healthcare cap if available
    requiredMaturity: 75,
    priority: "required",
    article: "21 CFR Part 11 §11.100-300",
    evidenceNotes: "Unique e-signature per individual, identity verification, certified to FDA upon request; biometric + non-biometric signature controls per §11.200.",
  },

  // ── Manufacturing side — GMP electronic records (21 CFR Part 210/211, 820) ──
  {
    capabilitySlug: "quality-data-management-analytics-modx4k1l-6f",
    requiredMaturity: 80,
    priority: "required",
    article: "21 CFR Part 11 + 21 CFR Part 211 (cGMP)",
    evidenceNotes: "Quality data + analytics for FDA-regulated manufacturing: batch-record integrity, deviation handling, complaint handling — Part 11 compliance baseline.",
  },
  {
    capabilitySlug: "in-process-quality-control-modx4k1a-eg",
    requiredMaturity: 75,
    priority: "required",
    article: "21 CFR Part 11 + 21 CFR Part 820 (QSR)",
    evidenceNotes: "Quality system records for medical devices: device-history records, design-history files, complaint records — all subject to Part 11 when electronic.",
  },
  {
    capabilitySlug: "regulatory-compliance-certification-management-modw3hht-29",
    requiredMaturity: 75,
    priority: "required",
    article: "21 CFR Part 11 + Part 820",
    evidenceNotes: "Regulatory compliance + certification management: design controls (820.30), document controls (820.40), records (820.180), corrective + preventive actions (820.100).",
  },
  {
    capabilitySlug: "nonconformance-corrective-action-management-modx4k1q-5o",
    requiredMaturity: 75,
    priority: "required",
    article: "21 CFR Part 11 + 21 CFR §820.100 (CAPA)",
    evidenceNotes: "Corrective + preventive action records subject to Part 11; documented investigation, root-cause analysis, effectiveness verification.",
  },
  {
    capabilitySlug: "final-product-testing-release-modx4k1e-1v",
    requiredMaturity: 70,
    priority: "required",
    article: "21 CFR Part 11 + Part 211.165 / 820.80",
    evidenceNotes: "Finished-product release: testing records, sampling, batch-release authorization captured as electronic records with signatures.",
  },

  // ── Data integrity (ALCOA+) — modern FDA emphasis ──
  {
    capabilitySlug: "master-data-management-mdm-modw0ycc-5n",
    requiredMaturity: 70,
    priority: "required",
    article: "21 CFR Part 11 + FDA Data Integrity Guidance",
    evidenceNotes: "ALCOA+ principles: Attributable, Legible, Contemporaneous, Original, Accurate + Complete, Consistent, Enduring, Available — supported by MDM for master records.",
  },
];

proposeRequirements({
  regulationShortCode: "21-CFR-Part-11",
  proposedBy: "seed:21-cfr-part-11-requirements",
  logLabel: "seed:21-cfr-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:21-cfr-reqs] fatal:", err);
    process.exit(1);
  });
