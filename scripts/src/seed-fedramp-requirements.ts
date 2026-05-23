/**
 * FedRAMP → capability requirement mapping seed.
 *
 * Maps the Federal Risk and Authorization Management Program to
 * Technology capabilities. FedRAMP standardizes security assessment +
 * authorization for cloud products and services used by US federal
 * agencies, aligned to NIST SP 800-53. Three impact levels:
 *   - Low Impact     (~125 controls)
 *   - Moderate       (~325 controls) — most common
 *   - High Impact    (~425 controls)
 *
 * Authorization paths:
 *   - JAB P-ATO (Joint Authorization Board provisional ATO)
 *   - Agency ATO (single agency Authorization-to-Operate)
 *
 * FedRAMP 20x (2024) introduced streamlined automation + continuous
 * monitoring pathways; aligns with OMB M-22-09 zero-trust architecture.
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index.
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── Access control family (AC) — NIST 800-53 AC-1 to AC-22 ──
  {
    capabilitySlug: "identity-access-governance-modw4q8c-ig",
    requiredMaturity: 85,
    priority: "required",
    article: "NIST 800-53 AC family + FedRAMP baseline",
    evidenceNotes: "Account management, access enforcement, least privilege, session controls, remote access (FedRAMP AC-17 Moderate); MFA per OMB M-22-09 phishing-resistant.",
  },

  // ── Audit + accountability (AU) ──
  {
    capabilitySlug: "observability-telemetry-modw45t1-23",
    requiredMaturity: 80,
    priority: "required",
    article: "NIST 800-53 AU family + FedRAMP AU-3, AU-6, AU-11",
    evidenceNotes: "Audit event content + review + retention: detailed event types, log review at FedRAMP cadence, audit-record retention (FedRAMP Moderate: 90 days online + offline as appropriate).",
  },

  // ── Configuration management (CM) ──
  {
    capabilitySlug: "infrastructure-as-code-gitops-modw45sw-oi",
    requiredMaturity: 80,
    priority: "required",
    article: "NIST 800-53 CM family",
    evidenceNotes: "Baseline configuration management (CM-2), least functionality (CM-7), authorized software (CM-10), configuration change control (CM-3). IaC + GitOps provides the immutable baseline.",
  },
  {
    capabilitySlug: "release-management-governance-modw4b4u-r1",
    requiredMaturity: 75,
    priority: "required",
    article: "NIST 800-53 CM-3 + SA-10/11",
    evidenceNotes: "Configuration change control with security-impact analysis; development + test + production environment segregation; developer security testing.",
  },

  // ── Contingency planning (CP) ──
  {
    capabilitySlug: "cloud-disaster-recovery-business-continuity-modw4ldg-4j",
    requiredMaturity: 80,
    priority: "required",
    article: "NIST 800-53 CP family + FedRAMP CP-2, CP-4, CP-9",
    evidenceNotes: "Contingency plan with defined RTO/RPO; annual contingency-plan testing (CP-4); backup storage with encryption (CP-9); information-system recovery + reconstitution.",
  },

  // ── Identification + authentication (IA) ──
  {
    capabilitySlug: "identity-verification-authentication-modw24yj-km", // technology-applicable
    requiredMaturity: 80,
    priority: "required",
    article: "NIST 800-53 IA family + OMB M-22-09",
    evidenceNotes: "Identification + authentication (organizational + non-organizational users); phishing-resistant MFA per OMB M-22-09 zero-trust architecture mandate.",
  },

  // ── Incident response (IR) ──
  {
    capabilitySlug: "threat-detection-response-modw4q88-fs",
    requiredMaturity: 80,
    priority: "required",
    article: "NIST 800-53 IR family + FedRAMP IR-4, IR-6",
    evidenceNotes: "Incident-response process: preparation, detection + analysis, containment + eradication + recovery, post-incident; FedRAMP IR-6 timeline for reporting to FedRAMP PMO + CISA.",
  },

  // ── Risk assessment (RA) + scanning ──
  {
    capabilitySlug: "vulnerability-patch-management-modw4q8f-h7",
    requiredMaturity: 80,
    priority: "required",
    article: "NIST 800-53 RA-5 + FedRAMP cadence",
    evidenceNotes: "Vulnerability scanning at FedRAMP cadence: monthly authenticated scans against OS + applications; remediation SLAs by severity (Critical 30 days, High 30 days, Moderate 90 days, Low 180 days).",
  },

  // ── System + services acquisition (SA) ──
  {
    capabilitySlug: "security-compliance-guardrails-modw45tg-f2",
    requiredMaturity: 80,
    priority: "required",
    article: "NIST 800-53 SA-8, SA-11, SA-15",
    evidenceNotes: "Security engineering principles + developer security testing + development process. Security guardrails enforce FedRAMP baselines as code.",
  },

  // ── System + communications protection (SC) ──
  {
    capabilitySlug: "data-protection-privacy-compliance-modw4q8j-gx",
    requiredMaturity: 80,
    priority: "required",
    article: "NIST 800-53 SC-8, SC-13, SC-28",
    evidenceNotes: "Transmission confidentiality + integrity (FIPS 140-2/140-3 validated cryptography); protection at rest; cryptographic protection of stored information.",
  },
  {
    capabilitySlug: "security-architecture-resilience-modw4q8p-ht",
    requiredMaturity: 80,
    priority: "required",
    article: "NIST 800-53 SC family + boundary protection",
    evidenceNotes: "Boundary protection (SC-7), network segmentation, denial-of-service protection, secure session management; resilience considerations in security architecture.",
  },

  // ── System + information integrity (SI) ──
  {
    capabilitySlug: "cloud-security-compliance-automation-modw4ld4-qp",
    requiredMaturity: 80,
    priority: "required",
    article: "NIST 800-53 SI family",
    evidenceNotes: "Flaw remediation, malicious code protection, system monitoring, security alerts + advisories; automation enforces FedRAMP baseline configurations.",
  },

  // ── Supply chain risk management (SR) — FedRAMP 20x emphasis ──
  {
    capabilitySlug: "container-orchestration-microservices-architecture-modw4ld8-1i",
    requiredMaturity: 70,
    priority: "required",
    article: "NIST 800-53 SR family + FedRAMP 20x",
    evidenceNotes: "Supply-chain risk management for cloud-service-provider components: container image SBOM generation, base-image provenance, third-party dependency tracking, supplier-security assessments.",
  },

  // ── Continuous monitoring (CA + system maintenance under FedRAMP ConMon) ──
  {
    capabilitySlug: "ml-monitoring-observability-modw4g8m-f6", // adjacent — continuous monitoring umbrella
    requiredMaturity: 75,
    priority: "required",
    article: "FedRAMP Continuous Monitoring Strategy Guide",
    evidenceNotes: "Continuous monitoring: monthly POA&M, monthly scan results upload, annual reauthorization, significant-change assessments. ML monitoring extends to model-serving baselines under FedRAMP if AI is in-scope.",
  },

  // ── Data governance for tagged content ──
  {
    capabilitySlug: "data-governance-lineage-modw51e4-oq",
    requiredMaturity: 70,
    priority: "required",
    article: "NIST 800-53 PT family + Privacy controls",
    evidenceNotes: "Privacy controls (PT family) — data inventory, lineage, system-of-records-notice support for PII processed in federal-system cloud.",
  },
];

proposeRequirements({
  regulationShortCode: "FedRAMP",
  proposedBy: "seed:fedramp-requirements",
  logLabel: "seed:fedramp-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:fedramp-reqs] fatal:", err);
    process.exit(1);
  });
