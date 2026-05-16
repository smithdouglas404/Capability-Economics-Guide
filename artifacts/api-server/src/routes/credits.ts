import { Router } from "express";
import { db } from "@workspace/db";
import {
  creditAccountsTable,
  creditTransactionsTable,
  creditPurchasesTable,
  creditPacksTable,
  userMembershipsTable,
  membershipTiersTable,
  TIER_ALLOCATIONS,
  CVI_CREDIT_BLOCK_SIZE,
  CVI_CREDIT_BLOCK_PRICE_CENTS,
  CREDIT_COSTS,
} from "@workspace/db";
import { eq, and, desc, asc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { createCheckoutSession, isStripeConfigured } from "../services/stripe";

/** Default credit expiry (days) for payg purchases — 1 year, locked by product decision in Task #8. */
const PAYG_EXPIRY_DAYS = 365;

const router = Router();

// Get credit balance and account info
router.get("/credits/balance", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;

    if (!userId) {
      res.json({
        balance: 0,
        monthlyAllocation: 50,
        tierSlug: "discovery",
        creditCosts: CREDIT_COSTS,
        blockSize: CVI_CREDIT_BLOCK_SIZE,
        blockPriceCents: CVI_CREDIT_BLOCK_PRICE_CENTS,
        canPurchase: false,
      });
      return;
    }

    let [account] = await db.select().from(creditAccountsTable).where(eq(creditAccountsTable.userId, userId));

    if (!account) {
      const [membership] = await db.select({ tierSlug: membershipTiersTable.slug })
        .from(userMembershipsTable)
        .innerJoin(membershipTiersTable, eq(userMembershipsTable.tierId, membershipTiersTable.id))
        .where(and(eq(userMembershipsTable.userId, userId), eq(userMembershipsTable.status, "active")))
        .limit(1);

      const tierSlug = membership?.tierSlug ?? "discovery";
      const allocation = TIER_ALLOCATIONS[tierSlug];
      if (allocation === undefined) { res.status(500).json({ error: `Unknown tier: ${tierSlug}` }); return; }

      [account] = await db.insert(creditAccountsTable).values({
        userId,
        balance: allocation,
        monthlyAllocation: allocation,
        tierSlug,
      }).returning();

      await db.insert(creditTransactionsTable).values({
        userId,
        amount: allocation,
        type: "allocation",
        description: "Initial credit allocation",
        balanceAfter: allocation,
      });
    }

    res.json({
      balance: account.balance,
      monthlyAllocation: account.monthlyAllocation,
      tierSlug: account.tierSlug,
      lastTopUpAt: account.lastTopUpAt,
      creditCosts: CREDIT_COSTS,
      blockSize: CVI_CREDIT_BLOCK_SIZE,
      blockPriceCents: CVI_CREDIT_BLOCK_PRICE_CENTS,
      // Every authenticated tier can purchase — including discovery and payg.
      // The previous discovery-block was a credits-tied gate, not a security
      // gate, and prevented the whole payg use case. Anonymous/unauth users
      // are blocked earlier at the auth layer.
      canPurchase: true,
      lowBalance: account.balance <= 10,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get credit transaction history
router.get("/credits/transactions", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) { res.json([]); return; }

    const limit = Math.min(100, Number(req.query.limit) || 50);
    const offset = Number(req.query.offset) || 0;

    const rows = await db.select().from(creditTransactionsTable)
      .where(eq(creditTransactionsTable.userId, userId))
      .orderBy(desc(creditTransactionsTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// List active credit packs (Starter / Growth / Pro / Power) sorted by display order.
// Public — no auth required so the /pricing page can render packs server-side.
router.get("/credits/packs", async (_req, res) => {
  try {
    const packs = await db.select().from(creditPacksTable)
      .where(eq(creditPacksTable.active, true))
      .orderBy(asc(creditPacksTable.displayOrder));
    res.json(packs);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Purchase credits via Stripe checkout. Two input modes:
//   { packSlug: "starter" }  — preferred, references credit_packs row
//   { blocks: N }             — legacy block-based (N × 1,000 credits at $2.50/k)
// Any authenticated tier may purchase, including discovery and payg —
// the previous "paid-tier only" restriction was a credits-tied gate, not a
// security gate, and blocked the entire payg use case.
router.post("/credits/purchase", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    let credits: number;
    let amountCents: number;
    let packSlug: string | null = null;
    let packDisplayName = "CVI Credits";
    let expiresAt: Date | null = null;

    if (typeof req.body.packSlug === "string") {
      const [pack] = await db.select().from(creditPacksTable)
        .where(and(eq(creditPacksTable.slug, req.body.packSlug), eq(creditPacksTable.active, true)))
        .limit(1);
      if (!pack) {
        res.status(404).json({ error: `Credit pack '${req.body.packSlug}' not found or inactive` });
        return;
      }
      credits = pack.creditAmount;
      amountCents = pack.priceCents;
      packSlug = pack.slug;
      packDisplayName = pack.displayName;
      const expiryDays = pack.expiresAfterDays ?? PAYG_EXPIRY_DAYS;
      expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    } else {
      const blocks = Math.max(1, Math.min(100, Number(req.body.blocks) || 1));
      credits = blocks * CVI_CREDIT_BLOCK_SIZE;
      amountCents = blocks * CVI_CREDIT_BLOCK_PRICE_CENTS;
      // Legacy block-based purchases also get the 1-year expiry now —
      // applying the same policy across both paths simplifies enforcement.
      expiresAt = new Date(Date.now() + PAYG_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    }

    // Initialize a credit_accounts row for first-time purchasers so the
    // post-checkout balance update finds something to write to. Defaults
    // to tierSlug from active membership, or "discovery" (free), or "payg"
    // if no other tier applies. Self-corrects on next /credits/balance call.
    let [account] = await db.select().from(creditAccountsTable).where(eq(creditAccountsTable.userId, userId));
    if (!account) {
      const [membership] = await db.select({ tierSlug: membershipTiersTable.slug })
        .from(userMembershipsTable)
        .innerJoin(membershipTiersTable, eq(userMembershipsTable.tierId, membershipTiersTable.id))
        .where(and(eq(userMembershipsTable.userId, userId), eq(userMembershipsTable.status, "active")))
        .limit(1);
      const tierSlug = membership?.tierSlug ?? "payg";
      const allocation = TIER_ALLOCATIONS[tierSlug] ?? 0;
      [account] = await db.insert(creditAccountsTable).values({
        userId,
        balance: allocation,
        monthlyAllocation: allocation,
        tierSlug,
      }).returning();
    }

    // Create purchase record as pending
    const [purchase] = await db.insert(creditPurchasesTable).values({
      userId,
      creditsBought: credits,
      amountCents,
      status: "pending",
      packSlug,
      expiresAt,
    }).returning();

    // If Stripe is configured, create a checkout session
    if (isStripeConfigured()) {
      const origin = `${req.protocol}://${req.get("host")}`;
      const successUrl = `${origin}/membership?credits=success&purchase=${purchase.id}`;
      const cancelUrl = `${origin}/membership?credits=cancelled&purchase=${purchase.id}`;

      // Get user email from membership record
      const [membership] = await db.select({ email: userMembershipsTable.userEmail })
        .from(userMembershipsTable)
        .where(eq(userMembershipsTable.userId, userId))
        .limit(1);

      const session = await createCheckoutSession({
        membershipId: purchase.id, // reusing the field for purchase ID
        tierName: packSlug ? `${packDisplayName} (${credits.toLocaleString()} credits)` : `${credits.toLocaleString()} CVI Credits`,
        tierSlug: "credits",
        amountCents,
        billingPeriod: "monthly",
        customerEmail: membership?.email ?? undefined,
        successUrl,
        cancelUrl,
      });

      res.json({
        purchaseId: purchase.id,
        creditsBought: credits,
        amountCents,
        checkoutUrl: session.url,
        sessionId: session.id,
      });
    } else {
      // Dev mode: auto-complete without Stripe. Account is guaranteed to
      // exist because we initialize it earlier in this handler.
      await db.update(creditPurchasesTable).set({ status: "completed" }).where(eq(creditPurchasesTable.id, purchase.id));

      const newBalance = account.balance + credits;
      await db.update(creditAccountsTable).set({ balance: newBalance }).where(eq(creditAccountsTable.userId, userId));

      await db.insert(creditTransactionsTable).values({
        userId,
        amount: credits,
        type: "purchase",
        description: `Purchased ${credits.toLocaleString()} credits — ${packDisplayName}${expiresAt ? ` (expires ${expiresAt.toISOString().slice(0, 10)})` : ""} [dev mode]`,
        balanceAfter: newBalance,
      });

      res.json({ purchaseId: purchase.id, creditsBought: credits, amountCents, newBalance, expiresAt });
    }
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Monthly allocation top-up (called by cron or admin)
router.post("/credits/allocate", async (req, res) => {
  try {
    const accounts = await db.select().from(creditAccountsTable);
    let topped = 0;

    for (const account of accounts) {
      const lastTopUp = new Date(account.lastTopUpAt);
      const daysSince = (Date.now() - lastTopUp.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 28) continue;

      const allocation = TIER_ALLOCATIONS[account.tierSlug];
      if (allocation === undefined) continue; // skip unknown tiers
      const newBalance = account.balance + allocation;

      await db.update(creditAccountsTable).set({
        balance: newBalance,
        lastTopUpAt: new Date(),
      }).where(eq(creditAccountsTable.userId, account.userId));

      await db.insert(creditTransactionsTable).values({
        userId: account.userId,
        amount: allocation,
        type: "allocation",
        description: `Monthly ${account.tierSlug} allocation (${allocation.toLocaleString()} credits)`,
        balanceAfter: newBalance,
      });

      topped++;
    }

    res.json({ processed: accounts.length, topped });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
