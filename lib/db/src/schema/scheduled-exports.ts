import { pgTable, serial, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

/**
 * Scheduled-export subscriptions — distinct from `digest_subscriptions`
 * (which delivers a curated capability-disruption digest) in that the
 * payload is a snapshot of the user's /exports view in their chosen
 * format (markdown or csv). Scope narrows what's included:
 *
 *   - "watchlist"  → only capabilities/regulations the user is watching
 *   - "portfolio"  → only entities in the user's portfolio
 *   - "all"        → unfiltered, mirrors the public /exports datasets
 *
 * The weekly cron walks rows where active = true AND (lastSentAt IS NULL
 * OR lastSentAt < now - 7d) and either drops the rendered export as an
 * attachment-shaped `member_notifications` row (when no SMTP channel is
 * available) or emails it via the existing digest delivery path.
 */
export const scheduledExportsTable = pgTable(
  "scheduled_exports",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    active: boolean("active").notNull().default(true),
    /** "weekly" today; future-proofed for "daily" / "monthly". */
    frequency: text("frequency").notNull().default("weekly"),
    /** "markdown" | "csv" — the format the rendered export is built in. */
    format: text("format").notNull().default("markdown"),
    /** "watchlist" | "portfolio" | "all" — narrows the export content. */
    scope: text("scope").notNull().default("all"),
    lastSentAt: timestamp("last_sent_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("scheduled_exports_user_idx").on(t.userId),
    index("scheduled_exports_active_idx").on(t.active, t.lastSentAt),
  ],
);

export type ScheduledExport = typeof scheduledExportsTable.$inferSelect;
