import { pgTable, serial, integer, real, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * Pre-computed peer benchmark percentiles per (industry, capability).
 *
 * Source: organization_capabilities table — every org that has assessed
 * itself contributes one (capability, maturity_score) point per cap they
 * covered. Aggregated nightly by services/peer-benchmarks/aggregator.ts.
 *
 * Suppression rule: cells with N < 5 contributors are not persisted at all
 * (privacy floor + statistical floor). A capability that's only been
 * assessed by 4 orgs in an industry simply has no row; the UI shows
 * "Insufficient peer data yet" when it can't find a row.
 *
 * Bot/synthetic vs real composition: the aggregator computes both counts
 * separately (n_real_orgs vs n_synthetic_orgs) so the methodology link can
 * honestly disclose mixed-source cells. See [[project-bot-population]] and
 * [[feedback-no-hardcoding]] memories.
 *
 * Trigger for re-aggregation: nightly cron + on-demand admin endpoint
 * (POST /admin/peer-benchmarks/refresh). Snapshots are NOT historized here
 * — that's a separate concern; this table holds current state only.
 */
export const peerBenchmarksTable = pgTable(
  "cvi_peer_benchmarks",
  {
    id: serial("id").primaryKey(),
    industryId: integer("industry_id").notNull(),
    capabilityId: integer("capability_id").notNull(),
    nOrgs: integer("n_orgs").notNull(),
    nRealOrgs: integer("n_real_orgs").notNull(),
    nSyntheticOrgs: integer("n_synthetic_orgs").notNull(),
    /** 25th percentile maturity score (0-100). */
    p25: real("p25").notNull(),
    /** 50th percentile (median). */
    p50: real("p50").notNull(),
    /** 75th percentile. */
    p75: real("p75").notNull(),
    /** 90th percentile. */
    p90: real("p90").notNull(),
    /** Min and max for spread context (useful when N is small). */
    minScore: real("min_score").notNull(),
    maxScore: real("max_score").notNull(),
    /** Arithmetic mean — secondary to median but useful for charts. */
    mean: real("mean").notNull(),
    computedAt: timestamp("computed_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("peer_benchmarks_ind_cap_unique").on(table.industryId, table.capabilityId),
    index("peer_benchmarks_cap_idx").on(table.capabilityId),
    index("peer_benchmarks_industry_idx").on(table.industryId),
  ],
);

export type PeerBenchmark = typeof peerBenchmarksTable.$inferSelect;
