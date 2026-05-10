/**
 * Per-user saved dashboard views.
 *
 * All routes are gated by requireSession() — API-key auth cannot manage user
 * preferences. A user may save up to MAX_VIEWS per (dashboardKey).
 */
import { Router, type IRouter } from "express";
import { db, dashboardViewsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getAuth } from "@clerk/express";
import { requireSession } from "../middlewares/requireSession";

const router: IRouter = Router();
router.use("/me/dashboard-views", requireSession());

const MAX_VIEWS_PER_DASHBOARD = 10;
const DASHBOARD_KEYS = ["cei", "alpha", "knowledge-graph", "companies"] as const;
const DashboardKey = z.enum(DASHBOARD_KEYS);

const CreateBody = z.object({
  dashboardKey: DashboardKey,
  name: z.string().min(1).max(80),
  stateJson: z.record(z.string(), z.unknown()),
  isDefault: z.boolean().optional(),
});
const UpdateBody = z.object({
  name: z.string().min(1).max(80).optional(),
  stateJson: z.record(z.string(), z.unknown()).optional(),
  isDefault: z.boolean().optional(),
});

router.get("/me/dashboard-views", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const dashRaw = typeof req.query.dashboard === "string" ? req.query.dashboard : null;
  const where = dashRaw
    ? and(eq(dashboardViewsTable.userId, auth.userId), eq(dashboardViewsTable.dashboardKey, dashRaw))
    : eq(dashboardViewsTable.userId, auth.userId);
  const rows = await db.select().from(dashboardViewsTable).where(where).orderBy(dashboardViewsTable.dashboardKey, dashboardViewsTable.name);
  res.json({ views: rows });
});

router.post("/me/dashboard-views", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const { dashboardKey, name, stateJson, isDefault } = parsed.data;

  try {
    // Race-safe cap + insert. Take a per-(user, dashboard) advisory lock so two
    // concurrent POSTs serialize on the count() check.
    const [created] = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${auth.userId}:${dashboardKey}`}, 0))`);
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(dashboardViewsTable)
        .where(and(eq(dashboardViewsTable.userId, auth.userId!), eq(dashboardViewsTable.dashboardKey, dashboardKey)));
      if (count >= MAX_VIEWS_PER_DASHBOARD) {
        throw Object.assign(new Error("view_limit_reached"), { __limit: true });
      }
      if (isDefault) {
        await tx.update(dashboardViewsTable).set({ isDefault: false })
          .where(and(eq(dashboardViewsTable.userId, auth.userId!), eq(dashboardViewsTable.dashboardKey, dashboardKey)));
      }
      return await tx.insert(dashboardViewsTable).values({
        userId: auth.userId!,
        dashboardKey,
        name,
        stateJson,
        isDefault: isDefault ?? false,
      }).returning();
    });
    res.status(201).json(created);
  } catch (err) {
    if ((err as { __limit?: boolean }).__limit) {
      res.status(409).json({
        error: "view_limit_reached",
        message: `Limit of ${MAX_VIEWS_PER_DASHBOARD} saved views per dashboard. Delete one before saving another.`,
      });
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("dashboard_views_unique_name_idx") || msg.includes("duplicate key")) {
      res.status(409).json({ error: "duplicate_name", message: "A view with this name already exists." });
      return;
    }
    throw err;
  }
});

router.put("/me/dashboard-views/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const [existing] = await db.select().from(dashboardViewsTable)
    .where(and(eq(dashboardViewsTable.id, id), eq(dashboardViewsTable.userId, auth.userId))).limit(1);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  try {
    const [updated] = await db.transaction(async (tx) => {
      if (parsed.data.isDefault === true) {
        await tx.update(dashboardViewsTable).set({ isDefault: false })
          .where(and(eq(dashboardViewsTable.userId, auth.userId!), eq(dashboardViewsTable.dashboardKey, existing.dashboardKey)));
      }
      return await tx.update(dashboardViewsTable).set({
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.stateJson !== undefined ? { stateJson: parsed.data.stateJson } : {}),
        ...(parsed.data.isDefault !== undefined ? { isDefault: parsed.data.isDefault } : {}),
        updatedAt: new Date(),
      }).where(eq(dashboardViewsTable.id, id)).returning();
    });
    res.json(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("dashboard_views_unique_name_idx") || msg.includes("duplicate key")) {
      res.status(409).json({ error: "duplicate_name", message: "A view with this name already exists." });
      return;
    }
    throw err;
  }
});

router.delete("/me/dashboard-views/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const result = await db.delete(dashboardViewsTable)
    .where(and(eq(dashboardViewsTable.id, id), eq(dashboardViewsTable.userId, auth.userId)))
    .returning({ id: dashboardViewsTable.id });
  if (result.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  res.status(204).end();
});

export default router;
