import { pgTable, serial, integer, real, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Persisted history of CEI backtest harness runs. One row per `runBacktest`
 * invocation. Lets the UI render trend lines (Brier / log-loss / directional
 * accuracy over time) so improvements to the engine become continuously
 * visible — the harness stops being a one-shot snapshot and starts being a
 * monitorable KPI.
 *
 * The summary blob is intentionally NOT stored here — full per-event detail
 * lives only in the response of the run that produced it. We persist just
 * enough to draw the trend and detect regressions.
 */
export const backtestRunsTable = pgTable(
  "backtest_runs",
  {
    id: serial("id").primaryKey(),
    ranAt: timestamp("ran_at").defaultNow().notNull(),
    methodologyVersion: text("methodology_version").notNull(),
    eventCount: integer("event_count").notNull(),
    aggregateMatched: integer("aggregate_matched").notNull(),
    aggregateScored: integer("aggregate_scored").notNull(),
    aggregateAccuracy: real("aggregate_accuracy").notNull(),
    /** Mean multiclass Brier across all probabilistic per-cap forecasts. */
    brier: real("brier"),
    /** Mean negative log-likelihood across all probabilistic per-cap forecasts. */
    logLoss: real("log_loss"),
    /** Number of per-cap forecasts contributing to brier / logLoss. */
    probabilisticCount: integer("probabilistic_count").notNull().default(0),
  },
  (table) => [index("backtest_runs_ran_at_idx").on(table.ranAt)],
);

export type BacktestRun = typeof backtestRunsTable.$inferSelect;
