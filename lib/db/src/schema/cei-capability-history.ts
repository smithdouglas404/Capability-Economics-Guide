import { pgTable, serial, integer, real, timestamp, text, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Per-capability CEI history. The existing cei_components table is single-row
 * per (capability, industry) and gets UPDATED in place — no history. The
 * existing cei_snapshots table holds industry-level rollups only.
 *
 * This table appends a row per (capability, industry, snapshot_at) so the
 * frontend sparkline can plot capability-specific trends, not just industry
 * indices. Live snapshots are written by the scheduler hook in
 * cei-engine.ts; reconstructed snapshots come from a per-cap version of
 * the historical replay (see services/cei-historical/replay-per-cap.ts —
 * future).
 *
 * methodologyVersion mirrors the discriminator on cei_snapshots:
 *   - "1.0" / "1.1" — live banked from the engine
 *   - "reconstructed-1.0" — replayed from source_triangulations history
 */
export const ceiCapabilityHistoryTable = pgTable(
  "cei_capability_history",
  {
    id: serial("id").primaryKey(),
    capabilityId: integer("capability_id").notNull(),
    industryId: integer("industry_id").notNull(),
    consensusScore: real("consensus_score").notNull(),
    confidence: real("confidence").notNull(),
    velocity: real("velocity").notNull().default(0),
    posteriorVariance: real("posterior_variance"),
    methodologyVersion: text("methodology_version").notNull().default("1.0"),
    snapshotAt: timestamp("snapshot_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("cei_cap_history_cap_ind_at_unique").on(table.capabilityId, table.industryId, table.snapshotAt),
    index("cei_cap_history_cap_idx").on(table.capabilityId),
    index("cei_cap_history_snapshot_at_idx").on(table.snapshotAt),
  ],
);

export type CeiCapabilityHistory = typeof ceiCapabilityHistoryTable.$inferSelect;
