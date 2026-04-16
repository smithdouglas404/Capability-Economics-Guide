import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { industriesTable } from "./industries";

export const caseStudiesTable = pgTable("case_studies", {
  id: serial("id").primaryKey(),
  industryId: integer("industry_id").notNull().references(() => industriesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  executiveSummary: text("executive_summary").notNull(),
  situation: text("situation").notNull(),
  challenges: jsonb("challenges").$type<string[]>().notNull(),
  recommendations: jsonb("recommendations").$type<{ title: string; rationale: string; impact: string }[]>().notNull(),
  fiveYearOutlook: text("five_year_outlook").notNull(),
  kpis: jsonb("kpis").$type<{ name: string; baseline: string; target: string }[]>().notNull(),
  sources: jsonb("sources").$type<{ url: string; title: string }[]>().notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  model: text("model").notNull(),
});

export type CaseStudy = typeof caseStudiesTable.$inferSelect;
export type NewCaseStudy = typeof caseStudiesTable.$inferInsert;
