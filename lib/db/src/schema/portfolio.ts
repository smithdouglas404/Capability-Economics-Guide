/**
 * Portfolio companies — a VC/PE buyer's watch list of *companies*
 * (separate from the existing capability-watchlist which tracks
 * individual capability scores with thresholds).
 *
 * Each row links a session/user to a company they want to monitor.
 * Optional alert preferences govern when the digest cron fires for them.
 *
 * Schema:
 *   id            serial PK
 *   session_token text NOT NULL      (the simple session-token auth this
 *                                     codebase uses for anonymous identity)
 *   company_id    int  NOT NULL FK   → companies(id) ON DELETE CASCADE
 *   notes         text               (free-form: thesis, deal context)
 *   alert_fevi_delta       boolean   default true — alert on FEVI change ≥ 5
 *   alert_capability_decay boolean   default true — alert when a tracked
 *                                                   capability score drops
 *                                                   meaningfully (negative
 *                                                   velocity over the
 *                                                   trailing 30 days)
 *   alert_regulation_change boolean  default true — alert when a regulation
 *                                                   touching one of the
 *                                                   company's capabilities
 *                                                   is added or amended
 *   added_at      timestamptz NOT NULL DEFAULT NOW()
 *
 * Unique on (session_token, company_id) so the same company can't be
 * added twice for the same user.
 */

import { pgTable, serial, integer, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export const portfolioCompaniesTable = pgTable("portfolio_companies", {
  id: serial("id").primaryKey(),
  sessionToken: text("session_token").notNull(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  notes: text("notes"),
  alertFeviDelta: boolean("alert_fevi_delta").notNull().default(true),
  alertCapabilityDecay: boolean("alert_capability_decay").notNull().default(true),
  alertRegulationChange: boolean("alert_regulation_change").notNull().default(true),
  addedAt: timestamp("added_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("portfolio_session_company_idx").on(table.sessionToken, table.companyId),
]);

export type PortfolioCompany = typeof portfolioCompaniesTable.$inferSelect;
export type NewPortfolioCompany = typeof portfolioCompaniesTable.$inferInsert;
