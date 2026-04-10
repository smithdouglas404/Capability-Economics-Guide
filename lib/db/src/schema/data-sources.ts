import { pgTable, serial, text, varchar, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const dataSourcesTable = pgTable("data_sources", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url"),
  publisher: text("publisher"),
  publishedDate: varchar("published_date", { length: 50 }),
  accessedDate: timestamp("accessed_date").defaultNow(),
  sourceType: varchar("source_type", { length: 50 }).notNull().default("report"),
  description: text("description"),
}, (table) => [
  uniqueIndex("data_sources_url_idx").on(table.url),
]);
