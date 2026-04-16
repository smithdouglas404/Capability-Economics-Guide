import { pgTable, serial, integer, text, varchar, real, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { industriesTable } from "./industries";

// A VCE assessment IS the campaign. Default duration is 7 days, decomposed into N cycles.
export const vceAssessmentsTable = pgTable("vce_assessments", {
  id: serial("id").primaryKey(),
  clientName: text("client_name").notNull(),
  industryId: integer("industry_id").references(() => industriesTable.id, { onDelete: "set null" }),
  valueCase: text("value_case").notNull(),
  valueCaseSource: varchar("value_case_source", { length: 20 }).notNull().default("typed"),
  // status: planning | active | paused | review | finalized | cancelled
  status: varchar("status", { length: 20 }).notNull().default("planning"),
  objective: text("objective"),
  durationDays: integer("duration_days").notNull().default(7),
  totalCycles: integer("total_cycles").notNull().default(7),
  currentCycle: integer("current_cycle").notNull().default(0),
  scheduledStart: timestamp("scheduled_start"),
  scheduledEnd: timestamp("scheduled_end"),
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

// One row per LangGraph invocation (one per "day" by default).
export const vceCyclesTable = pgTable("vce_cycles", {
  id: serial("id").primaryKey(),
  assessmentId: integer("assessment_id").notNull().references(() => vceAssessmentsTable.id, { onDelete: "cascade" }),
  cycleNumber: integer("cycle_number").notNull(),
  // status: scheduled | planning | researching | critiquing | synthesizing | review | completed | failed
  status: varchar("status", { length: 20 }).notNull().default("scheduled"),
  objective: text("objective"),
  summary: text("summary"),
  scheduledFor: timestamp("scheduled_for"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  graphState: jsonb("graph_state").$type<Record<string, unknown>>(),
  itemsCreated: integer("items_created").notNull().default(0),
  questionsCreated: integer("questions_created").notNull().default(0),
  toolCalls: integer("tool_calls").notNull().default(0),
  errors: jsonb("errors").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const vceQuestionsTable = pgTable("vce_questions", {
  id: serial("id").primaryKey(),
  assessmentId: integer("assessment_id").notNull().references(() => vceAssessmentsTable.id, { onDelete: "cascade" }),
  cycleId: integer("cycle_id").references(() => vceCyclesTable.id, { onDelete: "set null" }),
  question: text("question").notNull(),
  rationale: text("rationale"),
  answer: text("answer"),
  // status: pending | approved | answered | skipped | dismissed
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  priority: integer("priority").notNull().default(3),
  generatedFromItemId: integer("generated_from_item_id"),
  displayOrder: integer("display_order").notNull().default(0),
  askedAt: timestamp("asked_at").defaultNow().notNull(),
  answeredAt: timestamp("answered_at"),
});

export const vceResearchItemsTable = pgTable("vce_research_items", {
  id: serial("id").primaryKey(),
  assessmentId: integer("assessment_id").notNull().references(() => vceAssessmentsTable.id, { onDelete: "cascade" }),
  cycleId: integer("cycle_id").references(() => vceCyclesTable.id, { onDelete: "set null" }),
  // kind: capability_gap | opportunity | recommendation | risk | insight | benchmark | evidence_gap | contradiction
  kind: varchar("kind", { length: 30 }).notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  body: text("body").notNull(),
  sources: jsonb("sources").$type<{ url: string; title: string }[]>().default([]),
  evidenceCount: integer("evidence_count").notNull().default(0),
  crossValidated: boolean("cross_validated").notNull().default(false),
  contradictions: jsonb("contradictions").$type<string[]>().default([]),
  confidenceScore: real("confidence_score").notNull().default(0.7),
  // status: pending | approved | rejected | edited
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  reviewerNotes: text("reviewer_notes"),
  includeInReport: boolean("include_in_report").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
});
