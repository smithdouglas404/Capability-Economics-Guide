import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const curriculumPacksTable = pgTable("curriculum_packs", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  subtitle: text("subtitle").notNull(),
  industrySlug: text("industry_slug").notNull(),
  level: text("level").notNull(),
  durationWeeks: integer("duration_weeks").notNull(),
  learningObjectives: jsonb("learning_objectives").$type<string[]>().notNull(),
  caseStudyMarkdown: text("case_study_markdown").notNull(),
  assignmentPrompts: jsonb("assignment_prompts").$type<{ title: string; prompt: string; deliverable: string }[]>().notNull(),
  rubricMarkdown: text("rubric_markdown"),
  datasetExportUrls: jsonb("dataset_export_urls").$type<{ label: string; url: string }[]>().notNull(),
  sourceCitations: jsonb("source_citations").$type<{ title: string; url: string }[]>().notNull(),
  publishedAt: timestamp("published_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type CurriculumPack = typeof curriculumPacksTable.$inferSelect;
export type NewCurriculumPack = typeof curriculumPacksTable.$inferInsert;
