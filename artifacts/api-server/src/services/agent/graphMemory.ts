/**
 * Graph Memory — dual-backend graph traversal.
 *
 * BACKEND SELECTION (automatic):
 *   1. Neo4j (Railway) — activated when NEO4J_URI env var is set.
 *      Provides real Cypher-based graph traversal with native relationship
 *      semantics. This is the production target for the capability graph.
 *   2. PostgreSQL (Drizzle) — fallback when NEO4J_URI is absent.
 *      Uses the memory_entities + memory_relations tables that already exist
 *      in the Drizzle schema. Functionally equivalent but without graph-native
 *      query optimization.
 *
 * ENTITY/RELATION MODEL:
 *   Entities: industry | capability | concept | metric | actor
 *   Relations: depends_on | enables | competes_with | substitutes |
 *              co_occurs_with | correlates_with | contradicts
 *
 * WRITE PATH:
 *   All writes go to BOTH backends when Neo4j is configured, so the
 *   PostgreSQL tables remain a consistent mirror (useful for admin queries
 *   and as a fallback if Neo4j is temporarily unavailable).
 *
 * READ PATH:
 *   Reads prefer Neo4j when available (faster graph traversal, native hops).
 *   Falls back to PostgreSQL automatically on any Neo4j error.
 *
 * ENVIRONMENT VARIABLES:
 *   NEO4J_URI      — bolt://... or neo4j+s://... (Railway internal or public)
 *   NEO4J_USER     — default: "neo4j"
 *   NEO4J_PASSWORD — required when NEO4J_URI is set
 */

import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  memoryEntitiesTable,
  memoryRelationsTable,
} from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import pino from "pino";

const logger = pino({ name: "graph-memory" });

// ── Neo4j Integer → JS number helper ─────────────────────────────────────────
// neo4j-driver returns its own Integer type for integer fields. Floats (weight)
// come back as native JS numbers. This helper handles both safely.
function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (v !== null && typeof v === "object" && "toNumber" in v) return (v as { toNumber(): number }).toNumber();
  return Number(v);
}

// ── Neo4j driver (lazy-loaded) ────────────────────────────────────────────────

type Neo4jDriver = import("neo4j-driver").Driver;
let _neo4jDriver: Neo4jDriver | null = null;
let _neo4jInitAttempted = false;

async function getNeo4jDriver(): Promise<Neo4jDriver | null> {
  if (_neo4jInitAttempted) return _neo4jDriver;
  _neo4jInitAttempted = true;

  const uri = process.env.NEO4J_URI;
  if (!uri) return null;

  try {
    const neo4j = await import("neo4j-driver");
    const user = process.env.NEO4J_USER ?? "neo4j";
    const password = process.env.NEO4J_PASSWORD;
    if (!password) {
      logger.warn("[graph-memory] NEO4J_URI set but NEO4J_PASSWORD missing — Neo4j disabled");
      return null;
    }
    _neo4jDriver = neo4j.default.driver(uri, neo4j.default.auth.basic(user, password));
    // Verify connectivity
    await _neo4jDriver.verifyConnectivity();
    logger.info({ uri }, "[graph-memory] Neo4j connected");
    // Create indexes on first connect (idempotent)
    await initNeo4jSchema(_neo4jDriver);
    return _neo4jDriver;
  } catch (err) {
    logger.warn({ err }, "[graph-memory] Neo4j connection failed — falling back to PostgreSQL");
    _neo4jDriver = null;
    return null;
  }
}

async function initNeo4jSchema(driver: Neo4jDriver): Promise<void> {
  const session = driver.session();
  try {
    await session.run("CREATE INDEX entity_key IF NOT EXISTS FOR (e:Entity) ON (e.normalizedKey)");
    await session.run("CREATE INDEX entity_kind IF NOT EXISTS FOR (e:Entity) ON (e.kind)");
    await session.run("CREATE INDEX entity_industry IF NOT EXISTS FOR (e:Entity) ON (e.industryId)");
    await session.run("CREATE INDEX entity_capability IF NOT EXISTS FOR (e:Entity) ON (e.capabilityId)");
  } finally {
    await session.close();
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type EntityKind = "industry" | "capability" | "concept" | "metric" | "actor";
export type RelationKind = "depends_on" | "enables" | "competes_with" | "substitutes" | "co_occurs_with" | "correlates_with" | "contradicts";

export interface ExtractedEntity {
  kind: EntityKind;
  name: string;
  normalizedKey: string;
  industryId?: number | null;
  capabilityId?: number | null;
}

// ── Catalog cache ─────────────────────────────────────────────────────────────

let catalogCache: {
  loadedAt: number;
  industries: Array<{ id: number; name: string; key: string }>;
  capabilities: Array<{ id: number; name: string; industryId: number; key: string }>;
} | null = null;

const CATALOG_TTL_MS = 5 * 60 * 1000;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

async function loadCatalog() {
  const now = Date.now();
  if (catalogCache && now - catalogCache.loadedAt < CATALOG_TTL_MS) return catalogCache;
  const inds = await db.select({ id: industriesTable.id, name: industriesTable.name }).from(industriesTable);
  const caps = await db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name, industryId: capabilitiesTable.industryId }).from(capabilitiesTable);
  catalogCache = {
    loadedAt: now,
    industries: inds.map((i) => ({ ...i, key: normalize(i.name) })),
    capabilities: caps.map((c) => ({ ...c, key: normalize(c.name) })),
  };
  return catalogCache;
}

const STOP_TOKENS = new Set([
  "the", "and", "for", "with", "into", "from", "their", "they", "this", "that", "these", "those",
  "have", "been", "were", "what", "when", "where", "which", "while", "after", "before",
  "industry", "capability", "capabilities", "moat", "score", "trend", "data", "value", "company", "enterprise",
]);

// ── Entity extraction ─────────────────────────────────────────────────────────

/**
 * Extract entities by tokenizing text against the live catalog.
 * Recognizes: known industries, known capabilities, plus high-signal multi-word phrases.
 */
export async function extractEntitiesFromText(text: string): Promise<ExtractedEntity[]> {
  const catalog = await loadCatalog();
  const norm = normalize(text);
  const found = new Map<string, ExtractedEntity>();

  for (const ind of catalog.industries) {
    if (norm.includes(ind.key) && ind.key.length > 2) {
      const k = `industry:${ind.key}`;
      if (!found.has(k)) found.set(k, { kind: "industry", name: ind.name, normalizedKey: ind.key, industryId: ind.id });
    }
  }
  for (const cap of catalog.capabilities) {
    if (norm.includes(cap.key) && cap.key.length > 2) {
      const k = `capability:${cap.key}`;
      if (!found.has(k)) found.set(k, { kind: "capability", name: cap.name, normalizedKey: cap.key, capabilityId: cap.id, industryId: cap.industryId });
    }
  }

  // High-signal metric/concept phrases
  const conceptPhrases = [
    "moat score", "half life", "evar", "consensus score", "confidence", "velocity",
    "automation", "ai adoption", "data infrastructure", "regulatory", "cloud maturity",
  ];
  for (const phrase of conceptPhrases) {
    if (norm.includes(phrase)) {
      const k = `concept:${phrase}`;
      if (!found.has(k)) found.set(k, { kind: "concept", name: phrase, normalizedKey: phrase });
    }
  }

  void STOP_TOKENS; // referenced to avoid lint warning
  return Array.from(found.values());
}

// ── Write path (PostgreSQL + Neo4j mirror) ────────────────────────────────────

export async function upsertEntity(e: ExtractedEntity, metadata: Record<string, unknown> = {}): Promise<number> {
  // Always write to PostgreSQL first (source of truth for pgId)
  const existing = await db.select().from(memoryEntitiesTable)
    .where(and(eq(memoryEntitiesTable.kind, e.kind), eq(memoryEntitiesTable.normalizedKey, e.normalizedKey)))
    .limit(1);

  let pgId: number;
  if (existing.length > 0) {
    await db.update(memoryEntitiesTable)
      .set({
        mentionCount: existing[0].mentionCount + 1,
        lastSeenAt: new Date(),
        metadata: { ...(existing[0].metadata as Record<string, unknown> || {}), ...metadata },
      })
      .where(eq(memoryEntitiesTable.id, existing[0].id));
    pgId = existing[0].id;
  } else {
    const [row] = await db.insert(memoryEntitiesTable).values({
      kind: e.kind,
      name: e.name,
      normalizedKey: e.normalizedKey,
      industryId: e.industryId ?? null,
      capabilityId: e.capabilityId ?? null,
      metadata,
    }).returning();
    pgId = row.id;
  }

  // Mirror to Neo4j (fire-and-forget — failure doesn't block the write)
  const driver = await getNeo4jDriver();
  if (driver) {
    const session = driver.session();
    try {
      await session.run(
        `MERGE (e:Entity { normalizedKey: $normalizedKey, kind: $kind })
         SET e.name = $name,
             e.pgId = $pgId,
             e.industryId = $industryId,
             e.capabilityId = $capabilityId,
             e.updatedAt = timestamp()`,
        {
          normalizedKey: e.normalizedKey,
          kind: e.kind,
          name: e.name,
          pgId,
          industryId: e.industryId ?? null,
          capabilityId: e.capabilityId ?? null,
        },
      );
    } catch (err) {
      logger.warn({ err }, "[graph-memory] Neo4j upsertEntity failed — PostgreSQL write succeeded");
    } finally {
      await session.close();
    }
  }

  return pgId;
}

export interface RelationEvidence {
  runId?: number;
  memoryId?: string;
  note: string;
}

export async function recordRelation(
  fromEntityId: number,
  toEntityId: number,
  kind: RelationKind,
  weight: number,
  evidence: RelationEvidence,
): Promise<void> {
  if (fromEntityId === toEntityId) return;

  // Always write to PostgreSQL first
  const existing = await db.select().from(memoryRelationsTable)
    .where(and(
      eq(memoryRelationsTable.fromEntityId, fromEntityId),
      eq(memoryRelationsTable.toEntityId, toEntityId),
      eq(memoryRelationsTable.relationKind, kind),
    )).limit(1);

  const evWithTime = { ...evidence, observedAt: new Date().toISOString() };
  let newWeight: number;
  let newObservedCount: number;

  if (existing.length > 0) {
    const prev = existing[0];
    const evList = (prev.evidence as Array<{ runId?: number; memoryId?: string; note: string; observedAt: string }>) || [];
    evList.push(evWithTime);
    newWeight = Math.min(1.0, (prev.weight * prev.observedCount + weight) / (prev.observedCount + 1));
    newObservedCount = prev.observedCount + 1;
    await db.update(memoryRelationsTable)
      .set({
        observedCount: newObservedCount,
        weight: newWeight,
        evidence: evList.slice(-20),
        lastObservedAt: new Date(),
      })
      .where(eq(memoryRelationsTable.id, prev.id));
  } else {
    newWeight = weight;
    newObservedCount = 1;
    await db.insert(memoryRelationsTable).values({
      fromEntityId,
      toEntityId,
      relationKind: kind,
      weight,
      evidence: [evWithTime],
      observedCount: 1,
    });
  }

  // Mirror to Neo4j (fire-and-forget)
  const driver = await getNeo4jDriver();
  if (driver) {
    const session = driver.session();
    try {
      await session.run(
        `MATCH (from:Entity { pgId: $fromId }), (to:Entity { pgId: $toId })
         MERGE (from)-[r:${kind.toUpperCase()}]->(to)
         SET r.weight = $weight,
             r.observedCount = $observedCount,
             r.updatedAt = timestamp()`,
        { fromId: fromEntityId, toId: toEntityId, weight: newWeight, observedCount: newObservedCount },
      );
    } catch (err) {
      logger.warn({ err }, "[graph-memory] Neo4j recordRelation failed — PostgreSQL write succeeded");
    } finally {
      await session.close();
    }
  }
}

// ── Read path (Neo4j primary, PostgreSQL fallback) ────────────────────────────

export async function findRelated(entityId: number, hops: number = 1): Promise<Array<{
  entity: typeof memoryEntitiesTable.$inferSelect;
  relation: string;
  weight: number;
  observedCount: number;
  hop: number;
}>> {
  // ── Neo4j primary path ─────────────────────────────────────────────────────
  const driver = await getNeo4jDriver();
  if (driver) {
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH path = (start:Entity { pgId: $entityId })-[r*1..${hops}]->(related:Entity)
         WITH related, r[0] AS rel, path,
              r[0].weight AS weight, r[0].observedCount AS observedCount,
              related.pgId AS pgId, type(r[0]) AS relation
         RETURN pgId, relation, weight, observedCount,
                length(path) AS hop
         ORDER BY weight DESC
         LIMIT 50`,
        { entityId },
      );

      const pgIds = result.records.map(r => toNum(r.get("pgId")));
      if (pgIds.length === 0) return [];

      const entities = await db.select().from(memoryEntitiesTable)
        .where(sql`${memoryEntitiesTable.id} = ANY(${pgIds})`);
      const entityMap = new Map(entities.map(e => [e.id, e]));

      return result.records.map(r => ({
        entity: entityMap.get(toNum(r.get("pgId")))!,
        relation: (r.get("relation") as string).toLowerCase(),
        weight: toNum(r.get("weight")),
        observedCount: toNum(r.get("observedCount")),
        hop: toNum(r.get("hop")),
      })).filter(r => r.entity);
    } catch (err) {
      logger.warn({ err }, "[graph-memory] Neo4j findRelated failed — falling back to PostgreSQL");
    } finally {
      await session.close();
    }
  }

  // ── PostgreSQL fallback ────────────────────────────────────────────────────
  const visited = new Set<number>([entityId]);
  const frontier: Array<{ id: number; hop: number }> = [{ id: entityId, hop: 0 }];
  const results: Array<{ entity: typeof memoryEntitiesTable.$inferSelect; relation: string; weight: number; observedCount: number; hop: number }> = [];

  while (frontier.length > 0) {
    const { id, hop } = frontier.shift()!;
    if (hop >= hops) continue;

    const outRels = await db.select().from(memoryRelationsTable)
      .where(eq(memoryRelationsTable.fromEntityId, id))
      .orderBy(desc(memoryRelationsTable.weight));

    for (const rel of outRels) {
      if (visited.has(rel.toEntityId)) continue;
      visited.add(rel.toEntityId);
      const [target] = await db.select().from(memoryEntitiesTable).where(eq(memoryEntitiesTable.id, rel.toEntityId)).limit(1);
      if (target) {
        results.push({ entity: target, relation: rel.relationKind, weight: rel.weight, observedCount: rel.observedCount, hop: hop + 1 });
        if (hop + 1 < hops) frontier.push({ id: target.id, hop: hop + 1 });
      }
    }
  }
  return results;
}

export async function findCorrelations(industryId: number, capabilityId: number, minObserved: number = 2): Promise<Array<{
  fromName: string;
  toName: string;
  kind: string;
  weight: number;
  observedCount: number;
}>> {
  // ── Neo4j primary path ─────────────────────────────────────────────────────
  const driver = await getNeo4jDriver();
  if (driver) {
    const session = driver.session();
    try {
      const result = await session.run(
        `MATCH (from:Entity)-[r]->(to:Entity)
         WHERE (from.industryId = $industryId OR to.industryId = $industryId
                OR from.capabilityId = $capabilityId OR to.capabilityId = $capabilityId)
           AND r.observedCount >= $minObserved
         RETURN from.name AS fromName, to.name AS toName,
                type(r) AS kind, r.weight AS weight, r.observedCount AS observedCount
         ORDER BY r.weight DESC, r.observedCount DESC
         LIMIT 25`,
        { industryId, capabilityId, minObserved },
      );
      return result.records.map(r => ({
        fromName: r.get("fromName") as string,
        toName: r.get("toName") as string,
        kind: (r.get("kind") as string).toLowerCase(),
        weight: toNum(r.get("weight")),
        observedCount: toNum(r.get("observedCount")),
      }));
    } catch (err) {
      logger.warn({ err }, "[graph-memory] Neo4j findCorrelations failed — falling back to PostgreSQL");
    } finally {
      await session.close();
    }
  }

  // ── PostgreSQL fallback ────────────────────────────────────────────────────
  const rows = await db.execute<{
    from_name: string;
    to_name: string;
    relation_kind: string;
    weight: number;
    observed_count: number;
  }>(sql`
    SELECT fe.name AS from_name, te.name AS to_name, mr.relation_kind, mr.weight, mr.observed_count
    FROM ${memoryRelationsTable} mr
    JOIN ${memoryEntitiesTable} fe ON fe.id = mr.from_entity_id
    JOIN ${memoryEntitiesTable} te ON te.id = mr.to_entity_id
    WHERE (fe.industry_id = ${industryId} OR te.industry_id = ${industryId}
           OR fe.capability_id = ${capabilityId} OR te.capability_id = ${capabilityId})
      AND mr.observed_count >= ${minObserved}
    ORDER BY mr.weight DESC, mr.observed_count DESC
    LIMIT 25
  `);
  const list = (rows as unknown as { rows?: Array<{ from_name: string; to_name: string; relation_kind: string; weight: number; observed_count: number }> }).rows
    ?? (rows as unknown as Array<{ from_name: string; to_name: string; relation_kind: string; weight: number; observed_count: number }>);
  return (list || []).map(r => ({
    fromName: r.from_name,
    toName: r.to_name,
    kind: r.relation_kind,
    weight: Number(r.weight),
    observedCount: Number(r.observed_count),
  }));
}

export async function getGraphStats(): Promise<{
  entityCount: number;
  relationCount: number;
  neo4jConnected: boolean;
  topRelations: Array<{ from: string; to: string; kind: string; weight: number; observedCount: number }>;
}> {
  const neo4jConnected = (await getNeo4jDriver()) !== null;

  // ── Neo4j primary path ─────────────────────────────────────────────────────
  const driver = await getNeo4jDriver();
  if (driver) {
    const session = driver.session();
    try {
      const countResult = await session.run(
        `MATCH (e:Entity) WITH count(e) AS ec
         MATCH ()-[r]->() RETURN ec, count(r) AS rc`,
      );
      const topResult = await session.run(
        `MATCH (from:Entity)-[r]->(to:Entity)
         RETURN from.name AS fromName, to.name AS toName,
                type(r) AS kind, r.weight AS weight, r.observedCount AS observedCount
         ORDER BY r.observedCount DESC, r.weight DESC
         LIMIT 10`,
      );
      const rec = countResult.records[0];
      return {
        entityCount: rec ? toNum(rec.get("ec")) : 0,
        relationCount: rec ? toNum(rec.get("rc")) : 0,
        neo4jConnected,
        topRelations: topResult.records.map(r => ({
          from: r.get("fromName") as string,
          to: r.get("toName") as string,
          kind: (r.get("kind") as string).toLowerCase(),
          weight: toNum(r.get("weight")),
          observedCount: toNum(r.get("observedCount")),
        })),
      };
    } catch (err) {
      logger.warn({ err }, "[graph-memory] Neo4j getGraphStats failed — falling back to PostgreSQL");
    } finally {
      await session.close();
    }
  }

  // ── PostgreSQL fallback ────────────────────────────────────────────────────
  const [{ count: ec }] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(memoryEntitiesTable);
  const [{ count: rc }] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(memoryRelationsTable);
  const top = await db.execute<{ from_name: string; to_name: string; relation_kind: string; weight: number; observed_count: number }>(sql`
    SELECT fe.name AS from_name, te.name AS to_name, mr.relation_kind, mr.weight, mr.observed_count
    FROM ${memoryRelationsTable} mr
    JOIN ${memoryEntitiesTable} fe ON fe.id = mr.from_entity_id
    JOIN ${memoryEntitiesTable} te ON te.id = mr.to_entity_id
    ORDER BY mr.observed_count DESC, mr.weight DESC
    LIMIT 10
  `);
  const list = (top as unknown as { rows?: Array<{ from_name: string; to_name: string; relation_kind: string; weight: number; observed_count: number }> }).rows
    ?? (top as unknown as Array<{ from_name: string; to_name: string; relation_kind: string; weight: number; observed_count: number }>);
  return {
    entityCount: Number(ec),
    relationCount: Number(rc),
    neo4jConnected: false,
    topRelations: (list || []).map(r => ({
      from: r.from_name,
      to: r.to_name,
      kind: r.relation_kind,
      weight: Number(r.weight),
      observedCount: Number(r.observed_count),
    })),
  };
}
