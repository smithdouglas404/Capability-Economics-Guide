import { db, organizationCapabilitiesTable, organizationsTable, capabilitiesTable, peerBenchmarksTable, botsTable } from "@workspace/db";
import { eq, sql, and, inArray } from "drizzle-orm";
import { logger } from "../../lib/logger";

const MINIMUM_CONTRIBUTORS = 5;

interface Sample {
  orgId: number;
  maturityScore: number;
  isSynthetic: boolean;
}

/**
 * Nightly aggregator: walks organization_capabilities × organizations,
 * groups by (industry_id, capability_id), computes percentile distributions,
 * upserts peer_benchmarks rows. Cells with < MINIMUM_CONTRIBUTORS rows are
 * deleted (or never inserted) to preserve privacy + statistical floor.
 *
 * Bot-vs-real composition tracked separately so the methodology surface
 * can disclose "Includes synthetic agent data from N bot-origin
 * assessments" honestly.
 *
 * Re-runnable: full rebuild every time. The table is bounded
 * (industries × capabilities) so a full sweep is O(few-thousand-rows)
 * at worst.
 */
export interface AggregatorResult {
  cellsScanned: number;
  cellsWritten: number;
  cellsSuppressed: number;
  totalContributors: number;
  syntheticContributors: number;
  durationMs: number;
}

export async function rebuildPeerBenchmarks(): Promise<AggregatorResult> {
  const start = Date.now();

  // Pull every assessed (org × capability) row joined with the org's industry
  // and a sentinel for whether the org belongs to a bot.
  const orgCaps = await db
    .select({
      orgId: organizationCapabilitiesTable.organizationId,
      capabilityId: organizationCapabilitiesTable.capabilityId,
      maturityScore: organizationCapabilitiesTable.maturityScore,
      industryId: organizationsTable.industryId,
    })
    .from(organizationCapabilitiesTable)
    .innerJoin(organizationsTable, eq(organizationCapabilitiesTable.organizationId, organizationsTable.id));

  // Collect which orgIds are bot-owned (synthetic). One round-trip — bots
  // are at most dozens, not millions.
  const botOrgIds = new Set(
    (await db.select({ organizationId: botsTable.organizationId }).from(botsTable)).map(b => b.organizationId)
  );

  // Group by (industry, capability)
  const groups = new Map<string, Sample[]>();
  for (const row of orgCaps) {
    const key = `${row.industryId}|${row.capabilityId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({
      orgId: row.orgId,
      maturityScore: row.maturityScore,
      isSynthetic: botOrgIds.has(row.orgId),
    });
  }

  let written = 0;
  let suppressed = 0;
  let totalContributors = 0;
  let syntheticContributors = 0;

  for (const [key, samples] of groups.entries()) {
    const [industryIdStr, capabilityIdStr] = key.split("|");
    const industryId = Number(industryIdStr);
    const capabilityId = Number(capabilityIdStr);

    totalContributors += samples.length;
    syntheticContributors += samples.filter(s => s.isSynthetic).length;

    if (samples.length < MINIMUM_CONTRIBUTORS) {
      // Below floor — make sure no stale row exists for this cell
      await db.delete(peerBenchmarksTable).where(and(
        eq(peerBenchmarksTable.industryId, industryId),
        eq(peerBenchmarksTable.capabilityId, capabilityId),
      ));
      suppressed++;
      continue;
    }

    const scores = samples.map(s => s.maturityScore).sort((a, b) => a - b);
    const stats = {
      p25: percentile(scores, 0.25),
      p50: percentile(scores, 0.50),
      p75: percentile(scores, 0.75),
      p90: percentile(scores, 0.90),
      min: scores[0],
      max: scores[scores.length - 1],
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
    };

    const nRealOrgs = samples.filter(s => !s.isSynthetic).length;
    const nSyntheticOrgs = samples.length - nRealOrgs;

    await db
      .insert(peerBenchmarksTable)
      .values({
        industryId,
        capabilityId,
        nOrgs: samples.length,
        nRealOrgs,
        nSyntheticOrgs,
        p25: stats.p25,
        p50: stats.p50,
        p75: stats.p75,
        p90: stats.p90,
        minScore: stats.min,
        maxScore: stats.max,
        mean: stats.mean,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [peerBenchmarksTable.industryId, peerBenchmarksTable.capabilityId],
        set: {
          nOrgs: samples.length,
          nRealOrgs,
          nSyntheticOrgs,
          p25: stats.p25,
          p50: stats.p50,
          p75: stats.p75,
          p90: stats.p90,
          minScore: stats.min,
          maxScore: stats.max,
          mean: stats.mean,
          computedAt: new Date(),
        },
      });
    written++;
  }

  const durationMs = Date.now() - start;
  logger.info({
    cellsScanned: groups.size,
    cellsWritten: written,
    cellsSuppressed: suppressed,
    totalContributors,
    syntheticContributors,
    durationMs,
  }, "[peer-benchmarks] rebuild complete");

  return {
    cellsScanned: groups.size,
    cellsWritten: written,
    cellsSuppressed: suppressed,
    totalContributors,
    syntheticContributors,
    durationMs,
  };
}

/**
 * Look up a single (industry, capability) benchmark for the capability
 * detail page. Returns null if the cell is suppressed (< 5 contributors).
 * Caller renders "Insufficient peer data yet — N orgs have contributed
 * so far" in that case.
 */
export async function getPeerBenchmark(industryId: number, capabilityId: number): Promise<{ benchmark: typeof peerBenchmarksTable.$inferSelect | null; suppressed: boolean }> {
  const [row] = await db
    .select()
    .from(peerBenchmarksTable)
    .where(and(eq(peerBenchmarksTable.industryId, industryId), eq(peerBenchmarksTable.capabilityId, capabilityId)))
    .limit(1);
  return { benchmark: row ?? null, suppressed: !row };
}

/**
 * Linear interpolation percentile. p is 0..1.
 */
function percentile(sortedScores: number[], p: number): number {
  if (sortedScores.length === 0) return 0;
  if (sortedScores.length === 1) return sortedScores[0];
  const rank = p * (sortedScores.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sortedScores[lower];
  const weight = rank - lower;
  return sortedScores[lower] * (1 - weight) + sortedScores[upper] * weight;
}
