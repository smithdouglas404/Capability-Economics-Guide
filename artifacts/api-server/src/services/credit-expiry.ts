import { db, creditPurchasesTable, creditAccountsTable, creditTransactionsTable } from "@workspace/db";
import { and, eq, lte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Nightly expiry sweep for credit purchases. Walks every credit_purchases row
 * where:
 *   - status = 'completed'
 *   - expires_at IS NOT NULL AND expires_at <= NOW()
 *   - expired_processed = 0
 *
 * For each, computes the unused portion of the batch (FIFO accounting is
 * approximated here by debiting min(remaining_balance, batch_credits) —
 * see below) and writes a credit_transactions row of type "expiry" against
 * the user. Marks expired_processed=1 to prevent double-debit on the next
 * sweep.
 *
 * Why "approximated FIFO": this MVP doesn't track per-batch consumption.
 * If a user buys a $25 pack on day 0 and a $100 pack on day 30, then spends
 * 10k credits before day 365, we can't precisely tell which pack those came
 * from. The conservative approach is "expire whichever batch hits expiry
 * first, debiting min(remaining_balance, batch_credits)". This errs on the
 * user's side — they keep credits if they spent them; they lose credits if
 * they didn't. Over time, a per-batch ledger could be layered in if the
 * imprecision becomes a customer-service issue.
 *
 * Idempotent + safe to run multiple times per day.
 */
export interface ExpirySweepResult {
  scanned: number;
  expired: number;
  totalCreditsRevoked: number;
  errors: string[];
  durationMs: number;
}

export async function runCreditExpirySweep(): Promise<ExpirySweepResult> {
  const start = Date.now();
  const errors: string[] = [];
  let expiredCount = 0;
  let totalCreditsRevoked = 0;

  const now = new Date();
  const due = await db.select().from(creditPurchasesTable).where(and(
    eq(creditPurchasesTable.status, "completed"),
    lte(creditPurchasesTable.expiresAt, now),
    eq(creditPurchasesTable.expiredProcessed, 0),
  ));

  for (const purchase of due) {
    try {
      const [account] = await db.select().from(creditAccountsTable).where(eq(creditAccountsTable.userId, purchase.userId)).limit(1);
      if (!account) {
        // No account exists — mark processed so we don't keep scanning, log nothing else.
        await db.update(creditPurchasesTable).set({ expiredProcessed: 1 }).where(eq(creditPurchasesTable.id, purchase.id));
        continue;
      }

      // Debit the smaller of (remaining balance, batch credit amount). See
      // the function-level comment for the FIFO approximation rationale.
      const debit = Math.min(account.balance, purchase.creditsBought);
      if (debit > 0) {
        const newBalance = account.balance - debit;
        await db.transaction(async (tx) => {
          await tx.update(creditAccountsTable).set({ balance: newBalance }).where(eq(creditAccountsTable.userId, purchase.userId));
          await tx.insert(creditTransactionsTable).values({
            userId: purchase.userId,
            amount: -debit,
            type: "expiry",
            description: `Credit expiry: ${debit.toLocaleString()} credits from ${purchase.packSlug ?? "purchase"} #${purchase.id} (purchased ${purchase.createdAt.toISOString().slice(0, 10)}, expired ${(purchase.expiresAt ?? now).toISOString().slice(0, 10)})`,
            balanceAfter: newBalance,
          });
          await tx.update(creditPurchasesTable).set({ expiredProcessed: 1 }).where(eq(creditPurchasesTable.id, purchase.id));
        });
        totalCreditsRevoked += debit;
      } else {
        // Balance is 0 or already lower than this batch — nothing to debit,
        // just mark processed so we don't re-scan.
        await db.update(creditPurchasesTable).set({ expiredProcessed: 1 }).where(eq(creditPurchasesTable.id, purchase.id));
      }
      expiredCount++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`purchase ${purchase.id}: ${msg}`);
      logger.warn({ purchaseId: purchase.id, err: msg }, "[credit-expiry] failed to process purchase");
    }
  }

  const durationMs = Date.now() - start;
  if (expiredCount > 0 || errors.length > 0) {
    logger.info({ scanned: due.length, expired: expiredCount, creditsRevoked: totalCreditsRevoked, errors: errors.length, durationMs }, "[credit-expiry] sweep complete");
  }
  return { scanned: due.length, expired: expiredCount, totalCreditsRevoked, errors, durationMs };
}

/**
 * Soon-to-expire batches (within the next `days` days). Used by the (future)
 * email-warning job to nudge users to use up balance before it disappears.
 */
export async function getExpiringSoon(days = 30): Promise<Array<{ userId: string; purchaseId: number; creditsBought: number; expiresAt: Date | null; packSlug: string | null }>> {
  const horizon = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const rows = await db.select({
    userId: creditPurchasesTable.userId,
    purchaseId: creditPurchasesTable.id,
    creditsBought: creditPurchasesTable.creditsBought,
    expiresAt: creditPurchasesTable.expiresAt,
    packSlug: creditPurchasesTable.packSlug,
  }).from(creditPurchasesTable).where(and(
    eq(creditPurchasesTable.status, "completed"),
    eq(creditPurchasesTable.expiredProcessed, 0),
    sql`${creditPurchasesTable.expiresAt} <= ${horizon}`,
    sql`${creditPurchasesTable.expiresAt} > NOW()`,
  ));
  return rows;
}
