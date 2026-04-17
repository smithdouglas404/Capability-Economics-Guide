import express, { Router, type IRouter } from "express";
import { db, userMembershipsTable } from "@workspace/db";
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
      const membershipId = Number(session.metadata?.membershipId ?? session.client_reference_id ?? 0);
      if (!Number.isFinite(membershipId) || membershipId <= 0) {
        console.warn("[stripe webhook] checkout.session.completed without valid membershipId");
      } else {
        // Only flip pending → active. Idempotent on duplicate webhooks, and prevents
        // a late webhook from overriding an admin rejection or replaying activation.
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
    } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      const session = event.data.object as { id?: string; metadata?: Record<string, string>; client_reference_id?: string; payment_intent?: string };
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
    res.json({ received: true });
  } catch (err) {
    console.error("[stripe webhook] handler error:", err);
    res.status(500).json({ error: "handler_error" });
  }
});

export default router;
