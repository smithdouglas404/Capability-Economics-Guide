import { pgTable, text, serial, integer, timestamp, real, jsonb, boolean, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { industriesTable } from "./industries";

export const capabilitiesTable = pgTable("capabilities", {
  id: serial("id").primaryKey(),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  traditionalView: text("traditional_view").notNull(),
  economicView: text("economic_view").notNull(),
  benchmarkScore: real("benchmark_score").notNull().default(50),
  sourceIds: jsonb("source_ids").$type<number[]>(),
  reviewStatus: text("review_status").notNull().default("approved"),
  reviewNotes: jsonb("review_notes").$type<Array<{ role: "reviewer" | "system"; comment: string; ts: string }>>().default([]),
  revisionCount: integer("revision_count").notNull().default(0),
  submittedBy: text("submitted_by").default("seed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  enrichmentStatus: text("enrichment_status").notNull().default("pending"),
  enrichmentStage: text("enrichment_stage"),
  enrichmentError: text("enrichment_error"),
  enrichmentUpdatedAt: timestamp("enrichment_updated_at"),
  parentCapabilityId: integer("parent_capability_id").references((): AnyPgColumn => capabilitiesTable.id, { onDelete: "cascade" }),
  isLeaf: boolean("is_leaf").notNull().default(true),
  valueChainStage: text("value_chain_stage"),
  patentCount: integer("patent_count").notNull().default(0),
  vcCapitalUsd: real("vc_capital_usd").notNull().default(0),
  startupCount: integer("startup_count").notNull().default(0),
  externalSignalsUpdatedAt: timestamp("external_signals_updated_at"),
});

export const capabilityMetricsTable = pgTable("capability_metrics", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  unit: text("unit").notNull().default("score"),
  benchmarkValue: real("benchmark_value"),
});

export const capabilityDependenciesTable = pgTable("capability_dependencies", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  dependsOnId: integer("depends_on_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  strength: text("strength").notNull().default("moderate"),
});

export const insertCapabilitySchema = createInsertSchema(capabilitiesTable).omit({ id: true, createdAt: true });
export type InsertCapability = z.infer<typeof insertCapabilitySchema>;
export type Capability = typeof capabilitiesTable.$inferSelect;

export const insertCapabilityMetricSchema = createInsertSchema(capabilityMetricsTable).omit({ id: true });
export type InsertCapabilityMetric = z.infer<typeof insertCapabilityMetricSchema>;
export type CapabilityMetric = typeof capabilityMetricsTable.$inferSelect;
