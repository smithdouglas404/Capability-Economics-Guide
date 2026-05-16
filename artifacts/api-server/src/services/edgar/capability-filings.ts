import { db, capabilityFilingsTable, capabilityFilingStatusTable, capabilitiesTable } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { searchEdgar } from "./fetcher";
import { extractFilingsViaHaiku } from "./extractor";
import { logger } from "../../lib/logger";

/**
 * Stale window: if a capability's filings were last refreshed within this
 * window, serve from cache; otherwise hit EDGAR again. 24h strikes a
 * balance between freshness and cost / EDGAR-load.
 */
const CACHE_FRESHNESS_HOURS = 24;

/**
 * Fetch filings mentioning a capability. Lazy + usage-driven:
 *   1. If cache is fresh (< CACHE_FRESHNESS_HOURS old), serve directly.
 *   2. Otherwise, query EDGAR full-text search for the capability name,
 *      upsert each hit into capability_filings, bump view count.
 *   3. Either path increments the view count on capability_filing_status,
 *      which drives future backfill triggers.
 *
 * Called from the capability detail route (lazy on user/bot view).
 */
export async function getOrFetchCapabilityFilings(capabilityId: number, opts: { limit?: number; forceFresh?: boolean } = {}): Promise<{
  filings: Array<typeof capabilityFilingsTable.$inferSelect>;
  cacheHit: boolean;
  newFilingsAdded: number;
}> {
  const limit = Math.max(1, Math.min(50, opts.limit ?? 20));

  // Ensure status row exists, bump view count
  await db
    .insert(capabilityFilingStatusTable)
    .values({ capabilityId, viewCount: 1, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: capabilityFilingStatusTable.capabilityId,
      set: {
        viewCount: sql`${capabilityFilingStatusTable.viewCount} + 1`,
        updatedAt: new Date(),
      },
    });

  const [status] = await db.select().from(capabilityFilingStatusTable).where(eq(capabilityFilingStatusTable.capabilityId, capabilityId)).limit(1);

  const cacheFreshUntil = status?.lastExtractedAt
    ? new Date(status.lastExtractedAt.getTime() + CACHE_FRESHNESS_HOURS * 60 * 60 * 1000)
    : null;
  const isFresh = !opts.forceFresh && cacheFreshUntil != null && cacheFreshUntil > new Date();

  if (isFresh) {
    const filings = await db
      .select()
      .from(capabilityFilingsTable)
      .where(eq(capabilityFilingsTable.capabilityId, capabilityId))
      .orderBy(desc(capabilityFilingsTable.filingDate))
      .limit(limit);
    return { filings, cacheHit: true, newFilingsAdded: 0 };
  }

  // Cache miss — fetch from EDGAR
  const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, capabilityId)).limit(1);
  if (!cap) {
    return { filings: [], cacheHit: false, newFilingsAdded: 0 };
  }

  let newAdded = 0;
  try {
    const hits = await searchEdgar(cap.name, { limit });
    for (const hit of hits) {
      try {
        await db.insert(capabilityFilingsTable).values({
          capabilityId,
          accessionNumber: hit.accessionNumber,
          cik: hit.cik,
          companyName: hit.companyName,
          ticker: hit.ticker,
          formType: hit.formType,
          filingDate: new Date(hit.filingDate),
          filingUrl: hit.filingUrl,
          excerpt: hit.highlightExcerpt,
          sectionRef: null,
          extractionSource: "edgar-search",
          rawPayload: hit.rawHit as Record<string, unknown>,
          lastConfirmedAt: new Date(),
        }).onConflictDoUpdate({
          target: [capabilityFilingsTable.capabilityId, capabilityFilingsTable.accessionNumber],
          set: {
            excerpt: hit.highlightExcerpt,
            lastConfirmedAt: new Date(),
            rawPayload: hit.rawHit as Record<string, unknown>,
          },
        });
        newAdded++;
      } catch (err) {
        logger.warn({ err, capabilityId, accession: hit.accessionNumber }, "[edgar] upsert hit failed");
      }
    }
  } catch (err) {
    logger.warn({ err, capabilityId, capName: cap.name }, "[edgar] capability fetch failed");
  }

  // Update status: lastExtractedAt + filingsCached count
  const [countRow] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(capabilityFilingsTable)
    .where(eq(capabilityFilingsTable.capabilityId, capabilityId));
  await db
    .update(capabilityFilingStatusTable)
    .set({
      lastExtractedAt: new Date(),
      filingsCached: countRow?.n ?? 0,
      updatedAt: new Date(),
    })
    .where(eq(capabilityFilingStatusTable.capabilityId, capabilityId));

  // Phase 2: queue Haiku extraction of any newly-added rows so the next
  // page render shows cleaned-up excerpts + section refs instead of raw
  // EDGAR snippets. Capped at 10 per request to bound latency / cost
  // (~$0.20 worst case per first-view of a popular capability).
  if (newAdded > 0) {
    extractFilingsViaHaiku({ capabilityId, limit: 10 }).catch(err => {
      logger.warn({ err, capabilityId }, "[edgar] background extraction failed (non-fatal)");
    });
  }

  const filings = await db
    .select()
    .from(capabilityFilingsTable)
    .where(eq(capabilityFilingsTable.capabilityId, capabilityId))
    .orderBy(desc(capabilityFilingsTable.filingDate))
    .limit(limit);

  return { filings, cacheHit: false, newFilingsAdded: newAdded };
}

/**
 * Read-only fetch — never touches EDGAR, only returns whatever's in cache.
 * Useful for high-traffic surfaces where you don't want every render to
 * potentially fetch upstream.
 */
export async function readCachedCapabilityFilings(capabilityId: number, limit = 20): Promise<typeof capabilityFilingsTable.$inferSelect[]> {
  return await db
    .select()
    .from(capabilityFilingsTable)
    .where(eq(capabilityFilingsTable.capabilityId, capabilityId))
    .orderBy(desc(capabilityFilingsTable.filingDate))
    .limit(limit);
}
