import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  billingOrganizationsTable,
  billingOrgMembersTable,
  billingOrgInvitesTable,
  membershipTiersTable,
  userPersonasTable,
  PERSONA_SLUGS,
  type PersonaSlug,
} from "@workspace/db";
import { and, asc, desc, eq, isNull, gt } from "drizzle-orm";
import { z } from "zod/v4";
import { getAuth } from "@clerk/express";
import { sendOrgInviteEmail } from "../services/email";
import { logger } from "../lib/logger";
import { createOrgCheckoutSession, updateOrgSubscriptionSeats, createBillingPortalSession, cancelSubscription, isStripeConfigured } from "../services/stripe";

const router: IRouter = Router();

const INVITE_TTL_DAYS = 7;

/**
 * When the org has an active Stripe subscription, keep the quantity on
 * Stripe in sync with the current active member count. Fire-and-forget —
 * a Stripe outage must not fail the underlying invite/accept/remove flow.
 */
async function syncOrgStripeSeats(orgId: number): Promise<void> {
  try {
    const [org] = await db.select().from(billingOrganizationsTable).where(eq(billingOrganizationsTable.id, orgId));
    if (!org?.stripeSubscriptionId) return;
    const members = await db.select().from(billingOrgMembersTable).where(eq(billingOrgMembersTable.orgId, orgId));
    await updateOrgSubscriptionSeats(org.stripeSubscriptionId, Math.max(1, members.length));
  } catch (err) {
    logger.warn({ err, orgId }, "[billing-orgs] failed to sync Stripe seat quantity");
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || `org-${Date.now()}`;
}

/**
 * Helpers for authorizing org actions. "role" is the caller's role in that org.
 * Owner ⊃ admin ⊃ member.
 */
async function requireOrgRole(userId: string, orgId: number, minRole: "owner" | "admin" | "member"): Promise<{ role: string } | null> {
  const [m] = await db.select().from(billingOrgMembersTable).where(and(
    eq(billingOrgMembersTable.orgId, orgId),
    eq(billingOrgMembersTable.userId, userId),
  )).limit(1);
  if (!m) return null;
  const rank = (r: string) => r === "owner" ? 2 : r === "admin" ? 1 : 0;
  if (rank(m.role) < rank(minRole)) return null;
  return { role: m.role };
}

// ───────────────────── Create an org ─────────────────────

const CreateOrgBody = z.object({
  name: z.string().min(2).max(120),
  tierId: z.number().int().positive().optional(),
  seatLimit: z.number().int().min(1).max(500).default(5),
});

router.post("/billing-orgs", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CreateOrgBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const ownerEmail = (req.headers["x-user-email"] as string | undefined) ?? null;

  // Unique slug — append a short suffix if collision.
  let slug = slugify(parsed.data.name);
  for (let i = 0; i < 5; i++) {
    const [existing] = await db.select().from(billingOrganizationsTable).where(eq(billingOrganizationsTable.slug, slug)).limit(1);
    if (!existing) break;
    slug = `${slugify(parsed.data.name)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const [created] = await db.insert(billingOrganizationsTable).values({
    name: parsed.data.name,
    slug,
    ownerUserId: auth.userId,
    ownerEmail,
    tierId: parsed.data.tierId ?? null,
    seatLimit: parsed.data.seatLimit,
  }).returning();

  await db.insert(billingOrgMembersTable).values({
    orgId: created!.id,
    userId: auth.userId,
    email: ownerEmail,
    role: "owner",
    invitedBy: auth.userId,
  });

  res.status(201).json({ organization: created });
});

// ───────────────────── Org-level Stripe subscription (per-seat) ─────────────────────

const OrgCheckoutBody = z.object({
  tierId: z.number().int().positive(),
  billing: z.enum(["monthly", "annual"]).default("annual"),
  successPath: z.string().default("/account?status=success"),
  cancelPath: z.string().default("/account?status=cancelled"),
});

router.post("/billing-orgs/:id/checkout", async (req, res) => {
  if (!isStripeConfigured()) { res.status(503).json({ error: "Stripe not configured" }); return; }
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "bad id" }); return; }

  // Only the owner can purchase a team subscription. Admins can't create org charges.
  const role = await requireOrgRole(auth.userId, orgId, "owner");
  if (!role) { res.status(403).json({ error: "Forbidden — only the owner can subscribe" }); return; }

  const parsed = OrgCheckoutBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const [org] = await db.select().from(billingOrganizationsTable).where(eq(billingOrganizationsTable.id, orgId));
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }

  const [tier] = await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, parsed.data.tierId));
  if (!tier || !tier.active) { res.status(404).json({ error: "Tier not found or inactive" }); return; }
  // Team subscriptions use seatPriceCents when the tier sets an explicit team
  // price; otherwise fall back to the per-period individual price.
  const perSeat = parsed.data.billing === "annual"
    ? (tier.seatPriceCents ?? tier.annualPriceCents)
    : tier.monthlyPriceCents;
  if (!perSeat || perSeat <= 0) { res.status(400).json({ error: "Tier has no price for this billing period" }); return; }

  // seatLimit == seat count we bill for. Owner-only: the owner can adjust
  // seatLimit (e.g. to buy more seats) via PATCH /billing-orgs/:id before checkout.
  const seats = org.seatLimit;
  const userEmail = (req.headers["x-user-email"] as string | undefined) ?? org.ownerEmail ?? undefined;
  const origin = (req.headers.origin as string | undefined)
    ?? (req.headers.referer as string | undefined)?.replace(/\/[^/]*$/, "")
    ?? `${req.protocol}://${req.headers.host}`;
  const buildUrl = (p: string): string => {
    try { const u = new URL(p, origin); u.searchParams.set("org", String(orgId)); return u.toString(); }
    catch { const sep = p.includes("?") ? "&" : "?"; return `${origin}${p}${sep}org=${orgId}`; }
  };

  try {
    // Stage the tier on the org up front (webhook activates status on payment).
    await db.update(billingOrganizationsTable).set({
      tierId: parsed.data.tierId,
      status: "pending",
      updatedAt: new Date(),
    }).where(eq(billingOrganizationsTable.id, orgId));

    const session = await createOrgCheckoutSession({
      orgId,
      orgName: org.name,
      tierName: tier.name,
      tierSlug: tier.slug,
      perSeatPriceCents: perSeat,
      seats,
      billingPeriod: parsed.data.billing,
      customerEmail: userEmail,
      existingCustomerId: org.stripeCustomerId ?? undefined,
      successUrl: buildUrl(parsed.data.successPath),
      cancelUrl: buildUrl(parsed.data.cancelPath),
    });
    res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    logger.error({ err, orgId }, "[billing-orgs] checkout failed");
    res.status(500).json({ error: "Failed to create checkout session", message: (err as Error).message });
  }
});

const UpdateSeatLimitBody = z.object({ seatLimit: z.number().int().min(1).max(500) });

/** Owner can change seatLimit. If there's an active subscription, syncs to Stripe. */
router.patch("/billing-orgs/:id/seats", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "bad id" }); return; }
  const role = await requireOrgRole(auth.userId, orgId, "owner");
  if (!role) { res.status(403).json({ error: "Forbidden — owner only" }); return; }
  const parsed = UpdateSeatLimitBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const [org] = await db.select().from(billingOrganizationsTable).where(eq(billingOrganizationsTable.id, orgId));
  if (!org) { res.status(404).json({ error: "Org not found" }); return; }

  // Don't let seatLimit shrink below current member count — that would orphan members.
  const members = await db.select().from(billingOrgMembersTable).where(eq(billingOrgMembersTable.orgId, orgId));
  if (parsed.data.seatLimit < members.length) {
    res.status(400).json({ error: `Cannot shrink below current member count (${members.length}). Remove members first.` });
    return;
  }

  await db.update(billingOrganizationsTable).set({
    seatLimit: parsed.data.seatLimit,
    updatedAt: new Date(),
  }).where(eq(billingOrganizationsTable.id, orgId));

  // If there's a live subscription, sync the quantity to Stripe (prorated).
  if (org.stripeSubscriptionId) {
    try {
      await updateOrgSubscriptionSeats(org.stripeSubscriptionId, parsed.data.seatLimit);
    } catch (err) {
      logger.warn({ err, orgId }, "[billing-orgs] failed to sync seats to Stripe");
      // Non-fatal — our DB reflects the intent, reconciliation can happen later.
    }
  }

  res.json({ ok: true, seatLimit: parsed.data.seatLimit });
});

/**
 * Set the org's default persona — applied to new users at invite-acceptance
 * time. Existing members are not retroactively switched. Pass slug=null to
 * clear (then new invitees see the regular onboarding picker).
 */
router.patch("/billing-orgs/:id/default-persona", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "bad id" }); return; }
  const role = await requireOrgRole(auth.userId, orgId, "admin");
  if (!role) { res.status(403).json({ error: "Forbidden — admin or owner only" }); return; }

  const slug = (req.body as { slug?: unknown } | null)?.slug;
  if (slug !== null && !(typeof slug === "string" && (PERSONA_SLUGS as readonly string[]).includes(slug))) {
    res.status(400).json({ error: "Invalid slug — must be one of PERSONA_SLUGS or null", validSlugs: PERSONA_SLUGS });
    return;
  }

  await db.update(billingOrganizationsTable).set({
    defaultPersonaSlug: slug as string | null,
    updatedAt: new Date(),
  }).where(eq(billingOrganizationsTable.id, orgId));

  res.json({ ok: true, defaultPersonaSlug: slug });
});

/** Owner can cancel the org subscription. */
router.post("/billing-orgs/:id/cancel-subscription", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "bad id" }); return; }
  const role = await requireOrgRole(auth.userId, orgId, "owner");
  if (!role) { res.status(403).json({ error: "Forbidden — owner only" }); return; }
  const atPeriodEnd = req.body?.atPeriodEnd === true;

  const [org] = await db.select().from(billingOrganizationsTable).where(eq(billingOrganizationsTable.id, orgId));
  if (!org?.stripeSubscriptionId) { res.status(404).json({ error: "No active subscription for this org" }); return; }

  try {
    await cancelSubscription(org.stripeSubscriptionId, { atPeriodEnd });
    // Webhook customer.subscription.(updated|deleted) will flip status definitively.
    res.json({ ok: true, atPeriodEnd });
  } catch (err) {
    res.status(500).json({ error: "Cancel failed", message: (err as Error).message });
  }
});

/** Owner can open Stripe's Customer Portal to manage card, invoices, etc. */
router.post("/billing-orgs/:id/billing-portal", async (req, res) => {
  if (!isStripeConfigured()) { res.status(503).json({ error: "Stripe not configured" }); return; }
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "bad id" }); return; }
  const role = await requireOrgRole(auth.userId, orgId, "owner");
  if (!role) { res.status(403).json({ error: "Forbidden — owner only" }); return; }

  const [org] = await db.select().from(billingOrganizationsTable).where(eq(billingOrganizationsTable.id, orgId));
  if (!org?.stripeCustomerId) { res.status(404).json({ error: "No Stripe customer for this org yet" }); return; }

  const origin = (req.headers.origin as string | undefined)
    ?? (req.headers.referer as string | undefined)?.replace(/\/[^/]*$/, "")
    ?? `${req.protocol}://${req.headers.host}`;

  try {
    const portal = await createBillingPortalSession({
      customerId: org.stripeCustomerId,
      returnUrl: `${origin.replace(/\/$/, "")}/account`,
    });
    res.json({ url: portal.url });
  } catch (err) {
    res.status(500).json({ error: "Portal session failed", message: (err as Error).message });
  }
});

// ───────────────────── List / detail ─────────────────────

router.get("/billing-orgs/mine", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db
    .select({
      org: billingOrganizationsTable,
      role: billingOrgMembersTable.role,
      joinedAt: billingOrgMembersTable.joinedAt,
    })
    .from(billingOrgMembersTable)
    .innerJoin(billingOrganizationsTable, eq(billingOrgMembersTable.orgId, billingOrganizationsTable.id))
    .where(eq(billingOrgMembersTable.userId, auth.userId))
    .orderBy(desc(billingOrgMembersTable.joinedAt));
  res.json({ organizations: rows });
});

router.get("/billing-orgs/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "bad id" }); return; }
  const role = await requireOrgRole(auth.userId, orgId, "member");
  if (!role) { res.status(403).json({ error: "Forbidden" }); return; }

  const [org] = await db.select().from(billingOrganizationsTable).where(eq(billingOrganizationsTable.id, orgId));
  const members = await db.select().from(billingOrgMembersTable).where(eq(billingOrgMembersTable.orgId, orgId)).orderBy(asc(billingOrgMembersTable.joinedAt));
  const invites = await db.select().from(billingOrgInvitesTable).where(and(
    eq(billingOrgInvitesTable.orgId, orgId),
    isNull(billingOrgInvitesTable.acceptedAt),
    gt(billingOrgInvitesTable.expiresAt, new Date()),
  )).orderBy(desc(billingOrgInvitesTable.createdAt));
  const [tier] = org?.tierId
    ? await db.select().from(membershipTiersTable).where(eq(membershipTiersTable.id, org.tierId))
    : [null];
  res.json({ organization: org, tier: tier ?? null, members, pendingInvites: invites, callerRole: role.role });
});

// ───────────────────── Invite flow ─────────────────────

const InviteBody = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
});

router.post("/billing-orgs/:id/invites", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "bad id" }); return; }
  const role = await requireOrgRole(auth.userId, orgId, "admin");
  if (!role) { res.status(403).json({ error: "Forbidden — admin or owner required" }); return; }
  const parsed = InviteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  // Seat count + insert in one transaction to close the race window where two
  // concurrent invites could both pass the check.
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  let invite: typeof billingOrgInvitesTable.$inferSelect | undefined;
  try {
    await db.transaction(async (tx) => {
      // SELECT ... FOR UPDATE serializes seat counting against concurrent accepts/invites.
      const [org] = await tx.select().from(billingOrganizationsTable).where(eq(billingOrganizationsTable.id, orgId)).for("update");
      if (!org) throw Object.assign(new Error("Org no longer exists"), { statusCode: 404 });

      const members = await tx.select().from(billingOrgMembersTable).where(eq(billingOrgMembersTable.orgId, orgId));
      const pending = await tx.select().from(billingOrgInvitesTable).where(and(
        eq(billingOrgInvitesTable.orgId, orgId),
        isNull(billingOrgInvitesTable.acceptedAt),
        gt(billingOrgInvitesTable.expiresAt, new Date()),
      ));
      if (members.length + pending.length >= org.seatLimit) {
        throw Object.assign(new Error("Seat limit reached"), {
          statusCode: 402,
          seatLimit: org.seatLimit,
          current: members.length + pending.length,
        });
      }
      if (members.find(m => m.email?.toLowerCase() === parsed.data.email.toLowerCase())) {
        throw Object.assign(new Error("Email is already a member"), { statusCode: 409 });
      }

      const [inserted] = await tx.insert(billingOrgInvitesTable).values({
        orgId,
        email: parsed.data.email,
        token,
        role: parsed.data.role,
        invitedBy: auth.userId,
        expiresAt,
      }).returning();
      invite = inserted;
    });
  } catch (err) {
    const e = err as { statusCode?: number; message?: string; seatLimit?: number; current?: number };
    if (e.statusCode) { res.status(e.statusCode).json({ error: e.message, seatLimit: e.seatLimit, current: e.current }); return; }
    throw err;
  }

  if (!invite) { res.status(500).json({ error: "Insert failed" }); return; }

  const [org] = await db.select().from(billingOrganizationsTable).where(eq(billingOrganizationsTable.id, orgId));
  if (!org) { res.status(404).json({ error: "org disappeared" }); return; }

  const origin = (req.headers.origin as string | undefined)
    ?? (req.headers.referer as string | undefined)?.replace(/\/[^/]*$/, "")
    ?? `${req.protocol}://${req.headers.host}`;
  const acceptUrl = `${origin.replace(/\/$/, "")}/accept-invite?token=${encodeURIComponent(token)}`;

  void sendOrgInviteEmail({
    to: parsed.data.email,
    orgName: org.name,
    inviterName: (req.headers["x-user-name"] as string | undefined) ?? null,
    acceptUrl,
  });

  res.status(201).json({ invite, acceptUrl });
});

router.delete("/billing-orgs/:id/invites/:inviteId", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = Number(req.params.id);
  const inviteId = Number(req.params.inviteId);
  if (!Number.isFinite(orgId) || !Number.isFinite(inviteId)) { res.status(400).json({ error: "bad ids" }); return; }
  const role = await requireOrgRole(auth.userId, orgId, "admin");
  if (!role) { res.status(403).json({ error: "Forbidden" }); return; }
  const result = await db.delete(billingOrgInvitesTable).where(and(
    eq(billingOrgInvitesTable.id, inviteId),
    eq(billingOrgInvitesTable.orgId, orgId),
  )).returning({ id: billingOrgInvitesTable.id });
  if (result.length === 0) { res.status(404).json({ error: "not found" }); return; }
  res.json({ ok: true });
});

const AcceptBody = z.object({ token: z.string().min(1) });

router.post("/billing-orgs/accept-invite", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = AcceptBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const [invite] = await db.select().from(billingOrgInvitesTable).where(eq(billingOrgInvitesTable.token, parsed.data.token)).limit(1);
  if (!invite) { res.status(404).json({ error: "Invite not found" }); return; }
  if (invite.acceptedAt) { res.status(409).json({ error: "Invite already accepted" }); return; }
  if (invite.expiresAt < new Date()) { res.status(410).json({ error: "Invite expired" }); return; }

  const userEmail = (req.headers["x-user-email"] as string | undefined) ?? null;

  // Idempotency: if the user is already a member of this org, just mark the invite accepted.
  const [existing] = await db.select().from(billingOrgMembersTable).where(and(
    eq(billingOrgMembersTable.orgId, invite.orgId),
    eq(billingOrgMembersTable.userId, auth.userId),
  )).limit(1);

  let orgDefaultPersona: string | null = null;

  if (!existing) {
    // Seat-check + member insert atomically so two concurrent accept calls can't both succeed.
    try {
      await db.transaction(async (tx) => {
        const [org] = await tx.select().from(billingOrganizationsTable).where(eq(billingOrganizationsTable.id, invite.orgId)).for("update");
        if (!org) throw Object.assign(new Error("Org no longer exists"), { statusCode: 404 });
        orgDefaultPersona = org.defaultPersonaSlug ?? null;
        const members = await tx.select().from(billingOrgMembersTable).where(eq(billingOrgMembersTable.orgId, invite.orgId));
        if (members.length >= org.seatLimit) {
          throw Object.assign(new Error("Seat limit reached — cannot accept invite"), { statusCode: 402 });
        }
        await tx.insert(billingOrgMembersTable).values({
          orgId: invite.orgId,
          userId: auth.userId,
          email: userEmail ?? invite.email,
          role: invite.role,
          invitedBy: invite.invitedBy,
        });
      });
    } catch (err) {
      const e = err as { statusCode?: number; message?: string };
      if (e.statusCode) { res.status(e.statusCode).json({ error: e.message }); return; }
      throw err;
    }
  } else {
    // User already a member — pull org's default persona for the application step below.
    const [org] = await db.select().from(billingOrganizationsTable).where(eq(billingOrganizationsTable.id, invite.orgId)).limit(1);
    orgDefaultPersona = org?.defaultPersonaSlug ?? null;
  }

  // Apply the org's default persona to this user, but only if they haven't
  // already chosen one. Existing explicit picks are never overwritten.
  if (orgDefaultPersona && (PERSONA_SLUGS as readonly string[]).includes(orgDefaultPersona)) {
    const [existingPersona] = await db.select().from(userPersonasTable).where(eq(userPersonasTable.userId, auth.userId)).limit(1);
    if (!existingPersona) {
      await db.insert(userPersonasTable).values({
        userId: auth.userId,
        activePersonaSlug: orgDefaultPersona as PersonaSlug,
      });
    }
  }

  await db.update(billingOrgInvitesTable).set({
    acceptedAt: new Date(),
    acceptedByUserId: auth.userId,
  }).where(eq(billingOrgInvitesTable.id, invite.id));

  void syncOrgStripeSeats(invite.orgId);
  res.json({ ok: true, orgId: invite.orgId, appliedDefaultPersona: orgDefaultPersona });
});

const TransferOwnershipBody = z.object({
  toUserId: z.string().min(1),
});

router.post("/billing-orgs/:id/transfer-ownership", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = Number(req.params.id);
  if (!Number.isFinite(orgId)) { res.status(400).json({ error: "bad id" }); return; }

  // Only the current owner can transfer ownership.
  const callerRole = await requireOrgRole(auth.userId, orgId, "owner");
  if (!callerRole) { res.status(403).json({ error: "Forbidden — only the owner can transfer ownership" }); return; }

  const parsed = TransferOwnershipBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  if (parsed.data.toUserId === auth.userId) { res.status(400).json({ error: "You are already the owner" }); return; }

  const [target] = await db.select().from(billingOrgMembersTable).where(and(
    eq(billingOrgMembersTable.orgId, orgId),
    eq(billingOrgMembersTable.userId, parsed.data.toUserId),
  ));
  if (!target) { res.status(404).json({ error: "Target user is not a member of this org" }); return; }

  // Transfer: promote target to owner, demote old owner to admin, update the org's ownerUserId.
  await db.transaction(async (tx) => {
    await tx.update(billingOrgMembersTable).set({ role: "admin" }).where(and(
      eq(billingOrgMembersTable.orgId, orgId),
      eq(billingOrgMembersTable.userId, auth.userId),
    ));
    await tx.update(billingOrgMembersTable).set({ role: "owner" }).where(and(
      eq(billingOrgMembersTable.orgId, orgId),
      eq(billingOrgMembersTable.userId, parsed.data.toUserId),
    ));
    await tx.update(billingOrganizationsTable).set({
      ownerUserId: parsed.data.toUserId,
      ownerEmail: target.email,
      updatedAt: new Date(),
    }).where(eq(billingOrganizationsTable.id, orgId));
  });

  logger.info({ orgId, fromUserId: auth.userId, toUserId: parsed.data.toUserId }, "[billing-orgs] ownership transferred");
  res.json({ ok: true });
});

router.delete("/billing-orgs/:id/members/:userId", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const orgId = Number(req.params.id);
  const targetUserId = String(req.params.userId);
  if (!Number.isFinite(orgId) || !targetUserId) { res.status(400).json({ error: "bad params" }); return; }

  // Owners can remove anyone (except themselves via this endpoint); admins can remove members.
  const callerRole = await requireOrgRole(auth.userId, orgId, "admin");
  if (!callerRole) { res.status(403).json({ error: "Forbidden" }); return; }

  const [target] = await db.select().from(billingOrgMembersTable).where(and(
    eq(billingOrgMembersTable.orgId, orgId),
    eq(billingOrgMembersTable.userId, targetUserId),
  )).limit(1);
  if (!target) { res.status(404).json({ error: "not a member" }); return; }

  if (target.role === "owner") {
    res.status(400).json({ error: "Cannot remove the owner. Transfer ownership first." });
    return;
  }
  if (callerRole.role === "admin" && target.role === "admin") {
    res.status(403).json({ error: "Admins cannot remove other admins; owner must act." });
    return;
  }

  await db.delete(billingOrgMembersTable).where(and(
    eq(billingOrgMembersTable.orgId, orgId),
    eq(billingOrgMembersTable.userId, targetUserId),
  ));

  void syncOrgStripeSeats(orgId);
  logger.info({ orgId, targetUserId, by: auth.userId }, "[billing-orgs] member removed");
  res.json({ ok: true });
});

export default router;
