import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { membershipTiersTable, userMembershipsTable } from "@workspace/db";
import { asc, desc, eq, and } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAdmin } from "../middlewares/requireAdmin";
import { getAuth } from "@clerk/express";
import { createCheckoutSession, isStripeConfigured } from "../services/stripe";

const router: IRouter = Router();

const DEFAULT_TIERS = [
  {
    slug: "briefing",
    name: "Briefing",
    tagline: "Read the framework. See the data.",
    description:
      "For analysts, board members, and consultants who need the Capability Economics framework and the curated research without running their own studies.",
    monthlyPriceCents: 29900,
    annualPriceCents: 299000,
    isContactSales: false,
    priceLocked: false,
    displayOrder: 1,
    features: [
      "Read all 58 curated capabilities across 6 industries (Insurance, Healthcare, Banking, Manufacturing, Technology, Retail)",
      "Full 8-section detail per capability: summary, traditional view, economic view, AI exposure, playbook, sources, dependencies, role mappings",
      "Plain-English summary plus consequence-style economic narratives with named competitors and dollar figures",
      "Knowledge graph: force-directed view of cross-capability dependencies",
      "C-Suite perspectives by role across all 8 c-suite seats",
      "CEI Index: industry-level capability economic health scores",
      "Insights feed and case studies",
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
      "For operating executives doing internal strategy work — bring your own org, your own questions, and your own short list of capabilities into the framework.",
    monthlyPriceCents: 149900,
    annualPriceCents: 1499000,
    isContactSales: false,
    priceLocked: false,
    displayOrder: 2,
    features: [
      "Everything in Briefing",
      "All 10 CE Alpha tabs: EVaR, Cascade, Narrative Δ, Moat, Fragility, Arbitrage, Flows, Talent, M&A Twin, Thesis",
      "VCE: Value Chain Economics view with capital and data flows",
      "Run your own assessments — voice, document, or job posting in; structured analysis out",
      "Build and save an organization profile",
      "Project workspace for tracking strategic bets against capabilities",
      "Submit up to 10 custom capabilities per month into the review queue",
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
      "For PE firms, large enterprise strategy teams, and consulting firms who need bespoke industry coverage and full review-queue control.",
    monthlyPriceCents: null,
    annualPriceCents: 2500000,
    isContactSales: true,
    priceLocked: true,
    displayOrder: 3,
    features: [
      "Everything in Workbench, with no caps on submissions",
      "Autonomous discovery agent: generate capability research for any industry you ask for, using live Perplexity research and GLM-5.1 synthesis",
      "Full review-queue admin: approve, reject-with-comment (re-enriches against your feedback), or terminate",
      "Custom industries beyond the 6 included verticals",
      "Persistent agent memory: the system remembers prior research patterns across runs",
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
  res.status(201).json({ membership: final });
});

export default router;
