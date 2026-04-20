import { Router, type IRouter } from "express";
import { db, marketplaceListingsTable, marketplaceSellersTable, marketplacePurchasesTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { createMarketplaceCheckoutSession, isStripeConfigured } from "../services/stripe";
import { watermarkPdf } from "../services/marketplace-watermark";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Platform fee: 15% of the listing price. If you want to make this configurable
// per listing or per seller later, store it on the listing row.
const PLATFORM_FEE_PCT = 15;

function feeFor(priceCents: number): { platformFeeCents: number; sellerNetCents: number } {
  const platformFeeCents = Math.floor(priceCents * (PLATFORM_FEE_PCT / 100));
  return { platformFeeCents, sellerNetCents: priceCents - platformFeeCents };
}

/** Start a Stripe Checkout session for a listing. Returns the hosted URL. */
router.post("/marketplace/listings/:id/checkout", async (req, res) => {
  if (!isStripeConfigured()) { res.status(503).json({ error: "Stripe not configured" }); return; }
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in to purchase" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }

  const [row] = await db
    .select({ listing: marketplaceListingsTable, seller: marketplaceSellersTable })
    .from(marketplaceListingsTable)
    .leftJoin(marketplaceSellersTable, eq(marketplaceListingsTable.sellerId, marketplaceSellersTable.id))
    .where(eq(marketplaceListingsTable.id, id));
  if (!row?.listing || row.listing.status !== "approved") { res.status(404).json({ error: "Listing not available" }); return; }
  if (!row.seller?.stripeAccountId || !row.seller.chargesEnabled) {
    res.status(409).json({ error: "Seller is not ready to accept payments yet" });
    return;
  }

  const buyerEmail = (req.headers["x-user-email"] as string | undefined) ?? null;
  const { platformFeeCents, sellerNetCents } = feeFor(row.listing.priceCents);

  const [purchase] = await db.insert(marketplacePurchasesTable).values({
    listingId: row.listing.id,
    buyerUserId: auth.userId,
    buyerEmail,
    priceCents: row.listing.priceCents,
    platformFeeCents,
    sellerNetCents,
    status: "pending",
  }).returning();

  const origin = (req.headers.origin as string | undefined)
    ?? (req.headers.referer as string | undefined)?.replace(/\/[^/]*$/, "")
    ?? `${req.protocol}://${req.headers.host}`;

  try {
    const session = await createMarketplaceCheckoutSession({
      listingId: row.listing.id,
      listingTitle: row.listing.title,
      buyerEmail: buyerEmail ?? undefined,
      priceCents: row.listing.priceCents,
      platformFeeCents,
      sellerStripeAccountId: row.seller.stripeAccountId,
      successUrl: `${origin.replace(/\/$/, "")}/marketplace/thanks?purchase=${purchase!.id}`,
      cancelUrl: `${origin.replace(/\/$/, "")}/marketplace/listings/${row.listing.id}?cancelled=1`,
    });
    await db.update(marketplacePurchasesTable).set({
      stripeCheckoutSessionId: session.id,
    }).where(eq(marketplacePurchasesTable.id, purchase!.id));
    res.json({ checkoutUrl: session.url, purchaseId: purchase!.id });
  } catch (err) {
    logger.error({ err, listingId: row.listing.id }, "[marketplace] checkout failed");
    await db.update(marketplacePurchasesTable).set({ status: "failed" }).where(eq(marketplacePurchasesTable.id, purchase!.id));
    res.status(500).json({ error: "Checkout failed", message: (err as Error).message });
  }
});

/** The buyer's purchase history (their "Library"). */
router.get("/marketplace/my-purchases", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db
    .select({
      purchase: marketplacePurchasesTable,
      listing: marketplaceListingsTable,
    })
    .from(marketplacePurchasesTable)
    .leftJoin(marketplaceListingsTable, eq(marketplacePurchasesTable.listingId, marketplaceListingsTable.id))
    .where(eq(marketplacePurchasesTable.buyerUserId, auth.userId))
    .orderBy(desc(marketplacePurchasesTable.createdAt));
  res.json({ purchases: rows });
});

/**
 * Download the purchased PDF with the buyer's identity watermarked on every
 * page. Entitlement: must be paid, not refunded, and owned by the caller.
 */
router.get("/marketplace/purchases/:id/download", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const purchaseId = Number(req.params.id);
  if (!Number.isFinite(purchaseId)) { res.status(400).json({ error: "bad id" }); return; }

  const [row] = await db
    .select({ purchase: marketplacePurchasesTable, listing: marketplaceListingsTable })
    .from(marketplacePurchasesTable)
    .leftJoin(marketplaceListingsTable, eq(marketplacePurchasesTable.listingId, marketplaceListingsTable.id))
    .where(and(
      eq(marketplacePurchasesTable.id, purchaseId),
      eq(marketplacePurchasesTable.buyerUserId, auth.userId),
    ));

  if (!row?.purchase) { res.status(404).json({ error: "Not found" }); return; }
  if (row.purchase.status !== "paid") { res.status(402).json({ error: "Purchase is not paid", status: row.purchase.status }); return; }
  if (row.purchase.refundedAt) { res.status(410).json({ error: "Purchase was refunded" }); return; }
  if (!row.listing?.fileKey) { res.status(404).json({ error: "Report file missing" }); return; }

  try {
    const stamped = await watermarkPdf(row.listing.fileKey, {
      buyerEmail: row.purchase.buyerEmail ?? auth.userId,
      purchasedAt: row.purchase.purchasedAt ?? row.purchase.createdAt,
      purchaseId: row.purchase.id,
    });
    await db.update(marketplacePurchasesTable).set({
      downloadCount: (row.purchase.downloadCount ?? 0) + 1,
      lastDownloadedAt: new Date(),
    }).where(eq(marketplacePurchasesTable.id, row.purchase.id));

    const safeTitle = row.listing.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 60) || "report";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}-${row.purchase.id}.pdf"`);
    res.send(stamped);
  } catch (err) {
    logger.error({ err, purchaseId }, "[marketplace] download failed");
    res.status(500).json({ error: "Download failed", message: (err as Error).message });
  }
});

export default router;
