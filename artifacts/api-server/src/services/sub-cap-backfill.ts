import { db, capabilitiesTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { decomposeCapability } from "./sub-capability-generator";
import { logger } from "../lib/logger";

/**
 * Self-healing decomposition backfill. Runs on api-server boot and finds any
 * approved top-level capability (parentCapabilityId IS NULL) that has no
 * children, then calls decomposeCapability on it.
 *
 * Idempotent — `decomposeCapability` skips parents that already have children
 * or are already marked as in-flight, so re-running is safe. Boots that find
 * everything decomposed cost only one DB query.
 *
 * This exists because sub-capabilities are *generated* (Haiku call), not
 * seeded. Without a backfill on boot, a fresh DB would only ever have the
 * 60 top-level caps — so dev and staging drift apart silently the first
 * time someone triggers decomposition somewhere. Boot backfill drives every
 * environment toward the same canonical state.
 *
 * Cost: at most one Haiku call per missing parent (~$0.001 each, so ~$0.06
 * for a fully empty fleet of 60). Skipped runs are free.
 */
export async function backfillMissingSubCapabilities(opts: { childrenPerParent?: number } = {}): Promise<{ scanned: number; decomposed: number; skipped: number; failed: number }> {
  const childrenPerParent = opts.childrenPerParent ?? 5;

  // Subquery: capability ids that already have at least one child.
  const parentsWithChildren = sql<number>`SELECT DISTINCT parent_capability_id FROM capabilities WHERE parent_capability_id IS NOT NULL`;

  const candidates = await db
    .select({ id: capabilitiesTable.id, name: capabilitiesTable.name, industryId: capabilitiesTable.industryId })
    .from(capabilitiesTable)
    .where(and(
      isNull(capabilitiesTable.parentCapabilityId),
      eq(capabilitiesTable.reviewStatus, "approved"),
      sql`${capabilitiesTable.id} NOT IN (${parentsWithChildren})`,
    ));

  if (candidates.length === 0) {
    logger.info("[sub-cap-backfill] all approved top-level capabilities already decomposed");
    return { scanned: 0, decomposed: 0, skipped: 0, failed: 0 };
  }

  logger.info({ count: candidates.length }, "[sub-cap-backfill] decomposing missing parents");

  let decomposed = 0;
  let skipped = 0;
  let failed = 0;
  for (const parent of candidates) {
    try {
      const result = await decomposeCapability(parent.id, { count: childrenPerParent, triangulateNow: false });
      if (result.skipped) skipped++;
      else decomposed++;
    } catch (err) {
      failed++;
      logger.error({ err, capabilityId: parent.id, name: parent.name }, "[sub-cap-backfill] decompose failed");
    }
  }

  logger.info({ scanned: candidates.length, decomposed, skipped, failed }, "[sub-cap-backfill] done");
  return { scanned: candidates.length, decomposed, skipped, failed };
}
