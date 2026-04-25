import { pgTable, serial, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

export const savedViewsTable = pgTable("saved_views", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  route: text("route").notNull(),
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("saved_views_user_idx").on(table.userId),
  uniqueIndex("saved_views_user_slug_idx").on(table.userId, table.slug),
]);

export type SavedView = typeof savedViewsTable.$inferSelect;
