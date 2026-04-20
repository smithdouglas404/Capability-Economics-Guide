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

export interface OrgCheckoutSessionInput {
  orgId: number;
  orgName: string;
  tierName: string;
  tierSlug: string;
  perSeatPriceCents: number;
  seats: number;
  billingPeriod: "monthly" | "annual";
  customerEmail?: string;
  existingCustomerId?: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Stripe Checkout session for an org-level seat-priced subscription. The
 * subscription quantity equals the seat count; Stripe bills seats × per-seat
 * price on each period. Later member adds/removes update the Stripe
 * subscription quantity via updateOrgSubscriptionSeats().
 */
export async function createOrgCheckoutSession(input: OrgCheckoutSessionInput): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  return stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [{
      quantity: input.seats,
      price_data: {
        currency: "usd",
        unit_amount: input.perSeatPriceCents,
        recurring: { interval: input.billingPeriod === "annual" ? "year" : "month" },
        product_data: {
          name: `${input.tierName} — Capability Economics (${input.orgName})`,
          description: `${input.billingPeriod === "annual" ? "Annual" : "Monthly"} team membership, per seat`,
        },
      },
    }],
    customer: input.existingCustomerId,
    customer_email: input.existingCustomerId ? undefined : input.customerEmail,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: `org:${input.orgId}`,
    metadata: {
      orgId: String(input.orgId),
      tierSlug: input.tierSlug,
      billingPeriod: input.billingPeriod,
      seatsAtPurchase: String(input.seats),
    },
    subscription_data: {
      metadata: {
        orgId: String(input.orgId),
        tierSlug: input.tierSlug,
      },
    },
  });
}

/**
 * Update the quantity on an existing org subscription. Stripe will prorate
 * the difference and bill the owner accordingly.
 */
export async function updateOrgSubscriptionSeats(subscriptionId: string, seats: number): Promise<Stripe.Subscription> {
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const itemId = sub.items.data[0]?.id;
  if (!itemId) throw new Error("Subscription has no line items");
  return stripe.subscriptions.update(subscriptionId, {
    items: [{ id: itemId, quantity: seats }],
    proration_behavior: "create_prorations",
  });
}

// ───────────────────────────── Stripe Connect (marketplace) ─────────────────────────────

/**
 * Create a Stripe Connect Express account for a new seller. The account id
 * returned (acct_xxx) should be stored on the user's marketplace_seller row;
 * hosted onboarding happens via createAccountOnboardingLink.
 */
export async function createConnectAccount(opts: { email?: string; country?: string }): Promise<Stripe.Account> {
  const stripe = getStripe();
  return stripe.accounts.create({
    type: "express",
    email: opts.email,
    country: opts.country ?? "US",
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
  });
}

export async function createAccountOnboardingLink(opts: { accountId: string; returnUrl: string; refreshUrl: string }): Promise<Stripe.AccountLink> {
  const stripe = getStripe();
  return stripe.accountLinks.create({
    account: opts.accountId,
    type: "account_onboarding",
    return_url: opts.returnUrl,
    refresh_url: opts.refreshUrl,
  });
}

/** For a seller who wants to visit their Stripe Express dashboard (payouts, tax forms). */
export async function createExpressDashboardLink(accountId: string): Promise<Stripe.LoginLink> {
  const stripe = getStripe();
  return stripe.accounts.createLoginLink(accountId);
}

export async function retrieveConnectAccount(accountId: string): Promise<Stripe.Account> {
  const stripe = getStripe();
  return stripe.accounts.retrieve(accountId);
}

export interface MarketplaceCheckoutInput {
  listingId: number;
  listingTitle: string;
  buyerEmail?: string;
  priceCents: number;
  platformFeeCents: number;
  sellerStripeAccountId: string;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Marketplace checkout uses Stripe Connect "destination charges": buyer pays
 * us (the platform), we automatically transfer (price - platformFee) to the
 * connected seller account, and Stripe handles the 1099-K at year end.
 */
export async function createMarketplaceCheckoutSession(input: MarketplaceCheckoutInput): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: input.priceCents,
        product_data: {
          name: input.listingTitle,
          description: `Capability Economics marketplace report`,
        },
      },
    }],
    customer_email: input.buyerEmail,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: `listing:${input.listingId}`,
    metadata: {
      listingId: String(input.listingId),
      kind: "marketplace",
    },
    payment_intent_data: {
      application_fee_amount: input.platformFeeCents,
      transfer_data: {
        destination: input.sellerStripeAccountId,
      },
      metadata: {
        listingId: String(input.listingId),
        kind: "marketplace",
      },
    },
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
