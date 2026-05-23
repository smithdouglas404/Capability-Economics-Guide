/**
 * ISO/IEC 27001:2022 → capability requirement mapping seed.
 *
 * Maps the 2022 revision of ISO/IEC 27001 (Information Security
 * Management Systems) to capabilities across all six industries.
 *
 * ISO 27001:2022 Annex A reorganized 114 controls into 93 grouped by:
 *   A.5  Organizational controls   (37 controls)
 *   A.6  People controls           (8 controls)
 *   A.7  Physical controls         (14 controls)
 *   A.8  Technological controls    (34 controls)
 *
 * Cross-industry: ISMS is generic. Mapped to the highest-leverage
 * capability per industry; orgs can extend per their Statement of
 * Applicability (SoA).
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index to
 * upsert. Re-running refreshes required_maturity / priority / article /
 * evidence_notes without duplicating rows.
 *
 * Exit codes:
 *   0 — success (including idempotent no-op)
 *   1 — DB connection error or ISO-27001 row missing
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── Clauses 4-10: Management system requirements ──
  // Context, leadership, planning, support, operation, evaluation, improvement
  {
    capabilitySlug: "operational-risk-resilience-modw2etu-cz", // banking
    requiredMaturity: 70,
    priority: "required",
    article: "ISO 27001:2022 §4-6",
    evidenceNotes: "Defined ISMS scope, leadership commitment, and ISMS objectives with documented risk treatment plan; ISMS reviewed by management at planned intervals.",
  },
  {
    capabilitySlug: "regulatory-compliance-data-governance-automation-modvywyy-ld", // insurance
    requiredMaturity: 70,
    priority: "required",
    article: "ISO 27001:2022 §6, §8",
    evidenceNotes: "Information security risk assessment + treatment process embedded in compliance + governance automation; risk register updated continuously.",
  },
  {
    capabilitySlug: "security-compliance-guardrails-modw45tg-f2", // technology
    requiredMaturity: 75,
    priority: "required",
    article: "ISO 27001:2022 §6-8",
    evidenceNotes: "ISMS operationalized as engineering guardrails (policy-as-code); risk-treatment decisions reflected in pipeline policies and deployment gates.",
  },

  // ── Annex A.5 — Organizational controls ──
  // A.5.1 Policies, A.5.2 Roles, A.5.3 Segregation of duties, A.5.7 Threat intelligence,
  // A.5.9-12 Asset management, A.5.15-18 Access control, A.5.19-23 Supplier relationships,
  // A.5.24-28 Incident management
  {
    capabilitySlug: "data-analytics-fabric-modw29v1-dr", // banking
    requiredMaturity: 70,
    priority: "required",
    article: "ISO 27001:2022 A.5.9-12",
    evidenceNotes: "Inventory of information assets with assigned ownership; acceptable-use policy enforced; classification scheme aligned to handling controls.",
  },
  {
    capabilitySlug: "data-governance-compliance-modvzptq-3f", // insurance
    requiredMaturity: 70,
    priority: "required",
    article: "ISO 27001:2022 A.5.9-12",
    evidenceNotes: "Information assets inventoried with owners; classification scheme enforced via data-governance automation; handling rules per classification level.",
  },
  {
    capabilitySlug: "third-party-vendor-risk-management-modw24yr-gx", // banking
    requiredMaturity: 75,
    priority: "required",
    article: "ISO 27001:2022 A.5.19-23",
    evidenceNotes: "Information security in supplier relationships — pre-contract assessment, contractual obligations, monitoring, and managed changes to third-party services.",
  },
  {
    capabilitySlug: "third-party-risk-intelligence-modvylvz-m", // insurance
    requiredMaturity: 70,
    priority: "required",
    article: "ISO 27001:2022 A.5.19-23",
    evidenceNotes: "Continuous third-party risk intelligence on critical suppliers; periodic reassessment of supplier security posture; contractual security clauses enforced.",
  },
  {
    capabilitySlug: "supply-chain-compliance-risk-management-modw35nf-fl", // manufacturing
    requiredMaturity: 65,
    priority: "required",
    article: "ISO 27001:2022 A.5.19-23",
    evidenceNotes: "Supplier information-security clauses for industrial supply chain; cybersecurity assessment integrated with quality + compliance audits.",
  },
  {
    capabilitySlug: "advanced-threat-intelligence-response-modw24yw-j6", // banking
    requiredMaturity: 75,
    priority: "required",
    article: "ISO 27001:2022 A.5.7, A.5.24-28",
    evidenceNotes: "Threat intelligence feeds informing detection rules; documented incident-management process with classification, escalation, and forensic capability.",
  },
  {
    capabilitySlug: "threat-detection-response-modw4q88-fs", // technology
    requiredMaturity: 75,
    priority: "required",
    article: "ISO 27001:2022 A.5.7, A.5.24-28",
    evidenceNotes: "Threat-led detection with documented analyst runbooks; incident-response playbooks per severity tier; lessons-learned feed back into ISMS.",
  },
  {
    capabilitySlug: "adverse-event-reporting-learning-systems-modw13ng-7w", // healthcare
    requiredMaturity: 65,
    priority: "required",
    article: "ISO 27001:2022 A.5.24-28",
    evidenceNotes: "Incident-management process applies to information-security incidents; structured reporting, evidence collection, and post-incident learning.",
  },

  // ── Annex A.6 — People controls ──
  // A.6.1 Screening, A.6.3 Awareness training, A.6.6 Confidentiality, A.6.8 Reporting
  {
    capabilitySlug: "credentialing-compliance-lifecycle-modw0t7u-r0", // healthcare
    requiredMaturity: 70,
    priority: "required",
    article: "ISO 27001:2022 A.6.1, A.6.3",
    evidenceNotes: "Pre-employment screening + ongoing credentialing covers information-security responsibilities; security awareness training tracked per role.",
  },
  {
    capabilitySlug: "safety-training-competency-certification-modw3qg6-4g", // manufacturing
    requiredMaturity: 65,
    priority: "required",
    article: "ISO 27001:2022 A.6.3",
    evidenceNotes: "Workforce training covers cybersecurity hygiene alongside safety competencies; certification tracked per worker role and access level.",
  },

  // ── Annex A.7 — Physical controls ──
  {
    capabilitySlug: "store-compliance-loss-prevention-modw6lsm-c3", // retail
    requiredMaturity: 65,
    priority: "required",
    article: "ISO 27001:2022 A.7.1-A.7.4",
    evidenceNotes: "Store physical security: access control to secure areas (POS, server rooms), CCTV monitoring, visitor management, and clear-screen/desk policy.",
  },
  {
    capabilitySlug: "hazard-assessment-risk-management-modw3qg2-3t", // manufacturing
    requiredMaturity: 65,
    priority: "required",
    article: "ISO 27001:2022 A.7.1-A.7.14",
    evidenceNotes: "Physical security of OT/ICS environments — secure perimeters, access control to control rooms, equipment protection, secure disposal.",
  },

  // ── Annex A.8 — Technological controls ──
  // A.8.1-2 Endpoints, A.8.3-9 Privileged access + auth, A.8.10-14 Data + crypto,
  // A.8.15-19 Logging + monitoring, A.8.20-23 Network, A.8.24-25 Crypto/secure dev,
  // A.8.26-34 App security, change/test management
  {
    capabilitySlug: "identity-verification-authentication-modw24yj-km", // banking
    requiredMaturity: 80,
    priority: "required",
    article: "ISO 27001:2022 A.8.2-9",
    evidenceNotes: "Strong authentication with MFA, privileged access management, and full audit trail; secure authentication enforced for all privileged operations.",
  },
  {
    capabilitySlug: "digital-identity-verification-modvylvr-ct", // insurance
    requiredMaturity: 75,
    priority: "required",
    article: "ISO 27001:2022 A.8.2-9",
    evidenceNotes: "Customer + workforce identity verification with MFA for privileged systems; access reviewed at least annually with documented recertification.",
  },
  {
    capabilitySlug: "identity-access-governance-modw4q8c-ig", // technology
    requiredMaturity: 80,
    priority: "required",
    article: "ISO 27001:2022 A.8.2-9",
    evidenceNotes: "Identity governance with RBAC, JIT elevation, periodic recertification, and centralized audit log; SCIM-based provisioning + de-provisioning.",
  },
  {
    capabilitySlug: "data-protection-privacy-compliance-modw4q8j-gx", // technology
    requiredMaturity: 80,
    priority: "required",
    article: "ISO 27001:2022 A.8.10-14, A.8.24",
    evidenceNotes: "Encryption at rest + in transit; key management with HSM-backed root keys; DLP for sensitive data; documented cryptographic policy.",
  },
  {
    capabilitySlug: "privacy-consent-data-access-control-modw0ycl-bd", // healthcare
    requiredMaturity: 70,
    priority: "required",
    article: "ISO 27001:2022 A.8.10-14",
    evidenceNotes: "Encryption + access controls for PHI; consent management; minimum-necessary enforcement on data sharing with downstream parties.",
  },
  {
    capabilitySlug: "data-quality-provenance-monitoring-modw0ycp-ic", // healthcare
    requiredMaturity: 65,
    priority: "required",
    article: "ISO 27001:2022 A.8.15-16",
    evidenceNotes: "Logging + monitoring of PHI access; immutable audit trails with provenance tracking; anomaly detection on access patterns.",
  },
  {
    capabilitySlug: "observability-telemetry-modw45t1-23", // technology
    requiredMaturity: 75,
    priority: "required",
    article: "ISO 27001:2022 A.8.15-16",
    evidenceNotes: "Logging, monitoring, and audit-trail capabilities supporting both observability and security analytics; retention sufficient for forensic + audit needs.",
  },
  {
    capabilitySlug: "vulnerability-patch-management-modw4q8f-h7", // technology
    requiredMaturity: 75,
    priority: "required",
    article: "ISO 27001:2022 A.8.8",
    evidenceNotes: "Continuous vulnerability scanning with risk-based remediation SLAs; critical and high vulnerabilities tracked with closure dates.",
  },
  {
    capabilitySlug: "cloud-security-compliance-automation-modw4ld4-qp", // technology
    requiredMaturity: 75,
    priority: "required",
    article: "ISO 27001:2022 A.8.6, A.8.23",
    evidenceNotes: "Cloud-security automation enforcing baseline configurations, identity controls, and compliance gates; documented secure-deployment guardrails.",
  },
  {
    capabilitySlug: "security-architecture-resilience-modw4q8p-ht", // technology
    requiredMaturity: 75,
    priority: "required",
    article: "ISO 27001:2022 A.8.20-23",
    evidenceNotes: "Security architecture with defense in depth, network segmentation, secure design patterns, and resilience controls baked into platform engineering.",
  },
  {
    capabilitySlug: "api-security-consent-management-modw2paf-36", // banking
    requiredMaturity: 70,
    priority: "required",
    article: "ISO 27001:2022 A.8.26-28",
    evidenceNotes: "Secure API design + lifecycle: authentication, authorization, rate limiting, schema validation, and consent capture for open-banking flows.",
  },
  {
    capabilitySlug: "release-management-governance-modw4b4u-r1", // technology
    requiredMaturity: 70,
    priority: "required",
    article: "ISO 27001:2022 A.8.31-34",
    evidenceNotes: "Change-management with documented approval, segregation of dev/test/prod environments, and rollback procedures.",
  },
];

proposeRequirements({
  regulationShortCode: "ISO-27001",
  proposedBy: "seed:iso-27001-requirements",
  logLabel: "seed:iso-27001-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:iso-27001-reqs] fatal:", err);
    process.exit(1);
  });
