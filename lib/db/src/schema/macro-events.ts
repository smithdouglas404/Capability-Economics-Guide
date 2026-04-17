import { pgTable, serial, integer, real, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const macroEventsTable = pgTable("macro_events", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  severity: real("severity").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  affectedIndustryIds: jsonb("affected_industry_ids").$type<number[]>().notNull().default([]),
  affectedCapabilityIds: jsonb("affected_capability_ids").$type<number[]>().default([]),
  sentimentDirection: text("sentiment_direction").notNull().default("negative"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  decayDays: real("decay_days").notNull().default(14),
  source: text("source").notNull().default("admin"),
  citations: jsonb("citations").$type<string[]>().default([]),
  createdBy: text("created_by").default("admin"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type MacroEvent = typeof macroEventsTable.$inferSelect;
export type InsertMacroEvent = typeof macroEventsTable.$inferInsert;
