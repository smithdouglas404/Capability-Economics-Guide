/**
 * Marketplace reviews — buyer-only ratings & comments on listings.
 *
 * Move 4 / strategic UX overhaul: the catalog already has search,
 * filters, checkout, and download. The thing that makes it feel like
 * a marketplace (and not a static catalog) is buyer voice. This adds:
 *
 *   POST /marketplace/listings/:id/reviews     — create or update
 *   GET  /marketplace/listings/:id/reviews     — public list + summary
 *   DELETE /marketplace/listings/:id/reviews/me — buyer removes own review
 *
 * Authorization: a review row is only writable if the same Clerk user
 * has a `marketplace_purchases` row with `status='paid'` and
 * `refundedAt IS NULL` for this listing. Enforced here at the route
 * layer rather than via SQL CHECK because the paid/refunded transition
 * happens in the Stripe webhook handler and a CHECK would race with it.
 */
import { Router, type IRouter } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, marketplaceListingsTable, marketplacePurchasesTable, marketplaceReviewsTable } from "@workspace/db";
import { eq, and, isNull, desc, sql } from "drizzle-orm";

const router: IRouter = Router();

async function buyerHasPaidPurchase(listingId: number, userId: string): Promise<boolean> {
  const [hit] = await db
    .select({ id: marketplacePurchasesTable.id })
    .from(marketplacePurchasesTable)
    .where(and(
      eq(marketplacePurchasesTable.listingId, listingId),
      eq(marketplacePurchasesTable.buyerUserId, userId),
      eq(marketplacePurchasesTable.status, "paid"),
      isNull(marketplacePurchasesTable.refundedAt),
    ))
    .limit(1);
  return !!hit;
}

async function resolveDisplayName(userId: string): Promise<string> {
  try {
    const user = await clerkClient.users.getUser(userId);
    const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    return full || user.username || user.primaryEmailAddress?.emailAddress || userId;
  } catch {
    return userId;
  }
}

/**
 * GET /marketplace/listings/:id/reviews
 * Public. Returns a list of reviews + an aggregate { avgRating, count, distribution }
 * so the listing card / detail can render stars + histogram without a second call.
 */
router.get("/marketplace/listings/:id/reviews", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }

  const [listing] = await db.select({ id: marketplaceListingsTable.id }).from(marketplaceListingsTable).where(eq(marketplaceListingsTable.id, id)).limit(1);
  if (!listing) { res.status(404).json({ error: "listing not found" }); return; }

  const rows = await db
    .select({
      id: marketplaceReviewsTable.id,
      buyerUserId: marketplaceReviewsTable.buyerUserId,
      buyerDisplayName: marketplaceReviewsTable.buyerDisplayName,
      rating: marketplaceReviewsTable.rating,
      body: marketplaceReviewsTable.body,
      createdAt: marketplaceReviewsTable.createdAt,
      updatedAt: marketplaceReviewsTable.updatedAt,
    })
    .from(marketplaceReviewsTable)
    .where(eq(marketplaceReviewsTable.listingId, id))
    .orderBy(desc(marketplaceReviewsTable.createdAt));

  const total = rows.length;
  const sum = rows.reduce((acc, r) => acc + r.rating, 0);
  const avg = total > 0 ? sum / total : 0;
  // Distribution: how many of each star rating? Useful for the histogram.
  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of rows) {
    if (r.rating >= 1 && r.rating <= 5) distribution[r.rating as 1 | 2 | 3 | 4 | 5] += 1;
  }

  res.json({
    reviews: rows.map(r => ({
      ...r,
      // Hide the raw Clerk user id — it's an opaque key, not useful to render.
      buyerUserId: undefined,
    })),
    summary: {
      count: total,
      avgRating: Number(avg.toFixed(2)),
      distribution,
    },
  });
});

/**
 * POST /marketplace/listings/:id/reviews
 * Body: { rating: 1-5, body?: string }
 * Auth: must be signed in AND have a paid purchase for this listing.
 * Idempotent — re-posting from the same user updates the existing row.
 */
router.post("/marketplace/listings/:id/reviews", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }

  const ratingRaw = req.body?.rating;
  const rating = Number(ratingRaw);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: "rating must be an integer between 1 and 5" });
    return;
  }
  const bodyText = typeof req.body?.body === "string"
    ? req.body.body.slice(0, 4000).trim() || null
    : null;

  // Verify the buyer has a paid purchase for this listing.
  const hasPurchase = await buyerHasPaidPurchase(id, auth.userId);
  if (!hasPurchase) {
    res.status(403).json({ error: "Only buyers who have completed a paid purchase can review this listing." });
    return;
  }

  const displayName = await resolveDisplayName(auth.userId);

  // Idempotent upsert on (listingId, buyerUserId).
  const [row] = await db
    .insert(marketplaceReviewsTable)
    .values({
      listingId: id,
      buyerUserId: auth.userId,
      buyerDisplayName: displayName,
      rating,
      body: bodyText,
    })
    .onConflictDoUpdate({
      target: [marketplaceReviewsTable.listingId, marketplaceReviewsTable.buyerUserId],
      set: {
        rating,
        body: bodyText,
        buyerDisplayName: displayName,
        updatedAt: sql`NOW()`,
      },
    })
    .returning();

  res.json({ review: row });
});

/**
 * DELETE /marketplace/listings/:id/reviews/me
 * Removes the signed-in user's own review of the listing. No 404 if
 * absent — idempotent. Sellers and admins use the moderation paths
 * (route reserved for follow-up); this is the buyer-self path.
 */
router.delete("/marketplace/listings/:id/reviews/me", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }

  await db.delete(marketplaceReviewsTable).where(and(
    eq(marketplaceReviewsTable.listingId, id),
    eq(marketplaceReviewsTable.buyerUserId, auth.userId),
  ));

  res.json({ ok: true });
});

export default router;
