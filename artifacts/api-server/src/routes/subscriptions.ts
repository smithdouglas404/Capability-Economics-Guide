import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { z } from "zod/v4";
import {
  createSubscription,
  listUserSubscriptions,
  deleteSubscription,
  setSubscriptionActive,
  recentDeliveries,
  sendDailyDigests,
} from "../services/subscriptions";
import { db } from "@workspace/db";
import {
  userMembershipsTable,
  membershipTiersTable,
  billingOrgMembersTable,
  billingOrganizationsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { isClerkAdmin, requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

/**
 * Slack/webhook channels are Platform-tier only. Email works for every tier.
 * Mirrors the rank logic in middlewares/requireTier.ts (kept inline so this
 * route module has zero coupling to that middleware's auth response shape).
 */
async function userIsPlatformTier(userId: string): Promise<boolean> {
  if (await isClerkAdmin(userId)) return true;
  const [personal, orgs] = await Promise.all([
    db.select({ slug: membershipTiersTable.slug })
      .from(userMembershipsTable)
      .innerJoin(membershipTiersTable, eq(userMembershipsTable.tierId, membershipTiersTable.id))
      .where(and(eq(userMembershipsTable.userId, userId), eq(userMembershipsTable.status, "active"))),
    db.select({ slug: membershipTiersTable.slug })
      .from(billingOrgMembersTable)
      .innerJoin(billingOrganizationsTable, eq(billingOrgMembersTable.orgId, billingOrganizationsTable.id))
      .innerJoin(membershipTiersTable, eq(billingOrganizationsTable.tierId, membershipTiersTable.id))
      .where(and(eq(billingOrgMembersTable.userId, userId), eq(billingOrganizationsTable.status, "active"))),
  ]);
  const slugs = [...personal, ...orgs].map(r => r.slug);
  return slugs.includes("platform");
}

function getUserId(req: Parameters<typeof getAuth>[0]): string | null {
  if (process.env.ADMIN_AUTH_BYPASS === "1") return getAuth(req)?.userId ?? "dev-admin";
  return getAuth(req)?.userId ?? null;
}

router.get("/me/subscriptions", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const subs = await listUserSubscriptions(userId);
  res.json({ subscriptions: subs });
});

router.get("/me/notifications/recent", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const deliveries = await recentDeliveries(userId, 50);
  res.json({ deliveries });
});

// Per-targetType condition shapes — keep these strict so malformed
// subscriptions are rejected at create time instead of silently never firing.
const condCapThreshold = z.object({
  capabilityId: z.number().int().positive(),
  direction: z.enum(["above", "below"]),
  threshold: z.number(),
});
const condLifecycle = z.object({ capabilityId: z.number().int().positive() });
const condVelocitySignflip = z.object({ capabilityId: z.number().int().positive() });
const condMacro = z.object({
  industryId: z.number().int().positive().optional(),
  minSeverity: z.number().int().min(1).max(10),
});
const condQuadrant = z.object({
  capabilityId: z.number().int().positive().optional(),
  industryId: z.number().int().positive().optional(),
});

const createBody = z.discriminatedUnion("targetType", [
  z.object({ targetType: z.literal("capability_threshold"), condition: condCapThreshold }),
  z.object({ targetType: z.literal("lifecycle_change"), condition: condLifecycle }),
  z.object({ targetType: z.literal("velocity_signflip"), condition: condVelocitySignflip }),
  z.object({ targetType: z.literal("macro_event"), condition: condMacro }),
  z.object({ targetType: z.literal("quadrant_transition"), condition: condQuadrant }),
]).and(z.object({
  targetId: z.number().int().positive().nullable().optional(),
  channel: z.enum(["email", "slack", "webhook"]).optional(),
  channelTarget: z.string().url().nullable().optional(),
  frequency: z.enum(["realtime", "daily_digest"]).optional(),
  label: z.string().max(200).nullable().optional(),
}));

router.post("/me/subscriptions", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  if ((parsed.data.channel === "slack" || parsed.data.channel === "webhook")) {
    const isPlatform = await userIsPlatformTier(userId);
    if (!isPlatform) {
      res.status(403).json({ error: "Slack and webhook delivery require the Platform tier." });
      return;
    }
    if (!parsed.data.channelTarget) {
      res.status(400).json({ error: "channelTarget URL is required for slack/webhook channels." });
      return;
    }
  }

  // Daily digest is email-only (the digest job sends a single aggregated
  // email per user). Slack/webhook subscriptions must use realtime delivery.
  if (parsed.data.frequency === "daily_digest" && parsed.data.channel && parsed.data.channel !== "email") {
    res.status(400).json({ error: "Daily digest is only available for email delivery." });
    return;
  }

  const sub = await createSubscription({ userId, ...parsed.data });
  res.json({ subscription: sub });
});

router.patch("/me/subscriptions/:id", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const active = typeof req.body?.active === "boolean" ? req.body.active : true;
  const ok = await setSubscriptionActive(userId, id, active);
  if (!ok) { res.status(404).json({ error: "not found" }); return; }
  res.json({ ok: true });
});

router.delete("/me/subscriptions/:id", async (req, res) => {
  const userId = getUserId(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const ok = await deleteSubscription(userId, id);
  if (!ok) { res.status(404).json({ error: "not found" }); return; }
  res.json({ ok: true });
});

// Admin-triggered digest run (cron-callable).
router.post("/admin/notifications/run-digest", requireAdmin, async (_req, res) => {
  const result = await sendDailyDigests();
  res.json(result);
});

export default router;
