import express, { Router, type IRouter } from "express";
import { db, userMembershipsTable, creditPurchasesTable, creditAccountsTable, creditTransactionsTable, membershipTiersTable, billingOrganizationsTable, marketplaceSellersTable, marketplacePurchasesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { verifyWebhookSignature } from "../services/stripe";
import { sendApprovalEmail, sendPaymentFailedEmail } from "../services/email";
import { logger } from "../lib/logger";

/** Stripe fields that may be either a string id or the expanded object; normalize to id. */
function stringId(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "id" in v && typeof (v as { id: unknown }).id === "string") return (v as { id: string }).id;
  return null;
}

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

      // Marketplace purchase branch — session metadata.kind === "marketplace"
      if (session.metadata?.kind === "marketplace") {
        const listingId = Number(session.metadata.listingId ?? 0);
        const sessionFull = event.data.object as { id?: string; payment_intent?: unknown; customer_details?: { email?: string | null } };
        const paymentIntentId = stringId(sessionFull.payment_intent);
        // Tenancy metadata stamped at checkout creation. We re-affirm here so
        // the webhook is the source-of-truth update — if the pre-insert lost
        // the org attribution for any reason, the webhook fixes it.
        const buyerClerkOrgId = (session.metadata.buyerClerkOrgId as string | undefined) || null;
        const buyerClerkUserId = (session.metadata.buyerClerkUserId as string | undefined) || null;
        if (Number.isFinite(listingId) && listingId > 0) {
          // Build the update set conditionally so we never overwrite a previously
          // set buyerClerkOrgId with null (the pending row inserted it; metadata
          // may be missing if Stripe stripped it).
          const updates: Record<string, unknown> = {
            status: "paid",
            purchasedAt: new Date(),
            stripePaymentIntentId: paymentIntentId,
            buyerEmail: sessionFull.customer_details?.email ?? undefined,
          };
          if (buyerClerkOrgId) updates.buyerClerkOrgId = buyerClerkOrgId;

          const rows = await db.update(marketplacePurchasesTable).set(updates).where(and(
            eq(marketplacePurchasesTable.listingId, listingId),
            eq(marketplacePurchasesTable.stripeCheckoutSessionId, sessionFull.id ?? ""),
          )).returning({ id: marketplacePurchasesTable.id, buyerClerkOrgId: marketplacePurchasesTable.buyerClerkOrgId, priceCents: marketplacePurchasesTable.priceCents });
          if (rows.length > 0) {
            console.log(`[stripe webhook] marketplace purchase ${rows[0].id} marked paid (scope=${rows[0].buyerClerkOrgId ? "team" : "personal"}, buyerUser=${buyerClerkUserId ?? "—"})`);

            // Anchor the sale on Hedera. No PII / payment details on chain —
            // we hash the buyer identity + Stripe session id and publish only
            // the public listing + price + outcome.
            try {
              const { anchorEvent, canonicalHash } = await import("../services/blockchain-audit");
              const sensitivePayload = {
                buyerClerkUserId,
                buyerClerkOrgId,
                buyerEmail: sessionFull.customer_details?.email ?? null,
                stripeSessionId: sessionFull.id,
                stripePaymentIntentId: paymentIntentId,
              };
              void anchorEvent("marketplace_purchase", {
                contextHash: canonicalHash(sensitivePayload),
                contextSnapshot: {
                  purchaseId: rows[0].id,
                  listingId,
                  priceCents: rows[0].priceCents,
                  scope: rows[0].buyerClerkOrgId ? "team" : "personal",
                  buyerIdentityHash: canonicalHash({ buyerClerkUserId, buyerClerkOrgId }),
                },
                relatedEntity: `marketplace_purchases:${rows[0].id}`,
              });
            } catch (err) {
              console.error("[stripe webhook] anchor failed (non-fatal):", err);
            }
          }
        }
        res.json({ received: true });
        return;
      }

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
        const sessionFull = event.data.object as { metadata?: Record<string, string>; client_reference_id?: string; payment_intent?: unknown; subscription?: unknown; customer?: unknown };
        const subscriptionId = stringId(sessionFull.subscription);
        const customerId = stringId(sessionFull.customer);
        const paymentIntentId = stringId(sessionFull.payment_intent);
        const orgId = Number(session.metadata?.orgId ?? 0);

        // Org-level subscription checkout: metadata.orgId is set by the org
        // checkout endpoint. Update the billing_organizations row instead of a
        // user membership — individual members inherit access through requireTier.
        if (Number.isFinite(orgId) && orgId > 0) {
          await db.update(billingOrganizationsTable).set({
            status: "active",
            stripeSubscriptionId: subscriptionId,
            stripeCustomerId: customerId,
            updatedAt: new Date(),
          }).where(eq(billingOrganizationsTable.id, orgId));
          console.log(`[stripe webhook] activated billing org ${orgId}`);
        } else if (!Number.isFinite(membershipId) || membershipId <= 0) {
          console.warn("[stripe webhook] checkout.session.completed without valid membershipId or orgId");
        } else {
          const result = await db.update(userMembershipsTable).set({
            status: "active",
            paymentStatus: "paid",
            // Subscription mode: payment_intent is null; store the subscription id as the ref so refunds/cancels can find it.
            paymentRef: paymentIntentId ?? subscriptionId ?? "stripe_checkout",
            stripeSubscriptionId: subscriptionId,
            stripeCustomerId: customerId,
            approvedAt: new Date(),
            approvedBy: "stripe",
            updatedAt: new Date(),
          }).where(and(
            eq(userMembershipsTable.id, membershipId),
            eq(userMembershipsTable.status, "pending"),
          )).returning({ id: userMembershipsTable.id, userEmail: userMembershipsTable.userEmail, userName: userMembershipsTable.userName, tierId: userMembershipsTable.tierId });
          if (result.length > 0) {
            console.log(`[stripe webhook] activated membership ${membershipId}`);
            const [membership] = result;
            if (membership.userEmail) {
              const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, membership.tierId));
              void sendApprovalEmail({ to: membership.userEmail, name: membership.userName, tierName: tier?.name ?? "your" });
            }
          } else {
            console.log(`[stripe webhook] membership ${membershipId} not in pending state — skipping activation`);
          }
        }
      }
    } else if (event.type === "invoice.payment_succeeded") {
      // Subscription renewal succeeded — extend the current_period_end on our record.
      const inv = event.data.object as { subscription?: unknown; period_end?: number };
      const subId = stringId(inv.subscription);
      if (subId) {
        const periodEnd = typeof inv.period_end === "number" ? new Date(inv.period_end * 1000) : null;
        await db.update(userMembershipsTable).set({
          paymentStatus: "paid",
          currentPeriodEnd: periodEnd,
          updatedAt: new Date(),
        }).where(eq(userMembershipsTable.stripeSubscriptionId, subId));
        // Also ack the org-scoped subscription
        await db.update(billingOrganizationsTable).set({
          status: "active",
          updatedAt: new Date(),
        }).where(eq(billingOrganizationsTable.stripeSubscriptionId, subId));
      }
    } else if (event.type === "invoice.payment_failed") {
      // Start dunning — email the user and mark past_due. Stripe Smart Retries keeps trying.
      const inv = event.data.object as { subscription?: unknown; amount_due?: number };
      const subId = stringId(inv.subscription);
      if (subId) {
        const rows = await db.update(userMembershipsTable).set({
          paymentStatus: "past_due",
          updatedAt: new Date(),
        }).where(eq(userMembershipsTable.stripeSubscriptionId, subId)).returning({
          userEmail: userMembershipsTable.userEmail,
          userName: userMembershipsTable.userName,
          tierId: userMembershipsTable.tierId,
        });
        for (const r of rows) {
          if (r.userEmail) {
            const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, r.tierId));
            void sendPaymentFailedEmail({
              to: r.userEmail,
              name: r.userName,
              tierName: tier?.name ?? "your",
              amountCents: typeof inv.amount_due === "number" ? inv.amount_due : null,
            });
          }
        }
        // Org-scoped: mark past_due + email the owner
        const orgRows = await db.update(billingOrganizationsTable).set({
          status: "past_due",
          updatedAt: new Date(),
        }).where(eq(billingOrganizationsTable.stripeSubscriptionId, subId)).returning({
          ownerEmail: billingOrganizationsTable.ownerEmail,
          name: billingOrganizationsTable.name,
        });
        for (const o of orgRows) {
          if (o.ownerEmail) {
            void sendPaymentFailedEmail({
              to: o.ownerEmail,
              name: null,
              tierName: `${o.name} team`,
              amountCents: typeof inv.amount_due === "number" ? inv.amount_due : null,
            });
          }
        }
      }
    } else if (event.type === "customer.subscription.updated") {
      // Plan changes, cancel_at_period_end toggle, and final-retry-exhausted transitions to "unpaid".
      const sub = event.data.object as { id: string; cancel_at_period_end?: boolean; current_period_end?: number; status?: string };
      const periodEnd = typeof sub.current_period_end === "number" ? new Date(sub.current_period_end * 1000) : null;
      const newPaymentStatus =
        sub.status === "past_due" ? "past_due" :
        sub.status === "unpaid"   ? "unpaid"   :
        sub.cancel_at_period_end  ? "cancel_scheduled" : "paid";
      const updated = await db.update(userMembershipsTable).set({
        paymentStatus: newPaymentStatus,
        // Stripe's "unpaid" = Smart Retries exhausted. Revoke access so downstream tier gates start failing.
        status: sub.status === "unpaid" ? "cancelled" : undefined as never,
        currentPeriodEnd: periodEnd,
        updatedAt: new Date(),
      }).where(eq(userMembershipsTable.stripeSubscriptionId, sub.id)).returning({
        userEmail: userMembershipsTable.userEmail,
        userName: userMembershipsTable.userName,
        tierId: userMembershipsTable.tierId,
      });
      // Escalation email when Stripe gave up retrying.
      if (sub.status === "unpaid") {
        for (const row of updated) {
          if (row.userEmail) {
            const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, row.tierId));
            void sendPaymentFailedEmail({
              to: row.userEmail,
              name: row.userName,
              tierName: tier?.name ?? "your",
              amountCents: null,
            });
          }
        }
      }
    } else if (event.type === "charge.refunded") {
      // Marketplace refund: look up the purchase by payment_intent and mark it refunded.
      const charge = event.data.object as { payment_intent?: unknown; amount_refunded?: number };
      const piId = stringId(charge.payment_intent);
      if (piId) {
        const rows = await db.update(marketplacePurchasesTable).set({
          status: "refunded",
          refundedAt: new Date(),
        }).where(eq(marketplacePurchasesTable.stripePaymentIntentId, piId)).returning({ id: marketplacePurchasesTable.id });
        if (rows.length > 0) {
          logger.info({ purchaseId: rows[0].id, piId }, "[stripe webhook] marketplace purchase refunded");
        }
      }
    } else if (event.type === "account.updated") {
      // Connect account state sync (marketplace sellers).
      const account = event.data.object as { id: string; charges_enabled?: boolean; payouts_enabled?: boolean; details_submitted?: boolean };
      await db.update(marketplaceSellersTable).set({
        chargesEnabled: account.charges_enabled ?? false,
        payoutsEnabled: account.payouts_enabled ?? false,
        detailsSubmitted: account.details_submitted ?? false,
        accountSnapshot: account as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      }).where(eq(marketplaceSellersTable.stripeAccountId, account.id));
    } else if (event.type === "customer.subscription.deleted") {
      // Subscription fully cancelled — revoke access.
      const sub = event.data.object as { id: string };
      await db.update(userMembershipsTable).set({
        status: "cancelled",
        paymentStatus: "cancelled",
        notes: `[stripe] Subscription ${sub.id} ended at ${new Date().toISOString()}`,
        updatedAt: new Date(),
      }).where(eq(userMembershipsTable.stripeSubscriptionId, sub.id));
      // Org-scoped: revoke seat-inheritance access
      await db.update(billingOrganizationsTable).set({
        status: "cancelled",
        updatedAt: new Date(),
      }).where(eq(billingOrganizationsTable.stripeSubscriptionId, sub.id));
      logger.info({ subscriptionId: sub.id }, "[stripe webhook] subscription cancelled, access deactivated");
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
