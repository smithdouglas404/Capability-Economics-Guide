/**
 * Scheduled-export routes — user-facing CRUD for the /exports page's
 * "email me a weekly digest" toggle. Distinct from /me/digest (which
 * delivers the curated capability-disruption digest); these rows drive
 * services/scheduled-exports.ts, which mirrors the /exports payload.
 *
 *   GET    /me/scheduled-exports         — list the user's subscriptions
 *   POST   /me/scheduled-exports         — create a subscription
 *   DELETE /me/scheduled-exports/:id     — cancel a subscription
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { getAuth } from "@clerk/express";
import { db, scheduledExportsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const CreateBody = z.object({
  frequency: z.enum(["weekly"]).optional(),
  format: z.enum(["markdown", "csv"]).optional(),
  scope: z.enum(["watchlist", "portfolio", "all"]).optional(),
});

router.get("/me/scheduled-exports", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const rows = await db.select().from(scheduledExportsTable)
      .where(eq(scheduledExportsTable.userId, auth.userId))
      .orderBy(desc(scheduledExportsTable.createdAt));
    res.json({
      subscriptions: rows.map(r => ({
        id: r.id,
        userId: r.userId,
        active: r.active,
        frequency: r.frequency,
        format: r.format,
        scope: r.scope,
        lastSentAt: r.lastSentAt?.toISOString() ?? null,
        lastError: r.lastError,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  } catch (err) {
    logger.error({ err }, "[scheduled-exports] list failed");
    res.status(500).json({ error: "Failed to list scheduled exports" });
  }
});

router.post("/me/scheduled-exports", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CreateBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const frequency = parsed.data.frequency ?? "weekly";
  const format = parsed.data.format ?? "markdown";
  const scope = parsed.data.scope ?? "all";

  // Collapse duplicates: one (userId, frequency, format, scope) tuple is
  // enough — re-creating just re-activates the existing row instead of
  // accumulating identical subscriptions.
  try {
    const existing = await db.select().from(scheduledExportsTable).where(and(
      eq(scheduledExportsTable.userId, auth.userId),
      eq(scheduledExportsTable.frequency, frequency),
      eq(scheduledExportsTable.format, format),
      eq(scheduledExportsTable.scope, scope),
    )).limit(1);
    if (existing[0]) {
      const [updated] = await db.update(scheduledExportsTable)
        .set({ active: true, lastError: null, updatedAt: new Date() })
        .where(eq(scheduledExportsTable.id, existing[0].id))
        .returning();
      res.status(200).json({
        subscription: {
          id: updated.id,
          userId: updated.userId,
          active: updated.active,
          frequency: updated.frequency,
          format: updated.format,
          scope: updated.scope,
          lastSentAt: updated.lastSentAt?.toISOString() ?? null,
          lastError: updated.lastError,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
      });
      return;
    }

    const [created] = await db.insert(scheduledExportsTable).values({
      userId: auth.userId,
      active: true,
      frequency,
      format,
      scope,
    }).returning();
    res.status(201).json({
      subscription: {
        id: created.id,
        userId: created.userId,
        active: created.active,
        frequency: created.frequency,
        format: created.format,
        scope: created.scope,
        lastSentAt: null,
        lastError: null,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      },
    });
  } catch (err) {
    logger.error({ err }, "[scheduled-exports] create failed");
    res.status(500).json({ error: "Failed to create scheduled export" });
  }
});

router.delete("/me/scheduled-exports/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }
  try {
    const result = await db.update(scheduledExportsTable)
      .set({ active: false, updatedAt: new Date() })
      .where(and(
        eq(scheduledExportsTable.id, id),
        eq(scheduledExportsTable.userId, auth.userId),
      ))
      .returning({ id: scheduledExportsTable.id });
    if (result.length === 0) { res.status(404).json({ error: "not found" }); return; }
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, "[scheduled-exports] cancel failed");
    res.status(500).json({ error: "Failed to cancel scheduled export" });
  }
});

export default router;
