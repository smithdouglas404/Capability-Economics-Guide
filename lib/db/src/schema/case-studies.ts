import { pgTable, serial, text, integer, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
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
  // Admin can pin one case study to be the homepage "featured example". When no
  // row is featured, the homepage falls back to the most-recently generated study.
  isFeatured: boolean("is_featured").notNull().default(false),
  // Structured finance decomposition used by the homepage analogy card.
  // Optional — only populated for case studies that have been research-backed
  // with an economics breakdown. When null, the analogy card falls back to a
  // less-detailed presentation. Replaces the formerly hardcoded "WireDrop
  // $1.2B Series B" prose in home.tsx (commit 145ed9a's PLAN.md item #4).
  economicsBreakdown: jsonb("economics_breakdown").$type<{
    companyName: string;
    eventTitle: string; // e.g. "Series B funding", "Q3 transformation program"
    costBreakdown: Array<{ label: string; amountUsdMm: number }>;
    valueGeneratedUsdMm: number;
    unlockedUsdMm: number;
    sources: Array<{ url: string; title: string }>;
  }>(),
});

export type CaseStudy = typeof caseStudiesTable.$inferSelect;
export type NewCaseStudy = typeof caseStudiesTable.$inferInsert;
