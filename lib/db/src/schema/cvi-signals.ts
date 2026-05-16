import { pgTable, serial, integer, real, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * CVI signal events — moments where a capability's CVI moved by >= a
 * threshold within a window. Foundation for the predictive-signal
 * framework. Detected by services/cvi-signals/detector.ts; backtested
 * against forward stock returns once a price-feed integration is wired.
 *
 * One row per (capability, window-end-date, magnitude-direction) detection.
 * Idempotent — re-running the detector for the same window does not insert
 * a duplicate (unique index on (capability_id, detection_window_end)).
 */
export const cviSignalEventsTable = pgTable(
  "cvi_signal_events",
  {
    id: serial("id").primaryKey(),
    capabilityId: integer("capability_id").notNull(),
    industryId: integer("industry_id").notNull(),
    /** Window start: the older snapshot used in the comparison. */
    windowStartAt: timestamp("window_start_at").notNull(),
    /** Window end: the newer snapshot. Detection_window_end for uniqueness. */
    windowEndAt: timestamp("window_end_at").notNull(),
    windowDays: integer("window_days").notNull(),
    /** Magnitude in CVI points (positive = rose, negative = fell). */
    magnitudePoints: real("magnitude_points").notNull(),
    /** "up" | "down" — direction enum on top of magnitude for fast filtering. */
    direction: text("direction").notNull(),
    /** Severity tier: "moderate" (5-10pt), "large" (10-20pt), "extreme" (>20pt). */
    severity: text("severity").notNull(),
    /** Start and end values. */
    startValue: real("start_value").notNull(),
    endValue: real("end_value").notNull(),
    /** Has any forward-return outcome been attributed yet? Flips when the outcome attribution job runs. */
    outcomeAttributed: integer("outcome_attributed").notNull().default(0),
    /** Free-form context from the detector — what other events / data preceded this move. */
    contextNotes: jsonb("context_notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("cvi_signal_events_cap_idx").on(table.capabilityId),
    index("cvi_signal_events_window_end_idx").on(table.windowEndAt),
    index("cvi_signal_events_severity_idx").on(table.severity),
  ],
);

/**
 * Forward-return attribution per signal event. Populated by the outcome
 * job which fetches public-company stock returns over +30/+60/+90/+180 day
 * windows post-event.
 *
 * One row per (signal_event, ticker, window_days). Multiple rows per event
 * because each event may have multiple exposed tickers (derived from
 * capability_filings rows that mention the capability).
 */
export const cviSignalOutcomesTable = pgTable(
  "cvi_signal_outcomes",
  {
    id: serial("id").primaryKey(),
    signalEventId: integer("signal_event_id").notNull().references(() => cviSignalEventsTable.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    cik: text("cik"),
    windowDays: integer("window_days").notNull(), // 30 | 60 | 90 | 180
    /** Cumulative return % over window, vs industry benchmark. */
    cumulativeReturnPct: real("cumulative_return_pct"),
    /** Abnormal return vs industry index over same window. */
    abnormalReturnPct: real("abnormal_return_pct"),
    /** Raw start / end prices for transparency. */
    startPrice: real("start_price"),
    endPrice: real("end_price"),
    /** Source of the price data ("yfinance" | "polygon" | "manual"). */
    priceSource: text("price_source"),
    measuredAt: timestamp("measured_at").defaultNow().notNull(),
  },
  (table) => [
    index("cvi_signal_outcomes_event_idx").on(table.signalEventId),
    index("cvi_signal_outcomes_ticker_idx").on(table.ticker),
  ],
);

export type CviSignalEvent = typeof cviSignalEventsTable.$inferSelect;
export type CviSignalOutcome = typeof cviSignalOutcomesTable.$inferSelect;
