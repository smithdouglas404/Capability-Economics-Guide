import Stripe from "stripe";

let stripeClient: Stripe | null = null;
export function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  stripeClient = new Stripe(key, { apiVersion: "2025-09-30.clover" });
  return stripeClient;
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export interface CheckoutSessionInput {
  membershipId: number;
  tierName: string;
  tierSlug: string;
  amountCents: number;
  billingPeriod: "monthly" | "annual";
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  /** When true, creates a recurring subscription; otherwise a one-time payment (legacy). */
  subscription?: boolean;
}

export async function createCheckoutSession(input: CheckoutSessionInput): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  const isSubscription = input.subscription !== false; // default to subscriptions for new flows

  const recurring: Stripe.Checkout.SessionCreateParams.LineItem.PriceData["recurring"] | undefined = isSubscription
    ? { interval: input.billingPeriod === "annual" ? "year" : "month" }
    : undefined;

  return stripe.checkout.sessions.create({
    mode: isSubscription ? "subscription" : "payment",
    payment_method_types: ["card"],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: input.amountCents,
        recurring,
        product_data: {
          name: `${input.tierName} — Capability Economics`,
          description: `${input.billingPeriod === "annual" ? "Annual" : "Monthly"} membership`,
        },
      },
    }],
    customer_email: input.customerEmail,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: String(input.membershipId),
    metadata: {
      membershipId: String(input.membershipId),
      tierSlug: input.tierSlug,
      billingPeriod: input.billingPeriod,
    },
    subscription_data: isSubscription ? {
      metadata: {
        membershipId: String(input.membershipId),
        tierSlug: input.tierSlug,
      },
    } : undefined,
  });
}

/**
 * Returns a URL to Stripe's hosted Customer Portal where the user can
 * update payment methods, change plan, view invoices, or cancel.
 */
export async function createBillingPortalSession(opts: {
  customerId: string;
  returnUrl: string;
}): Promise<Stripe.BillingPortal.Session> {
  const stripe = getStripe();
  return stripe.billingPortal.sessions.create({
    customer: opts.customerId,
    return_url: opts.returnUrl,
  });
}

export async function cancelSubscription(subscriptionId: string, opts?: { atPeriodEnd?: boolean }): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  if (opts?.atPeriodEnd) {
    return stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  }
  return stripe.subscriptions.cancel(subscriptionId);
}

export interface RefundInput {
  paymentIntent: string;          // pi_... from paymentRef column
  amountCents?: number;           // omit to refund the full charge
  reason?: "duplicate" | "fraudulent" | "requested_by_customer";
}

/**
 * Issue a refund against a prior Stripe PaymentIntent. When amountCents is
 * omitted Stripe refunds the full original charge; supplying a smaller amount
 * issues a partial refund.
 */
export async function refundPaymentIntent(input: RefundInput): Promise<Stripe.Refund> {
  const stripe = getStripe();
  return stripe.refunds.create({
    payment_intent: input.paymentIntent,
    amount: input.amountCents,
    reason: input.reason ?? "requested_by_customer",
  });
}

export function verifyWebhookSignature(rawBody: Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // Refuse to process unsigned webhooks in production — an attacker could spoof
    // checkout.session.completed and grant themselves a free membership.
    if (process.env.NODE_ENV === "production") {
      throw new Error("STRIPE_WEBHOOK_SECRET is required in production");
    }
    console.warn("[stripe] STRIPE_WEBHOOK_SECRET not set — accepting webhook without signature verification (DEV ONLY)");
    return JSON.parse(rawBody.toString("utf8")) as Stripe.Event;
  }
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
}
