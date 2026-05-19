/**
 * SOX → capability requirement mapping seed.
 *
 * SOX (Sarbanes-Oxley Act 2002) applies to US-listed public companies
 * across all sectors. Coverage in this seed mirrors seed-regulations.ts:
 * Insurance, Banking, Manufacturing, Retail, Technology. Healthcare
 * companies are also SOX-bound when listed, but the existing seed
 * scopes Healthcare to HIPAA's regulatory focus; add SOX mappings to
 * specific Healthcare caps separately if a public hospital system needs
 * the cross-walk.
 *
 * The 16 mappings hang off two sections that drive operational control
 * design:
 *
 *   Sec. 302 — Management certification of disclosures (CEO/CFO sign
 *              that quarterly + annual financial reports fairly present
 *              financial condition, with effective disclosure controls).
 *
 *   Sec. 404(a) — Management assessment of Internal Control over
 *                 Financial Reporting (ICFR). The dominant SOX cost
 *                 center — entity-level controls, process controls
 *                 (revenue, expenditure, inventory, payroll, treasury),
 *                 and IT general controls (access, change management,
 *                 operations).
 *
 * Lookups by slug (capability) + shortCode (regulation). Idempotent:
 * (regulation_id, capability_id) unique index controls upsert. Safe
 * to re-run.
 *
 * Exit codes:
 *   0 — success (incl. idempotent no-op)
 *   1 — DB connection error or SOX row missing
 */
import { proposeRequirements, type RequirementSeed } from "./lib/propose-requirements";

const REQUIREMENTS: RequirementSeed[] = [
  // ── Insurance (industry 1) ──
  {
    capabilitySlug: "regulatory-compliance-reporting-modvylw9-ow",
    requiredMaturity: 75,
    priority: "required",
    article: "Sec. 302, Sec. 404(a)",
    evidenceNotes: "Quarterly/annual disclosure controls supporting CEO/CFO certification; reconciliation of statutory and GAAP financials.",
  },
  {
    capabilitySlug: "data-governance-compliance-modvzptq-3f",
    requiredMaturity: 70,
    priority: "required",
    article: "Sec. 404(a)",
    evidenceNotes: "Data integrity controls over financial reporting systems: source-to-disclosure lineage, change history, segregation enforcement.",
  },

  // ── Banking (industry 3) ──
  {
    capabilitySlug: "reconciliation-exception-management-modw1shp-db",
    requiredMaturity: 80,
    priority: "required",
    article: "Sec. 404(a) — Cash and General Ledger",
    evidenceNotes: "Account reconciliation is the canonical SOX 404 process control. Daily/monthly reconciliation with documented exception remediation and review approvals.",
  },
  {
    capabilitySlug: "risk-management-bank",
    requiredMaturity: 75,
    priority: "required",
    article: "Sec. 404(a) — Entity-level controls",
    evidenceNotes: "Tone-at-the-top and risk assessment process feeding the ICFR scoping and control rationalization that flows down to PCAOB-aligned audit work.",
  },
  {
    capabilitySlug: "security-compliance-engine-modw29v9-i4",
    requiredMaturity: 70,
    priority: "required",
    article: "Sec. 404(a) — IT General Controls (ITGCs)",
    evidenceNotes: "Logical access, change management, and computer operations ITGCs supporting reliance on automated controls in financial reporting systems.",
  },
  {
    capabilitySlug: "regulatory-explainable-compliance-scoring-modw2js9-pd",
    requiredMaturity: 65,
    priority: "recommended",
    article: "Sec. 302",
    evidenceNotes: "Explainable control evidence and management review support quarterly Sub-Certification process and 302 disclosure controls.",
  },

  // ── Manufacturing (industry 4) ──
  {
    capabilitySlug: "inventory-visibility-control-systems-modw40u0-nd",
    requiredMaturity: 70,
    priority: "required",
    article: "Sec. 404(a) — Inventory cycle",
    evidenceNotes: "Physical inventory and cycle counts with system-of-record integration; obsolescence reserves; standard cost variance review — directly material to financial reporting accuracy.",
  },
  {
    capabilitySlug: "supply-chain-visibility-control-tower-modw35nj-bo",
    requiredMaturity: 65,
    priority: "required",
    article: "Sec. 404(a) — Revenue and Cost of Sales",
    evidenceNotes: "Three-way match (PO/receipt/invoice) and shipment-to-revenue cutoff controls; period-end shipping cutoff is a high-risk SOX area for product companies.",
  },
  {
    capabilitySlug: "regulatory-compliance-certification-management-modw3hht-29",
    requiredMaturity: 60,
    priority: "recommended",
    article: "Sec. 302",
    evidenceNotes: "Product certification and supplier compliance evidence supporting management's quarterly representations on material exposures.",
  },

  // ── Technology (industry 5) — heaviest ITGC concentration ──
  {
    capabilitySlug: "release-management-governance-modw4b4u-r1",
    requiredMaturity: 80,
    priority: "required",
    article: "Sec. 404(a) — Change Management ITGC",
    evidenceNotes: "Segregated dev/prod, approval before promotion, traceability from ticket through deploy. Critical because most modern SaaS revenue systems sit on the platform team's release pipeline.",
  },
  {
    capabilitySlug: "identity-access-governance-modw4q8c-ig",
    requiredMaturity: 80,
    priority: "required",
    article: "Sec. 404(a) — Logical Access ITGC",
    evidenceNotes: "Segregation of duties between transaction entry, approval, and recording; quarterly user access reviews; privileged-access monitoring of financial systems.",
  },
  {
    capabilitySlug: "security-compliance-guardrails-modw45tg-f2",
    requiredMaturity: 75,
    priority: "required",
    article: "Sec. 404(a) — IT Operations ITGC",
    evidenceNotes: "Production monitoring, incident response, backup/recovery procedures supporting reliance on automated controls.",
  },
  {
    capabilitySlug: "data-governance-lineage-modw51e4-oq",
    requiredMaturity: 70,
    priority: "required",
    article: "Sec. 302, Sec. 404(a)",
    evidenceNotes: "Source-to-report lineage for revenue and key non-GAAP metrics; data quality monitoring with documented remediation evidence.",
  },

  // ── Retail (industry 6) ──
  {
    capabilitySlug: "store-compliance-loss-prevention-modw6lsm-c3",
    requiredMaturity: 70,
    priority: "required",
    article: "Sec. 404(a) — Inventory and Revenue",
    evidenceNotes: "Shrinkage controls, POS cash reconciliation, returns and refund authorization — material to financial reporting completeness and accuracy.",
  },
  {
    capabilitySlug: "supplier-quality-compliance-management-modw6x62-8b",
    requiredMaturity: 60,
    priority: "recommended",
    article: "Sec. 404(a) — Procure-to-Pay",
    evidenceNotes: "Supplier onboarding, three-way match, and AP cut-off discipline — supporting accuracy of inventory and operating expense reporting.",
  },
  {
    capabilitySlug: "identity-resolution-graph-modw72ic-is",
    requiredMaturity: 55,
    priority: "optional",
    article: "Sec. 302",
    evidenceNotes: "Customer entity resolution supports accurate revenue attribution across channels for disclosure controls; not material on its own but improves precision.",
  },
];

proposeRequirements({
  regulationShortCode: "SOX",
  proposedBy: "seed:sox-requirements",
  logLabel: "seed:sox-reqs",
  requirements: REQUIREMENTS,
})
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:sox-reqs] fatal:", err);
    process.exit(1);
  });
