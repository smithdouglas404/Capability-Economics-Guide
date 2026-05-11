/**
 * Multi-tenant marketplace workspace.
 *
 * The marketplace workspace view is org-scoped: every member of a Clerk org
 * sees the same set of purchases (anything bought with buyerClerkOrgId = org)
 * and listings (anything sold under a seller account with clerkOrgId = org).
 *
 * This is a SaaS-only feature — on-prem deployments do not have Clerk org
 * membership and fall back to the per-user `/marketplace/my-purchases` view.
 *
 * Falls back gracefully: when the caller has no clerkOrg (solo user), the
 * workspace shows their personal purchases + their personal seller listings.
 * This keeps the URL a single canonical entry point regardless of tenancy.
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  marketplaceSellersTable,
  marketplaceListingsTable,
  marketplacePurchasesTable,
} from "@workspace/db";
import { and, eq, or, inArray, sql, desc } from "drizzle-orm";
import { requireSession } from "../middlewares/requireSession";
import { getUserClerkOrgIds } from "../services/org-access";

const router: IRouter = Router();
router.use("/marketplace/workspace", requireSession());

router.get("/marketplace/workspace", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const myOrgIds = await getUserClerkOrgIds(req);

  // ── Purchases visible to this workspace ──────────────────────────────────
  // Visible = bought by me directly OR bought under any org I belong to.
  const purchases = await db
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

  // ── Seller records I can access ──────────────────────────────────────────
  // Mine personally + any team-owned seller account in my Clerk orgs.
  const sellers = await db
    .select()
    .from(marketplaceSellersTable)
    .where(or(
      eq(marketplaceSellersTable.userId, auth.userId),
      myOrgIds.length > 0 ? inArray(marketplaceSellersTable.clerkOrgId, myOrgIds) : sql`FALSE`,
    ));
  const sellerIds = sellers.map(s => s.id);

  const listings = sellerIds.length > 0
    ? await db.select().from(marketplaceListingsTable).where(inArray(marketplaceListingsTable.sellerId, sellerIds)).orderBy(desc(marketplaceListingsTable.createdAt))
    : [];

  // Sales rollup (paid purchases against any of our listings).
  const ourListingIds = listings.map(l => l.id);
  const sales = ourListingIds.length > 0
    ? await db
        .select({
          listingId: marketplacePurchasesTable.listingId,
          count: sql<number>`count(*)::int`,
          grossCents: sql<number>`COALESCE(sum(${marketplacePurchasesTable.priceCents}), 0)::int`,
          netCents: sql<number>`COALESCE(sum(${marketplacePurchasesTable.sellerNetCents}), 0)::int`,
        })
        .from(marketplacePurchasesTable)
        .where(and(
          inArray(marketplacePurchasesTable.listingId, ourListingIds),
          eq(marketplacePurchasesTable.status, "paid"),
        ))
        .groupBy(marketplacePurchasesTable.listingId)
    : [];

  // ── Summary stats for the workspace header ───────────────────────────────
  const paidPurchases = purchases.filter(p => p.purchase.status === "paid");
  const totalSpentCents = paidPurchases.reduce((s, p) => s + p.purchase.priceCents, 0);
  const totalSalesCents = sales.reduce((s, x) => s + x.grossCents, 0);
  const totalNetCents = sales.reduce((s, x) => s + x.netCents, 0);
  const totalSalesCount = sales.reduce((s, x) => s + x.count, 0);

  // Tenancy mode the caller is operating in. Affects which CTAs the UI shows.
  const mode = myOrgIds.length > 0 ? "team" as const : "personal" as const;

  res.json({
    mode,
    clerkOrgIds: myOrgIds,
    summary: {
      purchaseCount: purchases.length,
      paidPurchaseCount: paidPurchases.length,
      totalSpentCents,
      listingCount: listings.length,
      approvedListingCount: listings.filter(l => l.status === "approved").length,
      sellerCount: sellers.length,
      salesCount: totalSalesCount,
      grossSalesCents: totalSalesCents,
      netRevenueCents: totalNetCents,
    },
    purchases: purchases.map(p => ({
      id: p.purchase.id,
      status: p.purchase.status,
      priceCents: p.purchase.priceCents,
      buyerUserId: p.purchase.buyerUserId,
      buyerClerkOrgId: p.purchase.buyerClerkOrgId,
      purchasedAt: p.purchase.purchasedAt?.toISOString() ?? null,
      downloadCount: p.purchase.downloadCount,
      listing: p.listing ? {
        id: p.listing.id,
        title: p.listing.title,
        type: p.listing.type,
      } : null,
    })),
    sellers: sellers.map(s => ({
      id: s.id,
      userId: s.userId,
      clerkOrgId: s.clerkOrgId,
      displayName: s.displayName,
      tier: s.tier,
      chargesEnabled: s.chargesEnabled,
      payoutsEnabled: s.payoutsEnabled,
    })),
    listings: listings.map(l => {
      const sale = sales.find(s => s.listingId === l.id);
      return {
        id: l.id,
        title: l.title,
        type: l.type,
        status: l.status,
        priceCents: l.priceCents,
        featured: l.featured,
        salesCount: sale?.count ?? 0,
        grossCents: sale?.grossCents ?? 0,
        netCents: sale?.netCents ?? 0,
        createdAt: l.createdAt.toISOString(),
      };
    }),
  });
});

const ScopeBody = z.object({
  /** Pass null to revert to personal. */
  clerkOrgId: z.string().regex(/^org_/).nullable(),
});

/**
 * Promote the caller's seller record to org-owned, or revert it to personal.
 * Only the original seller user may do this. The caller must currently be a
 * member of the target Clerk org.
 */
router.post("/marketplace/workspace/sellers/me/scope", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = ScopeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const [seller] = await db.select().from(marketplaceSellersTable).where(eq(marketplaceSellersTable.userId, auth.userId));
  if (!seller) { res.status(404).json({ error: "Not a seller" }); return; }
  if (parsed.data.clerkOrgId) {
    const myOrgIds = await getUserClerkOrgIds(req);
    if (!myOrgIds.includes(parsed.data.clerkOrgId)) {
      res.status(403).json({ error: "You are not a member of that Clerk organization" });
      return;
    }
  }
  const [updated] = await db.update(marketplaceSellersTable).set({
    clerkOrgId: parsed.data.clerkOrgId,
    updatedAt: new Date(),
  }).where(eq(marketplaceSellersTable.id, seller.id)).returning();
  res.json({ seller: updated });
});

export default router;
