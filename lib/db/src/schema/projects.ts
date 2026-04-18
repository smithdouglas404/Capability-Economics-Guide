import { pgTable, text, serial, integer, real, timestamp } from "drizzle-orm/pg-core";
import { capabilitiesTable } from "./capabilities";

export const technologyProjectsTable = pgTable("technology_projects", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  businessCase: text("business_case").notNull(),
  typicalTimeline: text("typical_timeline").notNull(),
  investmentRange: text("investment_range").notNull(),
  complexityLevel: text("complexity_level").notNull(),
  icon: text("icon").notNull().default("Cpu"),
  source: text("source").notNull().default("manual"),
  citations: text("citations").array(),
  researchedAt: timestamp("researched_at", { withTimezone: true }),
});

export const projectCapabilityImpactsTable = pgTable("project_capability_impacts", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => technologyProjectsTable.id, { onDelete: "cascade" }),
  capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
  maturityUplift: real("maturity_uplift").notNull(),
  timeToImpactMonths: integer("time_to_impact_months").notNull(),
  impactDescription: text("impact_description").notNull(),
});

export const projectExecutiveInsightsTable = pgTable("project_executive_insights", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => technologyProjectsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  agendaTitle: text("agenda_title").notNull(),
  agendaDescription: text("agenda_description").notNull(),
  keyMetrics: text("key_metrics").notNull(),
  decisionFramework: text("decision_framework").notNull(),
});

export const projectRisksTable = pgTable("project_risks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => technologyProjectsTable.id, { onDelete: "cascade" }),
  riskCategory: text("risk_category").notNull(),
  severity: text("severity").notNull(),
  description: text("description").notNull(),
  consequence: text("consequence").notNull(),
  mitigationPath: text("mitigation_path").notNull(),
});

export type TechnologyProject = typeof technologyProjectsTable.$inferSelect;
export type ProjectCapabilityImpact = typeof projectCapabilityImpactsTable.$inferSelect;
export type ProjectExecutiveInsight = typeof projectExecutiveInsightsTable.$inferSelect;
export type ProjectRisk = typeof projectRisksTable.$inferSelect;
