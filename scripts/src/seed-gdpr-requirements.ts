/**
 * GDPR → capability requirement mapping seed.
 *
 * Two side-effects (both idempotent):
 *
 *   1. Updates the GDPR row's industries[] to include all 6 (insurance,
 *      healthcare, banking, manufacturing, retail, technology). The
 *      original GDPR row from initial DB setup has an empty array;
 *      GDPR applies to anyone processing EU residents' personal data
 *      regardless of sector.
 *
 *   2. Inserts/upserts 12 GDPR → capability requirements across the 6
 *      industries with article citations (e.g., "Art. 5", "Art. 32")
 *      and required-maturity thresholds.
 *
 * Lookups by slug (capability) and shortCode (regulation) so the script
 * is portable across environments. Uses the (regulation_id, capability_id)
 * unique index to upsert; re-run refreshes fields without duplicates.
 *
 * Exit codes:
 *   0 — success (incl. idempotent no-op)
 *   1 — DB connection error or GDPR row missing
 */
import { db, regulationsTable, capabilitiesTable, regulationCapabilityRequirementsTable, industriesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

interface RequirementMap {
  capabilitySlug: string;
  requiredMaturity: number;
  priority: "required" | "recommended" | "optional";
  article: string;
  evidenceNotes: string;
}

// One or two strong-fit caps per industry. GDPR applies broadly; this
// captures the dominant data-protection capability in each sector
// rather than mapping every loosely-related cap.
const REQUIREMENTS: RequirementMap[] = [
  // ── Insurance (industry 1) ──
  {
    capabilitySlug: "consumer-data-privacy-security-modvz7y6-9q",
    requiredMaturity: 75,
    priority: "required",
    article: "Art. 25, Art. 32",
    evidenceNotes: "Data protection by design and by default; appropriate technical and organisational measures securing processing.",
  },
  {
    capabilitySlug: "data-governance-compliance-modvzptq-3f",
    requiredMaturity: 70,
    priority: "required",
    article: "Art. 5, Art. 30",
    evidenceNotes: "Principles relating to processing (lawfulness, fairness, transparency, purpose limitation, minimisation); records of processing activities.",
  },

  // ── Healthcare (industry 2) ──
  // Note: this capability is also mapped to HIPAA. Both mappings coexist
  // since the unique index is (regulation_id, capability_id), not
  // capability_id alone — same capability, different regulatory hooks.
  {
    capabilitySlug: "privacy-consent-data-access-control-modw0ycl-bd",
    requiredMaturity: 75,
    priority: "required",
    article: "Art. 6, Art. 7, Art. 9",
    evidenceNotes: "Lawful basis for processing; conditions for explicit consent; processing of special category (health) data under Art. 9 exemptions.",
  },

  // ── Banking (industry 3) ──
  {
    capabilitySlug: "api-security-consent-management-modw2paf-36",
    requiredMaturity: 70,
    priority: "required",
    article: "Art. 25, Art. 7",
    evidenceNotes: "Privacy by design in API-mediated data sharing (open banking); granular consent capture, revocation, and audit trail.",
  },
  {
    capabilitySlug: "customer-data-platform-modw29vd-fa",
    requiredMaturity: 65,
    priority: "required",
    article: "Art. 5, Art. 17",
    evidenceNotes: "Data minimisation and storage limitation in the customer master; right to erasure (right to be forgotten) execution.",
  },

  // ── Manufacturing (industry 4) ──
  {
    capabilitySlug: "supply-chain-compliance-risk-management-modw35nf-fl",
    requiredMaturity: 60,
    priority: "recommended",
    article: "Art. 28, Art. 44",
    evidenceNotes: "Processor obligations in supplier contracts; safeguards for international transfers of personal data (e.g., SCCs).",
  },

  // ── Technology (industry 5) ──
  {
    capabilitySlug: "data-protection-privacy-compliance-modw4q8j-gx",
    requiredMaturity: 80,
    priority: "required",
    article: "Art. 5, Art. 25, Art. 32",
    evidenceNotes: "Tech sector is the heaviest-exposed industry under GDPR. Privacy-by-design across product surfaces; security of processing; DPIAs for high-risk new features.",
  },
  {
    capabilitySlug: "data-governance-lineage-modw51e4-oq",
    requiredMaturity: 70,
    priority: "required",
    article: "Art. 30",
    evidenceNotes: "Records of processing activities: data inventory with lineage from collection through retention and deletion.",
  },
  {
    capabilitySlug: "identity-access-governance-modw4q8c-ig",
    requiredMaturity: 70,
    priority: "required",
    article: "Art. 32",
    evidenceNotes: "Access control to personal data; least-privilege enforcement; periodic access reviews.",
  },

  // ── Retail (industry 6) ──
  {
    capabilitySlug: "privacy-consent-compliance-management-modw72iv-i7",
    requiredMaturity: 75,
    priority: "required",
    article: "Art. 6, Art. 7, Art. 13",
    evidenceNotes: "Lawful basis selection; consent management platform with revocation; transparent privacy notices at point of collection.",
  },
  {
    capabilitySlug: "consent-privacy-compliant-segmentation-modw5sg1-jr",
    requiredMaturity: 70,
    priority: "required",
    article: "Art. 7, Art. 22",
    evidenceNotes: "Profiling consent specificity; opt-out from automated decision-making with legal or significant effects.",
  },
  {
    capabilitySlug: "unified-customer-data-platform-modw5mww-e5",
    requiredMaturity: 65,
    priority: "required",
    article: "Art. 5, Art. 15, Art. 20",
    evidenceNotes: "Data minimisation and accuracy; data subject access requests (DSARs); data portability across systems.",
  },
];

async function main(): Promise<void> {
  const [gdpr] = await db.select().from(regulationsTable).where(eq(regulationsTable.shortCode, "GDPR"));
  if (!gdpr) {
    console.error("[seed:gdpr-reqs] FATAL: GDPR regulation row not found. Run `pnpm run seed:regulations` first.");
    process.exit(1);
  }
  console.log(`[seed:gdpr-reqs] GDPR id=${gdpr.id}, current industries=${JSON.stringify(gdpr.industries)}`);

  // Step 1: ensure GDPR's industries[] covers all 6.
  const allIndustries = await db.select().from(industriesTable);
  const allIds = allIndustries.map(i => i.id).sort((a, b) => a - b);
  const currentIds = (gdpr.industries ?? []).slice().sort((a, b) => a - b);
  const needsIndustryUpdate = allIds.length !== currentIds.length || allIds.some((id, i) => id !== currentIds[i]);
  if (needsIndustryUpdate) {
    await db.update(regulationsTable)
      .set({
        industries: allIds,
        // Backfill the placeholder name/description from the initial seed if
        // they're still the trivial "GDPR" placeholder.
        name: gdpr.name === "GDPR" ? "General Data Protection Regulation" : gdpr.name,
        description: gdpr.description === "GDPR" || !gdpr.description
          ? "EU regulation (2016/679) governing personal-data processing of EU residents. Establishes lawful bases, data subject rights (access, erasure, portability, restriction, objection), privacy by design, breach notification (72h), DPIAs for high-risk processing, and extraterritorial application."
          : gdpr.description,
        jurisdiction: gdpr.jurisdiction === "global" || !gdpr.jurisdiction ? "EU" : gdpr.jurisdiction,
        effectiveDate: gdpr.effectiveDate ?? new Date("2018-05-25"),
      })
      .where(eq(regulationsTable.id, gdpr.id));
    console.log(`[seed:gdpr-reqs] updated GDPR row — industries now ${JSON.stringify(allIds)}, name/desc/jurisdiction/effectiveDate normalized`);
  } else {
    console.log(`[seed:gdpr-reqs] GDPR industries already cover all 6 — skipping row update`);
  }

  // Step 2: requirement mappings.
  let inserted = 0, updated = 0, missing = 0;
  for (const req of REQUIREMENTS) {
    const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.slug, req.capabilitySlug));
    if (!cap) {
      console.warn(`[seed:gdpr-reqs] ⚠ capability not found: ${req.capabilitySlug} — skipping`);
      missing++;
      continue;
    }

    const [existing] = await db
      .select()
      .from(regulationCapabilityRequirementsTable)
      .where(
        and(
          eq(regulationCapabilityRequirementsTable.regulationId, gdpr.id),
          eq(regulationCapabilityRequirementsTable.capabilityId, cap.id),
        ),
      );

    if (existing) {
      await db
        .update(regulationCapabilityRequirementsTable)
        .set({
          requiredMaturity: req.requiredMaturity,
          priority: req.priority,
          article: req.article,
          evidenceNotes: req.evidenceNotes,
        })
        .where(eq(regulationCapabilityRequirementsTable.id, existing.id));
      updated++;
      console.log(`[seed:gdpr-reqs] updated ${cap.slug} → ${req.priority} @ ${req.requiredMaturity}`);
    } else {
      await db.insert(regulationCapabilityRequirementsTable).values({
        regulationId: gdpr.id,
        capabilityId: cap.id,
        requiredMaturity: req.requiredMaturity,
        priority: req.priority,
        article: req.article,
        evidenceNotes: req.evidenceNotes,
      });
      inserted++;
      console.log(`[seed:gdpr-reqs] inserted ${cap.slug} → ${req.priority} @ ${req.requiredMaturity}`);
    }
  }

  console.log(`\n[seed:gdpr-reqs] done — inserted=${inserted} updated=${updated} missing-caps=${missing}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("[seed:gdpr-reqs] fatal:", err);
    process.exit(1);
  });
