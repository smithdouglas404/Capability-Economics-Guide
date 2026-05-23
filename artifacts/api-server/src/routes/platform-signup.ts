import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { platformSignupRequestsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { randomBytes } from "node:crypto";
import { requireAdmin } from "../middlewares/requireAdmin";
import { getAuth } from "@clerk/express";

const router: IRouter = Router();

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().min(1).max(120),
  organization: z.string().trim().min(1).max(160),
  message: z.string().trim().max(2000).optional().nullable(),
  tierSlug: z.string().trim().min(1).max(40).optional().default("platform"),
});

// Public: create a new platform signup request
router.post("/platform-signup/request", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", issues: parsed.error.issues });
  }
  const { email, name, organization, message } = parsed.data;

  // Dedup: if there's already a pending or approved request for this email, return it.
  const existing = await db
    .select()
    .from(platformSignupRequestsTable)
    .where(eq(platformSignupRequestsTable.email, email))
    .orderBy(desc(platformSignupRequestsTable.requestedAt))
    .limit(1);

  if (existing[0] && existing[0].status !== "rejected") {
    return res.json({
      ok: true,
      alreadyExists: true,
      status: existing[0].status,
      message:
        existing[0].status === "approved"
          ? "Your request was already approved. Check your email for the signup link, or contact us if you can't find it."
          : "We already have your request — an admin will reach out shortly.",
    });
  }

  const [row] = await db
    .insert(platformSignupRequestsTable)
    .values({ email, name, organization, message: message ?? null })
    .returning({ id: platformSignupRequestsTable.id });

  return res.status(201).json({ ok: true, id: row?.id, status: "pending" });
});

// Public: verify an invite token, return prefill data for the signup form.
router.get("/platform-signup/verify/:token", async (req, res) => {
  const token = String(req.params.token ?? "").trim();
  if (!token) return res.status(400).json({ error: "Token required" });

  const [row] = await db
    .select()
    .from(platformSignupRequestsTable)
    .where(eq(platformSignupRequestsTable.inviteToken, token))
    .limit(1);

  if (!row) return res.status(404).json({ error: "Invite not found" });
  if (row.status !== "approved") return res.status(403).json({ error: "Invite is not active" });
  if (row.inviteTokenExpiresAt && row.inviteTokenExpiresAt.getTime() < Date.now()) {
    return res.status(410).json({ error: "Invite has expired" });
  }
  if (row.completedSignupAt) {
    return res.status(409).json({ error: "Invite has already been used" });
  }

  return res.json({
    ok: true,
    email: row.email,
    name: row.name,
    organization: row.organization,
  });
});

// Authenticated: mark an invite as consumed once the user finishes Clerk signup.
// The frontend calls this after Clerk reports a successful signUp.create — KYC still
// gates checkout downstream, so the invite is just the "you're allowed to register"
// pass, not a tier grant.
router.post("/platform-signup/consume", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) return res.status(401).json({ error: "Not signed in" });
  const token = String((req.body as { token?: string })?.token ?? "").trim();
  if (!token) return res.status(400).json({ error: "Token required" });

  const [row] = await db
    .select()
    .from(platformSignupRequestsTable)
    .where(eq(platformSignupRequestsTable.inviteToken, token))
    .limit(1);
  if (!row) return res.status(404).json({ error: "Invite not found" });
  if (row.status !== "approved") return res.status(403).json({ error: "Invite is not active" });
  if (row.completedSignupAt) return res.status(409).json({ error: "Invite has already been used" });

  await db
    .update(platformSignupRequestsTable)
    .set({ completedSignupAt: new Date(), completedSignupUserId: auth.userId })
    .where(eq(platformSignupRequestsTable.id, row.id));

  return res.json({ ok: true });
});

// Admin: list signup requests, newest first. ?status=pending|approved|rejected to filter.
router.get("/admin/platform-signups", requireAdmin, async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const rows = await db
    .select()
    .from(platformSignupRequestsTable)
    .where(status ? eq(platformSignupRequestsTable.status, status) : undefined)
    .orderBy(desc(platformSignupRequestsTable.requestedAt))
    .limit(500);
  return res.json(rows);
});

// Admin: pending count (used for the badge on the admin home).
router.get("/admin/platform-signups/pending-count", requireAdmin, async (_req, res) => {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(platformSignupRequestsTable)
    .where(eq(platformSignupRequestsTable.status, "pending"));
  return res.json({ count: Number(row?.count ?? 0) });
});

// Admin: approve a request — generates a single-use invite token (14-day expiry).
router.post("/admin/platform-signups/:id/approve", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  const auth = getAuth(req);
  const inviteToken = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const [row] = await db
    .update(platformSignupRequestsTable)
    .set({
      status: "approved",
      inviteToken,
      inviteTokenExpiresAt: expiresAt,
      decidedAt: new Date(),
      decidedBy: auth.userId ?? "admin",
      rejectionReason: null,
    })
    .where(and(eq(platformSignupRequestsTable.id, id), eq(platformSignupRequestsTable.status, "pending")))
    .returning();

  if (!row) return res.status(409).json({ error: "Request is not pending (already decided?)" });
  return res.json({ ok: true, id: row.id, inviteToken: row.inviteToken, expiresAt: row.inviteTokenExpiresAt });
});

// Admin: reject a request.
router.post("/admin/platform-signups/:id/reject", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });

  const reason = String((req.body as { reason?: string })?.reason ?? "").trim().slice(0, 500) || null;
  const auth = getAuth(req);

  const [row] = await db
    .update(platformSignupRequestsTable)
    .set({
      status: "rejected",
      rejectionReason: reason,
      decidedAt: new Date(),
      decidedBy: auth.userId ?? "admin",
      inviteToken: null,
      inviteTokenExpiresAt: null,
    })
    .where(and(eq(platformSignupRequestsTable.id, id), eq(platformSignupRequestsTable.status, "pending")))
    .returning();

  if (!row) return res.status(409).json({ error: "Request is not pending (already decided?)" });
  return res.json({ ok: true });
});

export default router;
