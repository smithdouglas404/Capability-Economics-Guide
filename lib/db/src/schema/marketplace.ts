import { pgTable, serial, text, integer, timestamp, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

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
    // Optional Clerk org id. When set, the seller record is org-owned —
    // every member of the Clerk org can see this seller's listings, payouts,
    // and analytics in the marketplace workspace view. SaaS-only feature;
    // on-prem deployments leave this null and treat sellers as per-user.
    clerkOrgId: text("clerk_org_id"),
    email: text("email"),
    displayName: text("display_name"),
    stripeAccountId: text("stripe_account_id").notNull().unique(),
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    detailsSubmitted: boolean("details_submitted").notNull().default(false),
    // Three-tier seller model. "open" anyone can list once Stripe Connect is
    // complete. "analyst" is admin-promoted; vetted consultants/researchers
    // who get a badge + a lower platform fee. "featured" is a curated
    // showcase — also admin-set, gets top placement. tierGrantedBy/At record
    // the admin promotion for audit.
    tier: text("tier").notNull().default("open"), // "open" | "analyst" | "featured"
    tierGrantedBy: text("tier_granted_by"),
    tierGrantedAt: timestamp("tier_granted_at"),
    tierNote: text("tier_note"),
    // Public-facing bio shown on listing pages and (eventually) a seller
    // profile route. Open sellers may write this themselves; analysts/featured
    // can be edited by admins too.
    bio: text("bio"),
    websiteUrl: text("website_url"),
    // Latest Stripe account object snapshot for debugging / audit.
    accountSnapshot: jsonb("account_snapshot"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("marketplace_sellers_user_idx").on(table.userId),
    index("marketplace_sellers_tier_idx").on(table.tier),
    index("marketplace_sellers_org_idx").on(table.clerkOrgId),
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
    type: text("type").notNull().default("report"), // "report" | "dataset" | "template" | "service"
    title: text("title").notNull(),
    description: text("description").notNull(),
    priceCents: integer("price_cents").notNull(), // full price to buyer; platform fee is taken on top
    coverImageUrl: text("cover_image_url"),
    fileKey: text("file_key"), // storage path to the PDF (set after upload)
    fileSizeBytes: integer("file_size_bytes"),
    fileOriginalName: text("file_original_name"),
    // Optional free-preview PDF (first few pages / teaser) downloadable by
    // anyone who visits the listing page — no entitlement, no watermark.
    previewFileKey: text("preview_file_key"),
    previewFileSizeBytes: integer("preview_file_size_bytes"),
    status: text("status").notNull().default("draft"), // "draft" | "pending_review" | "approved" | "rejected" | "archived"
    rejectionReason: text("rejection_reason"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at"),
    // When set, the listing auto-archives at this time. Null = open-ended (still
    // subject to the 30-day-after-approval auto-archive sweep).
    expiresAt: timestamp("expires_at"),
    // Featured placement on /marketplace browse. featuredUntil is the
    // expiration; nightly sweep flips `featured` to false past the cutoff.
    // Independent of seller.tier — an "analyst" seller doesn't get featured
    // automatically; admins promote per-listing.
    featured: boolean("featured").notNull().default(false),
    featuredUntil: timestamp("featured_until"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    /**
     * Latest verdict from the listing-moderation workflow:
     * `{ verdict: "auto_approve" | "send_to_moderator" | "auto_reject",
     *    riskFlags: string[], confidence: number, rationale: string,
     *    decidedAt: string }`. Populated async by the
     * `/marketplace/listings/:id/submit` route via `runListingModeration`.
     * Advisory only — the human moderation queue stays authoritative
     * until we trust auto_approve enough to act on it.
     */
    moderationHints: jsonb("moderation_hints"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("marketplace_listings_seller_idx").on(table.sellerId),
    index("marketplace_listings_status_idx").on(table.status),
    index("marketplace_listings_featured_idx").on(table.featured),
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
    // Optional Clerk org id of the buying team. When set, every member of
    // the Clerk org can see the purchase in the marketplace workspace and
    // download the file (entitlement check on download still requires the
    // download itself to be performed by an org member). Null = personal
    // purchase, only the buyerUserId sees it. SaaS-only feature.
    buyerClerkOrgId: text("buyer_clerk_org_id"),
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
    index("marketplace_purchases_buyer_org_idx").on(table.buyerClerkOrgId),
  ],
);

/**
 * Buyer reviews. One review per (listing, buyer) pair — enforced by a
 * unique index, not a check constraint, so re-purchases (rare) can
 * UPDATE the existing review instead of stacking duplicates.
 *
 * A row is only writable if the same buyerUserId has a corresponding
 * `marketplace_purchases` row with `status='paid' AND refundedAt IS NULL`
 * for this listing. That check is enforced at the route level
 * (services/marketplace-reviews.ts) rather than via SQL because the
 * paid/refunded transition happens in the Stripe webhook handler and
 * a CHECK constraint would race with it.
 *
 * Aggregations (avgRating, reviewCount) are computed on demand in the
 * listing GET handler — small enough that a materialized view isn't
 * worth the operational cost.
 */
export const marketplaceReviewsTable = pgTable(
  "marketplace_reviews",
  {
    id: serial("id").primaryKey(),
    listingId: integer("listing_id").notNull().references(() => marketplaceListingsTable.id, { onDelete: "cascade" }),
    buyerUserId: text("buyer_user_id").notNull(),
    // Display name captured at review time so the listing page doesn't
    // need a Clerk lookup per render. Synced from clerkClient.users.getUser
    // in the create handler; if Clerk lookup fails we fall back to the
    // userId so the review is still saveable.
    buyerDisplayName: text("buyer_display_name"),
    rating: integer("rating").notNull(), // 1–5; validated at the route layer
    body: text("body"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("marketplace_reviews_listing_idx").on(table.listingId),
    index("marketplace_reviews_buyer_idx").on(table.buyerUserId),
    // One review per (listing, buyer); a repeat review-of-the-same-listing
    // is an update, not a new row.
    uniqueIndex("marketplace_reviews_listing_buyer_unique").on(table.listingId, table.buyerUserId),
  ],
);

export type MarketplaceSeller = typeof marketplaceSellersTable.$inferSelect;
export type MarketplaceListing = typeof marketplaceListingsTable.$inferSelect;
export type MarketplacePurchase = typeof marketplacePurchasesTable.$inferSelect;
export type MarketplaceReview = typeof marketplaceReviewsTable.$inferSelect;
