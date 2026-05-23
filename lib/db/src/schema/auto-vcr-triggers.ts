import { pgTable, serial, integer, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Auto-VCR trigger ledger — one row per (signalSource, signalKey) firing.
 *
 * The `services/auto-vcr-trigger.ts` evaluator scans three signal sources
 * on a 4-hour cadence:
 *   - capability_drop  — a watched capability (regulation_watches OR
 *                        watchlist_items) saw its CVI consensus score drop
 *                        ≥ 8 points in the trailing 30 days
 *   - regulation_overdue — a watched regulation's effective_date has passed
 *                          AND the user's compliance is < 80%
 *   - portfolio_company_dip — a portfolio company's average capability CVI
 *                             dropped ≥ 5 points in the trailing 30 days
 *
 * Idempotency: re-firing the same (signalSource, signalKey) within 14 days
 * is suppressed. `signalKey` is a stable string composed from the signal
 * source (e.g. "cap:123:user:abc", "reg:42:user:abc", "company:9:user:abc").
 *
 * The created `vcrAssessmentId` references the VCR campaign that was kicked
 * off; `userId` is the inbox recipient who gets the member_notification
 * when the campaign's first cycle completes.
 */
export const autoVcrTriggersTable = pgTable(
  "auto_vcr_triggers",
  {
    id: serial("id").primaryKey(),
    /** Signal source: "capability_drop" | "regulation_overdue" | "portfolio_company_dip" */
    signalSource: text("signal_source").notNull(),
    /** Stable per-signal identifier — see comment above. */
    signalKey: text("signal_key").notNull(),
    /** Recipient of the resulting member_notification. */
    userId: text("user_id").notNull(),
    /** Subject of the trigger (capability_id / regulation_id / company_id). */
    targetId: integer("target_id"),
    /** Human-readable description of why this fired (e.g. "Cloud Ops dropped 12 pts in 30d"). */
    reason: text("reason").notNull(),
    /** The VCR assessment created by this trigger. */
    vcrAssessmentId: integer("vcr_assessment_id").notNull(),
    /** Set when the auto-VCR posts its result back to the user's inbox. */
    notifiedAt: timestamp("notified_at"),
    firedAt: timestamp("fired_at").defaultNow().notNull(),
  },
  (table) => [
    // We dedupe on (source, key) over a 14-day window — composite index keeps the
    // lookup fast. The window check happens in the evaluator, not the DB constraint,
    // because the same signal CAN legitimately re-fire after 14 days have passed.
    index("auto_vcr_triggers_source_key_idx").on(table.signalSource, table.signalKey),
    index("auto_vcr_triggers_user_idx").on(table.userId),
    uniqueIndex("auto_vcr_triggers_assessment_idx").on(table.vcrAssessmentId),
  ],
);

export type AutoVcrTrigger = typeof autoVcrTriggersTable.$inferSelect;
export type NewAutoVcrTrigger = typeof autoVcrTriggersTable.$inferInsert;
