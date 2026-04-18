import { Router } from "express";
import { db } from "@workspace/db";
import {
  creditAccountsTable,
  creditTransactionsTable,
  creditPurchasesTable,
  userMembershipsTable,
  membershipTiersTable,
  TIER_ALLOCATIONS,
  CEI_CREDIT_BLOCK_SIZE,
  CEI_CREDIT_BLOCK_PRICE_CENTS,
  CREDIT_COSTS,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { getAuth } from "@clerk/express";

const router = Router();

// Get credit balance and account info
router.get("/credits/balance", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;

    if (!userId) {
      // Return anonymous defaults
      res.json({
        balance: 0,
        monthlyAllocation: 50,
        tierSlug: "discovery",
        creditCosts: CREDIT_COSTS,
        blockSize: CEI_CREDIT_BLOCK_SIZE,
        blockPriceCents: CEI_CREDIT_BLOCK_PRICE_CENTS,
      });
      return;
    }

    let [account] = await db.select().from(creditAccountsTable).where(eq(creditAccountsTable.userId, userId));

    if (!account) {
      // Determine tier from membership
      const [membership] = await db.select({ tierSlug: membershipTiersTable.slug })
        .from(userMembershipsTable)
        .innerJoin(membershipTiersTable, eq(userMembershipsTable.tierId, membershipTiersTable.id))
        .where(and(eq(userMembershipsTable.userId, userId), eq(userMembershipsTable.status, "active")))
        .limit(1);

      const tierSlug = membership?.tierSlug ?? "discovery";
      const allocation = TIER_ALLOCATIONS[tierSlug] ?? 50;

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
      blockSize: CEI_CREDIT_BLOCK_SIZE,
      blockPriceCents: CEI_CREDIT_BLOCK_PRICE_CENTS,
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

// Purchase credit block
router.post("/credits/purchase", async (req, res) => {
  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const blocks = Math.max(1, Math.min(100, Number(req.body.blocks) || 1));
    const credits = blocks * CEI_CREDIT_BLOCK_SIZE;
    const amountCents = blocks * CEI_CREDIT_BLOCK_PRICE_CENTS;

    // Check tier allows purchase (Discovery cannot)
    const [account] = await db.select().from(creditAccountsTable).where(eq(creditAccountsTable.userId, userId));
    if (account?.tierSlug === "discovery") {
      res.status(403).json({ error: "Credit purchases require a paid tier. Please upgrade from Discovery." });
      return;
    }

    // Record purchase
    const [purchase] = await db.insert(creditPurchasesTable).values({
      userId,
      creditsBought: credits,
      amountCents,
      status: "completed", // In production, this would be "pending" until Stripe confirms
    }).returning();

    // Credit the account
    const currentBalance = account?.balance ?? 0;
    const newBalance = currentBalance + credits;

    if (account) {
      await db.update(creditAccountsTable).set({ balance: newBalance }).where(eq(creditAccountsTable.userId, userId));
    } else {
      await db.insert(creditAccountsTable).values({
        userId,
        balance: newBalance,
        monthlyAllocation: TIER_ALLOCATIONS["briefing"],
        tierSlug: "briefing",
      });
    }

    await db.insert(creditTransactionsTable).values({
      userId,
      amount: credits,
      type: "purchase",
      description: `Purchased ${credits.toLocaleString()} credits (${blocks} block${blocks > 1 ? "s" : ""})`,
      balanceAfter: newBalance,
    });

    res.json({
      purchaseId: purchase.id,
      creditsBought: credits,
      amountCents,
      newBalance,
    });
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

      // Only top up if at least 28 days since last allocation
      if (daysSince < 28) continue;

      const allocation = TIER_ALLOCATIONS[account.tierSlug] ?? 50;
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
