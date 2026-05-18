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

/**
 * Singleton row (id always 1) that governs auto-rotation of which case
 * study is featured on the homepage. Read by `featuredCaseStudyTick` in
 * `services/featured-case-study-rotation.ts` every 10 minutes.
 *
 * `mode = "manual"`: no rotation; admin promotes via the UI star toggle.
 * `mode = "rotation"`: rotate every `rotationDays`. `rotationSource`
 *   chooses whether to flip an existing case study to featured OR ask
 *   Anthropic to generate a fresh one before featuring it.
 */
export const featuredCaseStudyPolicyTable = pgTable("featured_case_study_policy", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull().default("manual"), // "manual" | "rotation"
  rotationDays: integer("rotation_days"), // 7, 14, 30 — null when mode=manual
  rotationSource: text("rotation_source"), // "existing_rotate" | "anthropic_new"
  industryFilter: text("industry_filter"), // null = all industries; or a single industry slug
  lastRotatedAt: timestamp("last_rotated_at"),
  nextRotationAt: timestamp("next_rotation_at"),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * One-off scheduled feature changes. Each row says "at time T, promote
 * case study X (or generate a new one for industry Y)". The cron tick
 * picks up rows where `scheduled_for <= NOW()` and `status = 'pending'`,
 * applies them, and marks `status = 'executed'` (or 'failed' with
 * `error_message`).
 *
 * Exactly one of `caseStudyId` or `generateForIndustryId` is non-null
 * per row. `generateCompanyName` is an optional hint when generating —
 * if null, the generator picks from the industry's reference orgs.
 */
export const featuredCaseStudyScheduleTable = pgTable("featured_case_study_schedule", {
  id: serial("id").primaryKey(),
  scheduledFor: timestamp("scheduled_for").notNull(),
  caseStudyId: integer("case_study_id").references(() => caseStudiesTable.id, { onDelete: "set null" }),
  generateForIndustryId: integer("generate_for_industry_id").references(() => industriesTable.id, { onDelete: "set null" }),
  generateCompanyName: text("generate_company_name"),
  status: text("status").notNull().default("pending"), // "pending" | "executed" | "failed" | "cancelled"
  executedAt: timestamp("executed_at"),
  resultCaseStudyId: integer("result_case_study_id").references(() => caseStudiesTable.id, { onDelete: "set null" }),
  errorMessage: text("error_message"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type FeaturedCaseStudyPolicy = typeof featuredCaseStudyPolicyTable.$inferSelect;
export type FeaturedCaseStudyScheduleRow = typeof featuredCaseStudyScheduleTable.$inferSelect;
