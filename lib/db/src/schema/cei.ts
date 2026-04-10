import { pgTable, serial, integer, real, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { capabilitiesTable } from "./capabilities";
import { industriesTable } from "./industries";

export const ceiSnapshotsTable = pgTable("cei_snapshots", {
  id: serial("id").primaryKey(),
  overallIndex: real("overall_index").notNull(),
  industryBreakdowns: jsonb("industry_breakdowns").$type<Record<string, {
    industryName: string;
    indexValue: number;
    weight: number;
    velocity: number;
    capabilityCount: number;
    topMover: string;
    topMoverDelta: number;
  }>>().notNull(),
  marketSentiment: real("market_sentiment"),
  volatility: real("volatility"),
  methodologyVersion: text("methodology_version").notNull().default("1.0"),
  snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
});

export const ceiComponentsTable = pgTable("cei_components", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id),
  consensusScore: real("consensus_score").notNull(),
  confidence: real("confidence").notNull(),
  velocity: real("velocity").notNull().default(0),
  economicMultiplier: real("economic_multiplier").notNull().default(1.0),
  sourceScores: jsonb("source_scores").$type<Array<{
    sourceLabel: string;
    rawScore: number;
    weight: number;
    methodology: string;
    queriedAt: string;
  }>>().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("cei_components_cap_industry_idx").on(table.capabilityId, table.industryId),
]);

export const sourceTriangulationsTable = pgTable("source_triangulations", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id),
  sourceLabel: text("source_label").notNull(),
  rawScore: real("raw_score").notNull(),
  weight: real("weight").notNull().default(1.0),
  methodology: text("methodology").notNull(),
  rationale: text("rationale"),
  citations: jsonb("citations").$type<string[]>(),
  queriedAt: timestamp("queried_at").defaultNow().notNull(),
});
