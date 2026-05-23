/**
 * DORA → capability requirement mapping seed.
 *
 * Maps the EU Digital Operational Resilience Act (Reg. (EU) 2022/2554)
 * to specific Banking + Insurance capabilities. Five DORA pillars:
 *   1. ICT risk management (Articles 5-16)
 *   2. ICT-related incident management, classification, reporting
 *      (Articles 17-23)
 *   3. Digital operational resilience testing — incl. TLPT for
 *      significant financial entities (Articles 24-27)
 *   4. ICT third-party risk management (Articles 28-44)
 *   5. Information-sharing arrangements (Article 45)
 *
 * Effective 17 January 2025; in active enforcement.
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index to
 * upsert. Re-running refreshes required_maturity / priority / article /
 * evidence_notes to current values without duplicating rows.
 *
 * Exit codes:
 *   0 — success (including idempotent no-op)
 *   1 — DB connection error or DORA row missing
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── ICT risk management framework (Articles 5-16) ──
  // Governance + management body accountability for ICT risk
  {
    capabilitySlug: "operational-risk-resilience-modw2etu-cz",
    requiredMaturity: 80,
    priority: "required",
    article: "DORA Art. 5-6",
    evidenceNotes: "ICT risk management framework with management-body accountability; integrates with the overall risk-management framework. Annual review required.",
  },
  {
    capabilitySlug: "regulatory-compliance-risk-management-modw2eu1-jm",
    requiredMaturity: 75,
    priority: "required",
    article: "DORA Art. 5(2), 6(8)",
    evidenceNotes: "Documented strategy on digital operational resilience approved by the management body; mapped to regulatory expectations from competent authorities.",
  },
  {
    capabilitySlug: "market-liquidity-risk-governance-modw2ety-bi",
    requiredMaturity: 70,
    priority: "recommended",
    article: "DORA Art. 6(8), 16",
    evidenceNotes: "Integration of ICT risk into overall financial risk taxonomy; impact assessment of ICT disruptions on liquidity and market access.",
  },
  // Asset identification + classification (Art. 8)
  {
    capabilitySlug: "data-analytics-fabric-modw29v1-dr",
    requiredMaturity: 70,
    priority: "required",
    article: "DORA Art. 8",
    evidenceNotes: "Inventory of ICT-supported business functions, information assets, and ICT assets with criticality classification; updated on every material change.",
  },
  // Protection + prevention (Art. 9)
  {
    capabilitySlug: "security-compliance-engine-modw29v9-i4",
    requiredMaturity: 80,
    priority: "required",
    article: "DORA Art. 9",
    evidenceNotes: "ICT security policies + procedures covering confidentiality, integrity, availability, and authenticity of data; network segmentation and identity controls.",
  },
  {
    capabilitySlug: "identity-verification-authentication-modw24yj-km",
    requiredMaturity: 80,
    priority: "required",
    article: "DORA Art. 9(4)(d), 15",
    evidenceNotes: "Strong identity and access management with least-privilege controls, MFA for privileged access, and continuous monitoring of access events.",
  },
  {
    capabilitySlug: "api-security-consent-management-modw2paf-36",
    requiredMaturity: 75,
    priority: "required",
    article: "DORA Art. 9(4)(c)",
    evidenceNotes: "Secure API design with authentication, authorization, rate limiting, and consent capture — critical for open-banking + embedded-finance flows.",
  },
  // Detection + monitoring (Art. 10)
  {
    capabilitySlug: "advanced-threat-intelligence-response-modw24yw-j6",
    requiredMaturity: 80,
    priority: "required",
    article: "DORA Art. 10",
    evidenceNotes: "Continuous detection of anomalous activities with documented alerting thresholds and SOC integration; logged events retained for audit.",
  },
  {
    capabilitySlug: "transaction-monitoring-anomaly-detection-modw24yb-3b",
    requiredMaturity: 75,
    priority: "required",
    article: "DORA Art. 10(1)(c)",
    evidenceNotes: "Real-time monitoring of transaction flows for anomalies + automated alert routing to incident response; integrates with fraud + AML monitoring.",
  },
  // Response + recovery (Art. 11-12)
  {
    capabilitySlug: "core-processing-engine-modw29uw-h4",
    requiredMaturity: 75,
    priority: "required",
    article: "DORA Art. 11-12",
    evidenceNotes: "ICT business-continuity policy with documented response and recovery plans; recovery time and recovery point objectives defined per critical or important function.",
  },
  // Learning + evolving (Art. 13)
  {
    capabilitySlug: "compliance-fraud-risk-monitoring-modw1shx-3f",
    requiredMaturity: 70,
    priority: "required",
    article: "DORA Art. 13",
    evidenceNotes: "Post-incident reviews feed back into the ICT risk framework; lessons-learned tracking with action-item closure and management-body reporting.",
  },

  // ── ICT-related incident management + reporting (Articles 17-23) ──
  {
    capabilitySlug: "operational-risk-resilience-modw2etu-cz",
    requiredMaturity: 80,
    priority: "required",
    article: "DORA Art. 17",
    evidenceNotes: "Process for identifying, classifying, recording, and managing ICT-related incidents; classification per Art. 18 criteria (severity, geographical spread, duration, data losses).",
  },
  {
    capabilitySlug: "regulatory-explainable-compliance-scoring-modw2js9-pd",
    requiredMaturity: 80,
    priority: "required",
    article: "DORA Art. 19",
    evidenceNotes: "Mandatory notification of major ICT-related incidents to competent authority within prescribed timeframes (initial, intermediate, final reports per RTS).",
  },

  // ── Digital operational resilience testing (Articles 24-27) ──
  {
    capabilitySlug: "operational-risk-resilience-modw2etu-cz",
    requiredMaturity: 80,
    priority: "required",
    article: "DORA Art. 24-25",
    evidenceNotes: "Comprehensive testing program: vulnerability assessments, scenario-based tests, performance tests, end-to-end testing, and penetration testing at least annually.",
  },
  {
    capabilitySlug: "compliance-fraud-risk-monitoring-modw1shx-3f",
    requiredMaturity: 80,
    priority: "required",
    article: "DORA Art. 26-27",
    evidenceNotes: "Threat-led penetration testing (TLPT) every 3 years for significant financial entities; pool of EU-recognized testers per Art. 27.",
  },

  // ── ICT third-party risk management (Articles 28-44) ──
  {
    capabilitySlug: "third-party-vendor-risk-management-modw24yr-gx",
    requiredMaturity: 80,
    priority: "required",
    article: "DORA Art. 28-30",
    evidenceNotes: "Pre-contractual due diligence on ICT third-party service providers; documented strategy on ICT third-party risk with concentration analysis.",
  },
  {
    capabilitySlug: "regulatory-compliance-risk-management-modw2eu1-jm",
    requiredMaturity: 75,
    priority: "required",
    article: "DORA Art. 30",
    evidenceNotes: "Contractual provisions per Art. 30 — exit strategies, audit rights, data location, security requirements, sub-outsourcing constraints.",
  },
  {
    capabilitySlug: "compliance-fraud-risk-monitoring-modw1shx-3f",
    requiredMaturity: 75,
    priority: "required",
    article: "DORA Art. 28(3)",
    evidenceNotes: "Maintain and report ICT third-party register to competent authority on request; identify critical third-party providers for designation.",
  },

  // ── Insurance-side mappings ──
  // ICT risk management as part of governance (Solvency II Pillar 2 overlap)
  {
    capabilitySlug: "regulatory-compliance-data-governance-automation-modvywyy-ld",
    requiredMaturity: 80,
    priority: "required",
    article: "DORA Art. 5-6, 8",
    evidenceNotes: "ICT risk-management framework integrated with insurer governance; asset and information-system classification with criticality tagging.",
  },
  {
    capabilitySlug: "regulatory-compliance",
    requiredMaturity: 75,
    priority: "required",
    article: "DORA Art. 5-16",
    evidenceNotes: "End-to-end regulatory compliance reporting on ICT risk posture; integrates with overall insurer compliance + audit calendar.",
  },
  // Identity + access management (Art. 9)
  {
    capabilitySlug: "digital-identity-verification-modvylvr-ct",
    requiredMaturity: 75,
    priority: "required",
    article: "DORA Art. 9(4)(d)",
    evidenceNotes: "Strong customer + workforce identity verification with MFA for privileged systems; revocation on role change or termination.",
  },
  // Third-party risk for outsourced claims / underwriting platforms
  {
    capabilitySlug: "third-party-risk-intelligence-modvylvz-m",
    requiredMaturity: 80,
    priority: "required",
    article: "DORA Art. 28-30",
    evidenceNotes: "Continuous third-party risk intelligence on ICT vendors (claims platforms, policy admin systems, cloud); concentration + sub-outsourcing tracking.",
  },
  // Anti-fraud + detection
  {
    capabilitySlug: "anti-fraud-detection-prevention-modvz7yj-cb",
    requiredMaturity: 75,
    priority: "required",
    article: "DORA Art. 10",
    evidenceNotes: "Real-time anomaly detection on claims + payment flows with documented escalation paths; feeds incident-management process.",
  },
  // Claims operational resilience (critical important function)
  {
    capabilitySlug: "claims-experience-management-modvz2j8-it",
    requiredMaturity: 70,
    priority: "required",
    article: "DORA Art. 11-12",
    evidenceNotes: "Claims is a critical/important function under DORA; documented RTO/RPO for claims platforms and supporting third-party services.",
  },
  // Data governance + compliance backbone
  {
    capabilitySlug: "data-governance-compliance-modvzptq-3f",
    requiredMaturity: 75,
    priority: "required",
    article: "DORA Art. 8, 9",
    evidenceNotes: "Information-asset classification + data-protection controls aligned to ICT risk taxonomy; supports both DORA Art. 8 inventory and Art. 9 protection.",
  },
  // Audit + licensing operations for reporting
  {
    capabilitySlug: "compliance-licensing-operations-modvzjnv-39",
    requiredMaturity: 70,
    priority: "required",
    article: "DORA Art. 19, 28(3)",
    evidenceNotes: "Operational backbone for incident reporting + third-party register submission to competent authority; audit-trail integrity for regulator inquiry.",
  },
];

proposeRequirements({
  regulationShortCode: "DORA",
  proposedBy: "seed:dora-requirements",
  logLabel: "seed:dora-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:dora-reqs] fatal:", err);
    process.exit(1);
  });
