import { pgTable, text, serial, integer, timestamp, real, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { industriesTable } from "./industries";
import { capabilitiesTable } from "./capabilities";

export const companiesTable = pgTable("companies", {
  id: serial("id").primaryKey(),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  country: text("country"),
  hqCity: text("hq_city"),
  foundedYear: integer("founded_year"),
  employeeCount: integer("employee_count"),
  revenueUsd: real("revenue_usd"),
  fundingUsd: real("funding_usd"),
  publicTicker: text("public_ticker"),
  ownership: text("ownership"),
  websiteUrl: text("website_url"),
  source: text("source").notNull().default("perplexity"),
  sourceUrls: jsonb("source_urls").$type<string[]>().default([]),
  citationsCount: integer("citations_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  uqSlug: uniqueIndex("companies_industry_slug_idx").on(t.industryId, t.slug),
}));

export const companyCapabilityFingerprintTable = pgTable("company_capability_fingerprint", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  weight: real("weight").notNull().default(0.5),
  evidenceUrl: text("evidence_url"),
  evidenceNote: text("evidence_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uqPair: uniqueIndex("company_cap_fp_idx").on(t.companyId, t.capabilityId),
}));

export const companyScoresTable = pgTable("company_scores", {
  companyId: integer("company_id").primaryKey().references(() => companiesTable.id, { onDelete: "cascade" }),
  capabilityCoverage: real("capability_coverage").notNull().default(0),
  ceiWeighted: real("cei_weighted").notNull().default(0),
  agedIndex: real("aged_index").notNull().default(0),
  awarenessScore: real("awareness_score").notNull().default(0),
  moatScore: real("moat_score").notNull().default(0),
  aiDisruptability: real("ai_disruptability").notNull().default(0),
  actionability: real("actionability").notNull().default(0),
  acquisitionProbability: real("acquisition_probability").notNull().default(0),
  forecastedValue: real("forecasted_value").notNull().default(0),
  qualityOfAsset: real("quality_of_asset").notNull().default(0),
  riskProfile: real("risk_profile").notNull().default(0),
  sensitivityProfile: real("sensitivity_profile").notNull().default(0),
  composite: real("composite").notNull().default(0),
  details: jsonb("details").$type<Record<string, unknown>>().default({}),
  lastComputedAt: timestamp("last_computed_at").defaultNow().notNull(),
});

export const insertCompanySchema = createInsertSchema(companiesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;

export const insertCompanyFingerprintSchema = createInsertSchema(companyCapabilityFingerprintTable).omit({ id: true, createdAt: true });
export type InsertCompanyFingerprint = z.infer<typeof insertCompanyFingerprintSchema>;
export type CompanyFingerprint = typeof companyCapabilityFingerprintTable.$inferSelect;

export type CompanyScores = typeof companyScoresTable.$inferSelect;
