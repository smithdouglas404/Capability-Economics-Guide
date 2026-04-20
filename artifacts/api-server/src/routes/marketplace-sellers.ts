import { Router, type IRouter } from "express";
import { db, marketplaceSellersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { isStripeConfigured, createConnectAccount, createAccountOnboardingLink, createExpressDashboardLink, retrieveConnectAccount } from "../services/stripe";
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
