import { pgTable, text, serial, integer, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const membershipTiersTable = pgTable("membership_tiers", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull(),
  description: text("description").notNull(),
  monthlyPriceCents: integer("monthly_price_cents"),
  annualPriceCents: integer("annual_price_cents"),
  isContactSales: boolean("is_contact_sales").notNull().default(false),
  priceLocked: boolean("price_locked").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(0),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  ctaLabel: text("cta_label").notNull().default("Get started"),
  highlight: boolean("highlight").notNull().default(false),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertMembershipTierSchema = createInsertSchema(membershipTiersTable).omit({ id: true, updatedAt: true });
export type InsertMembershipTier = z.infer<typeof insertMembershipTierSchema>;
export type MembershipTier = typeof membershipTiersTable.$inferSelect;

export const userMembershipsTable = pgTable("user_memberships", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  userEmail: text("user_email"),
  userName: text("user_name"),
  tierId: integer("tier_id").notNull().references(() => membershipTiersTable.id, { onDelete: "restrict" }),
  entityType: text("entity_type").notNull(),
  entityName: text("entity_name").notNull(),
  entityIndustry: text("entity_industry"),
  entitySize: text("entity_size"),
  entityRole: text("entity_role"),
  paymentMethod: text("payment_method").notNull(),
  paymentStatus: text("payment_status").notNull().default("pending"),
  paymentRef: text("payment_ref"),
  paymentAmountCents: integer("payment_amount_cents"),
  status: text("status").notNull().default("pending"),
  notes: text("notes"),
  rejectionReason: text("rejection_reason"),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  approvedAt: timestamp("approved_at"),
  approvedBy: text("approved_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserMembershipSchema = createInsertSchema(userMembershipsTable).omit({
  id: true, requestedAt: true, approvedAt: true, approvedBy: true, updatedAt: true, status: true, paymentStatus: true, rejectionReason: true,
});
export type InsertUserMembership = z.infer<typeof insertUserMembershipSchema>;
export type UserMembership = typeof userMembershipsTable.$inferSelect;

// ── CEI Credits System ──

export const creditAccountsTable = pgTable("credit_accounts", {
  userId: text("user_id").primaryKey(),
  balance: integer("balance").notNull().default(0),
  monthlyAllocation: integer("monthly_allocation").notNull().default(50),
  tierSlug: text("tier_slug").notNull().default("discovery"),
  lastTopUpAt: timestamp("last_top_up_at").defaultNow().notNull(),
});

export const creditTransactionsTable = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  amount: integer("amount").notNull(), // positive = credit, negative = debit
  type: text("type").notNull(), // "allocation" | "purchase" | "debit" | "refund"
  description: text("description").notNull(),
  operationEndpoint: text("operation_endpoint"),
  balanceAfter: integer("balance_after").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const creditPurchasesTable = pgTable("credit_purchases", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  creditsBought: integer("credits_bought").notNull(),
  amountCents: integer("amount_cents").notNull(),
  paymentRef: text("payment_ref"),
  status: text("status").notNull().default("pending"), // "pending" | "completed" | "failed"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CreditAccount = typeof creditAccountsTable.$inferSelect;
export type CreditTransaction = typeof creditTransactionsTable.$inferSelect;
export type CreditPurchase = typeof creditPurchasesTable.$inferSelect;

// Credit constants
export const CREDIT_COSTS = {
  ASSESSMENT: 8,
  RESEARCH_QUERY: 2,
  TRIANGULATION: 6,
  BENCHMARK_DISCOVERY: 4,
  VCE_CYCLE: 50,
  INVESTMENT_THESIS: 4,
  NL_QUERY: 0,
  ENRICHMENT_FULL: 10,
  CSUITE_PERSPECTIVES: 25,
  TRADE_SIGNAL: 0,
} as const;

export const TIER_ALLOCATIONS: Record<string, number> = {
  discovery: 50,
  briefing: 500,
  workbench: 5000,
  platform: 50000,
};

export const CEI_CREDIT_BLOCK_SIZE = 1000;
export const CEI_CREDIT_BLOCK_PRICE_CENTS = 250; // $2.50 per 1,000 credits
