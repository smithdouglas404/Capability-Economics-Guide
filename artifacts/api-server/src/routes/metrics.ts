import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityEconomicsTable,
  cviComponentsTable,
  cviSnapshotsTable,
  industriesTable,
} from "@workspace/db";
import { desc, sql, gt, lt, and, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Aggregation endpoints used by the homepage (and any other page that needs
 * cross-capability stats). Every value here is derived from the live database
 * — no hardcoded constants. See docs/Must Fix/PLAN.md for the inventory of
 * which frontend literals these replace.
 *
 * All endpoints public, no auth required (homepage is unauthenticated).
 */

const router = Router();

// Trivial in-memory cache to absorb spiky homepage hits. 15 minutes is well
// short of how often the underlying data actually changes (enrichment runs
// every 30 min, CVI snapshots once a day).
const CACHE_TTL_MS = 15 * 60 * 1000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt < Date.now()) return undefined;
  return entry.value as T;
}
function setCached(key: string, value: unknown): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function formatUsdMm(amountMm: number): string {
  if (amountMm >= 1000) return `$${(amountMm / 1000).toFixed(1)}B`;
  if (amountMm >= 1) return `$${amountMm.toFixed(1)}M`;
  if (amountMm > 0) return `$${(amountMm * 1000).toFixed(0)}K`;
  return "$0";
}

/**
 * GET /api/metrics/home-ticker
 *
 * Top 8 capabilities by absolute recent CVI velocity (top movers, positive
 * or negative). Drives the home page ticker bar (was hardcoded `TICKER_ITEMS`
 * in pages/home.tsx).
 */
router.get("/metrics/home-ticker", async (_req: Request, res: Response) => {
  const cached = getCached<unknown>("home-ticker");
  if (cached) { res.json(cached); return; }
  try {
    const rows = await db
      .select({
        capabilityId: cviComponentsTable.capabilityId,
        capabilityName: capabilitiesTable.name,
        velocity: cviComponentsTable.velocity,
        score: cviComponentsTable.consensusScore,
      })
      .from(cviComponentsTable)
      .innerJoin(capabilitiesTable, sql`${capabilitiesTable.id} = ${cviComponentsTable.capabilityId}`)
      .orderBy(desc(sql<number>`abs(${cviComponentsTable.velocity})`))
      .limit(8);

    const items = rows.map(r => ({
      capabilityName: r.capabilityName,
      valueText: `${(r.velocity ?? 0) >= 0 ? "+" : ""}${(r.velocity ?? 0).toFixed(1)} pts`,
      direction: (r.velocity ?? 0) >= 0 ? "up" : "down",
      score: r.score,
    }));
    const result = { items };
    setCached("home-ticker", result);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "[metrics/home-ticker] failed");
    res.status(500).json({ items: [], error: "failed" });
  }
});

/**
 * GET /api/metrics/principle-stats
 *
 * Aggregates over capability_economics for the home page principle row
 * (was the hardcoded "4.2×" and "18%" in pages/home.tsx:217-225).
 *
 * Returns:
 *   - avgAnnualMarginCapturedUsdMm: average of (revenue × margin/100) across
 *     enriched capabilities. Real measure of dollar yield per capability.
 *   - medianMarginStructurePct: median margin structure (%) across enriched
 *     capabilities. The "18%" from the audit referred to "median margin
 *     improvement"; the honest equivalent is median margin structure.
 *   - sampleSize: how many capabilities back the average — useful for
 *     downstream tooltips ("based on N enriched capabilities").
 */
router.get("/metrics/principle-stats", async (_req: Request, res: Response) => {
  const cached = getCached<unknown>("principle-stats");
  if (cached) { res.json(cached); return; }
  try {
    const rows = await db
      .select({
        revenue: capabilityEconomicsTable.revenueExposureMm,
        margin: capabilityEconomicsTable.marginStructurePct,
      })
      .from(capabilityEconomicsTable)
      .where(and(
        isNotNull(capabilityEconomicsTable.revenueExposureMm),
        isNotNull(capabilityEconomicsTable.marginStructurePct),
      ));

    const yields: number[] = [];
    const margins: number[] = [];
    for (const r of rows) {
      const rev = r.revenue ?? 0;
      const mar = r.margin ?? 0;
      if (rev > 0 && mar > 0) {
        yields.push((rev * mar) / 100);
        margins.push(mar);
      }
    }

    const avg = yields.length === 0 ? 0 : yields.reduce((a, b) => a + b, 0) / yields.length;
    const sortedMargins = [...margins].sort((a, b) => a - b);
    const medianMargin = sortedMargins.length === 0
      ? 0
      : sortedMargins[Math.floor(sortedMargins.length / 2)];

    const result = {
      avgAnnualMarginCapturedUsdMm: Number(avg.toFixed(1)),
      avgAnnualMarginCapturedFormatted: formatUsdMm(avg),
      medianMarginStructurePct: Number(medianMargin.toFixed(1)),
      sampleSize: yields.length,
    };
    setCached("principle-stats", result);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "[metrics/principle-stats] failed");
    res.status(500).json({ error: "failed" });
  }
});

/**
 * GET /api/metrics/home-tiles
 *
 * Aggregates for the homepage hero tiles (was hardcoded "$2.1B", "4.7×",
 * "↑ 3.1 pts this quarter" in pages/home.tsx:347-352).
 *
 * Returns:
 *   - valueUnlocked: { amountUsdMm, formatted } — sum of (revenue × margin/100)
 *     across all enriched capabilities. Real platform-wide annual margin
 *     captured.
 *   - topROI: { capabilityName, annualMarginUsdMm, formatted } — single
 *     capability with the highest annual margin captured.
 *   - quarterlyDelta: { pts, direction } — current CVI minus CVI from
 *     ~90 days ago (from cvi_snapshots history). Used as the "↑ X pts this
 *     quarter" sub-line on the Avg CVI tile.
 *
 * The Avg CVI and capability count come from existing /api/cvi/current and
 * /api/capabilities — not duplicated here.
 */
router.get("/metrics/home-tiles", async (_req: Request, res: Response) => {
  const cached = getCached<unknown>("home-tiles");
  if (cached) { res.json(cached); return; }
  try {
    // Value unlocked: sum of all (revenue × margin/100) where both are non-null.
    const [valueRow] = await db
      .select({
        total: sql<number>`coalesce(sum(${capabilityEconomicsTable.revenueExposureMm} * ${capabilityEconomicsTable.marginStructurePct} / 100.0), 0)`,
      })
      .from(capabilityEconomicsTable)
      .where(and(
        isNotNull(capabilityEconomicsTable.revenueExposureMm),
        isNotNull(capabilityEconomicsTable.marginStructurePct),
      ));

    const valueUnlockedMm = Number(valueRow?.total ?? 0);

    // Top capability by annual margin captured.
    const topRows = await db
      .select({
        capabilityName: capabilitiesTable.name,
        annualMargin: sql<number>`${capabilityEconomicsTable.revenueExposureMm} * ${capabilityEconomicsTable.marginStructurePct} / 100.0`,
      })
      .from(capabilityEconomicsTable)
      .innerJoin(capabilitiesTable, sql`${capabilitiesTable.id} = ${capabilityEconomicsTable.capabilityId}`)
      .where(and(
        isNotNull(capabilityEconomicsTable.revenueExposureMm),
        isNotNull(capabilityEconomicsTable.marginStructurePct),
        gt(capabilityEconomicsTable.revenueExposureMm, 0),
        gt(capabilityEconomicsTable.marginStructurePct, 0),
      ))
      .orderBy(desc(sql<number>`${capabilityEconomicsTable.revenueExposureMm} * ${capabilityEconomicsTable.marginStructurePct}`))
      .limit(1);

    const topROIRow = topRows[0];
    const topROIAmount = Number(topROIRow?.annualMargin ?? 0);

    // Quarterly CVI delta: current vs 90 days ago.
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const [currentCei] = await db
      .select({ overallIndex: cviSnapshotsTable.overallIndex, snapshotAt: cviSnapshotsTable.snapshotAt })
      .from(cviSnapshotsTable)
      .orderBy(desc(cviSnapshotsTable.snapshotAt))
      .limit(1);
    const [historicalCei] = await db
      .select({ overallIndex: cviSnapshotsTable.overallIndex, snapshotAt: cviSnapshotsTable.snapshotAt })
      .from(cviSnapshotsTable)
      .where(lt(cviSnapshotsTable.snapshotAt, ninetyDaysAgo))
      .orderBy(desc(cviSnapshotsTable.snapshotAt))
      .limit(1);

    let quarterlyDeltaPts: number | null = null;
    if (currentCei && historicalCei) {
      quarterlyDeltaPts = Number((currentCei.overallIndex - historicalCei.overallIndex).toFixed(1));
    }

    const result = {
      valueUnlocked: {
        amountUsdMm: Number(valueUnlockedMm.toFixed(1)),
        formatted: formatUsdMm(valueUnlockedMm),
      },
      topROI: topROIRow ? {
        capabilityName: topROIRow.capabilityName,
        annualMarginUsdMm: Number(topROIAmount.toFixed(1)),
        formatted: formatUsdMm(topROIAmount),
      } : null,
      quarterlyDelta: quarterlyDeltaPts === null ? null : {
        pts: quarterlyDeltaPts,
        direction: quarterlyDeltaPts >= 0 ? "up" : "down",
      },
    };
    setCached("home-tiles", result);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "[metrics/home-tiles] failed");
    res.status(500).json({ error: "failed" });
  }
});

export default router;
