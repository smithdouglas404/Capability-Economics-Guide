/**
 * Capability graph mirror — capabilities + capability_dependencies →
 * Neo4j (:Capability nodes + :DEPENDS_ON relationships).
 *
 * Dual-write pattern: Postgres remains source of truth; Neo4j mirror is
 * fire-and-forget on every capability create/update and every dependency
 * insert. Reads can either stay on Postgres (default, no behavior change)
 * or flip to Cypher behind the `USE_NEO4J_CAPABILITY_GRAPH=1` env var so
 * we can A/B the migration safely.
 *
 * What this module is NOT:
 *  - The fast-path for ongoing reads (yet). Callers continue to use
 *    drizzle queries against capabilityDependenciesTable. Migration of
 *    individual readers to Cypher is opt-in via the env flag.
 *  - A two-way sync. Postgres is the only writer; Neo4j is downstream.
 *
 * Companion script: scripts/src/backfill-capability-graph-to-neo4j.ts
 * performs the one-shot reconciliation needed after fresh deploys or
 * after a stretch where Neo4j was unreachable and dual-writes silently
 * dropped.
 *
 * Related: services/agent/graphMemory.ts uses the same pattern for the
 * agent's memory_entities + memory_relations tables. This module is the
 * structural analogue for the capability graph.
 */
import { logger } from "../../lib/logger";

// Lazy driver init — same pattern as graphMemory.ts, so a missing
// NEO4J_URI doesn't crash the api-server. Returns null when Neo4j is
// not configured or unreachable.
type Neo4jDriver = import("neo4j-driver").Driver;
let _driver: Neo4jDriver | null = null;
let _initAttempted = false;

async function getDriver(): Promise<Neo4jDriver | null> {
  if (_initAttempted) return _driver;
  _initAttempted = true;
  const uri = process.env.NEO4J_URI;
  if (!uri) return null;
  try {
    const neo4j = await import("neo4j-driver");
    const user = process.env.NEO4J_USER ?? "neo4j";
    const password = process.env.NEO4J_PASSWORD;
    if (!password) {
      logger.warn("[capability-graph-sync] NEO4J_PASSWORD not set; mirror disabled");
      return null;
    }
    _driver = neo4j.default.driver(uri, neo4j.default.auth.basic(user, password));
    await _driver.verifyConnectivity();
    // One-time index ensure.
    const session = _driver.session();
    try {
      await session.run("CREATE INDEX cap_pgid IF NOT EXISTS FOR (c:Capability) ON (c.pgId)");
      await session.run("CREATE INDEX cap_slug IF NOT EXISTS FOR (c:Capability) ON (c.slug)");
      await session.run("CREATE INDEX cap_industry IF NOT EXISTS FOR (c:Capability) ON (c.industryId)");
    } finally {
      await session.close();
    }
    logger.info("[capability-graph-sync] Neo4j driver ready");
    return _driver;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[capability-graph-sync] Neo4j unreachable; mirror disabled (Postgres reads continue)");
    _driver = null;
    return _driver;
  }
}

export interface CapabilityNodeFields {
  pgId: number;
  slug: string;
  name: string;
  industryId: number;
  parentCapabilityId?: number | null;
  isLeaf?: boolean;
  reviewStatus?: string;
  benchmarkScore?: number;
}

/**
 * Upsert a :Capability node mirroring a Postgres capabilities row.
 * Fire-and-forget — callers ignore failures (logged but don't bubble).
 */
export async function mirrorCapability(fields: CapabilityNodeFields): Promise<void> {
  const driver = await getDriver();
  if (!driver) return;
  const session = driver.session();
  try {
    await session.run(
      `MERGE (c:Capability { pgId: $pgId })
       SET c.slug = $slug,
           c.name = $name,
           c.industryId = $industryId,
           c.parentCapabilityId = $parentCapabilityId,
           c.isLeaf = $isLeaf,
           c.reviewStatus = $reviewStatus,
           c.benchmarkScore = $benchmarkScore,
           c.updatedAt = timestamp()`,
      {
        pgId: fields.pgId,
        slug: fields.slug,
        name: fields.name,
        industryId: fields.industryId,
        parentCapabilityId: fields.parentCapabilityId ?? null,
        isLeaf: fields.isLeaf ?? true,
        reviewStatus: fields.reviewStatus ?? "approved",
        benchmarkScore: fields.benchmarkScore ?? null,
      },
    );
  } catch (err) {
    logger.warn({ err, pgId: fields.pgId }, "[capability-graph-sync] mirrorCapability failed (Postgres write already succeeded)");
  } finally {
    await session.close();
  }
}

export interface DependencyEdgeFields {
  capabilityId: number;     // FROM (the dependent)
  dependsOnId: number;      // TO (the prerequisite)
  strength?: string;
}

/**
 * Upsert a :DEPENDS_ON relationship. Direction: dependent -[DEPENDS_ON]-> prerequisite.
 * Matches the semantics of the Postgres FK: capability_dependencies.capability_id depends on depends_on_id.
 */
export async function mirrorDependency(fields: DependencyEdgeFields): Promise<void> {
  const driver = await getDriver();
  if (!driver) return;
  const session = driver.session();
  try {
    await session.run(
      `MATCH (from:Capability { pgId: $capabilityId })
       MATCH (to:Capability { pgId: $dependsOnId })
       MERGE (from)-[r:DEPENDS_ON]->(to)
       SET r.strength = $strength, r.updatedAt = timestamp()`,
      { capabilityId: fields.capabilityId, dependsOnId: fields.dependsOnId, strength: fields.strength ?? "moderate" },
    );
  } catch (err) {
    logger.warn({ err, ...fields }, "[capability-graph-sync] mirrorDependency failed (Postgres write already succeeded)");
  } finally {
    await session.close();
  }
}

/**
 * Remove a :Capability node (cascade-removes its DEPENDS_ON edges).
 */
export async function removeCapabilityMirror(pgId: number): Promise<void> {
  const driver = await getDriver();
  if (!driver) return;
  const session = driver.session();
  try {
    await session.run(`MATCH (c:Capability { pgId: $pgId }) DETACH DELETE c`, { pgId });
  } catch (err) {
    logger.warn({ err, pgId }, "[capability-graph-sync] removeCapabilityMirror failed");
  } finally {
    await session.close();
  }
}

/**
 * Read path — multi-hop cascade traversal in Cypher. Returns every
 * capability transitively reachable downstream from `rootPgId` within
 * `maxHops` hops. Used by the Cascade tab when
 * `USE_NEO4J_CAPABILITY_GRAPH=1` is set.
 *
 * Returns null when Neo4j is not available so callers can fall back to
 * the Postgres recursive CTE path.
 */
export async function cypherCascadeImpacted(rootPgId: number, maxHops = 3): Promise<Array<{ pgId: number; name: string; hops: number }> | null> {
  const driver = await getDriver();
  if (!driver) return null;
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH path = (root:Capability { pgId: $rootPgId })<-[:DEPENDS_ON*1..${maxHops}]-(dependent:Capability)
       RETURN dependent.pgId AS pgId, dependent.name AS name, length(path) AS hops
       ORDER BY hops ASC, pgId ASC`,
      { rootPgId },
    );
    return result.records.map((r) => ({
      pgId: Number(r.get("pgId")),
      name: String(r.get("name")),
      hops: Number(r.get("hops")),
    }));
  } catch (err) {
    logger.warn({ err, rootPgId }, "[capability-graph-sync] cypherCascadeImpacted failed; caller should fall back to Postgres");
    return null;
  } finally {
    await session.close();
  }
}

/**
 * True iff Neo4j is wired and the operator has explicitly opted into
 * Cypher reads via env var. Default false — safe to deploy.
 */
export function useNeo4jCapabilityGraph(): boolean {
  return process.env.USE_NEO4J_CAPABILITY_GRAPH === "1";
}
