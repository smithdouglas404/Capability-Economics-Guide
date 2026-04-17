import { Router } from "express";
import { db } from "@workspace/db";
import { strategyCommentsTable, strategyDecisionsTable, capabilitiesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

// Get comments for a target
router.get("/collaboration/comments", async (req, res) => {
  try {
    const targetType = typeof req.query.targetType === "string" ? req.query.targetType : "";
    const targetId = Number(req.query.targetId) || 0;

    if (!targetType || !targetId) { res.json([]); return; }

    const rows = await db.select().from(strategyCommentsTable)
      .where(and(
        eq(strategyCommentsTable.targetType, targetType),
        eq(strategyCommentsTable.targetId, targetId),
      ))
      .orderBy(strategyCommentsTable.createdAt);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Add comment
router.post("/collaboration/comments", async (req, res) => {
  try {
    const { targetType, targetId, authorRole, authorName, sessionToken, body, parentCommentId } = req.body;
    if (!body || !targetType || !targetId || !authorRole || !authorName) {
      res.status(400).json({ error: "Missing required fields" }); return;
    }

    const [comment] = await db.insert(strategyCommentsTable).values({
      targetType,
      targetId,
      authorRole,
      authorName,
      sessionToken,
      body,
      parentCommentId: parentCommentId ?? null,
    }).returning();

    res.json(comment);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Resolve/unresolve comment
router.patch("/collaboration/comments/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { resolved } = req.body;
    const [updated] = await db.update(strategyCommentsTable)
      .set({ resolved: resolved ?? false })
      .where(eq(strategyCommentsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get strategy decisions
router.get("/collaboration/decisions", async (req, res) => {
  try {
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : undefined;
    const capabilityId = Number(req.query.capabilityId) || undefined;

    let rows;
    if (capabilityId) {
      rows = await db.select({
        decision: strategyDecisionsTable,
        capabilityName: capabilitiesTable.name,
      })
        .from(strategyDecisionsTable)
        .leftJoin(capabilitiesTable, eq(strategyDecisionsTable.capabilityId, capabilitiesTable.id))
        .where(eq(strategyDecisionsTable.capabilityId, capabilityId))
        .orderBy(desc(strategyDecisionsTable.createdAt));
    } else if (token) {
      rows = await db.select({
        decision: strategyDecisionsTable,
        capabilityName: capabilitiesTable.name,
      })
        .from(strategyDecisionsTable)
        .leftJoin(capabilitiesTable, eq(strategyDecisionsTable.capabilityId, capabilitiesTable.id))
        .where(eq(strategyDecisionsTable.sessionToken, token))
        .orderBy(desc(strategyDecisionsTable.createdAt));
    } else {
      rows = await db.select({
        decision: strategyDecisionsTable,
        capabilityName: capabilitiesTable.name,
      })
        .from(strategyDecisionsTable)
        .leftJoin(capabilitiesTable, eq(strategyDecisionsTable.capabilityId, capabilitiesTable.id))
        .orderBy(desc(strategyDecisionsTable.createdAt))
        .limit(50);
    }

    res.json(rows.map((r) => ({ ...r.decision, capabilityName: r.capabilityName })));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Record a strategy decision
router.post("/collaboration/decisions", async (req, res) => {
  try {
    const { capabilityId, sessionToken, decision, rationale, decidedBy, decidedByRole, investmentUsdK, timelineMonths } = req.body;
    if (!decision || !rationale || !decidedBy || !decidedByRole) {
      res.status(400).json({ error: "Missing required fields" }); return;
    }

    const [row] = await db.insert(strategyDecisionsTable).values({
      capabilityId,
      sessionToken,
      decision,
      rationale,
      decidedBy,
      decidedByRole,
      investmentUsdK,
      timelineMonths,
    }).returning();

    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
