import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, marketplaceSellersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { isStripeConfigured, createConnectAccount, createAccountOnboardingLink, createExpressDashboardLink, retrieveConnectAccount } from "../services/stripe";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAdminAction } from "../services/audit-log";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Fetch (or return null) the current user's seller record. */
router.get("/marketplace/sellers/me", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [seller] = await db.select().from(marketplaceSellersTable).where(eq(marketplaceSellersTable.userId, auth.userId));
  res.json({ seller: seller ?? null });
});

/**
 * Kick off Stripe Connect onboarding. Creates a Connect Express account on
 * first call, then returns a hosted onboarding link. The link is single-use
 * and expires quickly, so we mint a fresh one each time this endpoint is hit.
 */
router.post("/marketplace/sellers/onboard", async (req, res) => {
  if (!isStripeConfigured()) { res.status(503).json({ error: "Stripe not configured" }); return; }
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const userEmail = (req.headers["x-user-email"] as string | undefined) ?? null;
  const userName = (req.headers["x-user-name"] as string | undefined) ?? null;

  const origin = (req.headers.origin as string | undefined)
    ?? (req.headers.referer as string | undefined)?.replace(/\/[^/]*$/, "")
    ?? `${req.protocol}://${req.headers.host}`;

  let [seller] = await db.select().from(marketplaceSellersTable).where(eq(marketplaceSellersTable.userId, auth.userId));

  if (!seller) {
    try {
      const account = await createConnectAccount({ email: userEmail ?? undefined });
      [seller] = await db.insert(marketplaceSellersTable).values({
        userId: auth.userId,
        email: userEmail,
        displayName: userName,
        stripeAccountId: account.id,
      }).returning();
    } catch (err) {
      logger.error({ err }, "[marketplace] failed to create Connect account");
      res.status(500).json({ error: "Failed to create seller account", message: (err as Error).message });
      return;
    }
  }

  try {
    const link = await createAccountOnboardingLink({
      accountId: seller!.stripeAccountId,
      returnUrl: `${origin.replace(/\/$/, "")}/marketplace/sell?onboarded=1`,
      refreshUrl: `${origin.replace(/\/$/, "")}/marketplace/sell?refresh=1`,
    });
    res.json({ url: link.url, seller });
  } catch (err) {
    logger.error({ err }, "[marketplace] failed to create onboarding link");
    res.status(500).json({ error: "Failed to create onboarding link", message: (err as Error).message });
  }
});

/** Open Stripe Express dashboard (payout history, tax forms). */
router.post("/marketplace/sellers/dashboard", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [seller] = await db.select().from(marketplaceSellersTable).where(eq(marketplaceSellersTable.userId, auth.userId));
  if (!seller) { res.status(404).json({ error: "Not a seller" }); return; }
  try {
    const link = await createExpressDashboardLink(seller.stripeAccountId);
    res.json({ url: link.url });
  } catch (err) {
    res.status(500).json({ error: "Failed to create dashboard link", message: (err as Error).message });
  }
});

/**
 * Update the current seller's public profile fields (bio, website, display
 * name). Tier is admin-controlled and intentionally NOT mutable here — see
 * `/admin/marketplace/sellers/:id/tier` for promotion.
 */
const UpdateSellerProfileBody = z.object({
  displayName: z.string().min(1).max(80).optional(),
  bio: z.string().max(2000).optional(),
  websiteUrl: z.string().url().nullable().optional(),
});
router.patch("/marketplace/sellers/me", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = UpdateSellerProfileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [existing] = await db.select().from(marketplaceSellersTable).where(eq(marketplaceSellersTable.userId, auth.userId));
  if (!existing) { res.status(404).json({ error: "Not a seller" }); return; }
  const [updated] = await db.update(marketplaceSellersTable).set({
    ...parsed.data,
    updatedAt: new Date(),
  }).where(eq(marketplaceSellersTable.id, existing.id)).returning();
  res.json({ seller: updated });
});

// ───────────────────── Admin tier management ─────────────────────

/** Admin lists all sellers — used by the moderation UI. */
router.get("/admin/marketplace/sellers", requireAdmin, async (_req, res) => {
  const rows = await db
    .select()
    .from(marketplaceSellersTable)
    .orderBy(desc(marketplaceSellersTable.createdAt));
  res.json({ sellers: rows });
});

const SetTierBody = z.object({
  tier: z.enum(["open", "analyst", "featured"]),
  note: z.string().max(500).optional(),
});

/**
 * Promote (or demote) a seller's tier. "analyst" is for vetted
 * consultants/researchers — they get a badge + lower platform fee. "featured"
 * is the curated showcase tier. Demoting to "open" is reversible — it just
 * removes the badge; existing approved listings are unaffected.
 */
router.post("/admin/marketplace/sellers/:id/tier", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const parsed = SetTierBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const [existing] = await db.select().from(marketplaceSellersTable).where(eq(marketplaceSellersTable.id, id));
  if (!existing) { res.status(404).json({ error: "Seller not found" }); return; }
  const auth = getAuth(req);
  const grantedBy = auth?.userId ?? "shared-admin-key";

  const [updated] = await db.update(marketplaceSellersTable).set({
    tier: parsed.data.tier,
    tierGrantedBy: grantedBy,
    tierGrantedAt: new Date(),
    tierNote: parsed.data.note ?? null,
    updatedAt: new Date(),
  }).where(eq(marketplaceSellersTable.id, id)).returning();

  await logAdminAction(req, {
    action: "tier.update",
    targetType: "marketplace_seller",
    targetId: id,
    details: {
      from: existing.tier,
      to: parsed.data.tier,
      note: parsed.data.note ?? null,
      sellerUserId: existing.userId,
    },
  });

  res.json({ seller: updated });
});

/** Re-sync seller status from Stripe. Useful after finishing onboarding. */
router.post("/marketplace/sellers/refresh", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [seller] = await db.select().from(marketplaceSellersTable).where(eq(marketplaceSellersTable.userId, auth.userId));
  if (!seller) { res.status(404).json({ error: "Not a seller" }); return; }
  try {
    const account = await retrieveConnectAccount(seller.stripeAccountId);
    const [updated] = await db.update(marketplaceSellersTable).set({
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false,
      accountSnapshot: account as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    }).where(eq(marketplaceSellersTable.id, seller.id)).returning();
    res.json({ seller: updated });
  } catch (err) {
    res.status(500).json({ error: "Failed to refresh", message: (err as Error).message });
  }
});

export default router;
