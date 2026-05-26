/**
 * Capability graph mirror — capabilities + capability_dependencies →
 * Graphiti+FalkorDB (via the Graphiti MCP server).
 *
 * Dual-write pattern: Postgres remains source of truth. Mirror writes
 * are fire-and-forget on every capability create/update and every
 * dependency insert. Reads default to Postgres; opt-in flag routes
 * them through Graphiti's Cypher MERGE for graph-native traversal:
 *   USE_GRAPHITI_WORLD_MODEL=1 → cypherCascadeImpacted reads via Graphiti
 *
 * Writes:
 *   - Graphiti mirror runs whenever GRAPHITI_MCP_URL is set. Uses direct
 *     Cypher MERGE via query_cypher (NOT add_episode) to keep LLM cost
 *     zero for ordinary structural updates. Callers that want bitemporal
 *     entity extraction should call recordCapabilityEpisode() for
 *     explicitly-meaningful events (lifecycle transitions, scoring
 *     deltas worth narrating).
 *
 * What this module is NOT:
 *  - The fast-path for ongoing reads (yet). Callers continue to use
 *    drizzle queries against capabilityDependenciesTable. Migration of
 *    individual readers to Cypher is opt-in via USE_GRAPHITI_WORLD_MODEL.
 *  - A two-way sync. Postgres is the only writer; Graphiti is downstream.
 *
 * Companion script:
 *   scripts/src/backfill-graphiti-world-model.ts
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
      logger.warn({ err: result.error, pgId: fields.pgId }, "[capability-graph-sync] mirrorCapability returned error");
    }
  } catch (err) {
    logger.warn({ err, pgId: fields.pgId }, "[capability-graph-sync] mirrorCapability failed (Postgres write already succeeded)");
  }

  // Fire-and-forget embedding write. Lazy import to avoid pulling the
  // vector service (and its OpenAI fetch dep) into call sites that
  // mirror capability writes thousands of times during backfill — the
  // .then(...).catch(...) ensures we never block or throw upstream.
  void (async () => {
    try {
      const [{ isVectorSearchAvailable, embedText, setCapabilityEmbedding }] = await Promise.all([
        import("../capability-graph-vector"),
      ]);
      if (!isVectorSearchAvailable()) return;
      const parts: string[] = [fields.name];
      if (fields.slug) parts.push(`slug: ${fields.slug}`);
      const text = parts.join(" — ").slice(0, 4000);
      const vec = await embedText(text);
      if (!vec) return;
      await setCapabilityEmbedding(fields.pgId, vec);
    } catch {
      // Non-fatal — embedding is a nice-to-have that will be refilled
      // on the next backfill run if it ever fails here.
    }
  })();
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
      logger.warn({ err: result.error, ...fields }, "[capability-graph-sync] mirrorDependency returned error");
    }
  } catch (err) {
    logger.warn({ err, ...fields }, "[capability-graph-sync] mirrorDependency failed (Postgres write already succeeded)");
  }
}

/**
 * Remove a :Capability node (cascade-removes its DEPENDS_ON edges).
 */
export async function removeCapabilityMirror(pgId: number): Promise<void> {
  if (!isGraphitiAvailable()) return;
  try {
    const result = await graphitiQueryCypher({
      cypher: `MATCH (c:Capability { pgId: $pgId }) DETACH DELETE c`,
      params: { pgId },
    });
    if (!result.ok) {
      logger.warn({ err: result.error, pgId }, "[capability-graph-sync] removeCapabilityMirror returned error");
    }
  } catch (err) {
    logger.warn({ err, pgId }, "[capability-graph-sync] removeCapabilityMirror failed");
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
 * transitively reachable downstream from `rootPgId` within `maxHops`
 * hops. Used by services/disruption.ts:computeDisruptionRisk when
 * USE_GRAPHITI_WORLD_MODEL=1 is set.
 *
 * Returns null when Graphiti is not available so callers can fall back
 * to the Postgres recursive CTE path. **A successful empty result is
 * also a "fall back" signal** — callers should treat it as suspicious
 * unless Postgres also returns empty, because it almost always means
 * the structural mirror hasn't been backfilled. The helper logs a warn
 * on empty so this state is visible in the logs; the responsibility
 * for falling back lives with the caller (because what counts as a
 * valid Postgres fallback differs per consumer).
 */
export async function cypherCascadeImpacted(rootPgId: number, maxHops = 3): Promise<Array<{ pgId: number; name: string; hops: number }> | null> {
  if (!useGraphitiWorldModel() || !isGraphitiAvailable()) return null;
  try {
    const result = await graphitiQueryCypher({
      cypher: `MATCH path = (root:Capability { pgId: $rootPgId })<-[:DEPENDS_ON*1..${maxHops}]-(dependent:Capability)
               RETURN dependent.pgId AS pgId, dependent.name AS name, length(path) AS hops
               ORDER BY hops ASC, pgId ASC`,
      params: { rootPgId },
    });
    if (!result.ok || !result.rows) {
      logger.warn({ err: result.error, rootPgId }, "[capability-graph-sync] cypherCascadeImpacted returned error; caller should fall back to Postgres");
      return null;
    }
    const rows = result.rows.map((r) => ({
      pgId: Number(r.pgId),
      name: String(r.name ?? ""),
      hops: Number(r.hops),
    }));
    if (rows.length === 0) {
      logger.warn(
        { rootPgId, maxHops },
        "[capability-graph-sync] cypherCascadeImpacted returned empty — structural :Capability mirror may be incomplete. Caller should fall back to Postgres CTE.",
      );
    }
    return rows;
  } catch (err) {
    logger.warn({ err, rootPgId }, "[capability-graph-sync] cypherCascadeImpacted failed; caller should fall back to Postgres");
    return null;
  }
}

/**
 * True iff the operator has flipped the Phase A migration flag. When this
 * returns true, cypherCascadeImpacted() reads via Graphiti.
 * Default false — safe to deploy before FalkorDB is populated.
 */
export function useGraphitiWorldModel(): boolean {
  return process.env.USE_GRAPHITI_WORLD_MODEL === "1";
}
