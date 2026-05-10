import { pgTable, serial, integer, real, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { capabilitiesTable } from "./capabilities";
import { industriesTable } from "./industries";

export const ceiSnapshotsTable = pgTable("cei_snapshots", {
  id: serial("id").primaryKey(),
  overallIndex: real("overall_index").notNull(),
  // 95% credible interval on the overall (GDP-weighted) CEI, derived from
  // posterior-variance propagation across capabilities and industries.
  overallCiLow: real("overall_ci_low"),
  overallCiHigh: real("overall_ci_high"),
  industryBreakdowns: jsonb("industry_breakdowns").$type<Record<string, {
    industryName: string;
    indexValue: number;
    // 95% credible interval on this industry's index, propagated from
    // capability posterior variances. Null when no scored capabilities exist.
    ciLow: number | null;
    ciHigh: number | null;
    weight: number;
    weightSourceUrl: string | null;
    weightSourceYear: number | null;
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
  // Variance of the Bayesian posterior on consensusScore (0-100 scale).
  // ciLow/ciHigh are mean ± 1.96 × √variance, clamped to [0,100].
  posteriorVariance: real("posterior_variance"),
  ciLow: real("ci_low"),
  ciHigh: real("ci_high"),
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

/**
 * Per-industry GDP weight used by the global CEI rollup. Replaces the prior
 * hardcoded INDUSTRY_GDP_WEIGHTS constant. Each row MUST be Perplexity-cited
 * (sourceUrl + sourceYear + sourceCitation jsonb), no editorial fallback.
 *
 * gdpShare is the industry's share of nominal world GDP (0-1) for the
 * referenced source year. Rows without a backing citation are not allowed
 * — the seed script will refuse to insert without `sourceUrl`.
 */
export const industryGdpWeightsTable = pgTable("industry_gdp_weights", {
  id: serial("id").primaryKey(),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id, { onDelete: "cascade" }).unique(),
  gdpShare: real("gdp_share").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceYear: integer("source_year").notNull(),
  sourceCitations: jsonb("source_citations").$type<string[]>().notNull(),
  rationale: text("rationale"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type IndustryGdpWeight = typeof industryGdpWeightsTable.$inferSelect;

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
