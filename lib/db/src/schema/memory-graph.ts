import { pgTable, serial, text, timestamp, jsonb, integer, real, index, uniqueIndex } from "drizzle-orm/pg-core";

export const memoryEntitiesTable = pgTable("memory_entities", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  normalizedKey: text("normalized_key").notNull(),
  industryId: integer("industry_id"),
  capabilityId: integer("capability_id"),
  mentionCount: integer("mention_count").notNull().default(1),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
}, (t) => ({
  uniqKey: uniqueIndex("memory_entities_kind_key_uniq").on(t.kind, t.normalizedKey),
  byIndustry: index("memory_entities_industry_idx").on(t.industryId),
  byCapability: index("memory_entities_capability_idx").on(t.capabilityId),
}));

export const memoryRelationsTable = pgTable("memory_relations", {
  id: serial("id").primaryKey(),
  fromEntityId: integer("from_entity_id").notNull(),
  toEntityId: integer("to_entity_id").notNull(),
  relationKind: text("relation_kind").notNull(),
  weight: real("weight").notNull().default(1.0),
  evidence: jsonb("evidence").$type<Array<{ runId?: number; memoryId?: string; note: string; observedAt: string }>>().default([]),
  observedCount: integer("observed_count").notNull().default(1),
  firstObservedAt: timestamp("first_observed_at").defaultNow().notNull(),
  lastObservedAt: timestamp("last_observed_at").defaultNow().notNull(),
}, (t) => ({
  uniqRel: uniqueIndex("memory_relations_triple_uniq").on(t.fromEntityId, t.toEntityId, t.relationKind),
  byFrom: index("memory_relations_from_idx").on(t.fromEntityId),
  byTo: index("memory_relations_to_idx").on(t.toEntityId),
}));

/**
 * Daily snapshot of every memory_relations row's weight + observedCount.
 *
 * Feeds `services/agent/temporal-shift-detector.ts` so it can compute REAL
 * 30-day momentum by looking up the snapshot closest to (now - 30d), instead
 * of linearly extrapolating from a fictional 0.1 baseline. A row is appended
 * per (relationId, calendar day) by the daily cron in scheduler.ts; the
 * unique constraint guarantees idempotency if the writer fires twice.
 */
export const memoryRelationSnapshotsTable = pgTable("memory_relation_snapshots", {
  id: serial("id").primaryKey(),
  relationId: integer("relation_id").notNull(),
  weight: real("weight").notNull(),
  observedCount: integer("observed_count").notNull(),
  snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
}, (t) => ({
  byRelation: index("memory_relation_snapshots_relation_idx").on(t.relationId),
  bySnapshotAt: index("memory_relation_snapshots_snapshot_at_idx").on(t.snapshotAt),
  // One snapshot per relation per calendar day; the writer trims to date-only.
  uniqDay: uniqueIndex("memory_relation_snapshots_relation_day_uniq").on(t.relationId, t.snapshotAt),
}));

export const consolidationRunsTable = pgTable("consolidation_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  observationsScanned: integer("observations_scanned").notNull().default(0),
  patternsConsolidated: integer("patterns_consolidated").notNull().default(0),
  redundantDeleted: integer("redundant_deleted").notNull().default(0),
  archivalInserted: integer("archival_inserted").notNull().default(0),
  errorMessage: text("error_message"),
});
