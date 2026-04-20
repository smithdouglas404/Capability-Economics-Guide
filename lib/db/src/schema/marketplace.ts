import { pgTable, serial, text, integer, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Authors/sellers in the marketplace. One row per user who has started the
 * Stripe Connect onboarding flow. `stripeAccountId` is the Connect account id
 * (acct_xxx). `chargesEnabled` and `payoutsEnabled` mirror the Stripe account
 * state — updated via account.updated webhook.
 */
export const marketplaceSellersTable = pgTable(
  "marketplace_sellers",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().unique(),
    email: text("email"),
    displayName: text("display_name"),
    stripeAccountId: text("stripe_account_id").notNull().unique(),
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    detailsSubmitted: boolean("details_submitted").notNull().default(false),
    // Latest Stripe account object snapshot for debugging / audit.
    accountSnapshot: jsonb("account_snapshot"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("marketplace_sellers_user_idx").on(table.userId),
  ],
);

/**
 * A sellable digital product. Today only "report" (PDF download). "service"
 * and "template" reserved for future expansion. `fileKey` is the path within
 * the storage backend — today Railway volume, later S3/R2.
 *
 * Status machine: draft → pending_review → approved (listed publicly) | rejected.
 * Authors can edit drafts freely; once submitted they need admin approval.
 * Authors may archive an approved listing (hides from browse, still purchasable
 * by existing buyers downloading prior purchases).
 */
export const marketplaceListingsTable = pgTable(
  "marketplace_listings",
  {
    id: serial("id").primaryKey(),
    sellerId: integer("seller_id").notNull().references(() => marketplaceSellersTable.id, { onDelete: "restrict" }),
    type: text("type").notNull().default("report"), // "report" | "service" | "template"
    title: text("title").notNull(),
    description: text("description").notNull(),
    priceCents: integer("price_cents").notNull(), // full price to buyer; platform fee is taken on top
    coverImageUrl: text("cover_image_url"),
    fileKey: text("file_key"), // storage path to the PDF (set after upload)
    fileSizeBytes: integer("file_size_bytes"),
    fileOriginalName: text("file_original_name"),
    status: text("status").notNull().default("draft"), // "draft" | "pending_review" | "approved" | "rejected" | "archived"
    rejectionReason: text("rejection_reason"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("marketplace_listings_seller_idx").on(table.sellerId),
    index("marketplace_listings_status_idx").on(table.status),
  ],
);

/**
 * A completed (or pending) purchase. Entitlement check on download is
 * `buyerId == current.userId AND status = 'paid' AND refundedAt IS NULL`.
 */
export const marketplacePurchasesTable = pgTable(
  "marketplace_purchases",
  {
    id: serial("id").primaryKey(),
    listingId: integer("listing_id").notNull().references(() => marketplaceListingsTable.id, { onDelete: "restrict" }),
    buyerUserId: text("buyer_user_id").notNull(),
    buyerEmail: text("buyer_email"),
    priceCents: integer("price_cents").notNull(),       // what the buyer paid
    platformFeeCents: integer("platform_fee_cents").notNull(),
    sellerNetCents: integer("seller_net_cents").notNull(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeTransferId: text("stripe_transfer_id"),
    status: text("status").notNull().default("pending"), // "pending" | "paid" | "refunded" | "failed"
    purchasedAt: timestamp("purchased_at"),
    refundedAt: timestamp("refunded_at"),
    downloadCount: integer("download_count").notNull().default(0),
    lastDownloadedAt: timestamp("last_downloaded_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("marketplace_purchases_listing_idx").on(table.listingId),
    index("marketplace_purchases_buyer_idx").on(table.buyerUserId),
    index("marketplace_purchases_status_idx").on(table.status),
  ],
);

export type MarketplaceSeller = typeof marketplaceSellersTable.$inferSelect;
export type MarketplaceListing = typeof marketplaceListingsTable.$inferSelect;
export type MarketplacePurchase = typeof marketplacePurchasesTable.$inferSelect;
