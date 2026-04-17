import { Router } from "express";
import { db } from "@workspace/db";
import { innovationProjectsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

// List innovation projects
router.get("/innovation/projects", async (req, res) => {
  try {
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
    const rows = token
      ? await db.select().from(innovationProjectsTable).where(eq(innovationProjectsTable.sessionToken, token)).orderBy(desc(innovationProjectsTable.updatedAt))
      : await db.select().from(innovationProjectsTable).orderBy(desc(innovationProjectsTable.updatedAt));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get one project
router.get("/innovation/projects/:id", async (req, res) => {
  try {
    const [row] = await db.select().from(innovationProjectsTable).where(eq(innovationProjectsTable.id, Number(req.params.id)));
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

// Advance stage
router.post("/innovation/projects/:id/advance", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { newStage, decision, notes } = req.body as { newStage: string; decision: string; notes?: string };
    const [existing] = await db.select().from(innovationProjectsTable).where(eq(innovationProjectsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }

    const history = [...(existing.stageHistory as any[] || []), {
      stage: newStage,
      enteredAt: new Date().toISOString(),
      decision,
      notes: notes ?? "",
    }];

    const [updated] = await db.update(innovationProjectsTable)
      .set({ stage: newStage, stageHistory: history, updatedAt: new Date() })
      .where(eq(innovationProjectsTable.id, id))
      .returning();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Update project (actual ROI, actual uplift)
router.patch("/innovation/projects/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (req.body.actualRoiPct !== undefined) updates.actualRoiPct = req.body.actualRoiPct;
    if (req.body.targetCapabilities !== undefined) updates.targetCapabilities = req.body.targetCapabilities;
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;

    const [updated] = await db.update(innovationProjectsTable).set(updates).where(eq(innovationProjectsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Delete project
router.delete("/innovation/projects/:id", async (req, res) => {
  try {
    await db.delete(innovationProjectsTable).where(eq(innovationProjectsTable.id, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
