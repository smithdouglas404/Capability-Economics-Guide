import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, savedViewsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/saved-views", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db
    .select()
    .from(savedViewsTable)
    .where(eq(savedViewsTable.userId, auth.userId))
    .orderBy(desc(savedViewsTable.createdAt));
  res.json({ views: rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })) });
});

router.post("/saved-views", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { slug, name, route, state } = req.body ?? {};
  if (typeof slug !== "string" || !slug.trim()) { res.status(400).json({ error: "slug required" }); return; }
  if (typeof name !== "string" || !name.trim()) { res.status(400).json({ error: "name required" }); return; }
  if (typeof route !== "string" || !route.trim()) { res.status(400).json({ error: "route required" }); return; }
  const stateObj = state && typeof state === "object" ? state : {};
  try {
    const [view] = await db
      .insert(savedViewsTable)
      .values({
        userId: auth.userId,
        slug: slug.trim(),
        name: name.trim(),
        route: route.trim(),
        state: stateObj,
      })
      .onConflictDoUpdate({
        target: [savedViewsTable.userId, savedViewsTable.slug],
        set: { name: name.trim(), route: route.trim(), state: stateObj },
      })
      .returning();
    res.status(201).json({ view: { ...view, createdAt: view.createdAt.toISOString() } });
  } catch (err) {
    res.status(500).json({ error: "Failed to save view", message: (err as Error).message });
  }
});

router.delete("/saved-views/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  await db
    .delete(savedViewsTable)
    .where(and(eq(savedViewsTable.id, id), eq(savedViewsTable.userId, auth.userId)));
  res.status(204).send();
});

export default router;
