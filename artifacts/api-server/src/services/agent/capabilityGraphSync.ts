/**
 * Capability graph mirror — capabilities + capability_dependencies →
 * graph store (Neo4j AND/OR Graphiti+FalkorDB during the Phase A migration).
 *
 * Dual-write pattern: Postgres remains source of truth. Mirror writes are
 * fire-and-forget on every capability create/update and every dependency
 * insert. Reads default to Postgres; opt-in flags route them through a
 * graph store for A/B-safe migration:
 *   - USE_NEO4J_CAPABILITY_GRAPH=1   → cypher reads via Neo4j (legacy)
 *   - USE_GRAPHITI_WORLD_MODEL=1     → cypher reads via Graphiti MCP (Phase A target)
 *
 * Writes:
 *   - Neo4j mirror runs whenever NEO4J_URI is set (legacy path; preserved
 *     during Phase A cutover so we can roll back instantly).
 *   - Graphiti mirror runs whenever GRAPHITI_MCP_URL + _API_KEY are set.
 *     Uses direct Cypher MERGE via query_cypher (NOT add_episode) to keep
 *     LLM cost zero for ordinary structural updates. Callers that want
 *     bitemporal entity extraction should call recordCapabilityEpisode()
 *     for explicitly-meaningful events (lifecycle transitions, scoring
 *     deltas worth narrating).
 *
 * What this module is NOT:
 *  - The fast-path for ongoing reads (yet). Callers continue to use
 *    drizzle queries against capabilityDependenciesTable. Migration of
 *    individual readers to Cypher is opt-in via the env flag.
 *  - A two-way sync. Postgres is the only writer; the graph stores are
 *    downstream.
 *
 * Companion scripts:
 *   scripts/src/backfill-capability-graph-to-neo4j.ts          (legacy)
 *   scripts/src/backfill-graphiti-world-model.ts                (Phase A)
 *
 * Related: services/agent/graphMemory.ts uses the same pattern for the
 * agent's memory_entities + memory_relations tables. This module is the
 * structural analogue for the capability graph.
 */
import { logger } from "../../lib/logger";
import {
  isGraphitiAvailable,
  queryCypher as graphitiQueryCypher,
  addEpisode as graphitiAddEpisode,
} from "../../lib/graphiti-client";

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
  // Run both mirrors in parallel — fire-and-forget. Postgres has already
  // succeeded by the time we get here; the mirrors are best-effort.
  await Promise.allSettled([
    mirrorCapabilityNeo4j(fields),
    mirrorCapabilityGraphiti(fields),
  ]);
}

async function mirrorCapabilityNeo4j(fields: CapabilityNodeFields): Promise<void> {
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
    logger.warn({ err, pgId: fields.pgId }, "[capability-graph-sync] mirrorCapabilityNeo4j failed (Postgres write already succeeded)");
  } finally {
    await session.close();
  }
}

async function mirrorCapabilityGraphiti(fields: CapabilityNodeFields): Promise<void> {
  if (!isGraphitiAvailable()) return;
  try {
    const result = await graphitiQueryCypher({
      cypher: `MERGE (c:Capability { pgId: $pgId })
               SET c.slug = $slug,
                   c.name = $name,
                   c.industryId = $industryId,
                   c.parentCapabilityId = $parentCapabilityId,
                   c.isLeaf = $isLeaf,
                   c.reviewStatus = $reviewStatus,
                   c.benchmarkScore = $benchmarkScore,
                   c.updatedAt = timestamp()`,
      params: {
        pgId: fields.pgId,
        slug: fields.slug,
        name: fields.name,
        industryId: fields.industryId,
        parentCapabilityId: fields.parentCapabilityId ?? null,
        isLeaf: fields.isLeaf ?? true,
        reviewStatus: fields.reviewStatus ?? "approved",
        benchmarkScore: fields.benchmarkScore ?? null,
      },
    });
    if (!result.ok) {
      logger.warn({ err: result.error, pgId: fields.pgId }, "[capability-graph-sync] mirrorCapabilityGraphiti returned error");
    }
  } catch (err) {
    logger.warn({ err, pgId: fields.pgId }, "[capability-graph-sync] mirrorCapabilityGraphiti failed (Postgres write already succeeded)");
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
  await Promise.allSettled([
    mirrorDependencyNeo4j(fields),
    mirrorDependencyGraphiti(fields),
  ]);
}

async function mirrorDependencyNeo4j(fields: DependencyEdgeFields): Promise<void> {
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
    logger.warn({ err, ...fields }, "[capability-graph-sync] mirrorDependencyNeo4j failed (Postgres write already succeeded)");
  } finally {
    await session.close();
  }
}

async function mirrorDependencyGraphiti(fields: DependencyEdgeFields): Promise<void> {
  if (!isGraphitiAvailable()) return;
  try {
    const result = await graphitiQueryCypher({
      cypher: `MATCH (from:Capability { pgId: $capabilityId })
               MATCH (to:Capability { pgId: $dependsOnId })
               MERGE (from)-[r:DEPENDS_ON]->(to)
               SET r.strength = $strength, r.updatedAt = timestamp()`,
      params: { capabilityId: fields.capabilityId, dependsOnId: fields.dependsOnId, strength: fields.strength ?? "moderate" },
    });
    if (!result.ok) {
      logger.warn({ err: result.error, ...fields }, "[capability-graph-sync] mirrorDependencyGraphiti returned error");
    }
  } catch (err) {
    logger.warn({ err, ...fields }, "[capability-graph-sync] mirrorDependencyGraphiti failed (Postgres write already succeeded)");
  }
}

/**
 * Remove a :Capability node (cascade-removes its DEPENDS_ON edges).
 */
export async function removeCapabilityMirror(pgId: number): Promise<void> {
  await Promise.allSettled([
    removeCapabilityMirrorNeo4j(pgId),
    removeCapabilityMirrorGraphiti(pgId),
  ]);
}

async function removeCapabilityMirrorNeo4j(pgId: number): Promise<void> {
  const driver = await getDriver();
  if (!driver) return;
  const session = driver.session();
  try {
    await session.run(`MATCH (c:Capability { pgId: $pgId }) DETACH DELETE c`, { pgId });
  } catch (err) {
    logger.warn({ err, pgId }, "[capability-graph-sync] removeCapabilityMirrorNeo4j failed");
  } finally {
    await session.close();
  }
}

async function removeCapabilityMirrorGraphiti(pgId: number): Promise<void> {
  if (!isGraphitiAvailable()) return;
  try {
    const result = await graphitiQueryCypher({
      cypher: `MATCH (c:Capability { pgId: $pgId }) DETACH DELETE c`,
      params: { pgId },
    });
    if (!result.ok) {
      logger.warn({ err: result.error, pgId }, "[capability-graph-sync] removeCapabilityMirrorGraphiti returned error");
    }
  } catch (err) {
    logger.warn({ err, pgId }, "[capability-graph-sync] removeCapabilityMirrorGraphiti failed");
  }
}

/**
 * Record a meaningful capability event as a Graphiti episode so it gets
 * proper bitemporal extraction (entities, relations, time range). Callers
 * pass this for things like:
 *   - Capability lifecycle transitions (pending → approved → enriched)
 *   - Significant benchmark-score shifts worth narrating
 *   - Manual reviewer notes that should be searchable by future agents
 *
 * Do NOT call this for ordinary structural updates — mirrorCapability()
 * handles those via direct Cypher MERGE (zero LLM cost). add_episode runs
 * through the configured LLM (Haiku by default), so use it sparingly.
 *
 * Fire-and-forget; logs but doesn't bubble. No-op when Graphiti isn't
 * configured.
 */
export async function recordCapabilityEpisode(args: {
  capabilityPgId: number;
  capabilityName: string;
  eventName: string;
  narrative: string;
  occurredAt?: Date;
}): Promise<void> {
  if (!isGraphitiAvailable()) return;
  try {
    const result = await graphitiAddEpisode({
      name: `cap-${args.capabilityPgId}-${args.eventName}`,
      episodeBody: `Capability "${args.capabilityName}" (pgId=${args.capabilityPgId}): ${args.narrative}`,
      groupId: "global",
      sourceDescription: `capability-graph-sync:${args.eventName}`,
      referenceTime: (args.occurredAt ?? new Date()).toISOString(),
    });
    if (!result.ok) {
      logger.warn({ err: result.error, ...args }, "[capability-graph-sync] recordCapabilityEpisode returned error");
    }
  } catch (err) {
    logger.warn({ err, ...args }, "[capability-graph-sync] recordCapabilityEpisode failed");
  }
}

/**
 * Read path — multi-hop cascade traversal. Returns every capability
 * transitively reachable downstream from `rootPgId` within `maxHops` hops.
 * Used by services/disruption.ts:computeDisruptionRisk under either of
 * the read-routing flags.
 *
 * Routing precedence (first hit wins):
 *   1. USE_GRAPHITI_WORLD_MODEL=1 → cypher via Graphiti MCP (Phase A target)
 *   2. USE_NEO4J_CAPABILITY_GRAPH=1 → cypher via Neo4j (legacy fallback)
 *   3. neither flag set → returns null, caller uses Postgres CTE
 *
 * Returns null when the selected graph store is not available so callers
 * can fall back to the Postgres recursive CTE path.
 */
export async function cypherCascadeImpacted(rootPgId: number, maxHops = 3): Promise<Array<{ pgId: number; name: string; hops: number }> | null> {
  if (useGraphitiWorldModel()) {
    const result = await cypherCascadeImpactedGraphiti(rootPgId, maxHops);
    if (result !== null) return result;
    // Graphiti was supposed to handle this but errored — fall through to
    // Neo4j if it's also configured (defensive during cutover).
  }
  if (useNeo4jCapabilityGraph()) {
    return cypherCascadeImpactedNeo4j(rootPgId, maxHops);
  }
  return null;
}

async function cypherCascadeImpactedNeo4j(rootPgId: number, maxHops: number): Promise<Array<{ pgId: number; name: string; hops: number }> | null> {
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
    logger.warn({ err, rootPgId }, "[capability-graph-sync] cypherCascadeImpactedNeo4j failed; caller should fall back to Postgres");
    return null;
  } finally {
    await session.close();
  }
}

async function cypherCascadeImpactedGraphiti(rootPgId: number, maxHops: number): Promise<Array<{ pgId: number; name: string; hops: number }> | null> {
  if (!isGraphitiAvailable()) return null;
  try {
    const result = await graphitiQueryCypher({
      cypher: `MATCH path = (root:Capability { pgId: $rootPgId })<-[:DEPENDS_ON*1..${maxHops}]-(dependent:Capability)
               RETURN dependent.pgId AS pgId, dependent.name AS name, length(path) AS hops
               ORDER BY hops ASC, pgId ASC`,
      params: { rootPgId },
    });
    if (!result.ok || !result.rows) {
      logger.warn({ err: result.error, rootPgId }, "[capability-graph-sync] cypherCascadeImpactedGraphiti returned error; caller should fall back");
      return null;
    }
    return result.rows.map((r) => ({
      pgId: Number(r.pgId),
      name: String(r.name ?? ""),
      hops: Number(r.hops),
    }));
  } catch (err) {
    logger.warn({ err, rootPgId }, "[capability-graph-sync] cypherCascadeImpactedGraphiti failed; caller should fall back to Postgres");
    return null;
  }
}

/**
 * True iff Neo4j is wired and the operator has explicitly opted into
 * Cypher reads via env var. Default false — safe to deploy.
 */
export function useNeo4jCapabilityGraph(): boolean {
  return process.env.USE_NEO4J_CAPABILITY_GRAPH === "1";
}

/**
 * True iff the operator has flipped the Phase A migration flag. When this
 * returns true, cypherCascadeImpacted() prefers Graphiti over Neo4j.
 * Default false — safe to deploy before FalkorDB is populated.
 */
export function useGraphitiWorldModel(): boolean {
  return process.env.USE_GRAPHITI_WORLD_MODEL === "1";
}
