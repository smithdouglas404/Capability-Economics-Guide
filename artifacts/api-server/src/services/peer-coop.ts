/**
 * Anonymous peer data co-op.
 *
 * "Contribute your org's capability scores, get percentiles for your cohort."
 *
 * Cohort dimensions: industry × size × geography × revenueBand. A cohort is
 * eligible to return percentiles only when ≥ MIN_K orgs have contributed
 * (opted in and scored ≥ MIN_CAPS capabilities). Percentile responses never
 * expose individual scores — only p25 / p50 / p75 / p90 over the cohort.
 *
 * Access gate: to read peer percentiles for a cohort, the caller must belong
 * to an org that itself is a contributor. Net effect: members are incentivized
 * to opt in, and a single non-contributing org cannot scrape the panel.
 */
import { db } from "@workspace/db";
import {
  organizationsTable,
  organizationCapabilitiesTable,
  capabilitiesTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

const MIN_K = 5;       // k-anonymity threshold
const MIN_CAPS = 10;   // contribution threshold (caps scored)

export type CohortKey = {
  industryId: number;
  size: string | null;
  geography: string | null;
  revenueBand: string | null;
};

function cohortString(c: CohortKey): string {
  return `${c.industryId}|${c.size ?? "_"}|${c.geography ?? "_"}|${c.revenueBand ?? "_"}`;
}

export interface ContributorStatus {
  organizationId: number;
  organizationName: string;
  isContributor: boolean;
  capsScored: number;
  capsRequiredForContributor: number;
  peerOptIn: boolean;
  cohort: CohortKey;
  cohortContributorCount: number;
  cohortEligible: boolean;        // true when ≥ MIN_K contributors
  minK: number;
}

export async function getContributorStatus(organizationId: number): Promise<ContributorStatus | null> {
  const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, organizationId));
  if (!org) return null;

  const [{ c }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(organizationCapabilitiesTable)
    .where(eq(organizationCapabilitiesTable.organizationId, organizationId));

  const capsScored = c ?? 0;
  const isContributor = !!org.peerOptIn && capsScored >= MIN_CAPS;

  const cohort: CohortKey = {
    industryId: org.industryId,
    size: org.size ?? null,
    geography: org.geography ?? null,
    revenueBand: org.revenueBand ?? null,
  };

  // Cohort contributor count: peer-opted-in orgs in the same cohort with
  // capsScored >= MIN_CAPS. Computed via SQL group + filter.
  const peers = await db
    .select({
      orgId: organizationsTable.id,
      capsScored: sql<number>`(SELECT COUNT(*) FROM ${organizationCapabilitiesTable} WHERE ${organizationCapabilitiesTable.organizationId} = ${organizationsTable.id})::int`,
    })
    .from(organizationsTable)
    .where(and(
      eq(organizationsTable.industryId, org.industryId),
      eq(organizationsTable.peerOptIn, true),
    ));

  const cohortPeers = peers.filter(p => {
    const matchSize = !cohort.size || true; // size always matches the org's own bucket
    return matchSize && p.capsScored >= MIN_CAPS;
  });
  // Refine to exact cohort match (size/geo/rev) — separate filter so we have
  // the looser industry count handy for future fallback logic.
  const exactPeers = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(and(
      eq(organizationsTable.industryId, org.industryId),
      eq(organizationsTable.peerOptIn, true),
      org.size ? eq(organizationsTable.size, org.size) : sql`TRUE`,
      org.geography ? eq(organizationsTable.geography, org.geography) : sql`TRUE`,
      org.revenueBand ? eq(organizationsTable.revenueBand, org.revenueBand) : sql`TRUE`,
    ));

  const exactPeerIds = exactPeers.map(p => p.id);
  const exactContributors = await db
    .select({
      orgId: organizationCapabilitiesTable.organizationId,
      c: sql<number>`count(*)::int`,
    })
    .from(organizationCapabilitiesTable)
    .where(inArray(organizationCapabilitiesTable.organizationId, exactPeerIds.length > 0 ? exactPeerIds : [-1]))
    .groupBy(organizationCapabilitiesTable.organizationId);
  const cohortContributorCount = exactContributors.filter(r => r.c >= MIN_CAPS).length;

  return {
    organizationId: org.id,
    organizationName: org.name,
    isContributor,
    capsScored,
    capsRequiredForContributor: MIN_CAPS,
    peerOptIn: !!org.peerOptIn,
    cohort,
    cohortContributorCount,
    cohortEligible: cohortContributorCount >= MIN_K,
    minK: MIN_K,
  };
}

export interface PercentilesRow {
  capabilityId: number;
  capabilityName: string;
  n: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  mean: number;
  myScore: number | null;
  myPercentileBand: "bottom" | "below_median" | "above_median" | "top" | "unknown";
}

export interface PeerPercentilesResult {
  cohort: CohortKey;
  cohortContributorCount: number;
  cohortEligible: boolean;
  minK: number;
  rows: PercentilesRow[];
  // Generated for the org that's making the request — used to position their
  // own score on the cohort distribution.
  organizationId: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function bandFor(myScore: number | null, p25: number, p50: number, p75: number, p90: number): PercentilesRow["myPercentileBand"] {
  if (myScore === null) return "unknown";
  if (myScore >= p90) return "top";
  if (myScore >= p75) return "above_median";
  if (myScore < p25) return "bottom";
  if (myScore < p50) return "bottom";
  return "above_median";
}

export async function getPeerPercentiles(organizationId: number): Promise<PeerPercentilesResult | null> {
  const status = await getContributorStatus(organizationId);
  if (!status) return null;

  // Access gate: requester must be a contributor.
  if (!status.isContributor) {
    return {
      cohort: status.cohort,
      cohortContributorCount: status.cohortContributorCount,
      cohortEligible: false,
      minK: MIN_K,
      rows: [],
      organizationId,
    };
  }
  // K-anonymity gate.
  if (!status.cohortEligible) {
    return {
      cohort: status.cohort,
      cohortContributorCount: status.cohortContributorCount,
      cohortEligible: false,
      minK: MIN_K,
      rows: [],
      organizationId,
    };
  }

  // Pull peer org ids in the cohort.
  const cohort = status.cohort;
  const peers = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(and(
      eq(organizationsTable.industryId, cohort.industryId),
      eq(organizationsTable.peerOptIn, true),
      cohort.size ? eq(organizationsTable.size, cohort.size) : sql`TRUE`,
      cohort.geography ? eq(organizationsTable.geography, cohort.geography) : sql`TRUE`,
      cohort.revenueBand ? eq(organizationsTable.revenueBand, cohort.revenueBand) : sql`TRUE`,
    ));
  const peerIds = peers.map(p => p.id);

  // Filter to actual contributors (capsScored ≥ MIN_CAPS).
  const contributorCounts = await db
    .select({
      orgId: organizationCapabilitiesTable.organizationId,
      c: sql<number>`count(*)::int`,
    })
    .from(organizationCapabilitiesTable)
    .where(inArray(organizationCapabilitiesTable.organizationId, peerIds.length > 0 ? peerIds : [-1]))
    .groupBy(organizationCapabilitiesTable.organizationId);
  const contributorIds = contributorCounts.filter(r => r.c >= MIN_CAPS).map(r => r.orgId);

  // Pull all scores from contributing orgs.
  const scores = await db
    .select({
      capabilityId: organizationCapabilitiesTable.capabilityId,
      organizationId: organizationCapabilitiesTable.organizationId,
      score: organizationCapabilitiesTable.maturityScore,
    })
    .from(organizationCapabilitiesTable)
    .where(inArray(organizationCapabilitiesTable.organizationId, contributorIds.length > 0 ? contributorIds : [-1]));

  // Group by capability, compute stats only when within-capability n ≥ MIN_K.
  const byCap = new Map<number, number[]>();
  const mineByCap = new Map<number, number>();
  for (const s of scores) {
    const arr = byCap.get(s.capabilityId) ?? [];
    arr.push(s.score);
    byCap.set(s.capabilityId, arr);
    if (s.organizationId === organizationId) mineByCap.set(s.capabilityId, s.score);
  }

  const eligibleCapIds = [...byCap.entries()].filter(([, arr]) => arr.length >= MIN_K).map(([k]) => k);
  const capNames = eligibleCapIds.length > 0
    ? await db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name }).from(capabilitiesTable).where(inArray(capabilitiesTable.id, eligibleCapIds))
    : [];
  const nameById = new Map(capNames.map(c => [c.id, c.name]));

  const rows: PercentilesRow[] = eligibleCapIds.map(capId => {
    const arr = (byCap.get(capId) ?? []).slice().sort((a, b) => a - b);
    const p25 = percentile(arr, 25);
    const p50 = percentile(arr, 50);
    const p75 = percentile(arr, 75);
    const p90 = percentile(arr, 90);
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    const my = mineByCap.get(capId) ?? null;
    return {
      capabilityId: capId,
      capabilityName: nameById.get(capId) ?? `#${capId}`,
      n: arr.length,
      p25: Math.round(p25 * 100) / 100,
      p50: Math.round(p50 * 100) / 100,
      p75: Math.round(p75 * 100) / 100,
      p90: Math.round(p90 * 100) / 100,
      mean: Math.round(mean * 100) / 100,
      myScore: my !== null ? Math.round(my * 100) / 100 : null,
      myPercentileBand: bandFor(my, p25, p50, p75, p90),
    };
  });
  rows.sort((a, b) => a.capabilityName.localeCompare(b.capabilityName));

  return {
    cohort,
    cohortContributorCount: status.cohortContributorCount,
    cohortEligible: true,
    minK: MIN_K,
    rows,
    organizationId,
  };
}
