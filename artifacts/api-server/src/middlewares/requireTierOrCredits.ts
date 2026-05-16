import type { Request, Response, NextFunction } from "express";
import { db, creditAccountsTable, creditTransactionsTable, CREDIT_COSTS } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireTier } from "./requireTier";
import { isClerkAdmin } from "./requireAdmin";

type CreditOp = keyof typeof CREDIT_COSTS;

/**
 * Hybrid gate: lets the request through if EITHER
 *   (a) user's effective tier is at or above `minimumTier`  (existing requireTier behavior), OR
 *   (b) user has enough credit balance to cover CREDIT_COSTS[op] — in which case the balance is debited.
 *
 * Powers the pay-as-you-go (payg) tier: a payg user with $25 in credits can call
 * a "briefing"-gated endpoint as long as their balance covers the per-op cost.
 * The debit happens before the route handler runs, so a successful response means
 * "user paid for this with credits"; a 402 means "insufficient balance, upgrade
 * or top up."
 *
 * Operation costs come from CREDIT_COSTS (lib/db/src/schema/membership.ts) so
 * pricing changes flow through without touching middleware. Pass `op: "NL_QUERY"`
 * or `op: "TRADE_SIGNAL"` (both 0-cost) when you want the bypass to be free.
 *
 * Admins always pass without debit.
 */
export function requireTierOrCredits(minimumTier: string, op: CreditOp) {
  const tierGate = requireTier(minimumTier);
  const cost = CREDIT_COSTS[op];

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (process.env.ADMIN_AUTH_BYPASS === "1") { next(); return; }

    const auth = getAuth(req);
    const userId = auth?.userId;
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Admins bypass entirely (no debit).
    if (await isClerkAdmin(userId)) {
      (req as Request & { userTier?: string; userId?: string }).userTier = "platform";
      (req as Request & { userTier?: string; userId?: string }).userId = userId;
      next();
      return;
    }

    // Try the tier gate first by invoking it with a sentinel next that signals
    // "passed". If it sends a response (403 or 401), capture that to know we
    // should attempt the credit fallback.
    let tierPassed = false;
    let tierResponded = false;
    const fakeRes = {
      status: (_code: number) => {
        tierResponded = true;
        return { json: (_body: unknown) => { /* swallow — we'll handle ourselves */ } };
      },
    };
    await tierGate(req, fakeRes as unknown as Response, () => { tierPassed = true; });

    if (tierPassed) {
      next();
      return;
    }

    if (!tierResponded) {
      // Defensive: tierGate didn't pass and didn't respond — fail safe.
      res.status(500).json({ error: "tier gate produced no decision" });
      return;
    }

    // Credit fallback path. Free 0-cost ops (NL_QUERY, TRADE_SIGNAL) always
    // pass; we still attribute by writing a zero-amount transaction for auditability.
    const [account] = await db.select().from(creditAccountsTable).where(eq(creditAccountsTable.userId, userId)).limit(1);
    if (!account) {
      res.status(402).json({
        error: "Payment required",
        message: `This feature requires the ${minimumTier} tier or a credit balance of at least ${cost}. No credit account found — visit /credits to top up.`,
        requiredTier: minimumTier,
        creditCost: cost,
        currentBalance: 0,
      });
      return;
    }

    if (account.balance < cost) {
      res.status(402).json({
        error: "Insufficient credits",
        message: `This operation costs ${cost} credits. Your balance: ${account.balance}. Top up at /credits or upgrade to ${minimumTier}.`,
        requiredTier: minimumTier,
        creditCost: cost,
        currentBalance: account.balance,
      });
      return;
    }

    // Debit. Update balance + log transaction in a transaction so partial
    // failures can't drift the ledger.
    const newBalance = account.balance - cost;
    try {
      await db.transaction(async (tx) => {
        await tx.update(creditAccountsTable).set({ balance: newBalance }).where(eq(creditAccountsTable.userId, userId));
        await tx.insert(creditTransactionsTable).values({
          userId,
          amount: -cost,
          type: "debit",
          description: `${op} (gate fallback: tier=${minimumTier})`,
          operationEndpoint: req.path,
          balanceAfter: newBalance,
        });
      });
    } catch (err) {
      res.status(500).json({ error: "Credit debit failed", detail: err instanceof Error ? err.message : String(err) });
      return;
    }

    (req as Request & { userTier?: string; userId?: string; creditsBilled?: number }).userTier = "payg";
    (req as Request & { userTier?: string; userId?: string; creditsBilled?: number }).userId = userId;
    (req as Request & { userTier?: string; userId?: string; creditsBilled?: number }).creditsBilled = cost;
    res.setHeader("X-Credits-Billed", String(cost));
    res.setHeader("X-Credits-Remaining", String(newBalance));
    next();
  };
}
