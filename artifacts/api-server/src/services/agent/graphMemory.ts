import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  memoryEntitiesTable,
  memoryRelationsTable,
} from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";

export type EntityKind = "industry" | "capability" | "concept" | "metric" | "actor";
export type RelationKind = "depends_on" | "enables" | "competes_with" | "substitutes" | "co_occurs_with" | "correlates_with" | "contradicts";

export interface ExtractedEntity {
  kind: EntityKind;
  name: string;
  normalizedKey: string;
  industryId?: number | null;
  capabilityId?: number | null;
}

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

  return Array.from(found.values());
}

export async function upsertEntity(e: ExtractedEntity, metadata: Record<string, unknown> = {}): Promise<number> {
  const existing = await db.select().from(memoryEntitiesTable)
    .where(and(eq(memoryEntitiesTable.kind, e.kind), eq(memoryEntitiesTable.normalizedKey, e.normalizedKey)))
    .limit(1);
  if (existing.length > 0) {
    await db.update(memoryEntitiesTable)
      .set({
        mentionCount: existing[0].mentionCount + 1,
        lastSeenAt: new Date(),
        metadata: { ...(existing[0].metadata as Record<string, unknown> || {}), ...metadata },
      })
      .where(eq(memoryEntitiesTable.id, existing[0].id));
    return existing[0].id;
  }
  const [row] = await db.insert(memoryEntitiesTable).values({
    kind: e.kind,
    name: e.name,
    normalizedKey: e.normalizedKey,
    industryId: e.industryId ?? null,
    capabilityId: e.capabilityId ?? null,
    metadata,
  }).returning();
  return row.id;
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
  const existing = await db.select().from(memoryRelationsTable)
    .where(and(
      eq(memoryRelationsTable.fromEntityId, fromEntityId),
      eq(memoryRelationsTable.toEntityId, toEntityId),
      eq(memoryRelationsTable.relationKind, kind),
    )).limit(1);

  const evWithTime = { ...evidence, observedAt: new Date().toISOString() };

  if (existing.length > 0) {
    const prev = existing[0];
    const evList = (prev.evidence as Array<{ runId?: number; memoryId?: string; note: string; observedAt: string }>) || [];
    evList.push(evWithTime);
    const newWeight = Math.min(1.0, (prev.weight * prev.observedCount + weight) / (prev.observedCount + 1));
    await db.update(memoryRelationsTable)
      .set({
        observedCount: prev.observedCount + 1,
        weight: newWeight,
        evidence: evList.slice(-20),
        lastObservedAt: new Date(),
      })
      .where(eq(memoryRelationsTable.id, prev.id));
    return;
  }

  await db.insert(memoryRelationsTable).values({
    fromEntityId,
    toEntityId,
    relationKind: kind,
    weight,
    evidence: [evWithTime],
    observedCount: 1,
  });
}

export async function findRelated(entityId: number, hops: number = 1): Promise<Array<{
  entity: typeof memoryEntitiesTable.$inferSelect;
  relation: string;
  weight: number;
  observedCount: number;
  hop: number;
}>> {
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

export async function getGraphStats(): Promise<{ entityCount: number; relationCount: number; topRelations: Array<{ from: string; to: string; kind: string; weight: number; observedCount: number }> }> {
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
    topRelations: (list || []).map(r => ({
      from: r.from_name,
      to: r.to_name,
      kind: r.relation_kind,
      weight: Number(r.weight),
      observedCount: Number(r.observed_count),
    })),
  };
}
