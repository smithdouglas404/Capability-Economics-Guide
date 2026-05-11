/**
 * Digest subscription routes — user-facing CRUD + admin sweep trigger.
 *
 *   GET  /me/digest             — current subscription (or null)
 *   PUT  /me/digest             — upsert preferences
 *   DEL  /me/digest             — unsubscribe (sets active=false)
 *   POST /me/digest/preview     — build the payload + return as JSON without sending
 *   POST /admin/digest/run      — admin trigger of the sweep (force flag supported)
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, digestSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireSession } from "../middlewares/requireSession";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAdminAction } from "../services/audit-log";
import { buildDigest, runDigestSweep } from "../services/digest";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use("/me/digest", requireSession());

const UpsertBody = z.object({
  active: z.boolean().optional(),
  channel: z.enum(["email", "slack"]).optional(),
  slackWebhookUrl: z.string().url().nullable().optional(),
  emailOverride: z.string().email().nullable().optional(),
  frequency: z.enum(["weekly", "daily"]).optional(),
  industryIds: z.array(z.number().int().positive()).max(50).optional(),
  capabilityIds: z.array(z.number().int().positive()).max(100).optional(),
});

router.get("/me/digest", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [sub] = await db.select().from(digestSubscriptionsTable).where(eq(digestSubscriptionsTable.userId, auth.userId));
  res.json({
    subscription: sub
      ? {
        ...sub,
        createdAt: sub.createdAt.toISOString(),
        updatedAt: sub.updatedAt.toISOString(),
        lastSentAt: sub.lastSentAt?.toISOString() ?? null,
      }
      : null,
  });
});

router.put("/me/digest", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = UpsertBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  // Slack channel requires a webhook URL.
  if (parsed.data.channel === "slack" && !parsed.data.slackWebhookUrl) {
    res.status(400).json({ error: "Slack channel requires slackWebhookUrl" });
    return;
  }

  const [existing] = await db.select().from(digestSubscriptionsTable).where(eq(digestSubscriptionsTable.userId, auth.userId));
  if (existing) {
    const updates: Partial<typeof digestSubscriptionsTable.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.active !== undefined) updates.active = parsed.data.active;
    if (parsed.data.channel !== undefined) updates.channel = parsed.data.channel;
    if (parsed.data.slackWebhookUrl !== undefined) updates.slackWebhookUrl = parsed.data.slackWebhookUrl;
    if (parsed.data.emailOverride !== undefined) updates.emailOverride = parsed.data.emailOverride;
    if (parsed.data.frequency !== undefined) updates.frequency = parsed.data.frequency;
    if (parsed.data.industryIds !== undefined) updates.industryIds = parsed.data.industryIds;
    if (parsed.data.capabilityIds !== undefined) updates.capabilityIds = parsed.data.capabilityIds;
    const [updated] = await db.update(digestSubscriptionsTable).set(updates).where(eq(digestSubscriptionsTable.id, existing.id)).returning();
    res.json({
      subscription: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString(), lastSentAt: updated.lastSentAt?.toISOString() ?? null },
    });
    return;
  }

  // New subscription.
  const [created] = await db.insert(digestSubscriptionsTable).values({
    userId: auth.userId,
    active: parsed.data.active ?? true,
    channel: parsed.data.channel ?? "email",
    slackWebhookUrl: parsed.data.slackWebhookUrl ?? null,
    emailOverride: parsed.data.emailOverride ?? null,
    frequency: parsed.data.frequency ?? "weekly",
    industryIds: parsed.data.industryIds ?? [],
    capabilityIds: parsed.data.capabilityIds ?? [],
  }).returning();
  res.status(201).json({
    subscription: { ...created, createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString(), lastSentAt: null },
  });
});

router.delete("/me/digest", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.update(digestSubscriptionsTable)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(digestSubscriptionsTable.userId, auth.userId));
  res.status(204).send();
});

router.post("/me/digest/preview", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [sub] = await db.select().from(digestSubscriptionsTable).where(eq(digestSubscriptionsTable.userId, auth.userId));
  // Build from current saved subscription if present, otherwise from the
  // request body so the user can preview before saving.
  const parsed = UpsertBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const industryIds = parsed.data.industryIds ?? sub?.industryIds ?? [];
  const capabilityIds = parsed.data.capabilityIds ?? sub?.capabilityIds ?? [];
  const frequency = parsed.data.frequency ?? sub?.frequency ?? "weekly";
  try {
    const payload = await buildDigest({
      industryIds,
      capabilityIds,
      windowDays: frequency === "daily" ? 1 : 7,
    });
    res.json(payload);
  } catch (err) {
    logger.error({ err }, "[digest] preview failed");
    res.status(500).json({ error: "Preview failed", message: (err as Error).message });
  }
});

// Admin sweep — separate router so it can mount under requireAdmin without
// affecting /me/digest auth above.
const adminRouter: IRouter = Router();
adminRouter.post("/admin/digest/run", requireAdmin, async (req, res) => {
  const force = req.body?.force === true || req.query?.force === "1";
  try {
    const result = await runDigestSweep({ force });
    await logAdminAction(req, {
      action: "tier.update",
      targetType: "digest_subscriptions",
      targetId: "sweep",
      details: { force, attempted: result.attempted, succeeded: result.succeeded, failed: result.failed },
    });
    res.json(result);
  } catch (err) {
    logger.error({ err }, "[digest] sweep failed");
    res.status(500).json({ error: "Sweep failed", message: (err as Error).message });
  }
});

router.use(adminRouter);

export default router;
