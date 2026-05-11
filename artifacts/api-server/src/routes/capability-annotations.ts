/**
 * Capability-level analyst annotations: notes, score disputes, source flags.
 *
 * Reads are authenticated only (any signed-in user can see annotations on any
 * capability). Mutations are scoped: authors can edit their own body within a
 * 10-minute window, soft-delete their own at any time. Admins can resolve /
 * dismiss any annotation. Replies thread off a root annotation.
 *
 * Records to admin_audit_log on create / resolve / delete so the evidentiary
 * trail is permanent independent of the soft-delete flag on the row itself.
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, capabilityAnnotationsTable, capabilitiesTable, sourceTriangulationsTable, adminAuditLogTable } from "@workspace/db";
import { and, eq, isNull, desc, sql } from "drizzle-orm";
import { getAuth, clerkClient } from "@clerk/express";
import type { Request, Response } from "express";
import { requireSession } from "../middlewares/requireSession";
import { isClerkAdmin } from "../middlewares/requireAdmin";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const KIND_VALUES = ["note", "dispute", "source_flag"] as const;
const STATUS_VALUES = ["open", "resolved", "dismissed"] as const;
const EDIT_WINDOW_MS = 10 * 60 * 1000;
const MAX_BODY_LEN = 4000;

const CreateBody = z.object({
  kind: z.enum(KIND_VALUES).default("note"),
  body: z.string().min(1).max(MAX_BODY_LEN),
  targetSourceTriangulationId: z.number().int().positive().nullable().optional(),
  parentAnnotationId: z.number().int().positive().nullable().optional(),
});

const UpdateBody = z.object({
  body: z.string().min(1).max(MAX_BODY_LEN),
});

const ResolveBody = z.object({
  status: z.enum(["resolved", "dismissed"]),
  resolutionNote: z.string().max(2000).optional(),
});

const ListQuery = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  kind: z.enum(KIND_VALUES).optional(),
  includeDeleted: z.union([z.literal("1"), z.literal("true")]).optional(),
});

async function resolveActorEmail(userId: string): Promise<{ email: string | null; displayName: string | null }> {
  try {
    const user = await clerkClient.users.getUser(userId);
    const email = user.primaryEmailAddress?.emailAddress
      ?? user.emailAddresses[0]?.emailAddress
      ?? null;
    const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || null;
    return { email, displayName };
  } catch {
    return { email: null, displayName: null };
  }
}

async function logAudit(
  req: Request,
  action: string,
  targetId: number,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    const auth = getAuth(req);
    const actorUserId = auth?.userId ?? "unknown";
    let actorEmail: string | null = null;
    if (auth?.userId) {
      const { email } = await resolveActorEmail(auth.userId);
      actorEmail = email;
    }
    await db.insert(adminAuditLogTable).values({
      actorUserId,
      actorEmail,
      action,
      targetType: "capability_annotation",
      targetId: String(targetId),
      details,
    });
  } catch (err) {
    logger.warn({ err, action }, "[annotations] failed to write audit log");
  }
}

// ─── List annotations for a capability ───────────────────────────────────────
router.get("/capabilities/:id/annotations", requireSession(), async (req: Request, res: Response) => {
  const capabilityId = Number(req.params.id);
  if (!Number.isInteger(capabilityId) || capabilityId <= 0) {
    res.status(400).json({ error: "Invalid capability id" });
    return;
  }
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
    return;
  }

  const [cap] = await db.select({ id: capabilitiesTable.id }).from(capabilitiesTable).where(eq(capabilitiesTable.id, capabilityId));
  if (!cap) {
    res.status(404).json({ error: "Capability not found" });
    return;
  }

  const auth = getAuth(req);
  const includeDeleted = (parsed.data.includeDeleted === "1" || parsed.data.includeDeleted === "true")
    && auth?.userId
    && await isClerkAdmin(auth.userId);

  const filters = [eq(capabilityAnnotationsTable.capabilityId, capabilityId)];
  if (!includeDeleted) filters.push(isNull(capabilityAnnotationsTable.deletedAt));
  if (parsed.data.status) filters.push(eq(capabilityAnnotationsTable.status, parsed.data.status));
  if (parsed.data.kind) filters.push(eq(capabilityAnnotationsTable.kind, parsed.data.kind));

  const rows = await db
    .select()
    .from(capabilityAnnotationsTable)
    .where(and(...filters))
    .orderBy(desc(capabilityAnnotationsTable.createdAt));

  const counts = await db
    .select({
      kind: capabilityAnnotationsTable.kind,
      status: capabilityAnnotationsTable.status,
      c: sql<number>`count(*)::int`,
    })
    .from(capabilityAnnotationsTable)
    .where(and(
      eq(capabilityAnnotationsTable.capabilityId, capabilityId),
      isNull(capabilityAnnotationsTable.deletedAt),
    ))
    .groupBy(capabilityAnnotationsTable.kind, capabilityAnnotationsTable.status);

  const summary = {
    total: rows.filter(r => !r.deletedAt).length,
    openDisputes: counts.filter(c => c.kind === "dispute" && c.status === "open").reduce((s, c) => s + c.c, 0),
    openSourceFlags: counts.filter(c => c.kind === "source_flag" && c.status === "open").reduce((s, c) => s + c.c, 0),
    notes: counts.filter(c => c.kind === "note").reduce((s, c) => s + c.c, 0),
  };

  res.json({ capabilityId, annotations: rows, summary });
});

// ─── Create annotation ───────────────────────────────────────────────────────
router.post("/capabilities/:id/annotations", requireSession(), async (req: Request, res: Response) => {
  const capabilityId = Number(req.params.id);
  if (!Number.isInteger(capabilityId) || capabilityId <= 0) {
    res.status(400).json({ error: "Invalid capability id" });
    return;
  }
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const { kind, body, targetSourceTriangulationId, parentAnnotationId } = parsed.data;

  const [cap] = await db.select({ id: capabilitiesTable.id }).from(capabilitiesTable).where(eq(capabilitiesTable.id, capabilityId));
  if (!cap) {
    res.status(404).json({ error: "Capability not found" });
    return;
  }

  // Validate referenced source_triangulation belongs to this capability.
  if (targetSourceTriangulationId) {
    const [tri] = await db
      .select({ capabilityId: sourceTriangulationsTable.capabilityId })
      .from(sourceTriangulationsTable)
      .where(eq(sourceTriangulationsTable.id, targetSourceTriangulationId));
    if (!tri) {
      res.status(400).json({ error: "Target source triangulation not found" });
      return;
    }
    if (tri.capabilityId !== capabilityId) {
      res.status(400).json({ error: "Target source triangulation belongs to a different capability" });
      return;
    }
  }

  // Validate parent annotation belongs to this capability and isn't deleted.
  if (parentAnnotationId) {
    const [parent] = await db
      .select({ capabilityId: capabilityAnnotationsTable.capabilityId, deletedAt: capabilityAnnotationsTable.deletedAt })
      .from(capabilityAnnotationsTable)
      .where(eq(capabilityAnnotationsTable.id, parentAnnotationId));
    if (!parent || parent.deletedAt) {
      res.status(400).json({ error: "Parent annotation not found" });
      return;
    }
    if (parent.capabilityId !== capabilityId) {
      res.status(400).json({ error: "Parent annotation belongs to a different capability" });
      return;
    }
  }

  const { email, displayName } = await resolveActorEmail(auth.userId);

  const [created] = await db.insert(capabilityAnnotationsTable).values({
    capabilityId,
    userId: auth.userId,
    userEmail: email,
    userDisplayName: displayName,
    kind,
    body,
    targetSourceTriangulationId: targetSourceTriangulationId ?? null,
    parentAnnotationId: parentAnnotationId ?? null,
  }).returning();

  await logAudit(req, `annotation.create.${kind}`, created.id, {
    capabilityId,
    parentAnnotationId: parentAnnotationId ?? null,
    targetSourceTriangulationId: targetSourceTriangulationId ?? null,
  });

  res.status(201).json(created);
});

// ─── Update own annotation body (within edit window) ────────────────────────
router.patch("/capabilities/:id/annotations/:annotationId", requireSession(), async (req: Request, res: Response) => {
  const annotationId = Number(req.params.annotationId);
  if (!Number.isInteger(annotationId) || annotationId <= 0) {
    res.status(400).json({ error: "Invalid annotation id" });
    return;
  }
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }

  const [existing] = await db.select().from(capabilityAnnotationsTable).where(eq(capabilityAnnotationsTable.id, annotationId));
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Annotation not found" });
    return;
  }
  if (existing.userId !== auth.userId) {
    res.status(403).json({ error: "Not your annotation" });
    return;
  }
  if (Date.now() - existing.createdAt.getTime() > EDIT_WINDOW_MS) {
    res.status(403).json({ error: `Edit window of ${EDIT_WINDOW_MS / 60000} minutes has expired` });
    return;
  }

  const [updated] = await db
    .update(capabilityAnnotationsTable)
    .set({ body: parsed.data.body, updatedAt: new Date() })
    .where(eq(capabilityAnnotationsTable.id, annotationId))
    .returning();

  res.json(updated);
});

// ─── Resolve / dismiss (admin only) ─────────────────────────────────────────
router.post("/capabilities/:id/annotations/:annotationId/resolve", requireSession(), async (req: Request, res: Response) => {
  const annotationId = Number(req.params.annotationId);
  if (!Number.isInteger(annotationId) || annotationId <= 0) {
    res.status(400).json({ error: "Invalid annotation id" });
    return;
  }
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (!await isClerkAdmin(auth.userId)) {
    res.status(403).json({ error: "Admin required" });
    return;
  }
  const parsed = ResolveBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }

  const [existing] = await db.select().from(capabilityAnnotationsTable).where(eq(capabilityAnnotationsTable.id, annotationId));
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Annotation not found" });
    return;
  }
  if (existing.status !== "open") {
    res.status(409).json({ error: `Annotation already ${existing.status}` });
    return;
  }

  const [updated] = await db
    .update(capabilityAnnotationsTable)
    .set({
      status: parsed.data.status,
      resolvedBy: auth.userId,
      resolvedAt: new Date(),
      resolutionNote: parsed.data.resolutionNote ?? null,
      updatedAt: new Date(),
    })
    .where(eq(capabilityAnnotationsTable.id, annotationId))
    .returning();

  await logAudit(req, `annotation.${parsed.data.status}`, annotationId, {
    capabilityId: existing.capabilityId,
    resolutionNote: parsed.data.resolutionNote ?? null,
    originalKind: existing.kind,
  });

  res.json(updated);
});

// ─── Soft-delete (author or admin) ──────────────────────────────────────────
router.delete("/capabilities/:id/annotations/:annotationId", requireSession(), async (req: Request, res: Response) => {
  const annotationId = Number(req.params.annotationId);
  if (!Number.isInteger(annotationId) || annotationId <= 0) {
    res.status(400).json({ error: "Invalid annotation id" });
    return;
  }
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [existing] = await db.select().from(capabilityAnnotationsTable).where(eq(capabilityAnnotationsTable.id, annotationId));
  if (!existing || existing.deletedAt) {
    res.status(404).json({ error: "Annotation not found" });
    return;
  }
  const isAuthor = existing.userId === auth.userId;
  const isAdmin = await isClerkAdmin(auth.userId);
  if (!isAuthor && !isAdmin) {
    res.status(403).json({ error: "Not your annotation" });
    return;
  }

  await db
    .update(capabilityAnnotationsTable)
    .set({ deletedAt: new Date(), deletedBy: auth.userId, updatedAt: new Date() })
    .where(eq(capabilityAnnotationsTable.id, annotationId));

  await logAudit(req, "annotation.delete", annotationId, {
    capabilityId: existing.capabilityId,
    byAdmin: isAdmin && !isAuthor,
    originalKind: existing.kind,
  });

  res.status(204).send();
});

export default router;
