import { pgTable, serial, integer, real, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Curated historical events for the CEI backtesting harness.
 *
 * Each row encodes a real-world disruption (COVID, ChatGPT launch, SVB collapse, …)
 * with the analyst's *ground-truth* directional verdict on how the named
 * capabilities actually moved. The replay engine applies the event as a
 * macro-shock against the current CEI baseline and compares the model's
 * predicted direction against `expectedDirection` to compute directional
 * accuracy — the headline "does the model actually work?" number.
 *
 * Industries and capabilities are referenced by NAME (not FK) so seed data
 * survives capability-table rebuilds and can target capability lists that
 * vary between environments.
 */
export const historicalEventsTable = pgTable("historical_events", {
  id: serial("id").primaryKey(),
  eventDate: timestamp("event_date").notNull(),
  title: text("title").notNull(),
  eventType: text("event_type").notNull(),
  severity: real("severity").notNull(),
  // The model's classification of the event direction (drives the predicted shock).
  sentimentDirection: text("sentiment_direction").notNull(),
  // The analyst's ground-truth verdict on how the capability actually moved.
  // Predicted vs. expected is the directional-accuracy comparison.
  expectedDirection: text("expected_direction").notNull(),
  decayDays: real("decay_days").notNull().default(30),
  affectedIndustryNames: jsonb("affected_industry_names").$type<string[]>().notNull().default([]),
  affectedCapabilityNames: jsonb("affected_capability_names").$type<string[]>().notNull().default([]),
  description: text("description").notNull().default(""),
  citations: jsonb("citations").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("historical_events_date_idx").on(table.eventDate),
]);

export type HistoricalEvent = typeof historicalEventsTable.$inferSelect;
export type InsertHistoricalEvent = typeof historicalEventsTable.$inferInsert;
