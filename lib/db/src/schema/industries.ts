import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const industriesTable = pgTable("industries", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertIndustrySchema = createInsertSchema(industriesTable).omit({ id: true, createdAt: true });
export type InsertIndustry = z.infer<typeof insertIndustrySchema>;
export type Industry = typeof industriesTable.$inferSelect;
