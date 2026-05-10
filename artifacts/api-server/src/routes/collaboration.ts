import { Router } from "express";
import { db } from "@workspace/db";
import { strategyCommentsTable, strategyDecisionsTable, capabilitiesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { withOrgScope, resolveSessionToken } from "../lib/tenant-scope";

const router = Router();

// Get comments for a target — must be scoped to the caller's session.
// Pre-fix any caller could read another tenant's comments by passing the
// same (targetType, targetId) tuple.
router.get("/collaboration/comments", async (req, res) => {
  try {
    const targetType = typeof req.query.targetType === "string" ? req.query.targetType : "";
    const targetId = Number(req.query.targetId) || 0;
    const token = resolveSessionToken(req);

    if (!targetType || !targetId) { res.json([]); return; }
    if (!token) { res.status(401).json({ error: "sessionToken required" }); return; }

    const rows = await db.select().from(strategyCommentsTable)
      .where(withOrgScope("strategy_comments", token, and(
        eq(strategyCommentsTable.targetType, targetType),
        eq(strategyCommentsTable.targetId, targetId),
      )))
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

// Resolve/unresolve comment — must belong to the caller's session.
// Pre-fix any tenant could resolve any other tenant's comment by id.
router.patch("/collaboration/comments/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { resolved, sessionToken: bodyToken } = req.body ?? {};
    const token = (typeof req.query.sessionToken === "string" && req.query.sessionToken)
      || (typeof bodyToken === "string" && bodyToken)
      || (typeof req.headers["x-session-token"] === "string" && req.headers["x-session-token"] as string)
      || "";
    if (!token) { res.status(401).json({ error: "sessionToken required" }); return; }
    const [updated] = await db.update(strategyCommentsTable)
      .set({ resolved: resolved ?? false })
      .where(and(eq(strategyCommentsTable.id, id), eq(strategyCommentsTable.sessionToken, token)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get strategy decisions — always scoped to the caller's session.
// Pre-fix this leaked: passing only `capabilityId` returned every tenant's
// decisions on that capability, and omitting both args dumped the latest
// 50 globally.
router.get("/collaboration/decisions", async (req, res) => {
  try {
    const token = resolveSessionToken(req);
    const capabilityId = Number(req.query.capabilityId) || undefined;
    if (!token) { res.status(401).json({ error: "sessionToken required" }); return; }

    const rows = await db.select({
      decision: strategyDecisionsTable,
      capabilityName: capabilitiesTable.name,
    })
      .from(strategyDecisionsTable)
      .leftJoin(capabilitiesTable, eq(strategyDecisionsTable.capabilityId, capabilitiesTable.id))
      .where(withOrgScope(
        "strategy_decisions",
        token,
        capabilityId ? eq(strategyDecisionsTable.capabilityId, capabilityId) : undefined,
      ))
      .orderBy(desc(strategyDecisionsTable.createdAt));

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
