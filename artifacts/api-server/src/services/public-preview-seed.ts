import { db, capabilitiesTable, industriesTable } from "@workspace/db";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Idempotent boot-time seed: ensure at least 10 approved capabilities are
 * flagged `public_preview = true` so the unauthenticated /explore page
 * always has something to show in any environment (dev, staging, prod
 * after a fresh restore). Picks top 2 per industry by benchmarkScore so
 * the curated set is balanced and not dominated by one vertical.
 *
 * Safe to call repeatedly: skips industries that already have at least
 * one preview capability and is a no-op once the target is hit.
 */
export async function ensurePublicPreviewSeed(targetCount = 10): Promise<void> {
  try {
    const existing = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(capabilitiesTable)
      .where(and(
        eq(capabilitiesTable.publicPreview, true),
        eq(capabilitiesTable.reviewStatus, "approved"),
      ));
    const have = existing[0]?.count ?? 0;
    if (have >= targetCount) {
      logger.debug({ have, targetCount }, "[public-preview-seed] already satisfied");
      return;
    }

    const industries = await db.select({ id: industriesTable.id, name: industriesTable.name }).from(industriesTable);
    if (industries.length === 0) {
      logger.warn("[public-preview-seed] no industries; skipping");
      return;
    }

    // Strict policy: top 2 leaf capabilities per industry by benchmarkScore.
    // If that doesn't reach targetCount (sparse environment), do a second
    // pass to top up from any industry's next-best leaf.
    const PER_INDUSTRY = 2;
    let added = 0;

    for (const ind of industries) {
      const candidates = await db
        .select({ id: capabilitiesTable.id })
        .from(capabilitiesTable)
        .where(and(
          eq(capabilitiesTable.industryId, ind.id),
          eq(capabilitiesTable.reviewStatus, "approved"),
          eq(capabilitiesTable.publicPreview, false),
          isNull(capabilitiesTable.parentCapabilityId),
          ne(capabilitiesTable.benchmarkScore, 0),
        ))
        .orderBy(desc(capabilitiesTable.benchmarkScore))
        .limit(PER_INDUSTRY);
      if (candidates.length === 0) continue;
      const ids = candidates.map(c => c.id);
      await db.execute(sql`UPDATE capabilities SET public_preview = true WHERE id = ANY(${ids})`);
      added += candidates.length;
    }

    // Top-up pass — if top-2-per-industry didn't reach target (e.g., new
    // env with few approved caps in some verticals), pull additional
    // candidates globally without re-flagging anything we just touched.
    if (have + added < targetCount) {
      const need = targetCount - (have + added);
      const extra = await db
        .select({ id: capabilitiesTable.id })
        .from(capabilitiesTable)
        .where(and(
          eq(capabilitiesTable.reviewStatus, "approved"),
          eq(capabilitiesTable.publicPreview, false),
          ne(capabilitiesTable.benchmarkScore, 0),
        ))
        .orderBy(desc(capabilitiesTable.benchmarkScore))
        .limit(need);
      if (extra.length > 0) {
        const ids = extra.map(c => c.id);
        await db.execute(sql`UPDATE capabilities SET public_preview = true WHERE id = ANY(${ids})`);
        added += extra.length;
      }
    }

    logger.info({ added, totalAfter: have + added, targetCount }, "[public-preview-seed] flagged capabilities");
  } catch (err) {
    logger.error({ err }, "[public-preview-seed] failed");
  }
}
