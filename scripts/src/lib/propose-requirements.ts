/**
 * Shared helper for the three regulation-requirement seed scripts
 * (HIPAA, GDPR, SOX). All three follow the same pattern:
 *
 *   1. Look up the live regulation by shortCode
 *   2. For each requirement, look up the capability by slug
 *   3. Upsert (regulationId, capabilityId, requiredMaturity, ...)
 *      DIRECTLY into the live regulation_capability_requirements table
 *   4. Idempotent on (regulation_id, capability_id) — re-running refreshes
 *      requiredMaturity / priority / article / evidence_notes without
 *      duplicating rows.
 *
 * Cutover 2026-05-23: previously this wrote to
 * regulation_requirements_proposed and required admin approval at
 * /admin/review-queue, which left the /regulations page empty on every
 * fresh deploy. The starter mappings here are curated reference content,
 * not free-form user submissions — they ship live.
 *
 * Living in one place means future requirement-seed scripts (PCI-DSS,
 * Basel III, etc.) just import this and pass data.
 */
import { db, regulationsTable, capabilitiesTable, regulationCapabilityRequirementsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export interface RequirementSeed {
  capabilitySlug: string;
  requiredMaturity: number;
  priority: "required" | "recommended" | "optional";
  article: string;
  evidenceNotes: string;
}

export interface ProposeRequirementsOptions {
  regulationShortCode: string;
  proposedBy: string;       // e.g., "seed:hipaa-requirements" — kept for log compat
  requirements: RequirementSeed[];
  /** If set, log lines use this label; defaults to proposedBy. */
  logLabel?: string;
}

export async function proposeRequirements(opts: ProposeRequirementsOptions): Promise<void> {
  const label = opts.logLabel ?? opts.proposedBy;

  const [reg] = await db.select().from(regulationsTable).where(eq(regulationsTable.shortCode, opts.regulationShortCode));
  if (!reg) {
    // Graceful skip — the seed:regulations starter pack should have populated
    // this; if missing, log and move on rather than fail the deploy.
    console.warn(`[${label}] regulation shortCode=${opts.regulationShortCode} not in regulations table — skip.`);
    return;
  }
  console.log(`[${label}] regulation id=${reg.id} (${opts.regulationShortCode})`);

  let inserted = 0, updated = 0, missingCaps = 0;

  for (const req of opts.requirements) {
    const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.slug, req.capabilitySlug));
    if (!cap) {
      console.warn(`[${label}] ⚠ capability not found: ${req.capabilitySlug} — skipping`);
      missingCaps++;
      continue;
    }

    const [existing] = await db
      .select()
      .from(regulationCapabilityRequirementsTable)
      .where(
        and(
          eq(regulationCapabilityRequirementsTable.regulationId, reg.id),
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
      continue;
    }

    await db.insert(regulationCapabilityRequirementsTable).values({
      regulationId: reg.id,
      capabilityId: cap.id,
      requiredMaturity: req.requiredMaturity,
      priority: req.priority,
      article: req.article,
      evidenceNotes: req.evidenceNotes,
    });
    inserted++;
    console.log(`[${label}] live ${cap.slug} → ${req.priority} @ ${req.requiredMaturity}  (${req.article})`);
  }

  console.log(`\n[${label}] done — inserted=${inserted} updated=${updated} missing-caps=${missingCaps}`);
}
