import { pgTable, serial, integer, text, varchar, real, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { industriesTable } from "./industries";

export const vceAssessmentsTable = pgTable("vce_assessments", {
  id: serial("id").primaryKey(),
  clientName: text("client_name").notNull(),
  industryId: integer("industry_id").references(() => industriesTable.id, { onDelete: "set null" }),
  valueCase: text("value_case").notNull(),
  valueCaseSource: varchar("value_case_source", { length: 20 }).notNull().default("typed"),
  status: varchar("status", { length: 20 }).notNull().default("intake"),
  executiveSummary: text("executive_summary"),
  finalReport: jsonb("final_report").$type<{
    summary: string;
    capabilityGaps: { name: string; gap: string; impact: string }[];
    recommendations: { title: string; rationale: string; impact: string; horizon: string }[];
    quadrantInsights: { hot: string[]; emerging: string[]; cooling: string[]; tableStakes: string[] };
    risks: string[];
    nextSteps: string[];
  }>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const vceQuestionsTable = pgTable("vce_questions", {
  id: serial("id").primaryKey(),
  assessmentId: integer("assessment_id").notNull().references(() => vceAssessmentsTable.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  rationale: text("rationale"),
  answer: text("answer"),
  displayOrder: integer("display_order").notNull().default(0),
  askedAt: timestamp("asked_at").defaultNow().notNull(),
  answeredAt: timestamp("answered_at"),
});

export const vceResearchItemsTable = pgTable("vce_research_items", {
  id: serial("id").primaryKey(),
  assessmentId: integer("assessment_id").notNull().references(() => vceAssessmentsTable.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 30 }).notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  body: text("body").notNull(),
  sources: jsonb("sources").$type<{ url: string; title: string }[]>().default([]),
  confidenceScore: real("confidence_score").notNull().default(0.7),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  reviewerNotes: text("reviewer_notes"),
  includeInReport: boolean("include_in_report").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
});
