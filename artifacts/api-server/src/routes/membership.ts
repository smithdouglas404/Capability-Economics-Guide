import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  membershipTiersTable,
  userMembershipsTable,
  creditAccountsTable,
  creditTransactionsTable,
} from "@workspace/db";
import { asc, desc, eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAdmin, isClerkAdmin } from "../middlewares/requireAdmin";
import { getAuth } from "@clerk/express";
import { createCheckoutSession, isStripeConfigured, refundPaymentIntent } from "../services/stripe";
import { createInvoice as createNowPaymentsInvoice, isNowPaymentsConfigured } from "../services/nowpayments";
import { checkKycForTier } from "../middlewares/requireTier";
import { logAdminAction } from "../services/audit-log";
import {
  sendWelcomeEmail,
  sendApprovalEmail,
  sendRejectionEmail,
  sendHoldEmail,
  sendReactivatedEmail,
  sendCompEmail,
  sendTierChangedEmail,
} from "../services/email";

const router: IRouter = Router();

const DEFAULT_TIERS = [
  {
    slug: "discovery",
    name: "Discovery",
    tagline: "Explore the framework. Free forever.",
    description:
      "Browse the Capability Economics index, ask questions in natural language, and see how the framework maps your industry — at zero cost.",
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    isContactSales: false,
    priceLocked: false,
    displayOrder: 0,
    features: [
      "50 CEI credits/month",
      "Knowledge Graph: browse all 6 industries and capability relationships",
      "CEI Index: view the live composite index and industry breakdowns",
      "Natural-language query: ask questions about capabilities, AI risk, moat scores (5/day)",
      "Regulations: view compliance frameworks and capability mappings",
      "Collaboration: view strategy discussions (read-only)",
      "C-Suite perspectives and case studies",
    ],
    ctaLabel: "Get Started Free",
    highlight: false,
    active: true,
  },
  {
    slug: "briefing",
    name: "Briefing",
    tagline: "Read the framework. See the data.",
    description:
      "For analysts, board members, and consultants who need the full Capability Economics framework with watchlists, alerts, and the ability to contribute to strategy discussions.",
    monthlyPriceCents: 29900,
    annualPriceCents: 299000,
    isContactSales: false,
    priceLocked: false,
    displayOrder: 1,
    features: [
      "500 CEI credits/month",
      "Everything in Discovery",
      "Full Knowledge Graph with capability rerun and economic detail",
      "Full CEI dashboard with macro events, agent activity, and data freshness",
      "Watchlist: monitor up to 10 capabilities with decay/moat/fragility alerts",
      "Collaboration: post comments, participate in strategy discussions",
      "Regulations: create compliance frameworks and map capability requirements",
      "Insights feed with on-demand AI insight generation",
      "Case studies with full ROI data",
    ],
    ctaLabel: "Start Briefing",
    highlight: false,
    active: true,
  },
  {
    slug: "workbench",
    name: "Workbench",
    tagline: "Run the analysis on your own situation.",
    description:
      "For operating executives who need simulation, benchmarking, trade signals, and the full CE Alpha intelligence suite to drive strategy decisions.",
    monthlyPriceCents: 149900,
    annualPriceCents: 1499000,
    isContactSales: false,
    priceLocked: false,
    displayOrder: 2,
    features: [
      "5,000 CEI credits/month",
      "Everything in Briefing",
      "What-If Simulation Engine: model investments, see CEI/moat/fragility/EVaR projections",
      "Competitive War Room: real-time capability comparison with gap alerts",
      "Trade Signals: long/short signals from CE vs. street quadrant divergence",
      "Competitive Benchmarking: filter by industry/region/capabilities, AI-powered company discovery",
      "Innovation Pipeline: track projects from ideation through scale with capability uplift",
      "ROI Tracker: quarterly spend, revenue impact, and efficiency gains per capability",
      "All 10 CE Alpha tabs: EVaR, Cascade, Narrative Δ, Moat, Fragility, Arbitrage, Flows, Talent, M&A Twin, Thesis",
      "VCE: multi-day autonomous research campaigns",
      "Run custom assessments with SEC EDGAR, voice, document, and competitor analysis",
      "Organization profile and project workspace",
      "Submit up to 10 custom capabilities per month",
    ],
    ctaLabel: "Start Workbench",
    highlight: true,
    active: true,
  },
  {
    slug: "platform",
    name: "Platform",
    tagline: "The full Capability Economics engine, on your industries.",
    description:
      "For PE firms, large enterprise strategy teams, and consulting firms who need bespoke industry coverage, unlimited analysis, and full platform control.",
    monthlyPriceCents: null,
    annualPriceCents: 2500000,
    isContactSales: true,
    priceLocked: true,
    displayOrder: 3,
    features: [
      "50,000 CEI credits/month",
      "Everything in Workbench, with no caps on submissions",
      "Autonomous discovery agent: continuous capability research with Perplexity + GLM-5.1",
      "Full review-queue admin: approve, reject-with-comment, or terminate submissions",
      "Custom industries beyond the 6 included verticals",
      "Persistent agent memory across runs",
      "Unlimited watchlist items and benchmark sessions",
      "Record strategy decisions with investment tracking and audit trail",
    ],
    ctaLabel: "Talk to sales",
    highlight: false,
    active: true,
  },
];

async function ensureSeeded() {
  const existing = await db.select().from(membershipTiersTable);
  if (existing.length === 0) {
    await db.insert(membershipTiersTable).values(DEFAULT_TIERS);
  }
}

router.get("/membership/tiers", async (_req, res) => {
  await ensureSeeded();
  const tiers = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.active, true)).orderBy(asc(membershipTiersTable.displayOrder));
  res.json(tiers);
});

router.get("/membership/tiers/all", async (_req, res) => {
  await ensureSeeded();
  const tiers = await db.select().from(membershipTiersTable).orderBy(asc(membershipTiersTable.displayOrder));
  res.json(tiers);
});

const PatchBody = z.object({
  name: z.string().min(2).max(80).optional(),
  tagline: z.string().min(2).max(200).optional(),
  description: z.string().min(2).max(2000).optional(),
  monthlyPriceCents: z.number().int().min(0).max(100000000).nullable().optional(),
  annualPriceCents: z.number().int().min(0).max(100000000).nullable().optional(),
  seatPriceCents: z.number().int().min(0).max(100000000).nullable().optional(),
  features: z.array(z.string().min(1).max(300)).max(20).optional(),
  ctaLabel: z.string().min(2).max(40).optional(),
  highlight: z.boolean().optional(),
  active: z.boolean().optional(),
  isContactSales: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(99).optional(),
});

router.patch("/membership/tiers/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [existing] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, id));
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  if (existing.priceLocked && (parsed.data.annualPriceCents !== undefined || parsed.data.monthlyPriceCents !== undefined)) {
    res.status(403).json({ error: `Tier "${existing.name}" has its price locked. Unlock it in the schema if you really need to change.` });
    return;
  }
  await db.update(membershipTiersTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(membershipTiersTable.id, id));
  const [updated] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, id));
  await logAdminAction(req, {
    action: "tier.update",
    targetType: "tier",
    targetId: id,
    details: { tierName: existing.name, changes: parsed.data },
  });
  res.json(updated);
});

// ───────────────────────────── User memberships ─────────────────────────────

const RequestBody = z.object({
  tierId: z.number().int().positive(),
  entityType: z.enum(["company", "individual"]),
  entityName: z.string().min(1).max(200),
  entityIndustry: z.string().max(80).optional().nullable(),
  entitySize: z.string().max(40).optional().nullable(),
  entityRole: z.string().max(80).optional().nullable(),
  paymentMethod: z.enum(["card", "invoice", "crypto"]),
  paymentRef: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

router.get("/me/membership", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  // Admins: if they don't already have a membership row, auto-provision a real
  // Platform-tier active row so (a) they show up in the Members list like any
  // other user, (b) they don't need to self-assign a tier, and (c) every gate
  // treats them as top-tier without a special synthetic path.
  if (await isClerkAdmin(auth.userId)) {
    await ensureSeeded();
    const [existing] = await db
      .select()
      .from(userMembershipsTable)
      .where(eq(userMembershipsTable.userId, auth.userId))
      .orderBy(desc(userMembershipsTable.requestedAt))
      .limit(1);

    if (existing && existing.status === "active") {
      // Already provisioned — just return.
      const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, existing.tierId));
      res.json({ membership: existing, tier: tier ?? null });
      return;
    }

    const [platform] = await db
      .select()
      .from(membershipTiersTable)
      .where(eq(membershipTiersTable.slug, "platform"));
    if (platform) {
      const userEmail = (req.headers["x-user-email"] as string | undefined) ?? null;
      const userName = (req.headers["x-user-name"] as string | undefined) ?? null;
      const [created] = await db.insert(userMembershipsTable).values({
        userId: auth.userId,
        userEmail,
        userName,
        tierId: platform.id,
        entityType: "individual",
        entityName: userName ?? userEmail ?? "Platform Administrator",
        paymentMethod: "invoice",
        paymentRef: "ADMIN",
        notes: "Auto-provisioned admin membership (Clerk publicMetadata.role=admin).",
      }).returning();
      await db.update(userMembershipsTable).set({
        status: "active",
        paymentStatus: "comped",
        approvedAt: new Date(),
        approvedBy: "system",
        updatedAt: new Date(),
      }).where(eq(userMembershipsTable.id, created!.id));
      const [final] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, created!.id));
      res.json({ membership: final, tier: platform });
      return;
    }
  }

  const rows = await db
    .select()
    .from(userMembershipsTable)
    .where(eq(userMembershipsTable.userId, auth.userId))
    .orderBy(desc(userMembershipsTable.requestedAt))
    .limit(1);
  if (rows.length === 0) { res.json({ membership: null }); return; }
  const m = rows[0]!;
  const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, m.tierId));
  res.json({ membership: m, tier: tier ?? null });
});

router.post("/me/membership/request", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = RequestBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, parsed.data.tierId));
  if (!tier || !tier.active) { res.status(404).json({ error: "Tier not found or inactive" }); return; }

  // Server-side KYC gate: even free tiers require email-level KYC. Frontend
  // pre-flight is UX only — this is the actual security check that prevents
  // direct API callers from bypassing identity verification.
  const kyc = await checkKycForTier(auth.userId, tier.slug);
  if (!kyc.ok) {
    res.status(403).json({
      error: "KYC required",
      requiredKycLevel: kyc.requiredKycLevel,
      tierSlug: tier.slug,
      message: `This tier requires identity verification (${kyc.requiredKycLevel} level).`,
      redirectTo: `/kyc?tierSlug=${tier.slug}`,
    });
    return;
  }

  const isFree = !tier.monthlyPriceCents && !tier.annualPriceCents && !tier.isContactSales;
  // SECURITY: never auto-approve paid tiers based on the requested payment method alone.
  // Card requests stay pending until a verified Stripe webhook flips them (next iteration).
  // Only the free tier is granted immediately.
  const status = isFree ? "active" : "pending";
  const paymentStatus = isFree ? "comped" : "pending";

  const userEmailHeader = (req.headers["x-user-email"] as string | undefined) ?? null;
  const userNameHeader = (req.headers["x-user-name"] as string | undefined) ?? null;

  const [created] = await db.insert(userMembershipsTable).values({
    userId: auth.userId,
    userEmail: userEmailHeader,
    userName: userNameHeader,
    tierId: parsed.data.tierId,
    entityType: parsed.data.entityType,
    entityName: parsed.data.entityName,
    entityIndustry: parsed.data.entityIndustry ?? null,
    entitySize: parsed.data.entitySize ?? null,
    entityRole: parsed.data.entityRole ?? null,
    paymentMethod: parsed.data.paymentMethod,
    paymentRef: parsed.data.paymentRef ?? null,
    paymentAmountCents: tier.annualPriceCents ?? tier.monthlyPriceCents ?? null,
    notes: parsed.data.notes ?? null,
  }).returning();

  // For free / card auto-approve, immediately mark active
  if (status === "active") {
    await db.update(userMembershipsTable)
      .set({ status, paymentStatus, approvedAt: new Date(), approvedBy: "system", updatedAt: new Date() })
      .where(eq(userMembershipsTable.id, created!.id));
  }

  // Fire-and-forget welcome email (handles graceful-degrade when RESEND not configured)
  if (userEmailHeader) {
    void (status === "active"
      ? sendApprovalEmail({ to: userEmailHeader, name: userNameHeader, tierName: tier.name })
      : sendWelcomeEmail({ to: userEmailHeader, name: userNameHeader, tierName: tier.name }));
  }

  const [final] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, created!.id));
  res.status(201).json({ membership: final });
});

// ───────────────────────────── Stripe Checkout ─────────────────────────────

const CheckoutBody = z.object({
  tierId: z.number().int().positive(),
  billing: z.enum(["monthly", "annual"]).default("annual"),
  entityType: z.enum(["company", "individual"]).default("individual"),
  entityName: z.string().min(1).max(200),
  successPath: z.string().default("/membership?status=success"),
  cancelPath: z.string().default("/membership?status=cancelled"),
});

router.post("/me/membership/checkout", async (req, res) => {
  if (!isStripeConfigured()) { res.status(503).json({ error: "Stripe not configured" }); return; }
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CheckoutBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, parsed.data.tierId));
  if (!tier || !tier.active) { res.status(404).json({ error: "Tier not found or inactive" }); return; }
  const amount = parsed.data.billing === "annual" ? tier.annualPriceCents : tier.monthlyPriceCents;
  if (!amount || amount <= 0) { res.status(400).json({ error: "Tier has no price for the requested billing period" }); return; }

  // Server-side KYC gate before issuing a Stripe Checkout link. Even though the
  // frontend membership page does a pre-flight, this prevents direct API callers
  // from creating a checkout session without satisfying the tier's KYC level.
  const kyc = await checkKycForTier(auth.userId, tier.slug);
  if (!kyc.ok) {
    res.status(403).json({
      error: "KYC required",
      requiredKycLevel: kyc.requiredKycLevel,
      tierSlug: tier.slug,
      message: `This tier requires identity verification (${kyc.requiredKycLevel} level) before checkout.`,
      redirectTo: `/kyc?tierSlug=${tier.slug}&returnTo=/membership`,
    });
    return;
  }

  const userEmail = (req.headers["x-user-email"] as string | undefined) ?? null;

  // Create the membership record up front in `pending` so the webhook can flip it once Stripe confirms payment.
  const [membership] = await db.insert(userMembershipsTable).values({
    userId: auth.userId,
    userEmail,
    userName: (req.headers["x-user-name"] as string | undefined) ?? null,
    tierId: parsed.data.tierId,
    entityType: parsed.data.entityType,
    entityName: parsed.data.entityName,
    paymentMethod: "card",
    paymentAmountCents: amount,
    notes: `Stripe Checkout (${parsed.data.billing})`,
  }).returning();

  const origin = (req.headers.origin as string | undefined)
    ?? (req.headers.referer as string | undefined)?.replace(/\/[^/]*$/, "")
    ?? `${req.protocol}://${req.headers.host}`;

  // Build URLs with the URL helper so callers can pass paths with or without an existing query string.
  const buildUrl = (pathWithQuery: string): string => {
    try {
      const u = new URL(pathWithQuery, origin);
      u.searchParams.set("membership", String(membership!.id));
      return u.toString();
    } catch {
      const sep = pathWithQuery.includes("?") ? "&" : "?";
      return `${origin}${pathWithQuery}${sep}membership=${membership!.id}`;
    }
  };

  try {
    const session = await createCheckoutSession({
      membershipId: membership!.id,
      tierName: tier.name,
      tierSlug: tier.slug,
      amountCents: amount,
      billingPeriod: parsed.data.billing,
      customerEmail: userEmail ?? undefined,
      successUrl: buildUrl(parsed.data.successPath),
      cancelUrl: buildUrl(parsed.data.cancelPath),
    });
    res.json({ checkoutUrl: session.url, sessionId: session.id, membershipId: membership!.id });
  } catch (err) {
    console.error("[stripe checkout] create session failed:", err);
    // Mark as failed rather than delete so we have an audit trail if Stripe somehow
    // created a session before the error was raised.
    await db.update(userMembershipsTable).set({
      paymentStatus: "failed",
      notes: `Stripe Checkout session creation failed: ${(err as Error).message}`,
      updatedAt: new Date(),
    }).where(eq(userMembershipsTable.id, membership!.id));
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ───────────────────────────── NOWPayments: crypto checkout ─────────────────────────────

const CryptoCheckoutBody = z.object({
  tierId: z.number().int().positive(),
  billing: z.enum(["monthly", "annual"]).default("annual"),
  entityType: z.enum(["company", "individual"]).default("individual"),
  entityName: z.string().min(1).max(200),
  successPath: z.string().default("/membership?status=success"),
  cancelPath: z.string().default("/membership?status=cancelled"),
});

router.post("/me/membership/crypto/start", async (req, res) => {
  if (!isNowPaymentsConfigured()) { res.status(503).json({ error: "NOWPayments not configured" }); return; }
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CryptoCheckoutBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, parsed.data.tierId));
  if (!tier || !tier.active) { res.status(404).json({ error: "Tier not found or inactive" }); return; }
  const amountCents = parsed.data.billing === "annual" ? tier.annualPriceCents : tier.monthlyPriceCents;
  if (!amountCents || amountCents <= 0) { res.status(400).json({ error: "Tier has no price for the requested billing period" }); return; }

  const kyc = await checkKycForTier(auth.userId, tier.slug);
  if (!kyc.ok) {
    res.status(403).json({
      error: "KYC required",
      requiredKycLevel: kyc.requiredKycLevel,
      tierSlug: tier.slug,
      message: `This tier requires identity verification (${kyc.requiredKycLevel} level) before checkout.`,
      redirectTo: `/kyc?tierSlug=${tier.slug}&returnTo=/membership`,
    });
    return;
  }

  const userEmail = (req.headers["x-user-email"] as string | undefined) ?? null;
  const userName = (req.headers["x-user-name"] as string | undefined) ?? null;

  // Create the pending membership up front so the IPN webhook can match order_id → id.
  const [membership] = await db.insert(userMembershipsTable).values({
    userId: auth.userId,
    userEmail,
    userName,
    tierId: parsed.data.tierId,
    entityType: parsed.data.entityType,
    entityName: parsed.data.entityName,
    paymentMethod: "crypto",
    paymentAmountCents: amountCents,
    notes: `NOWPayments crypto checkout (${parsed.data.billing})`,
  }).returning();

  const origin = (req.headers.origin as string | undefined)
    ?? (req.headers.referer as string | undefined)?.replace(/\/[^/]*$/, "")
    ?? `${req.protocol}://${req.headers.host}`;

  const buildUrl = (pathWithQuery: string): string => {
    try {
      const u = new URL(pathWithQuery, origin);
      u.searchParams.set("membership", String(membership!.id));
      return u.toString();
    } catch {
      const sep = pathWithQuery.includes("?") ? "&" : "?";
      return `${origin}${pathWithQuery}${sep}membership=${membership!.id}`;
    }
  };

  const ipnCallbackUrl = `${origin.replace(/\/$/, "")}/api/payments/nowpayments/webhook`;

  try {
    const invoice = await createNowPaymentsInvoice({
      orderId: String(membership!.id),
      priceAmount: amountCents / 100,
      priceCurrency: "usd",
      orderDescription: `Capability Economics — ${tier.name} (${parsed.data.billing})`,
      ipnCallbackUrl,
      successUrl: buildUrl(parsed.data.successPath),
      cancelUrl: buildUrl(parsed.data.cancelPath),
    });

    // Store the NOWPayments invoice id for reconciliation
    await db.update(userMembershipsTable).set({
      paymentRef: invoice.invoiceId,
      updatedAt: new Date(),
    }).where(eq(userMembershipsTable.id, membership!.id));

    res.json({ invoiceUrl: invoice.invoiceUrl, invoiceId: invoice.invoiceId, membershipId: membership!.id });
  } catch (err) {
    await db.update(userMembershipsTable).set({
      paymentStatus: "failed",
      notes: `NOWPayments invoice create failed: ${(err as Error).message}`,
      updatedAt: new Date(),
    }).where(eq(userMembershipsTable.id, membership!.id));
    res.status(500).json({ error: "Failed to create crypto invoice" });
  }
});

// ───────────────────────────── Admin: payments review ─────────────────────────────

router.get("/admin/payments", requireAdmin, async (req, res) => {
  const statusFilter = (req.query.status as string | undefined) ?? "pending";
  const where = statusFilter === "all"
    ? undefined
    : eq(userMembershipsTable.status, statusFilter);
  const rows = await db
    .select()
    .from(userMembershipsTable)
    .where(where as any)
    .orderBy(desc(userMembershipsTable.requestedAt));
  const tiers = await db.select().from(membershipTiersTable);
  const tierMap = new Map(tiers.map(t => [t.id, t]));
  const enriched = rows.map(r => ({ ...r, tier: tierMap.get(r.tierId) ?? null }));
  res.json({ payments: enriched, total: enriched.length });
});

router.get("/admin/payments/summary", requireAdmin, async (_req, res) => {
  const all = await db.select().from(userMembershipsTable);
  const byStatus: Record<string, number> = { pending: 0, active: 0, rejected: 0, cancelled: 0 };
  const byPayment: Record<string, number> = { card: 0, invoice: 0, crypto: 0 };
  let pendingRevenueCents = 0;
  let activeRevenueCents = 0;
  for (const m of all) {
    byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
    byPayment[m.paymentMethod] = (byPayment[m.paymentMethod] ?? 0) + 1;
    if (m.status === "pending") pendingRevenueCents += m.paymentAmountCents ?? 0;
    if (m.status === "active" && m.paymentStatus === "paid") activeRevenueCents += m.paymentAmountCents ?? 0;
  }
  res.json({ total: all.length, byStatus, byPayment, pendingRevenueCents, activeRevenueCents });
});

router.post("/admin/payments/:id/approve", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  if (existing.status === "active") { res.status(409).json({ error: "Already active" }); return; }
  // requireAdmin already gated this route; keep the actor label simple and server-derived.
  const approver = "admin";
  await db.update(userMembershipsTable).set({
    status: "active",
    paymentStatus: "paid",
    approvedAt: new Date(),
    approvedBy: approver,
    updatedAt: new Date(),
  }).where(eq(userMembershipsTable.id, id));
  const [updated] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  await logAdminAction(req, {
    action: "membership.approve",
    targetType: "membership",
    targetId: id,
    details: { userId: existing.userId, tierId: existing.tierId, paymentMethod: existing.paymentMethod },
  });
  if (existing.userEmail) {
    const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, existing.tierId));
    void sendApprovalEmail({ to: existing.userEmail, name: existing.userName, tierName: tier?.name ?? "your" });
  }
  res.json({ membership: updated });
});

router.post("/admin/payments/:id/reject", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const reason = (req.body?.reason as string | undefined) ?? "No reason provided";
  const [existing] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  await db.update(userMembershipsTable).set({
    status: "rejected",
    paymentStatus: "rejected",
    rejectionReason: reason,
    updatedAt: new Date(),
  }).where(eq(userMembershipsTable.id, id));
  const [updated] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  await logAdminAction(req, {
    action: "membership.reject",
    targetType: "membership",
    targetId: id,
    details: { userId: existing.userId, tierId: existing.tierId, reason },
  });
  if (existing.userEmail) {
    const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, existing.tierId));
    void sendRejectionEmail({ to: existing.userEmail, name: existing.userName, tierName: tier?.name ?? "requested", reason });
  }
  res.json({ membership: updated });
});

// Admin can also comp a user directly
const CompBody = z.object({
  userId: z.string().min(1),
  userEmail: z.string().email().optional(),
  userName: z.string().optional(),
  tierId: z.number().int().positive(),
  entityType: z.enum(["company", "individual"]).default("individual"),
  entityName: z.string().min(1),
  notes: z.string().optional(),
});

router.post("/admin/payments/comp", requireAdmin, async (req, res) => {
  const parsed = CompBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [created] = await db.insert(userMembershipsTable).values({
    userId: parsed.data.userId,
    userEmail: parsed.data.userEmail ?? null,
    userName: parsed.data.userName ?? null,
    tierId: parsed.data.tierId,
    entityType: parsed.data.entityType,
    entityName: parsed.data.entityName,
    paymentMethod: "invoice",
    paymentRef: "COMP",
    notes: parsed.data.notes ?? "Comped by admin",
  }).returning();
  await db.update(userMembershipsTable).set({
    status: "active",
    paymentStatus: "comped",
    approvedAt: new Date(),
    approvedBy: "admin",
    updatedAt: new Date(),
  }).where(eq(userMembershipsTable.id, created!.id));
  const [final] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, created!.id));
  await logAdminAction(req, {
    action: "membership.comp",
    targetType: "membership",
    targetId: created!.id,
    details: { userId: parsed.data.userId, tierId: parsed.data.tierId, entityName: parsed.data.entityName, notes: parsed.data.notes },
  });
  if (parsed.data.userEmail) {
    const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, parsed.data.tierId));
    void sendCompEmail({ to: parsed.data.userEmail, name: parsed.data.userName, tierName: tier?.name ?? "a new", notes: parsed.data.notes });
  }
  res.status(201).json({ membership: final });
});

// ───────────────────────────── Admin: member detail & management ─────────────────────────────

/**
 * Full snapshot for a single user: every membership row they've ever had, the
 * credit account + recent transactions, and the current tier. Used by the
 * admin "member detail" drawer.
 */
router.get("/admin/members/:userId", requireAdmin, async (req, res) => {
  const userId = String(req.params.userId);
  if (!userId) { res.status(400).json({ error: "bad userId" }); return; }

  const memberships = await db
    .select()
    .from(userMembershipsTable)
    .where(eq(userMembershipsTable.userId, userId))
    .orderBy(desc(userMembershipsTable.requestedAt));

  const tiers = await db.select().from(membershipTiersTable);
  const tierMap = new Map(tiers.map(t => [t.id, t]));
  const enrichedMemberships = memberships.map(m => ({ ...m, tier: tierMap.get(m.tierId) ?? null }));

  const [creditAccount] = await db
    .select()
    .from(creditAccountsTable)
    .where(eq(creditAccountsTable.userId, userId));

  const transactions = await db
    .select()
    .from(creditTransactionsTable)
    .where(eq(creditTransactionsTable.userId, userId))
    .orderBy(desc(creditTransactionsTable.createdAt))
    .limit(50);

  const currentMembership = enrichedMemberships.find(m => m.status === "active") ?? enrichedMemberships[0] ?? null;

  res.json({
    userId,
    currentMembership,
    allMemberships: enrichedMemberships,
    creditAccount: creditAccount ?? null,
    transactions,
  });
});

const ChangeTierBody = z.object({
  tierId: z.number().int().positive(),
  syncCredits: z.boolean().default(true),
});

/**
 * Change the tier on an existing membership. If syncCredits is true (default)
 * the user's credit account monthlyAllocation + tierSlug are updated to match
 * the new tier. The first feature string on the tier is parsed for a
 * "N CEI credits/month" pattern to derive the allocation.
 */
router.post("/admin/memberships/:id/change-tier", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const parsed = ChangeTierBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const [existing] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  if (!existing) { res.status(404).json({ error: "not found" }); return; }

  const [newTier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, parsed.data.tierId));
  if (!newTier) { res.status(404).json({ error: "tier not found" }); return; }

  await db.update(userMembershipsTable).set({
    tierId: parsed.data.tierId,
    paymentAmountCents: newTier.annualPriceCents ?? newTier.monthlyPriceCents ?? existing.paymentAmountCents,
    notes: `${existing.notes ?? ""}\n[admin] Tier changed to ${newTier.name} at ${new Date().toISOString()}`.trim(),
    updatedAt: new Date(),
  }).where(eq(userMembershipsTable.id, id));

  if (parsed.data.syncCredits) {
    // Parse monthly allocation out of the tier's features. Format: "N CEI credits/month"
    const allocationFeature = (newTier.features as string[] | null)?.find(f => /credits?\/month/i.test(f));
    const allocationMatch = allocationFeature?.match(/([\d,]+)/);
    const allocation = allocationMatch ? Number(allocationMatch[1].replace(/,/g, "")) : 50;

    const [account] = await db
      .select()
      .from(creditAccountsTable)
      .where(eq(creditAccountsTable.userId, existing.userId));
    if (account) {
      await db.update(creditAccountsTable).set({
        monthlyAllocation: allocation,
        tierSlug: newTier.slug,
      }).where(eq(creditAccountsTable.userId, existing.userId));
    }
  }

  const [updated] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  await logAdminAction(req, {
    action: "membership.change_tier",
    targetType: "membership",
    targetId: id,
    details: { userId: existing.userId, fromTierId: existing.tierId, toTierId: parsed.data.tierId, toTierName: newTier.name, syncCredits: parsed.data.syncCredits },
  });
  if (existing.userEmail) {
    const [oldTier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, existing.tierId));
    void sendTierChangedEmail({ to: existing.userEmail, name: existing.userName, fromTier: oldTier?.name ?? "previous", toTier: newTier.name });
  }
  res.json({ membership: updated, tier: newTier });
});

/**
 * Put a membership on hold. We reuse the existing "cancelled" status — the
 * tier-gate middleware already treats cancelled as no-access, and we can flip
 * it back via /reactivate.
 */
router.post("/admin/memberships/:id/hold", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const reason = (req.body?.reason as string | undefined) ?? "Placed on hold by admin";
  const [existing] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  await db.update(userMembershipsTable).set({
    status: "cancelled",
    notes: `${existing.notes ?? ""}\n[admin] On hold: ${reason} (${new Date().toISOString()})`.trim(),
    updatedAt: new Date(),
  }).where(eq(userMembershipsTable.id, id));
  const [updated] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  await logAdminAction(req, {
    action: "membership.hold",
    targetType: "membership",
    targetId: id,
    details: { userId: existing.userId, reason },
  });
  if (existing.userEmail) {
    void sendHoldEmail({ to: existing.userEmail, name: existing.userName, reason });
  }
  res.json({ membership: updated });
});

router.post("/admin/memberships/:id/reactivate", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  await db.update(userMembershipsTable).set({
    status: "active",
    paymentStatus: existing.paymentStatus === "rejected" ? "paid" : existing.paymentStatus,
    approvedAt: existing.approvedAt ?? new Date(),
    approvedBy: existing.approvedBy ?? "admin",
    rejectionReason: null,
    notes: `${existing.notes ?? ""}\n[admin] Reactivated at ${new Date().toISOString()}`.trim(),
    updatedAt: new Date(),
  }).where(eq(userMembershipsTable.id, id));
  const [updated] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  await logAdminAction(req, {
    action: "membership.reactivate",
    targetType: "membership",
    targetId: id,
    details: { userId: existing.userId },
  });
  if (existing.userEmail) {
    const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, existing.tierId));
    void sendReactivatedEmail({ to: existing.userEmail, name: existing.userName, tierName: tier?.name ?? "your" });
  }
  res.json({ membership: updated });
});

const RefundBody = z.object({
  amountCents: z.number().int().positive().optional(),
  reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).default("requested_by_customer"),
});

/**
 * Issue a Stripe refund for a card-paid membership. Uses the stored paymentRef
 * as the PaymentIntent id. NOWPayments (crypto) refunds are not supported
 * through this endpoint — crypto refunds must be handled manually through the
 * NOWPayments dashboard.
 */
router.post("/admin/memberships/:id/refund", requireAdmin, async (req, res) => {
  if (!isStripeConfigured()) { res.status(503).json({ error: "Stripe not configured" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const parsed = RefundBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const [existing] = await db.select().from(userMembershipsTable).where(eq(userMembershipsTable.id, id));
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  if (existing.paymentMethod !== "card") {
    res.status(400).json({
      error: "Only Stripe (card) payments can be refunded through this endpoint",
      paymentMethod: existing.paymentMethod,
      hint: "For crypto refunds, use the NOWPayments dashboard.",
    });
    return;
  }
  if (!existing.paymentRef || !existing.paymentRef.startsWith("pi_")) {
    res.status(400).json({ error: "No Stripe PaymentIntent found on this membership", paymentRef: existing.paymentRef });
    return;
  }

  try {
    const refund = await refundPaymentIntent({
      paymentIntent: existing.paymentRef,
      amountCents: parsed.data.amountCents,
      reason: parsed.data.reason,
    });
    await db.update(userMembershipsTable).set({
      paymentStatus: "refunded",
      notes: `${existing.notes ?? ""}\n[admin] Refunded ${refund.amount != null ? `$${(refund.amount / 100).toFixed(2)}` : "full amount"} via Stripe (${refund.id}) at ${new Date().toISOString()}`.trim(),
      updatedAt: new Date(),
    }).where(eq(userMembershipsTable.id, id));

    await logAdminAction(req, {
      action: "membership.refund",
      targetType: "membership",
      targetId: id,
      details: { userId: existing.userId, stripeRefundId: refund.id, amount: refund.amount, reason: parsed.data.reason },
    });

    res.json({ refund: { id: refund.id, amount: refund.amount, status: refund.status } });
  } catch (err) {
    res.status(500).json({ error: "Refund failed", message: (err as Error).message });
  }
});

const GrantCreditsBody = z.object({
  amount: z.number().int().min(-100_000).max(1_000_000),
  description: z.string().min(1).max(500).default("Admin grant"),
});

router.post("/admin/members/:userId/credits/grant", requireAdmin, async (req, res) => {
  const userId = String(req.params.userId);
  if (!userId) { res.status(400).json({ error: "bad userId" }); return; }
  const parsed = GrantCreditsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  // Ensure credit account exists
  let [account] = await db.select().from(creditAccountsTable).where(eq(creditAccountsTable.userId, userId));
  if (!account) {
    [account] = await db.insert(creditAccountsTable).values({
      userId,
      balance: 0,
      monthlyAllocation: 50,
      tierSlug: "discovery",
    }).returning();
  }

  const newBalance = (account?.balance ?? 0) + parsed.data.amount;
  await db.update(creditAccountsTable)
    .set({ balance: newBalance })
    .where(eq(creditAccountsTable.userId, userId));

  await db.insert(creditTransactionsTable).values({
    userId,
    amount: parsed.data.amount,
    type: parsed.data.amount >= 0 ? "allocation" : "debit",
    description: `[admin] ${parsed.data.description}`,
    balanceAfter: newBalance,
  });

  await logAdminAction(req, {
    action: parsed.data.amount >= 0 ? "credits.grant" : "credits.deduct",
    targetType: "user",
    targetId: userId,
    details: { amount: parsed.data.amount, description: parsed.data.description, newBalance },
  });

  res.json({ balance: newBalance, granted: parsed.data.amount });
});

export default router;
