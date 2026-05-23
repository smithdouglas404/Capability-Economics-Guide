import { pgTable, text, serial, integer, real, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { regulationsTable } from "./innovation";

/**
 * Per-user regulation watch — when a user toggles "watch this regulation",
 * we insert a row. The autonomous CVI agent's notifier walks this table on
 * each cycle and writes a `member_notifications` row when the regulation's
 * effective date has passed AND compliance < 100, OR compliance dropped
 * since the last check.
 *
 * Idempotent on (user_id, regulation_id).
 */
export const regulationWatchesTable = pgTable(
  "regulation_watches",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    regulationId: integer("regulation_id")
      .notNull()
      .references(() => regulationsTable.id, { onDelete: "cascade" }),
    /** Last compliance % we observed on this regulation for this user. Used to detect drops. */
    lastComplianceScore: real("last_compliance_score"),
    /** Last time we wrote a notification for this watch. Throttle: 1 per 24h per watch. */
    lastAlertedAt: timestamp("last_alerted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("regulation_watches_user_reg_idx").on(t.userId, t.regulationId),
    index("regulation_watches_user_idx").on(t.userId),
  ],
);

export type RegulationWatch = typeof regulationWatchesTable.$inferSelect;
