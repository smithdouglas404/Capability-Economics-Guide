/**
 * Regulation-watch notifier.
 *
 * Walks the `regulation_watches` table on a schedule and writes a row into
 * `member_notifications` (the inbox + bell badge) when a watched regulation
 * either:
 *   - has passed its effective_date AND compliance is < 100, or
 *   - dropped ≥ 5 points since the previous check.
 *
 * Throttled: at most one notification per (user, regulation) per 24 hours,
 * stored on `regulation_watches.last_alerted_at`. The previous compliance
 * level is cached on `last_compliance_score` so we can detect drops without
 * keeping a separate history table.
 *
 * Idempotent. Safe to invoke from the scheduler tick on any cadence; runs
 * are cheap (one read per watch + at most one write per alert).
 */
import { db } from "@workspace/db";
import {
  regulationWatchesTable,
  regulationsTable,
  regulationCapabilityRequirementsTable,
  organizationsTable,
  organizationCapabilitiesTable,
  memberNotificationsTable,
} from "@workspace/db";
import { eq, inArray, desc } from "drizzle-orm";

const ALERT_THROTTLE_MS = 24 * 60 * 60 * 1000;
const DROP_THRESHOLD_POINTS = 5;

interface WatchRow {
  id: number;
  userId: string;
  regulationId: number;
  lastComplianceScore: number | null;
  lastAlertedAt: Date | null;
}

interface NotifierStats {
  walked: number;
  notified: number;
  skippedRecent: number;
  skippedNoOrg: number;
  errors: number;
}

export async function runRegulationsWatchNotifier(): Promise<NotifierStats> {
  const stats: NotifierStats = { walked: 0, notified: 0, skippedRecent: 0, skippedNoOrg: 0, errors: 0 };

  const watches = await db.select().from(regulationWatchesTable);
  if (watches.length === 0) return stats;

  // Group watches by userId so we look up each user's org only once.
  const byUser = new Map<string, WatchRow[]>();
  for (const w of watches) {
    const arr = byUser.get(w.userId) ?? [];
    arr.push(w);
    byUser.set(w.userId, arr);
  }

  // Cache regulations + their requirements in one lookup per cycle.
  const regIds = Array.from(new Set(watches.map((w) => w.regulationId)));
  const regs = await db.select().from(regulationsTable).where(inArray(regulationsTable.id, regIds));
  const regById = new Map(regs.map((r) => [r.id, r]));

  const allReqs = await db
    .select()
    .from(regulationCapabilityRequirementsTable)
    .where(inArray(regulationCapabilityRequirementsTable.regulationId, regIds));
  const reqsByReg = new Map<number, typeof allReqs>();
  for (const r of allReqs) {
    const arr = reqsByReg.get(r.regulationId) ?? [];
    arr.push(r);
    reqsByReg.set(r.regulationId, arr);
  }

  const now = Date.now();

  for (const [userId, userWatches] of byUser) {
    // Find this user's most recent org (sessionToken-claimed via clerkUserId).
    const [org] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.clerkUserId, userId))
      .orderBy(desc(organizationsTable.updatedAt))
      .limit(1);
    if (!org) {
      stats.skippedNoOrg += userWatches.length;
      continue;
    }
    const caps = await db
      .select()
      .from(organizationCapabilitiesTable)
      .where(eq(organizationCapabilitiesTable.organizationId, org.id));
    const scoreByCap = new Map(caps.map((c) => [c.capabilityId, c.maturityScore]));

    for (const w of userWatches) {
      stats.walked++;
      try {
        const reg = regById.get(w.regulationId);
        if (!reg) continue;

        const reqs = reqsByReg.get(w.regulationId) ?? [];
        let assessed = 0;
        let compliant = 0;
        for (const r of reqs) {
          const s = scoreByCap.get(r.capabilityId);
          if (s == null) continue;
          assessed++;
          if (s >= r.requiredMaturity) compliant++;
        }
        const currentCompliance = assessed > 0 ? Math.round((compliant / assessed) * 100) : null;

        const effectiveDate = reg.effectiveDate ? new Date(reg.effectiveDate).getTime() : null;
        const pastEffective = effectiveDate !== null && effectiveDate < now;
        const previous = w.lastComplianceScore;
        const dropped =
          previous !== null && currentCompliance !== null
            ? previous - currentCompliance >= DROP_THRESHOLD_POINTS
            : false;

        const shouldAlert =
          (pastEffective && currentCompliance !== null && currentCompliance < 100) || dropped;

        if (!shouldAlert) {
          if (currentCompliance !== null && currentCompliance !== previous) {
            await db
              .update(regulationWatchesTable)
              .set({ lastComplianceScore: currentCompliance })
              .where(eq(regulationWatchesTable.id, w.id));
          }
          continue;
        }

        // Throttle: skip if we alerted in the last 24h.
        if (w.lastAlertedAt && now - new Date(w.lastAlertedAt).getTime() < ALERT_THROTTLE_MS) {
          stats.skippedRecent++;
          continue;
        }

        const body = dropped
          ? `${reg.shortCode} compliance dropped from ${previous}% to ${currentCompliance}% — review the gap.`
          : `${reg.shortCode} is in effect and you're at ${currentCompliance ?? "—"}% compliance. Close the critical gaps.`;

        await db.insert(memberNotificationsTable).values({
          userId,
          type: "regulation_alert",
          targetType: "regulation",
          targetId: w.regulationId,
          body,
        });

        await db
          .update(regulationWatchesTable)
          .set({
            lastComplianceScore: currentCompliance,
            lastAlertedAt: new Date(now),
          })
          .where(eq(regulationWatchesTable.id, w.id));

        stats.notified++;
      } catch (err) {
        stats.errors++;
        console.warn(
          `[regulations-watch-notifier] failed watch ${w.id}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  return stats;
}
