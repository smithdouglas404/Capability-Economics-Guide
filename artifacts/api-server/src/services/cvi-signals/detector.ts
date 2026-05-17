import { db, cviCapabilityHistoryTable, cviSignalEventsTable, industriesTable } from "@workspace/db";
import { eq, sql, gte, asc, and, inArray } from "drizzle-orm";
import { logger } from "../../lib/logger";

/**
 * CVI signal detector — Task #5 phase 1. Walks cvi_capability_history,
 * identifies moments where a capability's consensusScore moved by >= a
 * threshold within a configurable window, and records each as a row in
 * cvi_signal_events.
 *
 * Detection model:
 *   For each capability, sort history chronologically. For each pair of
 *   snapshots (older, newer) where newer.snapshotAt - older.snapshotAt
 *   <= windowDays, if |newer.consensusScore - older.consensusScore| >=
 *   moderateThreshold, emit an event. Severity classified as:
 *     - moderate: |Δ| in [5, 10)
 *     - large:    |Δ| in [10, 20)
 *     - extreme:  |Δ| >= 20
 *
 * Uniqueness: (capability_id, window_end_at) — re-running for the same
 * snapshot doesn't insert duplicates. Detector run sweeps the last 90 days
 * by default.
 *
 * Outcome attribution (forward stock returns) is a separate job — needs a
 * price-feed integration (yfinance / Polygon) not wired here. Once events
 * exist, outcome rows can be populated by the future outcomes job.
 */

export interface DetectionOptions {
  /** How far back to look (days). Default 90. */
  lookbackDays?: number;
  /** Sliding comparison window (days). Default 30. */
  windowDays?: number;
  /** Minimum point delta to fire. Default 5. */
  moderateThreshold?: number;
}

export interface DetectionResult {
  scannedCapabilities: number;
  pairsCompared: number;
  eventsDetected: number;
  newEventsInserted: number;
  durationMs: number;
}

export async function detectCviSignalEvents(opts: DetectionOptions = {}): Promise<DetectionResult> {
  const start = Date.now();
  const lookbackDays = Math.max(7, opts.lookbackDays ?? 90);
  const windowDays = Math.max(1, opts.windowDays ?? 30);
  const moderateThreshold = Math.max(1, opts.moderateThreshold ?? 5);

  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  // Pull all per-cap history rows in the window, sorted chronologically
  const rows = await db
    .select()
    .from(cviCapabilityHistoryTable)
    .where(gte(cviCapabilityHistoryTable.snapshotAt, since))
    .orderBy(asc(cviCapabilityHistoryTable.capabilityId), asc(cviCapabilityHistoryTable.snapshotAt));

  if (rows.length === 0) {
    return { scannedCapabilities: 0, pairsCompared: 0, eventsDetected: 0, newEventsInserted: 0, durationMs: Date.now() - start };
  }

  // Group by capability
  const byCapId = new Map<number, typeof rows>();
  for (const r of rows) {
    if (!byCapId.has(r.capabilityId)) byCapId.set(r.capabilityId, []);
    byCapId.get(r.capabilityId)!.push(r);
  }

  let pairs = 0;
  let detected = 0;
  let inserted = 0;
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  for (const [capId, series] of byCapId.entries()) {
    if (series.length < 2) continue;

    // Sliding-window comparison: for each newer point, find the oldest
    // point still within windowDays and compare. We don't compare every
    // (i,j) pair — only consecutive sliding-window edges to avoid
    // double-counting the same move multiple times.
    let leftIdx = 0;
    for (let rightIdx = 1; rightIdx < series.length; rightIdx++) {
      const newer = series[rightIdx];
      // Advance left until older is within window of newer
      while (leftIdx < rightIdx && newer.snapshotAt.getTime() - series[leftIdx].snapshotAt.getTime() > windowMs) {
        leftIdx++;
      }
      if (leftIdx >= rightIdx) continue;
      const older = series[leftIdx];
      pairs++;
      const delta = newer.consensusScore - older.consensusScore;
      const absDelta = Math.abs(delta);
      if (absDelta < moderateThreshold) continue;

      const severity = absDelta >= 20 ? "extreme" : absDelta >= 10 ? "large" : "moderate";
      const direction = delta >= 0 ? "up" : "down";

      detected++;

      try {
        await db
          .insert(cviSignalEventsTable)
          .values({
            capabilityId: capId,
            industryId: newer.industryId,
            windowStartAt: older.snapshotAt,
            windowEndAt: newer.snapshotAt,
            windowDays: Math.round((newer.snapshotAt.getTime() - older.snapshotAt.getTime()) / (24 * 60 * 60 * 1000)),
            magnitudePoints: delta,
            direction,
            severity,
            startValue: older.consensusScore,
            endValue: newer.consensusScore,
            outcomeAttributed: 0,
            contextNotes: {
              olderMethodologyVersion: older.methodologyVersion,
              newerMethodologyVersion: newer.methodologyVersion,
            },
          })
          .onConflictDoNothing();
        inserted++;
        // Fire-and-forget bot event for severity in {large, extreme} (i.e. |Δ| ≥ 10pt).
        // Bots covering the relevant industry get a chance to react. Industry slug
        // is looked up lazily once per cap then cached; per-event dispatch is the bot trigger's debounce concern.
        if (severity === "large" || severity === "extreme") {
          (async () => {
            try {
              const [ind] = await db.select({ slug: industriesTable.slug })
                .from(industriesTable)
                .where(eq(industriesTable.id, newer.industryId));
              if (!ind) return;
              const triggers = await import("../bots/workflows/triggers");
              await triggers.dispatchBotEvent("cvi.delta-large", {
                capabilityId: capId,
                industrySlug: ind.slug,
                metadata: { magnitudePoints: delta, severity, direction },
              });
            } catch { /* bots are not critical path */ }
          })().catch(() => {});
        }
      } catch (err) {
        // Likely unique violation from a re-run — non-fatal
        logger.debug({ err, capId }, "[cvi-signals] insert conflict (expected on re-run)");
      }
    }
  }

  const durationMs = Date.now() - start;
  if (inserted > 0 || detected > 0) {
    logger.info({ scannedCapabilities: byCapId.size, pairsCompared: pairs, eventsDetected: detected, newEventsInserted: inserted, durationMs }, "[cvi-signals] detection complete");
  }
  return {
    scannedCapabilities: byCapId.size,
    pairsCompared: pairs,
    eventsDetected: detected,
    newEventsInserted: inserted,
    durationMs,
  };
}

/**
 * Read recent signal events for the admin / research view. Defaults to
 * last 30 days, sorted by magnitude (most-significant first).
 */
export async function listRecentSignalEvents(opts: { days?: number; minSeverity?: "moderate" | "large" | "extreme"; limit?: number } = {}) {
  const days = Math.max(1, Math.min(365, opts.days ?? 30));
  const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  let conds = [gte(cviSignalEventsTable.windowEndAt, since)];
  if (opts.minSeverity === "extreme") {
    conds = [...conds, eq(cviSignalEventsTable.severity, "extreme")];
  } else if (opts.minSeverity === "large") {
    conds = [...conds, sql`${cviSignalEventsTable.severity} IN ('large', 'extreme')`];
  }

  return await db
    .select()
    .from(cviSignalEventsTable)
    .where(and(...conds))
    .orderBy(sql`ABS(${cviSignalEventsTable.magnitudePoints}) DESC`)
    .limit(limit);
}
