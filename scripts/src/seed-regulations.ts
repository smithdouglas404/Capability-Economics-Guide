/**
 * Starter regulation seed — writes the 17 well-known frameworks DIRECTLY
 * into the live `regulations` table (idempotent on shortCode).
 *
 * Cutover 2026-05-23: previously this script wrote to regulations_proposed
 * and required an admin to manually approve each on /admin/review-queue.
 * That left /regulations empty on every fresh deploy, which is the wrong
 * default — the 17 frameworks here are well-known reference data, not
 * curation decisions.
 *
 * The proposal flow is still the right path for *new*, less well-known
 * regulations submitted by users or other seed scripts. This script
 * specifically covers the starter pack only.
 *
 * Idempotent on (short_code): re-running refreshes name, description,
 * jurisdiction, effective_date, and industries[] but never duplicates.
 *
 * Exit codes:
 *   0 — success (incl. idempotent no-op)
 *   1 — only on DB connection / catastrophic errors
 */
import { db, regulationsTable, industriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface RegSeed {
  shortCode: string;
  name: string;
  description: string;
  jurisdiction: string;
  effectiveDate: Date | null;
  industrySlugs: string[];
}

const SEED: RegSeed[] = [
  {
    shortCode: "HIPAA",
    name: "Health Insurance Portability and Accountability Act",
    description: "US law governing PHI privacy, security, and breach notification. Sets administrative, physical, and technical safeguards for covered entities and business associates.",
    jurisdiction: "US",
    effectiveDate: new Date("1996-08-21"),
    industrySlugs: ["healthcare"],
  },
  {
    shortCode: "HITECH",
    name: "Health Information Technology for Economic and Clinical Health Act",
    description: "Strengthens HIPAA enforcement, mandates breach notification, and incentivizes meaningful use of EHRs. Extends HIPAA obligations to business associates.",
    jurisdiction: "US",
    effectiveDate: new Date("2009-02-17"),
    industrySlugs: ["healthcare"],
  },
  {
    shortCode: "SOX",
    name: "Sarbanes-Oxley Act",
    description: "US federal law for public-company financial reporting integrity. Sections 302/404 require management certification and external audit of internal controls over financial reporting.",
    jurisdiction: "US",
    effectiveDate: new Date("2002-07-30"),
    industrySlugs: ["banking", "insurance", "technology", "manufacturing", "retail"],
  },
  {
    shortCode: "PCI-DSS",
    name: "Payment Card Industry Data Security Standard",
    description: "Global standard for organizations that store, process, or transmit cardholder data. Twelve high-level requirements covering network security, encryption, access control, monitoring, and incident response.",
    jurisdiction: "global",
    effectiveDate: new Date("2004-12-15"),
    industrySlugs: ["banking", "retail"],
  },
  {
    shortCode: "CCPA",
    name: "California Consumer Privacy Act",
    description: "Consumer-privacy rights for California residents: disclosure, access, deletion, opt-out of sale, non-discrimination. Amended by CPRA (2023).",
    jurisdiction: "US-CA",
    effectiveDate: new Date("2020-01-01"),
    industrySlugs: ["banking", "healthcare", "insurance", "manufacturing", "retail", "technology"],
  },
  {
    shortCode: "Basel-III",
    name: "Basel III",
    description: "International regulatory framework for banks covering capital adequacy, leverage, liquidity (LCR/NSFR), and stress testing. Phased implementation through Basel III Endgame.",
    jurisdiction: "global",
    effectiveDate: new Date("2013-01-01"),
    industrySlugs: ["banking"],
  },
  {
    shortCode: "MIFID-II",
    name: "Markets in Financial Instruments Directive II",
    description: "EU framework for investment services covering transparency, investor protection, transaction reporting, best execution, and product governance.",
    jurisdiction: "EU",
    effectiveDate: new Date("2018-01-03"),
    industrySlugs: ["banking", "insurance"],
  },
  {
    shortCode: "Solvency-II",
    name: "Solvency II",
    description: "EU prudential framework for insurers: quantitative capital requirements (SCR/MCR), governance and risk management standards (Pillar 2), and supervisory reporting (Pillar 3).",
    jurisdiction: "EU",
    effectiveDate: new Date("2016-01-01"),
    industrySlugs: ["insurance"],
  },
  {
    shortCode: "Dodd-Frank",
    name: "Dodd-Frank Wall Street Reform and Consumer Protection Act",
    description: "US post-2008-crisis financial reform. Volcker Rule, derivatives clearing, systemic risk oversight, consumer financial protection, and orderly liquidation authority.",
    jurisdiction: "US",
    effectiveDate: new Date("2010-07-21"),
    industrySlugs: ["banking", "insurance"],
  },
  {
    shortCode: "DORA",
    name: "Digital Operational Resilience Act",
    description: "EU regulation for ICT risk management at financial entities. Mandates incident reporting, operational resilience testing, third-party ICT risk oversight, and information sharing.",
    jurisdiction: "EU",
    effectiveDate: new Date("2025-01-17"),
    industrySlugs: ["banking", "insurance"],
  },
  {
    shortCode: "NIST-CSF",
    name: "NIST Cybersecurity Framework",
    description: "Voluntary framework (de facto standard for US federal contractors) organizing cybersecurity activities into Identify, Protect, Detect, Respond, Recover, and (CSF 2.0) Govern.",
    jurisdiction: "US",
    effectiveDate: new Date("2014-02-12"),
    industrySlugs: ["banking", "healthcare", "insurance", "manufacturing", "retail", "technology"],
  },
  {
    shortCode: "ISO-27001",
    name: "ISO/IEC 27001 Information Security Management",
    description: "International standard specifying requirements for an information security management system (ISMS). Annex A controls cover access, cryptography, supplier relationships, and incident management.",
    jurisdiction: "global",
    effectiveDate: new Date("2022-10-25"),
    industrySlugs: ["banking", "healthcare", "insurance", "manufacturing", "retail", "technology"],
  },
  {
    shortCode: "FedRAMP",
    name: "Federal Risk and Authorization Management Program",
    description: "Standardized approach to security assessment, authorization, and continuous monitoring for cloud products and services used by US federal agencies. Aligned to NIST SP 800-53.",
    jurisdiction: "US",
    effectiveDate: new Date("2011-12-08"),
    industrySlugs: ["technology"],
  },
  {
    shortCode: "21-CFR-Part-11",
    name: "FDA 21 CFR Part 11",
    description: "US FDA regulation on electronic records and electronic signatures in FDA-regulated industries. Validation, audit trails, access controls, and signature manifestation requirements.",
    jurisdiction: "US",
    effectiveDate: new Date("1997-08-20"),
    industrySlugs: ["healthcare", "manufacturing"],
  },
  {
    shortCode: "OSHA",
    name: "Occupational Safety and Health Act",
    description: "US law setting workplace safety standards. Coverage includes hazard communication, PPE, recordkeeping, and incident reporting for general industry and construction.",
    jurisdiction: "US",
    effectiveDate: new Date("1971-04-28"),
    industrySlugs: ["manufacturing"],
  },
  {
    shortCode: "EU-AI-Act",
    name: "EU AI Act",
    description: "Risk-tiered framework for AI systems placed on the EU market. Unacceptable-risk practices prohibited; high-risk systems subject to conformity assessment, transparency, and post-market monitoring.",
    jurisdiction: "EU",
    effectiveDate: new Date("2026-08-02"),
    industrySlugs: ["banking", "healthcare", "insurance", "manufacturing", "retail", "technology"],
  },
  {
    shortCode: "NAIC-MAR",
    name: "NAIC Model Audit Rule",
    description: "US state-adopted requirements for insurer financial reporting integrity, mirroring SOX. Independent audit of financial statements plus assessment of internal controls.",
    jurisdiction: "US",
    effectiveDate: new Date("2010-01-01"),
    industrySlugs: ["insurance"],
  },
];

async function main(): Promise<void> {
  // Resolve industry slugs → ids once
  const allIndustries = await db.select().from(industriesTable);
  const slugToId = new Map<string, number>();
  for (const i of allIndustries) slugToId.set(i.slug, i.id);

  // Index existing live regulations by short_code so we can upsert.
  const existingLive = await db.select().from(regulationsTable);
  const liveByShortCode = new Map(existingLive.map(r => [r.shortCode, r]));

  let inserted = 0, updated = 0;

  for (const reg of SEED) {
    const industries = reg.industrySlugs
      .map(slug => slugToId.get(slug))
      .filter((id): id is number => typeof id === "number");

    if (industries.length === 0) {
      console.warn(`[seed:regulations] ${reg.shortCode} — no matching industries (${reg.industrySlugs.join(", ")})`);
    }

    const existing = liveByShortCode.get(reg.shortCode);
    if (existing) {
      await db.update(regulationsTable).set({
        name: reg.name,
        description: reg.description,
        jurisdiction: reg.jurisdiction,
        effectiveDate: reg.effectiveDate,
        industries,
      }).where(eq(regulationsTable.id, existing.id));
      updated++;
      continue;
    }

    await db.insert(regulationsTable).values({
      name: reg.name,
      shortCode: reg.shortCode,
      description: reg.description,
      jurisdiction: reg.jurisdiction,
      effectiveDate: reg.effectiveDate,
      industries,
    });
    inserted++;
    console.log(`[seed:regulations] inserted ${reg.shortCode} → live (${industries.length} industries)`);
  }

  console.log(`\n[seed:regulations] done — inserted=${inserted} updated=${updated}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:regulations] fatal:", err);
    process.exit(1);
  });
