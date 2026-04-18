import express, { Router, type IRouter } from "express";
import { db, userMembershipsTable, creditPurchasesTable, creditAccountsTable, creditTransactionsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { verifyWebhookSignature } from "../services/stripe";

const router: IRouter = Router();

// Stripe requires the raw request body to verify the webhook signature, so this
// route must be mounted BEFORE the global express.json() middleware.
router.post("/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["stripe-signature"] as string | undefined;
  let event;
  try {
    event = verifyWebhookSignature(req.body as Buffer, signature ?? "");
  } catch (err) {
    console.error("[stripe webhook] signature verification failed:", err);
    res.status(400).send(`Webhook Error: ${(err as Error).message}`);
    return;
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as { metadata?: Record<string, string>; client_reference_id?: string; payment_intent?: string };
      const tierSlug = session.metadata?.tierSlug;

      if (tierSlug === "credits") {
        // ── Credit purchase completion ──
        const purchaseId = Number(session.metadata?.membershipId ?? session.client_reference_id ?? 0);
        if (Number.isFinite(purchaseId) && purchaseId > 0) {
          const result = await db.update(creditPurchasesTable).set({
            status: "completed",
            paymentRef: typeof session.payment_intent === "string" ? session.payment_intent : "stripe_checkout",
          }).where(and(
            eq(creditPurchasesTable.id, purchaseId),
            eq(creditPurchasesTable.status, "pending"),
          )).returning();

          if (result.length > 0) {
            const purchase = result[0];
            // Credit the account
            const [account] = await db.select().from(creditAccountsTable).where(eq(creditAccountsTable.userId, purchase.userId));
            if (!account) {
              console.error(`[stripe webhook] credit purchase ${purchase.id} completed but no credit account for user ${purchase.userId}`);
            } else {
              const newBalance = account.balance + purchase.creditsBought;
              await db.update(creditAccountsTable).set({ balance: newBalance }).where(eq(creditAccountsTable.userId, purchase.userId));

              await db.insert(creditTransactionsTable).values({
                userId: purchase.userId,
                amount: purchase.creditsBought,
                type: "purchase",
                description: `Purchased ${purchase.creditsBought.toLocaleString()} credits via Stripe`,
                balanceAfter: newBalance,
              });

              console.log(`[stripe webhook] credited ${purchase.creditsBought} credits to user ${purchase.userId}, new balance: ${newBalance}`);
            }
          }
        }
      } else {
        // ── Membership activation ──
        const membershipId = Number(session.metadata?.membershipId ?? session.client_reference_id ?? 0);
        if (!Number.isFinite(membershipId) || membershipId <= 0) {
          console.warn("[stripe webhook] checkout.session.completed without valid membershipId");
        } else {
          const result = await db.update(userMembershipsTable).set({
            status: "active",
            paymentStatus: "paid",
            paymentRef: typeof session.payment_intent === "string" ? session.payment_intent : "stripe_checkout",
            approvedAt: new Date(),
            approvedBy: "stripe",
            updatedAt: new Date(),
          }).where(and(
            eq(userMembershipsTable.id, membershipId),
            eq(userMembershipsTable.status, "pending"),
          )).returning({ id: userMembershipsTable.id });
          if (result.length > 0) {
            console.log(`[stripe webhook] activated membership ${membershipId}`);
          } else {
            console.log(`[stripe webhook] membership ${membershipId} not in pending state — skipping activation`);
          }
        }
      }
    } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object as { id?: string; metadata?: Record<string, string>; client_reference_id?: string; payment_intent?: string };
      const tierSlug = session.metadata?.tierSlug;

      if (tierSlug === "credits") {
        const purchaseId = Number(session.metadata?.membershipId ?? session.client_reference_id ?? 0);
        if (Number.isFinite(purchaseId) && purchaseId > 0) {
          await db.update(creditPurchasesTable).set({
            status: "failed",
            paymentRef: session.id ?? null,
          }).where(and(
            eq(creditPurchasesTable.id, purchaseId),
            eq(creditPurchasesTable.status, "pending"),
          ));
        }
      } else {
        const membershipId = Number(session.metadata?.membershipId ?? session.client_reference_id ?? 0);
        if (Number.isFinite(membershipId) && membershipId > 0) {
          const ref = (typeof session.payment_intent === "string" ? session.payment_intent : null) ?? session.id ?? null;
          await db.update(userMembershipsTable).set({
            paymentStatus: "failed",
            paymentRef: ref,
            updatedAt: new Date(),
          }).where(and(
            eq(userMembershipsTable.id, membershipId),
            eq(userMembershipsTable.status, "pending"),
          ));
        }
      }
    }
    res.json({ received: true });
  } catch (err) {
    console.error("[stripe webhook] handler error:", err);
    res.status(500).json({ error: "handler_error" });
  }
});

export default router;
