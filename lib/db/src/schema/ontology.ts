import { pgTable, serial, integer, text, varchar } from "drizzle-orm/pg-core";
import { capabilitiesTable } from "./capabilities";
import { industriesTable } from "./industries";

export const ontologyRelationshipsTable = pgTable("ontology_relationships", {
  id: serial("id").primaryKey(),
  sourceCapabilityId: integer("source_capability_id").notNull().references(() => capabilitiesTable.id),
  targetCapabilityId: integer("target_capability_id").notNull().references(() => capabilitiesTable.id),
  relationshipType: varchar("relationship_type", { length: 50 }).notNull(),
  strength: varchar("strength", { length: 20 }).notNull().default("moderate"),
  description: text("description"),
  industryContext: text("industry_context"),
});

export const ontologyIndustryAdaptersTable = pgTable("ontology_industry_adapters", {
  id: serial("id").primaryKey(),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id),
  adapterName: text("adapter_name").notNull(),
  adapterDescription: text("adapter_description").notNull(),
  capabilityFocusAreas: text("capability_focus_areas").notNull(),
  maturityModel: text("maturity_model").notNull(),
  keyDifferentiators: text("key_differentiators").notNull(),
});
