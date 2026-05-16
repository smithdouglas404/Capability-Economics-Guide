import { pgTable, serial, real, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Curated historical events for the CVI backtesting harness.
 *
 * Each row encodes a real-world disruption (COVID, ChatGPT launch, SVB, …)
 * with the analyst's *ground-truth* directional verdict **per affected
 * capability** (not per event). Per-cap expected directions are critical:
 * many real events are net-negative globally but POSITIVE for a specific
 * capability (e.g. COVID for telehealth, the EU AI Act for AI-governance
 * tooling). A naive engine that infers direction from the event's primary
 * sentiment alone will MISS these cases — exposing that gap is the whole
 * point of the harness.
 *
 * `sentimentDirection` is the event's primary classification fed to the live
 * macro-event pipeline. The harness compares the engine's per-cap predicted
 * delta sign against each cap's `expectedDirection` to compute directional
 * accuracy. Since the engine derives the shock sign from `sentimentDirection`
 * (NOT from `expectedDirection`), the two fields can disagree per cap and
 * the test is genuinely diagnostic.
 *
 * Industries and capabilities are referenced by NAME (not FK) so seed data
 * survives capability-table rebuilds.
 */
export const historicalEventsTable = pgTable("historical_events", {
  id: serial("id").primaryKey(),
  eventDate: timestamp("event_date").notNull(),
  title: text("title").notNull(),
  eventType: text("event_type").notNull(),
  severity: real("severity").notNull(),
  // The event's primary direction — what the live macro-event pipeline would
  // tag this as via world-scan. Drives the engine's shock sign.
  sentimentDirection: text("sentiment_direction").notNull(),
  decayDays: real("decay_days").notNull().default(30),
  affectedIndustryNames: jsonb("affected_industry_names").$type<string[]>().notNull().default([]),
  // Per-capability ground-truth verdicts. The harness tests engine-predicted
  // delta sign against each `expectedDirection` independently.
  affectedCapabilities: jsonb("affected_capabilities")
    .$type<Array<{ name: string; expectedDirection: "positive" | "negative" | "neutral"; rationale?: string }>>()
    .notNull()
    .default([]),
  description: text("description").notNull().default(""),
  citations: jsonb("citations").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("historical_events_date_idx").on(table.eventDate),
]);

export type HistoricalEvent = typeof historicalEventsTable.$inferSelect;
export type InsertHistoricalEvent = typeof historicalEventsTable.$inferInsert;
