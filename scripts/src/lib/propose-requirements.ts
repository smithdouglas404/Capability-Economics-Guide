/**
 * Shared helper for the three regulation-requirement seed scripts
 * (HIPAA, GDPR, SOX). All three follow the same pattern:
 *
 *   1. Look up the live regulation by shortCode
 *   2. For each requirement, look up the capability by slug
 *   3. Propose the (regulationId, capabilityId, requiredMaturity, ...)
 *      mapping into regulation_requirements_proposed
 *   4. Idempotent on (regulationId, capabilityId, proposedBy) —
 *      re-running refreshes pending proposals, leaves approved alone.
 *
 * Living in one place means future requirement-seed scripts
 * (PCI-DSS, Basel III, etc.) just import this and pass data.
 */
import { db, regulationsTable, capabilitiesTable, regulationRequirementsProposedTable } from "@workspace/db";
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
  proposedBy: string;       // e.g., "seed:hipaa-requirements"
  requirements: RequirementSeed[];
  /** If set, log lines use this label; defaults to proposedBy. */
  logLabel?: string;
}

export async function proposeRequirements(opts: ProposeRequirementsOptions): Promise<void> {
  const force = process.env.FORCE === "1" || process.env.FORCE === "true";
  const label = opts.logLabel ?? opts.proposedBy;

  const [reg] = await db.select().from(regulationsTable).where(eq(regulationsTable.shortCode, opts.regulationShortCode));
  if (!reg) {
    console.error(`[${label}] FATAL: regulation shortCode=${opts.regulationShortCode} not found in live regulations table. Approve its proposal first.`);
    process.exit(1);
  }
  console.log(`[${label}] regulation id=${reg.id} (${opts.regulationShortCode})`);

  let proposed = 0, refreshed = 0, alreadyApproved = 0, missingCaps = 0;

  for (const req of opts.requirements) {
    const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.slug, req.capabilitySlug));
    if (!cap) {
      console.warn(`[${label}] ⚠ capability not found: ${req.capabilitySlug} — skipping`);
      missingCaps++;
      continue;
    }

    const [existing] = await db
      .select()
      .from(regulationRequirementsProposedTable)
      .where(
        and(
          eq(regulationRequirementsProposedTable.regulationId, reg.id),
          eq(regulationRequirementsProposedTable.capabilityId, cap.id),
          eq(regulationRequirementsProposedTable.proposedBy, opts.proposedBy),
        ),
      );

    if (existing) {
      if (existing.reviewStatus === "approved") {
        alreadyApproved++;
        continue;
      }
      if (existing.reviewStatus === "rejected" && !force) {
        console.log(`[${label}] ${cap.slug} previously rejected — skip (set FORCE=1 to re-propose)`);
        continue;
      }
      await db
        .update(regulationRequirementsProposedTable)
        .set({
          requiredMaturity: req.requiredMaturity,
          priority: req.priority,
          article: req.article,
          evidenceNotes: req.evidenceNotes,
          verificationNotes: `Refreshed by ${opts.proposedBy} on ${new Date().toISOString()}`,
        })
        .where(eq(regulationRequirementsProposedTable.id, existing.id));
      refreshed++;
      continue;
    }

    await db.insert(regulationRequirementsProposedTable).values({
      regulationId: reg.id,
      capabilityId: cap.id,
      requiredMaturity: req.requiredMaturity,
      priority: req.priority,
      article: req.article,
      evidenceNotes: req.evidenceNotes,
      proposedBy: opts.proposedBy,
      verificationNotes: `Curated mapping from ${opts.proposedBy}. Article citation: ${req.article}.`,
    });
    proposed++;
    console.log(`[${label}] proposed ${cap.slug} → ${req.priority} @ ${req.requiredMaturity}  (${req.article})`);
  }

  console.log(`\n[${label}] done — proposed=${proposed} refreshed=${refreshed} already-approved=${alreadyApproved} missing-caps=${missingCaps}`);
  console.log(`[${label}] Review at /admin/review-queue`);
}
