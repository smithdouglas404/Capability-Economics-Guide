/**
 * Capability graph algorithms — wraps FalkorDB's built-in PageRank +
 * Community-Detection-via-Label-Propagation (CDLP) so the rest of the app
 * can use them without thinking about Cypher / row-unwrap details.
 *
 * Why here and not in capabilityGraphSync.ts: those wrappers are about
 * dual-write mirroring (Postgres → FalkorDB) for the dependency edges.
 * This file is about READING derived metrics off the populated graph.
 * Keeping the two concerns separate makes it obvious which file to look
 * at when you're investigating a write vs a read problem.
 *
 * Caching: both algorithms are sub-millisecond on the current ~500-cap
 * graph but produce identical results across many disruption-risk
 * computations within a single API tick. A 1-hour TTL in-memory cache
 * trades a sliver of freshness for not hammering FalkorDB on every
 * request. The cache is module-scoped so it survives within one
 * Node process; on container restart it warms back up.
 *
 * Graceful degrade: when USE_GRAPHITI_WORLD_MODEL=0 or the MCP server
 * is unreachable, every public function returns an empty map. Callers
 * should treat absence as "no signal" — never throw on missing data.
 */

import { isGraphitiEnabled, queryCypher } from "../lib/graphiti-client";
import { logger } from "../lib/logger";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

interface CachedMap {
  map: Map<number, number>;
  computedAt: number;
}

let pageRankCache: CachedMap | null = null;
let communityCache: CachedMap | null = null;

function isFresh(cache: CachedMap | null): boolean {
  return !!cache && Date.now() - cache.computedAt < CACHE_TTL_MS;
}

/**
 * PageRank over (:Capability)-[:DEPENDS_ON]->(:Capability).
 *
 * The score is FalkorDB's standard PageRank — higher means the
 * capability is depended upon by more (transitively important) other
 * capabilities. "Systemic importance" in human terms: if this thing
 * breaks, more downstream stuff breaks with it.
 *
 * Returns Map<pgId, score>. Empty map when Graphiti is off / unreachable
 * / the graph has no :Capability nodes.
 */
export async function getPageRankScores(): Promise<Map<number, number>> {
  if (isFresh(pageRankCache)) return pageRankCache!.map;
  const map = new Map<number, number>();
  if (!isGraphitiEnabled()) {
    pageRankCache = { map, computedAt: Date.now() };
    return map;
  }
  try {
    const result = await queryCypher({
      cypher:
        "CALL algo.pageRank('Capability', 'DEPENDS_ON') YIELD node, score " +
        "RETURN node.pgId AS pgId, score",
    });
    if (!result.ok || !result.rows) {
      logger.warn({ err: result.error }, "[capability-graph-algorithms] pageRank query failed");
    } else {
      for (const r of result.rows) {
        const pg = Number(r.pgId);
        const score = Number(r.score);
        if (Number.isFinite(pg) && Number.isFinite(score)) map.set(pg, score);
      }
    }
  } catch (err) {
    logger.warn({ err }, "[capability-graph-algorithms] pageRank threw");
  }
  pageRankCache = { map, computedAt: Date.now() };
  return map;
}

/**
 * Community assignments via Label Propagation (CDLP). Returns
 * Map<pgId, communityId>. The communityId is an internal FalkorDB id
 * that's only meaningful within the same algorithm run — use it for
 * "which caps cluster together" lookups, not as a stable external key.
 */
export async function getCommunityAssignments(): Promise<Map<number, number>> {
  if (isFresh(communityCache)) return communityCache!.map;
  const map = new Map<number, number>();
  if (!isGraphitiEnabled()) {
    communityCache = { map, computedAt: Date.now() };
    return map;
  }
  try {
    const result = await queryCypher({
      cypher:
        "CALL algo.labelPropagation({nodeLabels:['Capability'], relationshipTypes:['DEPENDS_ON']}) " +
        "YIELD node, communityId RETURN node.pgId AS pgId, communityId",
    });
    if (!result.ok || !result.rows) {
      logger.warn({ err: result.error }, "[capability-graph-algorithms] CDLP query failed");
    } else {
      for (const r of result.rows) {
        const pg = Number(r.pgId);
        const cid = Number(r.communityId);
        if (Number.isFinite(pg) && Number.isFinite(cid)) map.set(pg, cid);
      }
    }
  } catch (err) {
    logger.warn({ err }, "[capability-graph-algorithms] CDLP threw");
  }
  communityCache = { map, computedAt: Date.now() };
  return map;
}

/**
 * Percentile rank of a capability's PageRank score among all known
 * capabilities. Result is 0–1; missing capabilities or empty cache
 * return null (caller decides how to render).
 *
 * Percentile is computed as `1 - (rank / N)` where rank=0 is the most
 * important cap. So 1.0 = "most systemically important on the graph",
 * 0.0 = "least important / leaf node".
 */
export async function getSystemicImportance(pgId: number): Promise<number | null> {
  const scores = await getPageRankScores();
  if (scores.size === 0) return null;
  const score = scores.get(pgId);
  if (score === undefined) return null;
  const lower = Array.from(scores.values()).filter((s) => s <= score).length;
  return scores.size === 1 ? 1 : (lower - 1) / (scores.size - 1);
}

/**
 * Admin / diagnostic snapshot — top-N PageRank scores and community
 * size distribution. Used by /api/admin/graphiti/algorithms.
 */
export async function getAlgorithmsSnapshot(): Promise<{
  graphitiEnabled: boolean;
  pageRank: { top: Array<{ pgId: number; score: number }>; n: number };
  communities: { sizes: Array<{ communityId: number; size: number }>; n: number };
  computedAt: string;
}> {
  const [pr, comm] = await Promise.all([getPageRankScores(), getCommunityAssignments()]);
  const top = Array.from(pr.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pgId, score]) => ({ pgId, score }));
  const sizeMap = new Map<number, number>();
  for (const cid of comm.values()) sizeMap.set(cid, (sizeMap.get(cid) ?? 0) + 1);
  const sizes = Array.from(sizeMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([communityId, size]) => ({ communityId, size }));
  return {
    graphitiEnabled: isGraphitiEnabled(),
    pageRank: { top, n: pr.size },
    communities: { sizes, n: sizeMap.size },
    computedAt: new Date().toISOString(),
  };
}
