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
}

export async function createCheckoutSession(input: CheckoutSessionInput): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: input.amountCents,
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
  });
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
