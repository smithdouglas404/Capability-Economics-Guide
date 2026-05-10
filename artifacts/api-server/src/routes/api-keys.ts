import { Router, type IRouter } from "express";
import { db, apiKeysTable, apiRequestLogTable } from "@workspace/db";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { getAuth } from "@clerk/express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { requireSession } from "../middlewares/requireSession";
import { generateApiKey, ALL_V1_SCOPES, nextMonthlyResetAt } from "../services/api-keys";
import { logAdminAction } from "../services/audit-log";

const router: IRouter = Router();

const ScopeSchema = z.array(z.enum(ALL_V1_SCOPES)).min(1);

// ───────────────────── User-facing: manage own keys ─────────────────────
//
// All /me/api-keys* routes are gated by requireSession() so they cannot be
// invoked with an API-key bearer token — only a real Clerk browser session.
// This prevents a holder of any v1 key from minting a broader-scoped key.
router.use("/me/api-keys", requireSession());

router.get("/me/api-keys", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db
    .select({
      id: apiKeysTable.id,
      label: apiKeysTable.label,
      prefix: apiKeysTable.prefix,
      scopes: apiKeysTable.scopes,
      rateLimitPerMin: apiKeysTable.rateLimitPerMin,
      monthlyQuota: apiKeysTable.monthlyQuota,
      monthlyUsageCount: apiKeysTable.monthlyUsageCount,
      quotaResetAt: apiKeysTable.quotaResetAt,
      orgId: apiKeysTable.orgId,
      lastUsedAt: apiKeysTable.lastUsedAt,
      revokedAt: apiKeysTable.revokedAt,
      createdAt: apiKeysTable.createdAt,
    })
    .from(apiKeysTable)
    .where(eq(apiKeysTable.userId, auth.userId))
    .orderBy(desc(apiKeysTable.createdAt));
  res.json({ keys: rows });
});

// orgId is NOT accepted from the request body — it's derived from the
// authenticated Clerk session so a caller can't issue keys "as" another org.
const CreateKeyBody = z.object({
  label: z.string().min(1).max(100),
  scopes: ScopeSchema.optional(),
  rateLimitPerMin: z.number().int().min(1).max(100000).nullable().optional(),
  monthlyQuota: z.number().int().min(1).nullable().optional(),
});

router.post("/me/api-keys", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CreateKeyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  // Derive org from Clerk session (the user's currently active org). Falls
  // back to a per-user namespace when the user isn't acting on behalf of an
  // org so individual developers can still issue keys.
  const orgId = (auth as { orgId?: string | null }).orgId ?? null;

  const { raw, prefix, hashed } = generateApiKey();
  const [created] = await db.insert(apiKeysTable).values({
    userId: auth.userId,
    label: parsed.data.label,
    prefix,
    hashedKey: hashed,
    scopes: parsed.data.scopes ?? [...ALL_V1_SCOPES],
    rateLimitPerMin: parsed.data.rateLimitPerMin ?? null,
    monthlyQuota: parsed.data.monthlyQuota ?? null,
    quotaResetAt: nextMonthlyResetAt(),
    orgId,
    createdBy: auth.userId,
  }).returning();

  res.status(201).json({
    id: created!.id,
    label: created!.label,
    prefix: created!.prefix,
    scopes: created!.scopes,
    rateLimitPerMin: created!.rateLimitPerMin,
    monthlyQuota: created!.monthlyQuota,
    orgId: created!.orgId,
    createdAt: created!.createdAt,
    raw, // returned ONCE — not stored
    warning: "Copy this key now. It will never be shown again.",
  });
});

const UpdateKeyBody = z.object({
  label: z.string().min(1).max(100).optional(),
  scopes: ScopeSchema.optional(),
  rateLimitPerMin: z.number().int().min(1).max(100000).nullable().optional(),
  monthlyQuota: z.number().int().min(1).nullable().optional(),
});

router.patch("/me/api-keys/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const parsed = UpdateKeyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const updates: Record<string, unknown> = {};
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.scopes !== undefined) updates.scopes = parsed.data.scopes;
  if (parsed.data.rateLimitPerMin !== undefined) updates.rateLimitPerMin = parsed.data.rateLimitPerMin;
  if (parsed.data.monthlyQuota !== undefined) updates.monthlyQuota = parsed.data.monthlyQuota;

  if (Object.keys(updates).length === 0) { res.json({ ok: true }); return; }

  const result = await db.update(apiKeysTable)
    .set(updates)
    .where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.userId, auth.userId), isNull(apiKeysTable.revokedAt)))
    .returning({ id: apiKeysTable.id });
  if (result.length === 0) { res.status(404).json({ error: "not found or revoked" }); return; }
  res.json({ ok: true, id });
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

// Per-key usage stats — last 30 days, daily buckets, for the /developers panel.
router.get("/me/api-keys/:id/usage", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [key] = await db.select().from(apiKeysTable)
    .where(and(eq(apiKeysTable.id, id), eq(apiKeysTable.userId, auth.userId))).limit(1);
  if (!key) { res.status(404).json({ error: "not found" }); return; }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const bucketRes = await db.execute<{ day: string; count: number }>(sql`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
           count(*)::int AS count
      FROM api_request_log
     WHERE key_id = ${id} AND created_at >= ${since}
  GROUP BY 1
  ORDER BY 1
  `);
  const buckets = (bucketRes as unknown as { rows?: Array<{ day: string; count: number }> }).rows
    ?? (Array.isArray(bucketRes) ? (bucketRes as unknown as Array<{ day: string; count: number }>) : []);
  const recent = await db.select({
    method: apiRequestLogTable.method,
    path: apiRequestLogTable.path,
    statusCode: apiRequestLogTable.statusCode,
    durationMs: apiRequestLogTable.durationMs,
    createdAt: apiRequestLogTable.createdAt,
  }).from(apiRequestLogTable)
    .where(and(eq(apiRequestLogTable.keyId, id), gte(apiRequestLogTable.createdAt, since)))
    .orderBy(desc(apiRequestLogTable.createdAt))
    .limit(50);

  res.json({
    keyId: key.id,
    monthlyQuota: key.monthlyQuota,
    monthlyUsageCount: key.monthlyUsageCount,
    quotaResetAt: key.quotaResetAt,
    rateLimitPerMin: key.rateLimitPerMin,
    scopes: key.scopes,
    dailyBuckets: buckets,
    recent,
  });
});

// ───────────────────── Admin: issue/revoke keys on behalf of users ─────────────────────

const AdminCreateKeyBody = z.object({
  userId: z.string().min(1),
  label: z.string().min(1).max(100),
  scopes: ScopeSchema.optional(),
  rateLimitPerMin: z.number().int().min(1).max(100000).nullable().optional(),
  monthlyQuota: z.number().int().min(1).nullable().optional(),
  orgId: z.string().min(1).nullable().optional(),
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
    scopes: parsed.data.scopes ?? [...ALL_V1_SCOPES],
    rateLimitPerMin: parsed.data.rateLimitPerMin ?? null,
    monthlyQuota: parsed.data.monthlyQuota ?? null,
    quotaResetAt: nextMonthlyResetAt(),
    orgId: parsed.data.orgId ?? null,
    createdBy: auth?.userId ?? "admin",
  }).returning();

  await logAdminAction(req, {
    action: "api_key.issue",
    targetType: "user",
    targetId: parsed.data.userId,
    details: {
      keyId: created!.id,
      label: parsed.data.label,
      prefix,
      scopes: created!.scopes,
      rateLimitPerMin: created!.rateLimitPerMin,
      monthlyQuota: created!.monthlyQuota,
    },
  });

  res.status(201).json({
    id: created!.id,
    label: created!.label,
    prefix: created!.prefix,
    scopes: created!.scopes,
    rateLimitPerMin: created!.rateLimitPerMin,
    monthlyQuota: created!.monthlyQuota,
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
      orgId: apiKeysTable.orgId,
      label: apiKeysTable.label,
      prefix: apiKeysTable.prefix,
      scopes: apiKeysTable.scopes,
      rateLimitPerMin: apiKeysTable.rateLimitPerMin,
      monthlyQuota: apiKeysTable.monthlyQuota,
      monthlyUsageCount: apiKeysTable.monthlyUsageCount,
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
