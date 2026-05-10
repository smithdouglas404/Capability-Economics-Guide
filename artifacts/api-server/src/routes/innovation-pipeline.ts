import { Router } from "express";
import { db } from "@workspace/db";
import { innovationProjectsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { resolveSessionToken } from "../lib/tenant-scope";

const router = Router();

/**
 * Every endpoint here requires a sessionToken. Without one we return an
 * empty list (for collection routes) or 401 (for mutations) — never
 * serve, mutate, or delete another tenant's data. Pre-fix the GET
 * collection silently returned the entire table when token was missing.
 */

// List innovation projects for a session
router.get("/innovation/projects", async (req, res) => {
  try {
    const token = resolveSessionToken(req);
    if (!token) { res.json([]); return; }
    const rows = await db.select().from(innovationProjectsTable)
      .where(eq(innovationProjectsTable.sessionToken, token))
      .orderBy(desc(innovationProjectsTable.updatedAt));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get one project (must belong to the caller's session)
router.get("/innovation/projects/:id", async (req, res) => {
  try {
    const token = resolveSessionToken(req);
    if (!token) { res.status(401).json({ error: "sessionToken required" }); return; }
    const [row] = await db.select().from(innovationProjectsTable)
      .where(and(
        eq(innovationProjectsTable.id, Number(req.params.id)),
        eq(innovationProjectsTable.sessionToken, token),
      ));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Create project
router.post("/innovation/projects", async (req, res) => {
  try {
    const { sessionToken, name, description, industryId, targetCapabilities, investmentUsdK, projectedRoiPct, owner, startDate, targetDate } = req.body;
    if (typeof sessionToken !== "string" || !sessionToken) { res.status(401).json({ error: "sessionToken required" }); return; }
    const [project] = await db.insert(innovationProjectsTable).values({
      sessionToken,
      name,
      description,
      industryId,
      targetCapabilities: targetCapabilities ?? [],
      investmentUsdK,
      projectedRoiPct,
      owner,
      startDate: startDate ? new Date(startDate) : undefined,
      targetDate: targetDate ? new Date(targetDate) : undefined,
      stage: "ideation",
      stageHistory: [{ stage: "ideation", enteredAt: new Date().toISOString(), decision: "Created", notes: "" }],
    }).returning();
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Advance stage (must belong to caller)
router.post("/innovation/projects/:id/advance", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const token = resolveSessionToken(req);
    if (!token) { res.status(401).json({ error: "sessionToken required" }); return; }
    const { newStage, decision, notes } = req.body as { newStage: string; decision: string; notes?: string };
    const [existing] = await db.select().from(innovationProjectsTable)
      .where(and(eq(innovationProjectsTable.id, id), eq(innovationProjectsTable.sessionToken, token)));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const history = [
      ...(existing.stageHistory ?? []),
      {
        stage: newStage,
        enteredAt: new Date().toISOString(),
        decision,
        notes: notes ?? "",
      },
    ];

    const [updated] = await db.update(innovationProjectsTable)
      .set({ stage: newStage, stageHistory: history, updatedAt: new Date() })
      .where(and(eq(innovationProjectsTable.id, id), eq(innovationProjectsTable.sessionToken, token)))
      .returning();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Update project (must belong to caller)
router.patch("/innovation/projects/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const token = resolveSessionToken(req);
    if (!token) { res.status(401).json({ error: "sessionToken required" }); return; }
    const updates = { ...req.body, updatedAt: new Date() };
    delete updates.sessionToken; // never let caller rewrite ownership
    delete updates.id;
    const [updated] = await db.update(innovationProjectsTable)
      .set(updates)
      .where(and(eq(innovationProjectsTable.id, id), eq(innovationProjectsTable.sessionToken, token)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Delete project (must belong to caller)
router.delete("/innovation/projects/:id", async (req, res) => {
  try {
    const token = resolveSessionToken(req);
    if (!token) { res.status(401).json({ error: "sessionToken required" }); return; }
    const deleted = await db.delete(innovationProjectsTable)
      .where(and(
        eq(innovationProjectsTable.id, Number(req.params.id)),
        eq(innovationProjectsTable.sessionToken, token),
      ))
      .returning({ id: innovationProjectsTable.id });
    if (deleted.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
