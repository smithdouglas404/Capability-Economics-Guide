import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { creditAccountsTable, creditTransactionsTable, TIER_ALLOCATIONS } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getAuth } from "@clerk/express";

/**
 * Middleware factory that deducts CEI credits before allowing an LLM-consuming operation.
 *
 * Usage: `router.post("/analyze", deductCredits(8), handler)`
 *
 * - Returns 402 if insufficient credits
 * - Sets X-Credits-Remaining header on success
 * - Auto-creates credit account if none exists (grants tier default allocation)
 */
export function deductCredits(amount: number) {
  if (amount <= 0) {
    // Free operation — no deduction needed
    return (_req: Request, _res: Response, next: NextFunction) => { next(); };
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Bypass if admin auth bypass is set (local dev)
    if (process.env.ADMIN_AUTH_BYPASS === "1") { next(); return; }

    const auth = getAuth(req);
    const userId = auth?.userId ?? (req as any).userId;

    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Get or create credit account
    let [account] = await db.select().from(creditAccountsTable).where(eq(creditAccountsTable.userId, userId));

    if (!account) {
      const tierSlug: string = (req as any).userTier;
      if (!tierSlug || !(tierSlug in TIER_ALLOCATIONS)) {
        res.status(403).json({ error: "No membership tier found. Sign up first." });
        return;
      }
      const allocation = TIER_ALLOCATIONS[tierSlug];
      [account] = await db.insert(creditAccountsTable).values({
        userId,
        balance: allocation,
        monthlyAllocation: allocation,
        tierSlug,
      }).returning();

      // Log the initial allocation
      await db.insert(creditTransactionsTable).values({
        userId,
        amount: allocation,
        type: "allocation",
        description: "Initial credit allocation",
        balanceAfter: allocation,
      });
    }

    // Check balance
    if (account.balance < amount) {
      const canPurchase = account.tierSlug !== "discovery";
      res.status(402).json({
        error: "Insufficient credits",
        balance: account.balance,
        required: amount,
        tierSlug: account.tierSlug,
        canPurchase,
        message: canPurchase
          ? `This operation costs ${amount} credits. You have ${account.balance}. Purchase more credits to continue.`
          : `This operation costs ${amount} credits. You have ${account.balance}. Upgrade from Discovery to purchase additional credits.`,
      });
      return;
    }

    // Deduct
    const newBalance = account.balance - amount;
    await db.update(creditAccountsTable)
      .set({ balance: newBalance })
      .where(eq(creditAccountsTable.userId, userId));

    // Log transaction
    await db.insert(creditTransactionsTable).values({
      userId,
      amount: -amount,
      type: "debit",
      description: `${req.method} ${req.path}`,
      operationEndpoint: req.originalUrl,
      balanceAfter: newBalance,
    });

    res.setHeader("X-Credits-Remaining", String(newBalance));
    (req as any).creditsDeducted = amount;
    (req as any).creditsRemaining = newBalance;
    next();
  };
}
