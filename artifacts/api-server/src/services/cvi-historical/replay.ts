import { db, sourceTriangulationsTable, industriesTable, capabilitiesTable, industryGdpWeightsTable, cviSnapshotsTable, cviCapabilityHistoryTable } from "@workspace/db";
import { eq, lte, sql, and, gte, asc } from "drizzle-orm";
import { logger } from "../../lib/logger";

/**
 * Historical CEI replay: reconstructs as-of CEI snapshots by replaying the
 * weighted source_triangulations data that existed at each historical
 * date. Fills the time series with pseudo-history immediately rather than
 * waiting weeks for live snapshots to accumulate.
 *
 * Provenance is explicit — every reconstructed row carries
 * methodologyVersion = "reconstructed-1.0" so frontend can distinguish
 * banked-live snapshots from reconstructed ones in the methodology
 * surface and (optionally) in chart styling (e.g. dashed line for
 * reconstructed segments).
 *
 * Reconstruction model (intentionally simpler than the live CEI engine):
 *   1. For each as-of date, pull every source_triangulations row with
 *      queriedAt <= date.
 *   2. Group by (industryId, capabilityId), compute weighted-average
 *      rawScore using the per-row weight column.
 *   3. Per industry: simple mean across capability scores.
 *   4. Overall: GDP-weighted mean across industries from industry_gdp_weights.
 *
 * No Bayesian posterior, no confidence intervals. The live engine produces
 * these from the full triangulation state machine; reconstruction approximates
 * the point estimate only. The CI fields are written as NULL with
 * methodologyVersion flagging the reconstruction so downstream consumers
 * never confuse reconstructed CI=NULL with a missing-data error.
 *
 * Idempotent — never overwrites an existing snapshot (live or reconstructed)
 * that falls within the dedup window of the as-of date.
 */

export interface ReplayOptions {
  /** Inclusive start date (defaults to 90 days ago). */
  fromDate?: Date;
  /** Inclusive end date (defaults to NOW). */
  toDate?: Date;
  /** Days between reconstructed snapshots (default 1 → daily). */
  intervalDays?: number;
  /** Hours of dedup window — skip a date if any snapshot exists within ±hours. Default 18 (overlap-safe vs daily live snapshots). */
  dedupWindowHours?: number;
  /** Dry run: compute but don't persist. Returns the computed series for inspection. */
  dryRun?: boolean;
}

export interface ReplayResult {
  scanned: number;
  inserted: number;
  skippedDedup: number;
  skippedNoData: number;
  errors: string[];
  durationMs: number;
  series?: Array<{ asOf: string; overallIndex: number; industryCount: number }>;
}

export async function replayHistoricalCVI(opts: ReplayOptions = {}): Promise<ReplayResult> {
  const start = Date.now();
  const toDate = opts.toDate ?? new Date();
  const fromDate = opts.fromDate ?? new Date(toDate.getTime() - 90 * 24 * 60 * 60 * 1000);
  const intervalDays = Math.max(1, opts.intervalDays ?? 1);
  const dedupHours = Math.max(0, opts.dedupWindowHours ?? 18);
  const dedupMs = dedupHours * 60 * 60 * 1000;

  const errors: string[] = [];
  let inserted = 0;
  let skippedDedup = 0;
  let skippedNoData = 0;
  const series: Array<{ asOf: string; overallIndex: number; industryCount: number }> = [];

  // Pre-fetch industries + GDP weights once
  const industries = await db.select().from(industriesTable);
  const industryById = new Map(industries.map(i => [i.id, i]));
  const weights = await db.select().from(industryGdpWeightsTable);
  const weightByIndustryId = new Map(weights.map(w => [w.industryId, w.gdpShare]));

  // Walk dates
  const dates: Date[] = [];
  for (let t = fromDate.getTime(); t <= toDate.getTime(); t += intervalDays * 24 * 60 * 60 * 1000) {
    dates.push(new Date(t));
  }

  // Pre-fetch existing snapshots once across the window for dedup
  const existingSnapshots = await db
    .select({ snapshotAt: cviSnapshotsTable.snapshotAt })
    .from(cviSnapshotsTable)
    .where(and(
      gte(cviSnapshotsTable.snapshotAt, fromDate),
      lte(cviSnapshotsTable.snapshotAt, new Date(toDate.getTime() + dedupMs)),
    ))
    .orderBy(asc(cviSnapshotsTable.snapshotAt));
  const existingTimes = existingSnapshots.map(s => s.snapshotAt.getTime());

  for (const asOf of dates) {
    // Dedup: skip if any existing snapshot is within ±dedupMs of asOf
    const inWindow = existingTimes.some(t => Math.abs(t - asOf.getTime()) <= dedupMs);
    if (inWindow) {
      skippedDedup++;
      continue;
    }

    try {
      const triangulations = await db
        .select()
        .from(sourceTriangulationsTable)
        .where(lte(sourceTriangulationsTable.queriedAt, asOf));

      if (triangulations.length === 0) {
        skippedNoData++;
        continue;
      }

      // Per-cap weighted average
      const capScores = new Map<string, { industryId: number; capabilityId: number; weightedSum: number; weightTotal: number }>();
      for (const t of triangulations) {
        const key = `${t.industryId}|${t.capabilityId}`;
        const existing = capScores.get(key);
        if (existing) {
          existing.weightedSum += t.rawScore * t.weight;
          existing.weightTotal += t.weight;
        } else {
          capScores.set(key, {
            industryId: t.industryId,
            capabilityId: t.capabilityId,
            weightedSum: t.rawScore * t.weight,
            weightTotal: t.weight,
          });
        }
      }

      // Per-industry mean of cap scores
      const industryScores = new Map<number, { total: number; count: number }>();
      for (const cs of capScores.values()) {
        const score = cs.weightTotal > 0 ? cs.weightedSum / cs.weightTotal : 0;
        const existing = industryScores.get(cs.industryId);
        if (existing) {
          existing.total += score;
          existing.count += 1;
        } else {
          industryScores.set(cs.industryId, { total: score, count: 1 });
        }
      }

      // Build industry breakdowns + overall GDP-weighted mean
      const industryBreakdowns: Record<string, {
        industryName: string;
        indexValue: number;
        ciLow: number | null;
        ciHigh: number | null;
        weight: number;
        weightSourceUrl: string | null;
        weightSourceYear: number | null;
        velocity: number;
        capabilityCount: number;
        topMover: string;
        topMoverDelta: number;
      }> = {};
      let overallWeightedSum = 0;
      let overallWeightTotal = 0;

      for (const [industryId, stats] of industryScores.entries()) {
        const industry = industryById.get(industryId);
        if (!industry) continue;
        const indexValue = stats.count > 0 ? stats.total / stats.count : 0;
        const weight = weightByIndustryId.get(industryId) ?? 0;
        industryBreakdowns[String(industryId)] = {
          industryName: industry.name,
          indexValue,
          ciLow: null,
          ciHigh: null,
          weight,
          weightSourceUrl: null,
          weightSourceYear: null,
          velocity: 0,
          capabilityCount: stats.count,
          topMover: "",
          topMoverDelta: 0,
        };
        if (weight > 0) {
          overallWeightedSum += indexValue * weight;
          overallWeightTotal += weight;
        }
      }

      // If no GDP weights set, fall back to simple mean across industries —
      // reconstructed historical data shouldn't fail just because the
      // weights table isn't fully populated.
      const overallIndex = overallWeightTotal > 0
        ? overallWeightedSum / overallWeightTotal
        : (industryScores.size > 0
            ? Array.from(industryScores.values()).reduce((acc, s) => acc + (s.count > 0 ? s.total / s.count : 0), 0) / industryScores.size
            : 0);

      series.push({ asOf: asOf.toISOString(), overallIndex, industryCount: industryScores.size });

      if (!opts.dryRun) {
        await db.insert(cviSnapshotsTable).values({
          overallIndex,
          overallCiLow: null,
          overallCiHigh: null,
          industryBreakdowns,
          marketSentiment: null,
          volatility: null,
          methodologyVersion: "reconstructed-1.0",
          snapshotAt: asOf,
        });
        inserted++;

        // Also bank per-capability reconstructed rows so the per-cap
        // sparkline has reconstructed history alongside the industry
        // rollup. Same as-of weighted score, written per (cap, industry).
        // ConflictDoNothing guards against re-runs hitting the unique
        // (cap, industry, snapshotAt) constraint.
        const capRows = Array.from(capScores.values()).map(cs => ({
          capabilityId: cs.capabilityId,
          industryId: cs.industryId,
          consensusScore: cs.weightTotal > 0 ? cs.weightedSum / cs.weightTotal : 0,
          confidence: 0.5, // reconstructed — no posterior, mid-confidence sentinel
          velocity: 0,
          posteriorVariance: null,
          methodologyVersion: "reconstructed-1.0",
          snapshotAt: asOf,
        }));
        if (capRows.length > 0) {
          try {
            await db.insert(cviCapabilityHistoryTable).values(capRows).onConflictDoNothing();
          } catch (capErr) {
            logger.warn({ capErr, asOf }, "[cei-replay] per-cap insert failed (non-fatal)");
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${asOf.toISOString().slice(0, 10)}: ${msg}`);
      logger.warn({ asOf, err: msg }, "[cei-replay] failed to compute as-of");
    }
  }

  const durationMs = Date.now() - start;
  logger.info({ scanned: dates.length, inserted, skippedDedup, skippedNoData, errors: errors.length, durationMs }, "[cei-replay] complete");

  return {
    scanned: dates.length,
    inserted,
    skippedDedup,
    skippedNoData,
    errors,
    durationMs,
    series: opts.dryRun ? series : undefined,
  };
}
