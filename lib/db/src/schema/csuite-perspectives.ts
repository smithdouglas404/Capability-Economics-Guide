import { pgTable, serial, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { cSuiteRolesTable } from "./c-suite-roles";
import { industriesTable } from "./industries";

export const csuitePerspectivesTable = pgTable("csuite_perspectives", {
  id: serial("id").primaryKey(),
  roleId: integer("role_id").notNull().references(() => cSuiteRolesTable.id, { onDelete: "cascade" }),
  industryId: integer("industry_id").references(() => industriesTable.id, { onDelete: "cascade" }),
  scenario: text("scenario").notNull(),
  questions: jsonb("questions").$type<string[]>().notNull(),
  capabilities: jsonb("capabilities").$type<string[]>().notNull(),
  metrics: jsonb("metrics").$type<string[]>().notNull(),
  chartData: jsonb("chart_data").$type<{ subject: string; A: number; fullMark: number }[]>().notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

export type CsuitePerspective = typeof csuitePerspectivesTable.$inferSelect;

export const caseStudyContentTable = pgTable("case_study_content", {
  id: serial("id").primaryKey(),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id, { onDelete: "cascade" }),
  capabilitySlug: text("capability_slug").notNull(),
  capabilityName: text("capability_name").notNull(),
  description: text("description").notNull(),
  traditionalView: text("traditional_view").notNull(),
  economicView: text("economic_view").notNull(),
  metrics: jsonb("metrics").$type<{ name: string; value: string; trend: "up" | "down" | "neutral" }[]>().notNull(),
  roiData: jsonb("roi_data").$type<{ year: string; traditionalCost: number; capabilityCost: number; valueGenerated: number }[]>(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});

export type CaseStudyContent = typeof caseStudyContentTable.$inferSelect;
