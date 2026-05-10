import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  ceiComponentsTable,
  sourceTriangulationsTable,
  capabilityQuadrantsTable,
  industryGdpWeightsTable,
  enrichmentJobsTable,
  enrichmentConfigTable,
} from "@workspace/db";
import { sql } from "drizzle-orm";

export type HealthTier = "Mature" | "Developing" | "Sparse";

export interface IndustryCoverageRow {
  industryId: number;
  industrySlug: string;
  industryName: string;
  capsTracked: number;
  leafCaps: number;
  pctApproved: number;
  pctWithQuadrant: number;
  pctWithFullEconomics: number;
  pctFreshUnder60d: number;
  medianFreshnessDays: number | null;
  hasGdpWeight: boolean;
  healthScore: number;
  tier: HealthTier;
}

export interface CoverageResult {
  generatedAt: string;
  ttlSeconds: number;
  totals: {
    industries: number;
    capabilities: number;
    leafCapabilities: number;
    pctApproved: number;
    pctWithQuadrant: number;
    pctWithFullEconomics: number;
    pctFreshUnder60d: number;
  };
  industries: IndustryCoverageRow[];
}

export interface AdminCoverageExtras {
  enrichmentQueue: {
    queued: number;
    running: number;
    failed: number;
    completedLast24h: number;
    oldestQueuedAgeMinutes: number | null;
  };
  rotation: {
    enabled: boolean;
    refreshDays: number;
    lastRunAt: string | null;
    lastRunEnqueued: number;
    minutesSinceLastRun: number | null;
    lagHours: number | null;
  };
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { at: number; value: CoverageResult } | null = null;
// Single-flight: at TTL expiry, dozens of concurrent /coverage requests
// would otherwise each kick off the full aggregation (5 full-table scans).
// Coalesce them onto one in-flight promise.
let inFlight: Promise<CoverageResult> | null = null;

function tierFor(score: number): HealthTier {
  if (score >= 75) return "Mature";
  if (score >= 40) return "Developing";
  return "Sparse";
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Compute the public coverage scorecard.
 *
 * One pass over capabilities + cei_components + source_triangulations +
 * capability_quadrants + industry_gdp_weights, aggregated per industry.
 *
 * Per-industry metrics:
 *  - capsTracked, leafCaps                                 (count from capabilities)
 *  - pctApproved             reviewStatus = "approved"     (capabilities)
 *  - pctWithQuadrant         capability_quadrants exists   (per-capability)
 *  - pctWithFullEconomics    cei_components exists AND     (per-capability)
 *                            sourceScores has ≥1 non-seed
 *                            entry (i.e. real triangulated
 *                            evidence, not the prior-only
 *                            fallback).
 *  - pctFreshUnder60d        max(queriedAt) per cap ≤ 60d  (source_triangulations)
 *  - medianFreshnessDays     median over caps that have any triangulation
 *  - hasGdpWeight            industry_gdp_weights row present
 *
 * healthScore = average of the four percentages → tier (Mature/Developing/Sparse).
 *
 * Result is cached in-memory for 5 minutes since this aggregation is heavy
 * and identical for every public visitor.
 */
export async function getCoverageScorecard(force = false): Promise<CoverageResult> {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }
  if (inFlight) return inFlight;
  inFlight = computeCoverageScorecard().then(value => {
    cached = { at: Date.now(), value };
    return value;
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function computeCoverageScorecard(): Promise<CoverageResult> {
  const [industries, capabilities, components, quadrants, gdp] = await Promise.all([
    db.select().from(industriesTable),
    db.select().from(capabilitiesTable),
    db.select({
      capabilityId: ceiComponentsTable.capabilityId,
      sourceScores: ceiComponentsTable.sourceScores,
    }).from(ceiComponentsTable),
    db.select({ capabilityId: capabilityQuadrantsTable.capabilityId }).from(capabilityQuadrantsTable),
    db.select({ industryId: industryGdpWeightsTable.industryId }).from(industryGdpWeightsTable),
  ]);

  // Per-cap latest triangulation timestamp.
  const latestByCap = new Map<number, Date>();
  const triRows = await db
    .select({
      capabilityId: sourceTriangulationsTable.capabilityId,
      queriedAt: sourceTriangulationsTable.queriedAt,
    })
    .from(sourceTriangulationsTable);
  for (const r of triRows) {
    const prev = latestByCap.get(r.capabilityId);
    if (!prev || r.queriedAt > prev) latestByCap.set(r.capabilityId, r.queriedAt);
  }

  // Per-cap cei_components row + flag for "real" (non-seed) sourceScores.
  const compByCap = new Map<number, { hasRealSources: boolean }>();
  for (const c of components) {
    const ss = c.sourceScores ?? [];
    const hasRealSources = ss.some(s => s.methodology !== "perplexity-seeded" && s.methodology !== "rollup_from_children");
    compByCap.set(c.capabilityId, { hasRealSources });
  }

  const quadrantSet = new Set(quadrants.map(q => q.capabilityId));
  const gdpSet = new Set(gdp.map(g => g.industryId));

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const rows: IndustryCoverageRow[] = industries.map(ind => {
    const caps = capabilities.filter(c => c.industryId === ind.id);
    const total = caps.length;
    const leaf = caps.filter(c => c.isLeaf).length;

    if (total === 0) {
      return {
        industryId: ind.id,
        industrySlug: ind.slug,
        industryName: ind.name,
        capsTracked: 0,
        leafCaps: 0,
        pctApproved: 0,
        pctWithQuadrant: 0,
        pctWithFullEconomics: 0,
        pctFreshUnder60d: 0,
        medianFreshnessDays: null,
        hasGdpWeight: gdpSet.has(ind.id),
        healthScore: 0,
        tier: "Sparse" as HealthTier,
      };
    }

    const approved = caps.filter(c => c.reviewStatus === "approved").length;
    const withQuadrant = caps.filter(c => quadrantSet.has(c.id)).length;
    const withFullEcon = caps.filter(c => compByCap.get(c.id)?.hasRealSources === true).length;

    const ages: number[] = [];
    let freshUnder60 = 0;
    for (const c of caps) {
      const last = latestByCap.get(c.id);
      if (!last) continue;
      const days = (now - last.getTime()) / DAY;
      ages.push(days);
      if (days <= 60) freshUnder60 += 1;
    }

    const pctApproved = (approved / total) * 100;
    const pctWithQuadrant = (withQuadrant / total) * 100;
    const pctWithFullEconomics = (withFullEcon / total) * 100;
    const pctFreshUnder60d = (freshUnder60 / total) * 100;

    const med = median(ages);
    const healthScore = (pctApproved + pctWithQuadrant + pctWithFullEconomics + pctFreshUnder60d) / 4;

    return {
      industryId: ind.id,
      industrySlug: ind.slug,
      industryName: ind.name,
      capsTracked: total,
      leafCaps: leaf,
      pctApproved: Math.round(pctApproved * 10) / 10,
      pctWithQuadrant: Math.round(pctWithQuadrant * 10) / 10,
      pctWithFullEconomics: Math.round(pctWithFullEconomics * 10) / 10,
      pctFreshUnder60d: Math.round(pctFreshUnder60d * 10) / 10,
      medianFreshnessDays: med !== null ? Math.round(med * 10) / 10 : null,
      hasGdpWeight: gdpSet.has(ind.id),
      healthScore: Math.round(healthScore * 10) / 10,
      tier: tierFor(healthScore),
    };
  });

  rows.sort((a, b) => b.healthScore - a.healthScore);

  // Project totals over capabilities (not over industries — industries
  // vary wildly in size, so a per-cap denominator is the honest one).
  const totalCaps = capabilities.length;
  const totalLeaf = capabilities.filter(c => c.isLeaf).length;
  const totalApproved = capabilities.filter(c => c.reviewStatus === "approved").length;
  const totalQuadrant = capabilities.filter(c => quadrantSet.has(c.id)).length;
  const totalFullEcon = capabilities.filter(c => compByCap.get(c.id)?.hasRealSources === true).length;
  let totalFresh = 0;
  for (const c of capabilities) {
    const last = latestByCap.get(c.id);
    if (last && (now - last.getTime()) / DAY <= 60) totalFresh += 1;
  }

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

  const result: CoverageResult = {
    generatedAt: new Date().toISOString(),
    ttlSeconds: CACHE_TTL_MS / 1000,
    totals: {
      industries: industries.length,
      capabilities: totalCaps,
      leafCapabilities: totalLeaf,
      pctApproved: pct(totalApproved, totalCaps),
      pctWithQuadrant: pct(totalQuadrant, totalCaps),
      pctWithFullEconomics: pct(totalFullEcon, totalCaps),
      pctFreshUnder60d: pct(totalFresh, totalCaps),
    },
    industries: rows,
  };

  return result;
}

/**
 * Admin-only extras: enrichment queue depth + rotation lag. These don't
 * fit the public scorecard's per-industry shape, so they're returned
 * separately by the admin endpoint.
 */
export async function getCoverageAdminExtras(): Promise<AdminCoverageExtras> {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const [counts, oldestQueuedRow, configRows] = await Promise.all([
    db
      .select({ status: enrichmentJobsTable.status, c: sql<number>`count(*)::int` })
      .from(enrichmentJobsTable)
      .groupBy(enrichmentJobsTable.status),
    db
      .select({ createdAt: enrichmentJobsTable.createdAt })
      .from(enrichmentJobsTable)
      .where(sql`${enrichmentJobsTable.status} = 'queued'`)
      .orderBy(enrichmentJobsTable.createdAt)
      .limit(1),
    db.select().from(enrichmentConfigTable).limit(1),
  ]);

  const byStatus = new Map(counts.map(r => [r.status, r.c]));
  const completedLast24h = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(enrichmentJobsTable)
    .where(sql`${enrichmentJobsTable.status} = 'completed' AND ${enrichmentJobsTable.completedAt} > ${new Date(now - DAY)}`);

  const oldestQueuedAgeMinutes = oldestQueuedRow[0]?.createdAt
    ? Math.round((now - oldestQueuedRow[0].createdAt.getTime()) / 60000)
    : null;

  const cfg = configRows[0];
  const minutesSinceLastRun = cfg?.lastRunAt
    ? Math.round((now - cfg.lastRunAt.getTime()) / 60000)
    : null;
  // Rotation is "lagging" if more than (refreshDays in hours) have elapsed
  // since the last run. We surface the raw lag in hours so the UI can decide
  // how loud to be about it.
  const lagHours = minutesSinceLastRun !== null && cfg
    ? Math.max(0, Math.round(minutesSinceLastRun / 60 - cfg.refreshDays * 24))
    : null;

  return {
    enrichmentQueue: {
      queued: byStatus.get("queued") ?? 0,
      running: byStatus.get("running") ?? 0,
      failed: byStatus.get("failed") ?? 0,
      completedLast24h: completedLast24h[0]?.c ?? 0,
      oldestQueuedAgeMinutes,
    },
    rotation: {
      enabled: cfg?.enabled ?? false,
      refreshDays: cfg?.refreshDays ?? 60,
      lastRunAt: cfg?.lastRunAt?.toISOString() ?? null,
      lastRunEnqueued: cfg?.lastRunEnqueued ?? 0,
      minutesSinceLastRun,
      lagHours,
    },
  };
}

export function _resetCoverageCacheForTest(): void {
  cached = null;
  inFlight = null;
}
