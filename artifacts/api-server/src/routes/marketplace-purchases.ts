import { Router, type IRouter } from "express";
import { db, marketplaceListingsTable, marketplaceSellersTable, marketplacePurchasesTable } from "@workspace/db";
import { and, desc, eq, or, inArray, sql } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { createMarketplaceCheckoutSession, isStripeConfigured } from "../services/stripe";
import { watermarkPdf } from "../services/marketplace-watermark";
import { getUserClerkOrgIds } from "../services/org-access";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Platform fee: 15% of the listing price. If you want to make this configurable
// per listing or per seller later, store it on the listing row.
const PLATFORM_FEE_PCT = 15;

function feeFor(priceCents: number): { platformFeeCents: number; sellerNetCents: number } {
  const platformFeeCents = Math.floor(priceCents * (PLATFORM_FEE_PCT / 100));
  return { platformFeeCents, sellerNetCents: priceCents - platformFeeCents };
}

/**
 * Start a Stripe Checkout session for a listing. Returns the hosted URL.
 *
 * Tenancy: when the request body includes `clerkOrgId`, the purchase is
 * recorded against that org (every member of the Clerk org will see it in
 * the marketplace workspace and can download the file). The caller must be
 * a member of the target Clerk org; we verify before committing.
 *
 * When omitted, the purchase stays personal — only the buyer sees it.
 */
router.post("/marketplace/listings/:id/checkout", async (req, res) => {
  if (!isStripeConfigured()) { res.status(503).json({ error: "Stripe not configured" }); return; }
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in to purchase" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }

  // Optional team-attribution: { clerkOrgId: "org_..." }
  const requestedOrgIdRaw = (req.body as { clerkOrgId?: unknown })?.clerkOrgId;
  let buyerClerkOrgId: string | null = null;
  if (typeof requestedOrgIdRaw === "string" && requestedOrgIdRaw.length > 0) {
    if (!requestedOrgIdRaw.startsWith("org_")) {
      res.status(400).json({ error: "clerkOrgId must start with org_" });
      return;
    }
    const myOrgIds = await getUserClerkOrgIds(req);
    if (!myOrgIds.includes(requestedOrgIdRaw)) {
      res.status(403).json({ error: "You are not a member of that Clerk organization" });
      return;
    }
    buyerClerkOrgId = requestedOrgIdRaw;
  }

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
    buyerClerkOrgId,
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
      purchaseId: purchase!.id,
      buyerClerkUserId: auth.userId,
      buyerClerkOrgId,
    });
    await db.update(marketplacePurchasesTable).set({
      stripeCheckoutSessionId: session.id,
    }).where(eq(marketplacePurchasesTable.id, purchase!.id));
    res.json({ checkoutUrl: session.url, purchaseId: purchase!.id, scope: buyerClerkOrgId ? "team" : "personal" });
  } catch (err) {
    logger.error({ err, listingId: row.listing.id }, "[marketplace] checkout failed");
    await db.update(marketplacePurchasesTable).set({ status: "failed" }).where(eq(marketplacePurchasesTable.id, purchase!.id));
    res.status(500).json({ error: "Checkout failed", message: (err as Error).message });
  }
});

/**
 * Get a single purchase by id — including listing details — for the current
 * user (or a Clerk org they belong to). Used by the /marketplace/thanks page
 * after a successful Stripe Checkout redirect.
 */
router.get("/marketplace/purchases/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const purchaseId = Number(req.params.id);
  if (!Number.isFinite(purchaseId)) { res.status(400).json({ error: "bad id" }); return; }
  const myOrgIds = await getUserClerkOrgIds(req);
  const [row] = await db
    .select({
      purchase: marketplacePurchasesTable,
      listing: marketplaceListingsTable,
    })
    .from(marketplacePurchasesTable)
    .leftJoin(marketplaceListingsTable, eq(marketplacePurchasesTable.listingId, marketplaceListingsTable.id))
    .where(and(
      eq(marketplacePurchasesTable.id, purchaseId),
      or(
        eq(marketplacePurchasesTable.buyerUserId, auth.userId),
        myOrgIds.length > 0 ? inArray(marketplacePurchasesTable.buyerClerkOrgId, myOrgIds) : sql`FALSE`,
      ),
    ));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

/**
 * The buyer's purchase library. Returns personal purchases AND purchases made
 * under any Clerk org the caller belongs to — so a team member who joins
 * after a purchase still gets access to the file.
 */
router.get("/marketplace/my-purchases", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const myOrgIds = await getUserClerkOrgIds(req);
  const rows = await db
    .select({
      purchase: marketplacePurchasesTable,
      listing: marketplaceListingsTable,
    })
    .from(marketplacePurchasesTable)
    .leftJoin(marketplaceListingsTable, eq(marketplacePurchasesTable.listingId, marketplaceListingsTable.id))
    .where(or(
      eq(marketplacePurchasesTable.buyerUserId, auth.userId),
      myOrgIds.length > 0 ? inArray(marketplacePurchasesTable.buyerClerkOrgId, myOrgIds) : sql`FALSE`,
    ))
    .orderBy(desc(marketplacePurchasesTable.createdAt));
  res.json({ purchases: rows });
});

/**
 * Download the purchased PDF with the buyer's identity watermarked on every
 * page. Entitlement: must be paid, not refunded, and either (a) owned by the
 * caller, or (b) attributed to a Clerk org the caller is a member of.
 *
 * Watermark always carries the *downloading* user's email so a team-shared
 * file leaked by member A doesn't appear to have been leaked by member B.
 */
router.get("/marketplace/purchases/:id/download", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const purchaseId = Number(req.params.id);
  if (!Number.isFinite(purchaseId)) { res.status(400).json({ error: "bad id" }); return; }
  const myOrgIds = await getUserClerkOrgIds(req);

  const [row] = await db
    .select({ purchase: marketplacePurchasesTable, listing: marketplaceListingsTable })
    .from(marketplacePurchasesTable)
    .leftJoin(marketplaceListingsTable, eq(marketplacePurchasesTable.listingId, marketplaceListingsTable.id))
    .where(and(
      eq(marketplacePurchasesTable.id, purchaseId),
      or(
        eq(marketplacePurchasesTable.buyerUserId, auth.userId),
        myOrgIds.length > 0 ? inArray(marketplacePurchasesTable.buyerClerkOrgId, myOrgIds) : sql`FALSE`,
      ),
    ));

  if (!row?.purchase) { res.status(404).json({ error: "Not found" }); return; }
  if (row.purchase.status !== "paid") { res.status(402).json({ error: "Purchase is not paid", status: row.purchase.status }); return; }
  if (row.purchase.refundedAt) { res.status(410).json({ error: "Purchase was refunded" }); return; }
  if (!row.listing?.fileKey) { res.status(404).json({ error: "Report file missing" }); return; }

  // Watermark with the downloading user's identity, not the original buyer's,
  // so cross-member leak attribution stays accurate in team purchases.
  const downloaderEmail = (req.headers["x-user-email"] as string | undefined)
    ?? row.purchase.buyerEmail
    ?? auth.userId;

  try {
    const stamped = await watermarkPdf(row.listing.fileKey, {
      buyerEmail: downloaderEmail,
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
