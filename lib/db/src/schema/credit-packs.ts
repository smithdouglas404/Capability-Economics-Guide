import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Credit pack catalog — the one-time purchase SKUs available to payg and
 * paid-tier users. Seeded by scripts/src/seed-payg-tier.ts with the four
 * default packs (Starter $2.50/1k · Growth $10/4.5k · Pro $25/12k · Power
 * $100/55k). Admin can add new SKUs or disable existing ones without a code
 * change.
 *
 * Stripe linkage: stripePriceId holds the test-mode or live one-time price
 * ID created in Stripe Dashboard. Webhook resolves purchases back to packs
 * by matching the line item's price ID.
 *
 * Per-pack expiry override: when expiresAfterDays is set, that pack's
 * purchases expire after N days instead of the default 365 (payg policy).
 * Lets us run limited-time promo packs without policy churn.
 */
export const creditPacksTable = pgTable("credit_packs", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(), // "starter" | "growth" | "pro" | "power"
  displayName: text("display_name").notNull(),
  description: text("description"),
  priceCents: integer("price_cents").notNull(),
  creditAmount: integer("credit_amount").notNull(),
  /** Stripe price ID — nullable for dev/seed without Stripe configured. */
  stripePriceId: text("stripe_price_id"),
  /** Override expiry (days). Null = use account-default (365d for payg). */
  expiresAfterDays: integer("expires_after_days"),
  displayOrder: integer("display_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  /** Optional highlight (most-popular / best-value) badge for UI. */
  highlight: text("highlight"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type CreditPack = typeof creditPacksTable.$inferSelect;
export type NewCreditPack = typeof creditPacksTable.$inferInsert;
