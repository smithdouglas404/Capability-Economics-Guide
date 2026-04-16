import { pgTable, serial, text, integer, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";

export const educationalContentTable = pgTable("educational_content", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  bodyMarkdown: text("body_markdown").notNull(),
  keyTakeaways: jsonb("key_takeaways").$type<string[]>().notNull(),
  sources: jsonb("sources").$type<{ url: string; title: string }[]>().notNull(),
  category: text("category").notNull(),
  estimatedReadMinutes: integer("estimated_read_minutes").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  published: boolean("published").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type EducationalContent = typeof educationalContentTable.$inferSelect;
export type NewEducationalContent = typeof educationalContentTable.$inferInsert;

export const EDUCATIONAL_CATEGORIES = [
  "concept",
  "methodology",
  "case-study",
  "framework",
  "metric",
] as const;
export type EducationalCategory = (typeof EDUCATIONAL_CATEGORIES)[number];
