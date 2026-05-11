import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, adminAuditLogTable } from "@workspace/db";
import { desc, eq, and, or, gte, lte, sql, type SQL } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

const Query = z.object({
  limit: z.coerce.number().int().min(1).max(2000).optional(),
  targetType: z.string().optional(),
  targetId: z.string().optional(),
  actor: z.string().optional(),
  action: z.string().optional(),
  // Substring match on action (e.g. "annotation" matches all annotation.* events).
  actionPrefix: z.string().optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
});

function buildWhere(q: z.infer<typeof Query>) {
  const conds: SQL[] = [];
  if (q.targetType) conds.push(eq(adminAuditLogTable.targetType, q.targetType));
  if (q.targetId) conds.push(eq(adminAuditLogTable.targetId, q.targetId));
  if (q.action) conds.push(eq(adminAuditLogTable.action, q.action));
  if (q.actionPrefix) conds.push(sql`${adminAuditLogTable.action} LIKE ${q.actionPrefix + "%"}`);
  if (q.actor) {
    const orClause = or(
      eq(adminAuditLogTable.actorUserId, q.actor),
      eq(adminAuditLogTable.actorEmail, q.actor),
    );
    if (orClause) conds.push(orClause);
  }
  if (q.since) conds.push(gte(adminAuditLogTable.createdAt, new Date(q.since)));
  if (q.until) conds.push(lte(adminAuditLogTable.createdAt, new Date(q.until)));
  return conds.length ? and(...conds) : undefined;
}

router.get("/admin/audit-log", requireAdmin, async (req, res) => {
  const parsed = Query.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
    return;
  }
  const q = parsed.data;
  const where = buildWhere(q);

  const rows = await db
    .select()
    .from(adminAuditLogTable)
    .where(where)
    .orderBy(desc(adminAuditLogTable.createdAt))
    .limit(q.limit ?? 100);

  // Distinct actions list, useful for the filter dropdown.
  const distinctActions = await db
    .selectDistinct({ action: adminAuditLogTable.action })
    .from(adminAuditLogTable)
    .orderBy(adminAuditLogTable.action);

  res.json({
    entries: rows,
    total: rows.length,
    distinctActions: distinctActions.map(d => d.action),
  });
});

router.get("/admin/audit-log/export.csv", requireAdmin, async (req, res) => {
  const parsed = Query.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
    return;
  }
  const q = parsed.data;
  const where = buildWhere(q);

  // Caps at 50k rows — anything beyond that should be paged through the JSON
  // endpoint; CSV export is for compliance "give me what I asked about"
  // moments, not full-table dumps.
  const rows = await db
    .select()
    .from(adminAuditLogTable)
    .where(where)
    .orderBy(desc(adminAuditLogTable.createdAt))
    .limit(q.limit ?? 50000);

  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = "id,createdAt,actorUserId,actorEmail,action,targetType,targetId,details\n";
  const body = rows.map(r => [
    r.id,
    r.createdAt.toISOString(),
    r.actorUserId,
    r.actorEmail ?? "",
    r.action,
    r.targetType ?? "",
    r.targetId ?? "",
    r.details ? JSON.stringify(r.details) : "",
  ].map(escape).join(",")).join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(header + body + "\n");
});

export default router;
