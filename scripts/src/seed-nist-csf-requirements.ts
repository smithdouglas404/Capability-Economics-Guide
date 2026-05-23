/**
 * NIST CSF 2.0 → capability requirement mapping seed.
 *
 * Maps the NIST Cybersecurity Framework v2.0 to capabilities across all
 * six industries. CSF 2.0 introduces a Govern function in addition to
 * the original Identify, Protect, Detect, Respond, Recover.
 *
 * Voluntary framework — but de facto required for US federal contractors
 * (NIST SP 800-53), critical-infrastructure operators (CISA), and
 * increasingly cited in state breach-disclosure statutes.
 *
 * Cross-industry: cybersecurity is universal. Mapped here against the
 * highest-leverage capability in each industry; each org can extend the
 * mapping with industry-specific subprocesses.
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index to
 * upsert. Re-running refreshes required_maturity / priority / article /
 * evidence_notes without duplicating rows.
 *
 * Exit codes:
 *   0 — success (including idempotent no-op)
 *   1 — DB connection error or NIST-CSF row missing
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── GOVERN (CSF 2.0 new function — GV) ──
  // Cybersecurity governance is owned and accountable at the management body.
  {
    capabilitySlug: "operational-risk-resilience-modw2etu-cz", // banking
    requiredMaturity: 70,
    priority: "required",
    article: "CSF 2.0 GV.OC, GV.RM",
    evidenceNotes: "Organizational context and cybersecurity risk-management strategy with management-body oversight; risk appetite documented and reviewed at least annually.",
  },
  {
    capabilitySlug: "regulatory-compliance-data-governance-automation-modvywyy-ld", // insurance
    requiredMaturity: 70,
    priority: "required",
    article: "CSF 2.0 GV.OC, GV.PO",
    evidenceNotes: "Cybersecurity policy framework integrated with insurer governance; covers roles, responsibilities, authorities, and oversight.",
  },
  {
    capabilitySlug: "security-compliance-guardrails-modw45tg-f2", // technology
    requiredMaturity: 75,
    priority: "required",
    article: "CSF 2.0 GV.RR, GV.SC",
    evidenceNotes: "Roles, responsibilities, and supply-chain cybersecurity risk management embedded in platform engineering practices; codified as guardrails not policy documents.",
  },

  // ── IDENTIFY (ID) ──
  // Asset management, business environment, risk assessment, supply chain
  {
    capabilitySlug: "data-analytics-fabric-modw29v1-dr", // banking
    requiredMaturity: 65,
    priority: "required",
    article: "CSF 2.0 ID.AM",
    evidenceNotes: "Asset inventory of hardware, software, data, and external systems; criticality and sensitivity classification per asset class.",
  },
  {
    capabilitySlug: "data-ingestion-integration-modvzptl-6m", // insurance
    requiredMaturity: 65,
    priority: "required",
    article: "CSF 2.0 ID.AM, ID.RA",
    evidenceNotes: "Data-flow inventory across ingestion + integration paths; supports asset identification and risk assessment for third-party data exchanges.",
  },
  {
    capabilitySlug: "third-party-vendor-risk-management-modw24yr-gx", // banking
    requiredMaturity: 70,
    priority: "required",
    article: "CSF 2.0 ID.SC",
    evidenceNotes: "Supply-chain risk management process with documented third-party cybersecurity due diligence and ongoing monitoring of critical providers.",
  },
  {
    capabilitySlug: "third-party-risk-intelligence-modvylvz-m", // insurance
    requiredMaturity: 70,
    priority: "required",
    article: "CSF 2.0 ID.SC",
    evidenceNotes: "Continuous third-party risk intelligence on outsourced claims, underwriting, and policy-admin platforms; concentration analysis.",
  },
  {
    capabilitySlug: "supply-chain-compliance-risk-management-modw35nf-fl", // manufacturing
    requiredMaturity: 65,
    priority: "required",
    article: "CSF 2.0 ID.SC",
    evidenceNotes: "Industrial supply chain — supplier cybersecurity assessment, contract security clauses, and ongoing risk monitoring per supplier criticality.",
  },

  // ── PROTECT (PR) ──
  // Identity management, awareness, data security, processes, maintenance, tech protections
  {
    capabilitySlug: "identity-verification-authentication-modw24yj-km", // banking
    requiredMaturity: 80,
    priority: "required",
    article: "CSF 2.0 PR.AA",
    evidenceNotes: "Identity, credential, and access management with MFA for privileged access; periodic access recertification; just-in-time elevation for sensitive operations.",
  },
  {
    capabilitySlug: "digital-identity-verification-modvylvr-ct", // insurance
    requiredMaturity: 75,
    priority: "required",
    article: "CSF 2.0 PR.AA",
    evidenceNotes: "Strong customer + workforce identity verification with MFA; revocation on role change or termination; periodic recertification.",
  },
  {
    capabilitySlug: "identity-access-governance-modw4q8c-ig", // technology
    requiredMaturity: 80,
    priority: "required",
    article: "CSF 2.0 PR.AA",
    evidenceNotes: "Identity governance across all production systems; role-based access control with least-privilege; SCIM-based provisioning; centralized audit log.",
  },
  {
    capabilitySlug: "privacy-consent-data-access-control-modw0ycl-bd", // healthcare
    requiredMaturity: 75,
    priority: "required",
    article: "CSF 2.0 PR.AA, PR.DS",
    evidenceNotes: "PHI access controls per minimum-necessary; consent management for downstream data sharing; encryption at rest and in transit.",
  },
  {
    capabilitySlug: "data-protection-privacy-compliance-modw4q8j-gx", // technology
    requiredMaturity: 80,
    priority: "required",
    article: "CSF 2.0 PR.DS",
    evidenceNotes: "Data protection program covering at-rest, in-transit, and in-use encryption; DLP for sensitive data; data classification policy enforced via code.",
  },
  {
    capabilitySlug: "consumer-data-privacy-security-modvz7y6-9q", // insurance
    requiredMaturity: 75,
    priority: "required",
    article: "CSF 2.0 PR.DS",
    evidenceNotes: "Consumer data protection: encryption, access controls, retention/deletion procedures, and breach-prevention monitoring.",
  },
  {
    capabilitySlug: "vulnerability-patch-management-modw4q8f-h7", // technology
    requiredMaturity: 75,
    priority: "required",
    article: "CSF 2.0 PR.IR, PR.PS",
    evidenceNotes: "Vulnerability scanning + patch management with risk-based remediation SLAs; critical and high vulnerabilities tracked with closure dates.",
  },
  {
    capabilitySlug: "security-architecture-resilience-modw4q8p-ht", // technology
    requiredMaturity: 75,
    priority: "required",
    article: "CSF 2.0 PR.IR",
    evidenceNotes: "Security architecture documented with defense-in-depth controls, network segmentation, and resilience considerations baked into design reviews.",
  },
  {
    capabilitySlug: "store-compliance-loss-prevention-modw6lsm-c3", // retail
    requiredMaturity: 65,
    priority: "required",
    article: "CSF 2.0 PR.IR",
    evidenceNotes: "Store-level information protection: POS terminal hardening, in-store network segmentation, and physical access controls protecting payment + customer data.",
  },
  {
    capabilitySlug: "hazard-assessment-risk-management-modw3qg2-3t", // manufacturing
    requiredMaturity: 65,
    priority: "required",
    article: "CSF 2.0 PR.IR",
    evidenceNotes: "OT/ICS protection integrated with IT cybersecurity — air-gapping, network segmentation, and protocol-aware controls per IEC 62443.",
  },

  // ── DETECT (DE) ──
  {
    capabilitySlug: "advanced-threat-intelligence-response-modw24yw-j6", // banking
    requiredMaturity: 75,
    priority: "required",
    article: "CSF 2.0 DE.CM, DE.AE",
    evidenceNotes: "Continuous monitoring with documented alert thresholds, automated correlation across log sources, and tiered SOC triage with documented runbooks.",
  },
  {
    capabilitySlug: "threat-detection-response-modw4q88-fs", // technology
    requiredMaturity: 80,
    priority: "required",
    article: "CSF 2.0 DE.CM, DE.AE",
    evidenceNotes: "EDR/NDR with behavioral baselining; automated detection of anomalous activity; SOAR-based investigation workflow for L1 / L2 escalation.",
  },
  {
    capabilitySlug: "anti-fraud-detection-prevention-modvz7yj-cb", // insurance
    requiredMaturity: 70,
    priority: "required",
    article: "CSF 2.0 DE.CM",
    evidenceNotes: "Anti-fraud monitoring covers cyber-enabled claim fraud and account takeover; real-time anomaly detection on suspicious user + payment patterns.",
  },
  {
    capabilitySlug: "observability-telemetry-modw45t1-23", // technology
    requiredMaturity: 75,
    priority: "required",
    article: "CSF 2.0 DE.CM",
    evidenceNotes: "Comprehensive telemetry collection (logs, metrics, traces) supporting both reliability and security analytics; retention sufficient for forensic investigation.",
  },

  // ── RESPOND (RS) ──
  {
    capabilitySlug: "adverse-event-reporting-learning-systems-modw13ng-7w", // healthcare
    requiredMaturity: 70,
    priority: "required",
    article: "CSF 2.0 RS.MA",
    evidenceNotes: "Adverse-event reporting extends to cybersecurity incidents: structured intake, classification, escalation, and learning-system integration for post-incident review.",
  },
  {
    capabilitySlug: "operational-risk-resilience-modw2etu-cz", // banking — secondary mapping
    requiredMaturity: 70,
    priority: "required",
    article: "CSF 2.0 RS.MA, RS.AN",
    evidenceNotes: "Incident-response plan with documented playbooks, on-call rotation, and analyst forensic capabilities; tabletop exercises at least annually.",
  },
  {
    capabilitySlug: "emergency-response-business-continuity-modw3qgj-mv", // manufacturing
    requiredMaturity: 65,
    priority: "required",
    article: "CSF 2.0 RS.MA, RS.CO",
    evidenceNotes: "Coordinated emergency response that spans cyber + physical safety events; communication protocols with external stakeholders during major incidents.",
  },

  // ── RECOVER (RC) ──
  {
    capabilitySlug: "cloud-disaster-recovery-business-continuity-modw4ldg-4j", // technology
    requiredMaturity: 75,
    priority: "required",
    article: "CSF 2.0 RC.RP, RC.IM",
    evidenceNotes: "Documented disaster recovery plans with defined RTO/RPO; regular restore tests; lessons-learned process feeds improvements back into runbooks.",
  },
  {
    capabilitySlug: "core-processing-engine-modw29uw-h4", // banking
    requiredMaturity: 75,
    priority: "required",
    article: "CSF 2.0 RC.RP",
    evidenceNotes: "Core-system recovery procedures with defined RTO/RPO per critical function; quarterly restore tests including end-to-end transaction flow validation.",
  },
];

proposeRequirements({
  regulationShortCode: "NIST-CSF",
  proposedBy: "seed:nist-csf-requirements",
  logLabel: "seed:nist-csf-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:nist-csf-reqs] fatal:", err);
    process.exit(1);
  });
