import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  billingOrganizationsTable,
  billingOrgMembersTable,
  billingOrgInvitesTable,
  membershipTiersTable,
} from "@workspace/db";
import { and, asc, desc, eq, isNull, gt, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { getAuth } from "@clerk/express";
import { sendOrgInviteEmail } from "../services/email";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const INVITE_TTL_DAYS = 7;

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
      const [org] = await tx.execute(
        sql`SELECT * FROM ${billingOrganizationsTable} WHERE id = ${orgId} FOR UPDATE`,
      ) as unknown as (typeof billingOrganizationsTable.$inferSelect)[];
      if (!org) throw Object.assign(new Error("not found"), { statusCode: 404 });

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

  if (!existing) {
    // Seat-check + member insert atomically so two concurrent accept calls can't both succeed.
    try {
      await db.transaction(async (tx) => {
        const [org] = await tx.execute(
          sql`SELECT * FROM ${billingOrganizationsTable} WHERE id = ${invite.orgId} FOR UPDATE`,
        ) as unknown as (typeof billingOrganizationsTable.$inferSelect)[];
        if (!org) throw Object.assign(new Error("Org no longer exists"), { statusCode: 404 });
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
  }

  await db.update(billingOrgInvitesTable).set({
    acceptedAt: new Date(),
    acceptedByUserId: auth.userId,
  }).where(eq(billingOrgInvitesTable.id, invite.id));

  res.json({ ok: true, orgId: invite.orgId });
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

  logger.info({ orgId, targetUserId, by: auth.userId }, "[billing-orgs] member removed");
  res.json({ ok: true });
});

export default router;
