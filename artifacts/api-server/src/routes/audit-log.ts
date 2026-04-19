import { Router, type IRouter } from "express";
import { db, adminAuditLogTable } from "@workspace/db";
import { desc, eq, and, or } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.get("/admin/audit-log", requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const targetType = req.query.targetType as string | undefined;
  const targetId = req.query.targetId as string | undefined;
  const actor = req.query.actor as string | undefined;

  const conditions = [] as ReturnType<typeof eq>[];
  if (targetType) conditions.push(eq(adminAuditLogTable.targetType, targetType));
  if (targetId) conditions.push(eq(adminAuditLogTable.targetId, targetId));
  if (actor) {
    // match either the clerk userId or the email
    const orClause = or(
      eq(adminAuditLogTable.actorUserId, actor),
      eq(adminAuditLogTable.actorEmail, actor),
    );
    if (orClause) conditions.push(orClause as ReturnType<typeof eq>);
  }

  const rows = await db
    .select()
    .from(adminAuditLogTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(adminAuditLogTable.createdAt))
    .limit(limit);

  res.json({ entries: rows, total: rows.length });
});

export default router;
