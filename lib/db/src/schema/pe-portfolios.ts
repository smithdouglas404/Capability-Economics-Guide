import { pgTable, serial, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { industriesTable } from "./industries";

/**
 * PE-persona "portfolios" — saved lists of N companies a user is tracking.
 * Loose-coupled to companiesTable: companyIds is a jsonb array so a portfolio
 * can outlive any single company row (deletes don't cascade).
 */
export const pePortfoliosTable = pgTable("pe_portfolios", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  industryId: integer("industry_id").references(() => industriesTable.id, { onDelete: "set null" }),
  companyIds: jsonb("company_ids").$type<number[]>().notNull().default([]),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("pe_portfolios_user_idx").on(t.userId),
]);

export type PePortfolio = typeof pePortfoliosTable.$inferSelect;
export type InsertPePortfolio = typeof pePortfoliosTable.$inferInsert;
