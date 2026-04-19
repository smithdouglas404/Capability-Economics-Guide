import express, { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db, userMembershipsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * NOWPayments IPN webhook for crypto payments.
 *
 * NOWPayments signs the webhook body with HMAC-SHA512 using your IPN secret. The
 * signature is sent as header `x-nowpayments-sig`. To verify, we must:
 *   1. Parse the JSON body
 *   2. Sort the top-level keys alphabetically
 *   3. Re-serialize the sorted object
 *   4. HMAC-SHA512 with the IPN secret
 *   5. Compare in constant time with the header
 *
 * Docs: https://nowpayments.io/help/how-can-i-check-the-ipn-signature/
 *
 * When NOWPAYMENTS_IPN_SECRET is not set this route responds 503 — the feature
 * is disabled until an operator configures the integration.
 */
router.post(
  "/payments/nowpayments/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const secret = process.env.NOWPAYMENTS_IPN_SECRET;
    if (!secret) {
      logger.warn("[nowpayments webhook] NOWPAYMENTS_IPN_SECRET not configured — rejecting incoming IPN");
      res.status(503).json({ error: "nowpayments_not_configured" });
      return;
    }

    const provided = req.headers["x-nowpayments-sig"];
    if (typeof provided !== "string" || provided.length === 0) {
      res.status(400).json({ error: "missing_signature" });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body));
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).json({ error: "invalid_json" });
      return;
    }

    // NOWPayments sorts top-level keys alphabetically before signing. Re-serialize
    // the same way so our HMAC matches theirs.
    const sorted = JSON.stringify(
      Object.fromEntries(
        Object.entries(payload).sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
    const expected = crypto.createHmac("sha512", secret).update(sorted).digest("hex");

    let valid = false;
    try {
      valid =
        expected.length === provided.length &&
        crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
    } catch {
      valid = false;
    }
    if (!valid) {
      logger.warn("[nowpayments webhook] signature mismatch");
      res.status(401).json({ error: "invalid_signature" });
      return;
    }

    const status = String(payload.payment_status ?? "");
    // The `order_id` we set when creating the invoice should match our membership id.
    const orderId = Number(payload.order_id ?? 0);
    const paymentId = payload.payment_id != null ? String(payload.payment_id) : null;

    logger.info(
      { status, orderId, paymentId, paidAmount: payload.actually_paid, priceAmount: payload.price_amount },
      "[nowpayments webhook] received",
    );

    if (!Number.isFinite(orderId) || orderId <= 0) {
      res.json({ received: true, note: "no_membership_linked" });
      return;
    }

    try {
      if (status === "finished" || status === "confirmed") {
        // Crypto payment confirmed → flip the membership to active.
        const result = await db
          .update(userMembershipsTable)
          .set({
            status: "active",
            paymentStatus: "paid",
            paymentRef: paymentId ?? "nowpayments",
            approvedAt: new Date(),
            approvedBy: "nowpayments",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(userMembershipsTable.id, orderId),
              eq(userMembershipsTable.status, "pending"),
            ),
          )
          .returning({ id: userMembershipsTable.id });
        if (result.length > 0) {
          logger.info({ membershipId: orderId }, "[nowpayments webhook] activated membership");
        } else {
          logger.info({ membershipId: orderId }, "[nowpayments webhook] membership not pending — skipping activation");
        }
      } else if (status === "failed" || status === "expired" || status === "refunded") {
        await db
          .update(userMembershipsTable)
          .set({
            paymentStatus: "failed",
            paymentRef: paymentId ?? "nowpayments",
            notes: `NOWPayments reported status: ${status}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(userMembershipsTable.id, orderId),
              eq(userMembershipsTable.status, "pending"),
            ),
          );
      }
      // Other statuses (waiting, confirming, sending, partially_paid) are informational — no state flip.

      res.json({ received: true });
    } catch (err) {
      logger.error({ err }, "[nowpayments webhook] handler error");
      res.status(500).json({ error: "handler_error" });
    }
  },
);

export default router;
