/**
 * PCI-DSS v4.0 → capability requirement mapping seed.
 *
 * Maps PCI-DSS v4.0 (effective March 2024, fully required March 2025)
 * to capabilities in Banking + Retail — the two industries with the
 * largest cardholder-data environments.
 *
 * PCI-DSS v4.0 organizes 12 high-level requirements into 6 control
 * objectives:
 *   Build + Maintain a Secure Network   (Req. 1-2)
 *   Protect Cardholder Data              (Req. 3-4)
 *   Maintain Vulnerability Management   (Req. 5-6)
 *   Implement Strong Access Control     (Req. 7-9)
 *   Regularly Monitor + Test Networks   (Req. 10-11)
 *   Maintain an Information Security
 *     Policy                            (Req. 12)
 *
 * Idempotent — uses the (regulation_id, capability_id) unique index.
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── Banking (industry 3) ──
  // Req. 3 — Protect stored account data
  {
    capabilitySlug: "data-protection-privacy-compliance-modw4q8j-gx", // (cross-listed; covered for banking through CDP)
    requiredMaturity: 80,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 3",
    evidenceNotes: "Protect stored account data: encryption, key management with split knowledge / dual control, data-retention limits, render PAN unreadable.",
  },
  {
    capabilitySlug: "core-processing-engine-modw29uw-h4",
    requiredMaturity: 80,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 3, 4",
    evidenceNotes: "Core processing handles PAN data — must encrypt at rest, encrypt transmissions of cardholder data across open public networks, and apply truncation/tokenization where displayed.",
  },
  // Req. 4 — Protect cardholder data with strong cryptography during transmission
  {
    capabilitySlug: "transaction-routing-switching-modw1shi-ph",
    requiredMaturity: 75,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 4",
    evidenceNotes: "Transaction routing must use TLS 1.2+ with strong cipher suites for cardholder data in transit; certificate management with rotation and pinning where feasible.",
  },
  // Req. 5 — Anti-malware
  {
    capabilitySlug: "advanced-threat-intelligence-response-modw24yw-j6",
    requiredMaturity: 75,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 5, 11",
    evidenceNotes: "Anti-malware deployed on all in-scope systems; threat intelligence informs detection rules; continuous monitoring of CDE for new threats.",
  },
  // Req. 6 — Develop + maintain secure systems
  {
    capabilitySlug: "security-compliance-engine-modw29v9-i4",
    requiredMaturity: 75,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 6",
    evidenceNotes: "Secure software development with documented secure-coding standards, code review for in-scope changes, web-application protections (WAF / vulnerability scanning).",
  },
  // Req. 7-8 — Strong access control
  {
    capabilitySlug: "identity-verification-authentication-modw24yj-km",
    requiredMaturity: 85,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 7-8",
    evidenceNotes: "Identity + authentication: MFA for all non-console access into CDE; least-privilege RBAC; unique user IDs; password complexity per v4.0 baseline.",
  },
  // Req. 10 — Log + monitor
  {
    capabilitySlug: "compliance-fraud-risk-monitoring-modw1shx-3f",
    requiredMaturity: 80,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 10",
    evidenceNotes: "Log + monitor all access to network resources + cardholder data; daily log review with documented escalation; 1-year retention with 3 months immediately available.",
  },
  // Req. 11 — Regularly test security systems
  {
    capabilitySlug: "transaction-monitoring-anomaly-detection-modw24yb-3b",
    requiredMaturity: 70,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 10, 11",
    evidenceNotes: "Real-time anomaly detection feeding the monitoring program; intrusion-detection and vulnerability scanning at PCI-defined cadence.",
  },
  // Req. 12 — Information security policy + third-party risk
  {
    capabilitySlug: "third-party-vendor-risk-management-modw24yr-gx",
    requiredMaturity: 75,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 12.8-12.9",
    evidenceNotes: "Third-party-service-provider (TPSP) management: maintain list, written agreements + responsibility matrix, monitor TPSP PCI compliance status annually.",
  },
  // Fraud prevention sits adjacent
  {
    capabilitySlug: "fraud-prevention-bank",
    requiredMaturity: 75,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 10, 11",
    evidenceNotes: "Fraud prevention overlaps PCI monitoring obligations — continuous anomaly detection on payment flows + escalation to the security incident response process.",
  },

  // ── Retail (industry 6) ──
  // Req. 3-4 — Cardholder data protection
  {
    capabilitySlug: "payment-fraud-risk-management-modw6s7a-iu",
    requiredMaturity: 80,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 3-4, 10",
    evidenceNotes: "Payment + fraud risk management is the retail PCI scope-owner: encrypt stored PAN, encrypt transmissions, monitor + alert on suspicious patterns.",
  },
  {
    capabilitySlug: "cross-channel-payment-loyalty-integration-modw5mxd-gf",
    requiredMaturity: 75,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 3-4",
    evidenceNotes: "Cross-channel payment + loyalty must avoid storing sensitive authentication data post-authorization; tokenization where loyalty cards link to cards.",
  },
  // Req. 7-8 — Access control at store + online
  {
    capabilitySlug: "store-compliance-loss-prevention-modw6lsm-c3",
    requiredMaturity: 70,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 7-9",
    evidenceNotes: "Store compliance owns physical + logical access to in-store POS systems: badge access to back-of-house, terminal-level authentication, tamper-evident hardware checks.",
  },
  // Req. 10-11 — Monitor + test
  {
    capabilitySlug: "ecommerce-platform",
    requiredMaturity: 75,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 6, 10-11",
    evidenceNotes: "Web platform: protect against OWASP-top-10 (Req. 6.2.4); log payment-page activity; quarterly external ASV scans + annual penetration tests per Req. 11.",
  },
  // Req. 12 — TPSP for payment processors + gateways
  {
    capabilitySlug: "supplier-quality-compliance-management-modw6x62-8b",
    requiredMaturity: 70,
    priority: "required",
    article: "PCI-DSS v4.0 Req. 12.8-12.9",
    evidenceNotes: "Supplier compliance management extends to payment processors + gateways; track their AOCs, written responsibility matrix, and annual review.",
  },
  // Privacy / consent boundary for loyalty data
  {
    capabilitySlug: "privacy-consent-compliance-management-modw72iv-i7",
    requiredMaturity: 65,
    priority: "recommended",
    article: "PCI-DSS v4.0 Req. 3.1",
    evidenceNotes: "Data-retention minimization for cardholder data in loyalty + analytics flows; documented purpose for each retained element.",
  },
];

proposeRequirements({
  regulationShortCode: "PCI-DSS",
  proposedBy: "seed:pci-dss-requirements",
  logLabel: "seed:pci-dss-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:pci-dss-reqs] fatal:", err);
    process.exit(1);
  });
