import { pgTable, serial, integer, text, varchar, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { capabilitiesTable } from "./capabilities";
import { industriesTable } from "./industries";

export const capabilityQuadrantsTable = pgTable("capability_quadrants", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id, { onDelete: "cascade" }),
  quadrant: varchar("quadrant", { length: 20 }).notNull(),
  economicImpactScore: real("economic_impact_score").notNull(),
  adoptionMomentumScore: real("adoption_momentum_score").notNull(),
  disruptionIntensity: real("disruption_intensity").notNull(),
  rationale: text("rationale").notNull(),
  perplexitySources: jsonb("perplexity_sources").$type<string[]>(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

export const valueChainStagesTable = pgTable("value_chain_stages", {
  id: serial("id").primaryKey(),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id, { onDelete: "cascade" }),
  stageName: text("stage_name").notNull(),
  stageOrder: integer("stage_order").notNull(),
  numSectors: integer("num_sectors"),
  hhiScore: real("hhi_score"),
  patentCount: integer("patent_count"),
  patentTrendPct: real("patent_trend_pct"),
  startupCount: integer("startup_count"),
  startupTrendPct: real("startup_trend_pct"),
  capitalFlowMm: real("capital_flow_mm"),
  capitalTrendPct: real("capital_trend_pct"),
  disruptionSummary: text("disruption_summary").notNull(),
  keyCapabilities: jsonb("key_capabilities").$type<number[]>(),
  keyCompanies: jsonb("key_companies").$type<string[]>(),
  perplexitySources: jsonb("perplexity_sources").$type<string[]>(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

export const companyCapabilityProfilesTable = pgTable("company_capability_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  country: text("country").notNull(),
  naicsCode: text("naics_code"),
  naicsSector: text("naics_sector"),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id, { onDelete: "cascade" }),
  feviScore: real("fevi_score").notNull(),
  cdiScore: real("cdi_score").notNull(),
  quadrant: varchar("quadrant", { length: 20 }).notNull(),
  fundingStage: text("funding_stage"),
  description: text("description").notNull(),
  perplexitySources: jsonb("perplexity_sources").$type<string[]>(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

export const enrichmentRunsTable = pgTable("enrichment_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  quadrantsClassified: integer("quadrants_classified").default(0).notNull(),
  valueChainStagesCreated: integer("value_chain_stages_created").default(0).notNull(),
  companiesProfiled: integer("companies_profiled").default(0).notNull(),
  companyMappingsCreated: integer("company_mappings_created").default(0).notNull(),
  durationMs: integer("duration_ms"),
  errors: jsonb("errors").$type<string[]>(),
  status: varchar("status", { length: 20 }).default("running").notNull(),
});

export const companyCapabilityMappingsTable = pgTable("company_capability_mappings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companyCapabilityProfilesTable.id, { onDelete: "cascade" }),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  strength: varchar("strength", { length: 20 }).notNull().default("core"),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});
