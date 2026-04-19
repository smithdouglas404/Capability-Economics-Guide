import { Router, type IRouter } from "express";
import { db, apiKeysTable } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import { getAuth } from "@clerk/express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { generateApiKey } from "../services/api-keys";
import { logAdminAction } from "../services/audit-log";

const router: IRouter = Router();

// ───────────────────── User-facing: manage own keys ─────────────────────

router.get("/me/api-keys", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db
    .select({
      id: apiKeysTable.id,
      label: apiKeysTable.label,
      prefix: apiKeysTable.prefix,
      lastUsedAt: apiKeysTable.lastUsedAt,
      revokedAt: apiKeysTable.revokedAt,
      createdAt: apiKeysTable.createdAt,
    })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.userId, auth.userId))
    .orderBy(desc(apiKeysTable.createdAt));
  res.json({ keys: rows });
});

const CreateKeyBody = z.object({
  label: z.string().min(1).max(100),
});

router.post("/me/api-keys", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CreateKeyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const { raw, prefix, hashed } = generateApiKey();
  const [created] = await db.insert(apiKeysTable).values({
    userId: auth.userId,
    label: parsed.data.label,
    prefix,
    hashedKey: hashed,
    createdBy: auth.userId,
  }).returning();

  res.status(201).json({
    id: created!.id,
    label: created!.label,
    prefix: created!.prefix,
    createdAt: created!.createdAt,
    raw, // returned ONCE — not stored
    warning: "Copy this key now. It will never be shown again.",
  });
});

router.delete("/me/api-keys/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const result = await db.update(apiKeysTable)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.userId, auth.userId), isNull(apiKeysTable.revokedAt)))
    .returning({ id: apiKeysTable.id });
  if (result.length === 0) { res.status(404).json({ error: "not found or already revoked" }); return; }
  res.json({ ok: true, revokedId: id });
});

// ───────────────────── Admin: issue/revoke keys on behalf of users ─────────────────────

const AdminCreateKeyBody = z.object({
  userId: z.string().min(1),
  label: z.string().min(1).max(100),
});

router.post("/admin/api-keys", requireAdmin, async (req, res) => {
  const parsed = AdminCreateKeyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const auth = getAuth(req);
  const { raw, prefix, hashed } = generateApiKey();
  const [created] = await db.insert(apiKeysTable).values({
    userId: parsed.data.userId,
    label: parsed.data.label,
    prefix,
    hashedKey: hashed,
    createdBy: auth?.userId ?? "admin",
  }).returning();

  await logAdminAction(req, {
    action: "api_key.issue",
    targetType: "user",
    targetId: parsed.data.userId,
    details: { keyId: created!.id, label: parsed.data.label, prefix },
  });

  res.status(201).json({
    id: created!.id,
    label: created!.label,
    prefix: created!.prefix,
    createdAt: created!.createdAt,
    raw,
    warning: "Copy this key now and give it to the user. It will never be shown again.",
  });
});

router.get("/admin/api-keys", requireAdmin, async (req, res) => {
  const userId = req.query.userId as string | undefined;
  const conditions = userId ? [eq(apiKeysTable.userId, userId)] : [];
  const rows = await db
    .select({
      id: apiKeysTable.id,
      userId: apiKeysTable.userId,
      label: apiKeysTable.label,
      prefix: apiKeysTable.prefix,
      lastUsedAt: apiKeysTable.lastUsedAt,
      revokedAt: apiKeysTable.revokedAt,
      createdAt: apiKeysTable.createdAt,
      createdBy: apiKeysTable.createdBy,
    })
    .from(apiKeysTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(apiKeysTable.createdAt));
  res.json({ keys: rows });
});

router.delete("/admin/api-keys/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(apiKeysTable).where(eq(apiKeysTable.id, id));
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  await db.update(apiKeysTable)
    .set({ revokedAt: new Date() })
    .where(eq(apiKeysTable.id, id));

  await logAdminAction(req, {
    action: "api_key.revoke",
    targetType: "user",
    targetId: existing.userId,
    details: { keyId: id, label: existing.label, prefix: existing.prefix },
  });

  res.json({ ok: true, revokedId: id });
});

export default router;
