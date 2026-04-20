import { db, marketplaceListingsTable } from "@workspace/db";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const ARCHIVE_INTERVAL_MS = 60 * 60 * 1000; // hourly
const APPROVAL_TTL_DAYS = 30;

let timer: ReturnType<typeof setInterval> | null = null;
let lastRunAt: Date | null = null;
let lastArchivedCount = 0;

/**
 * Auto-archive sweep: any approved listing where either
 *   (a) `expiresAt` is set and in the past, or
 *   (b) it has been on the marketplace more than 30 days since approval
 * gets moved to status="archived". Existing buyers can still re-download
 * via their library — only public browse is affected.
 */
export async function runAutoArchive(): Promise<{ archived: number }> {
  const cutoff = sql`now() - interval '${sql.raw(String(APPROVAL_TTL_DAYS))} days'`;
  const result = await db
    .update(marketplaceListingsTable)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(
      eq(marketplaceListingsTable.status, "approved"),
      or(
        lt(marketplaceListingsTable.expiresAt, sql`now()`),
        lt(marketplaceListingsTable.approvedAt, cutoff),
      ),
    ))
    .returning({ id: marketplaceListingsTable.id });
  lastRunAt = new Date();
  lastArchivedCount = result.length;
  if (result.length > 0) {
    logger.info({ archivedIds: result.map(r => r.id) }, "[marketplace] auto-archived expired listings");
  }
  return { archived: result.length };
}

export function startMarketplaceAutoArchive(): void {
  if (timer) return;
  timer = setInterval(() => {
    void runAutoArchive().catch(err => logger.error({ err }, "[marketplace] auto-archive sweep failed"));
  }, ARCHIVE_INTERVAL_MS);
  // Kick off one sweep at startup (delay a bit so DB is warm).
  setTimeout(() => {
    void runAutoArchive().catch(err => logger.error({ err }, "[marketplace] auto-archive sweep failed"));
  }, 60_000);
  logger.info({ intervalMinutes: ARCHIVE_INTERVAL_MS / 60000, ttlDays: APPROVAL_TTL_DAYS }, "[marketplace] auto-archive started");
}

export function stopMarketplaceAutoArchive(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

export function getMarketplaceAutoArchiveStatus(): { active: boolean; lastRunAt: string | null; lastArchivedCount: number; ttlDays: number } {
  return { active: timer !== null, lastRunAt: lastRunAt?.toISOString() ?? null, lastArchivedCount, ttlDays: APPROVAL_TTL_DAYS };
}
