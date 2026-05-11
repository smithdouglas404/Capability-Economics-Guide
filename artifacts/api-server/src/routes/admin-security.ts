import { Router, type Request, type Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { db, systemSecretsTable, auditChainEventsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireAdmin, invalidateAdminKeyCache } from "../middlewares/requireAdmin";
import { anchorEvent, blockchainAuditStatus, hashScanUrl } from "../services/blockchain-audit";
import { logger } from "../lib/logger";

/**
 * Admin security routes — currently exposes admin API key rotation.
 *
 * All routes require requireAdmin (Clerk admin OR current x-admin-key).
 * Rotation flow:
 *   1. UI calls POST /api/admin/security/rotate-admin-key
 *   2. Server generates a new key, writes to system_secrets, appends an
 *      audit-log entry with sha256 hash of the previous value
 *   3. Server returns the new raw value ONCE — UI displays + stores in
 *      localStorage; user is advised to copy to a password manager
 *   4. Cache invalidated immediately so the next admin request uses the
 *      new key
 *
 * Audit log shape per entry:
 *   { rotatedAt, rotatedByUserId, source, reason, previousValueHash }
 *
 * The previous value is hashed (sha256), never stored in plaintext. This
 * gives a tamper-evident chain — when a blockchain audit log is wired up
 * later, each rotation event can be anchored on-chain with the hash as
 * the proof of a value-change without revealing past secrets.
 */

const router = Router();

function generateKey(): string {
  // 32 random bytes → 43-char base64url (no padding, URL-safe).
  return randomBytes(32).toString("base64url");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

router.post("/admin/security/rotate-admin-key", requireAdmin, async (req: Request, res: Response) => {
  const auth = getAuth(req);
  const rotatedByUserId = auth?.userId ?? "shared_key_holder";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 240) : null;

  const newKey = generateKey();
  const now = new Date();

  try {
    const [existing] = await db.select().from(systemSecretsTable).where(eq(systemSecretsTable.keyName, "admin_api_key"));

    if (existing) {
      const auditEntry = {
        rotatedAt: now.toISOString(),
        rotatedByUserId,
        source: "manual_admin_ui" as const,
        reason,
        previousValueHash: sha256(existing.keyValue),
      };
      const newAuditLog = [...(existing.auditLog ?? []), auditEntry].slice(-100); // cap history
      await db.update(systemSecretsTable).set({
        keyValue: newKey,
        rotatedAt: now,
        rotatedByUserId,
        auditLog: newAuditLog,
      }).where(eq(systemSecretsTable.id, existing.id));
    } else {
      // First rotation when no DB row exists yet: also previous = env var.
      const previousValueHash = process.env.ADMIN_API_KEY ? sha256(process.env.ADMIN_API_KEY) : null;
      await db.insert(systemSecretsTable).values({
        id: 1,
        keyName: "admin_api_key",
        keyValue: newKey,
        rotatedAt: now,
        rotatedByUserId,
        auditLog: [{
          rotatedAt: now.toISOString(),
          rotatedByUserId,
          source: "manual_admin_ui",
          reason,
          previousValueHash,
        }],
      });
    }

    invalidateAdminKeyCache();
    logger.info({ rotatedByUserId, reason }, "[admin/rotate-admin-key] ADMIN_API_KEY rotated");

    // Anchor on Hedera (async, fire-and-forget). Failure or no-config
    // doesn't block the rotation — the row in audit_chain_events captures
    // status either way.
    void anchorEvent("admin_key_rotated", {
      contextHash: existing ? sha256(existing.keyValue) : (process.env.ADMIN_API_KEY ? sha256(process.env.ADMIN_API_KEY) : "bootstrap"),
      contextSnapshot: {
        source: "manual_admin_ui",
        rotatedByUserId,
        reason: reason ?? null,
      },
      relatedEntity: `system_secrets:1`,
    });

    res.json({
      ok: true,
      newKey,
      rotatedAt: now.toISOString(),
      hint: "Copy this value into your password manager AND paste it into the admin UI's Admin Key field. The previous key stops working immediately.",
    });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "[admin/rotate-admin-key] failed");
    res.status(500).json({ error: "Rotation failed; see server logs" });
  }
});

router.get("/admin/security/admin-key-history", requireAdmin, async (_req: Request, res: Response) => {
  const [row] = await db.select().from(systemSecretsTable).where(eq(systemSecretsTable.keyName, "admin_api_key"));
  if (!row) {
    res.json({
      rotations: [],
      currentSource: process.env.ADMIN_API_KEY ? "env_var" : "none",
      autoRotateEnabled: false,
      rotationCadenceDays: 90,
      notifyEmail: null,
      hint: "No rotation history yet — admin key is sourced from the ADMIN_API_KEY env var.",
    });
    return;
  }
  res.json({
    rotations: row.auditLog ?? [],
    rotatedAt: row.rotatedAt,
    rotatedByUserId: row.rotatedByUserId,
    currentSource: "db",
    autoRotateEnabled: row.autoRotateEnabled,
    rotationCadenceDays: row.rotationCadenceDays,
    notifyEmail: row.notifyEmail,
    lastAutoCheckAt: row.lastAutoCheckAt,
  });
});

/**
 * PATCH /api/admin/security/rotation-config
 *
 * Update the auto-rotation knobs: enable/disable, cadence days, notify email.
 * Body: { autoRotateEnabled?: boolean, rotationCadenceDays?: number, notifyEmail?: string | null }
 */
router.patch("/admin/security/rotation-config", requireAdmin, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { autoRotateEnabled?: boolean; rotationCadenceDays?: number; notifyEmail?: string | null };
  const update: Partial<typeof systemSecretsTable.$inferInsert> = {};
  if (typeof body.autoRotateEnabled === "boolean") update.autoRotateEnabled = body.autoRotateEnabled;
  if (typeof body.rotationCadenceDays === "number" && body.rotationCadenceDays >= 1 && body.rotationCadenceDays <= 365) {
    update.rotationCadenceDays = body.rotationCadenceDays;
  }
  if (body.notifyEmail === null || (typeof body.notifyEmail === "string" && (body.notifyEmail === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.notifyEmail)))) {
    update.notifyEmail = body.notifyEmail || null;
  }
  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "No valid fields to update" });
    return;
  }
  const [existing] = await db.select().from(systemSecretsTable).where(eq(systemSecretsTable.keyName, "admin_api_key"));
  if (!existing) {
    res.status(412).json({
      error: "No admin-key row in DB yet — rotate the key at least once first so the auto-rotate config has somewhere to live.",
    });
    return;
  }
  await db.update(systemSecretsTable).set(update).where(eq(systemSecretsTable.id, existing.id));
  res.json({ ok: true, ...update });
});

/**
 * GET /api/admin/audit-chain
 *
 * Lists audit chain events for the explorer UI. Most recent first; cap 200.
 * Query: ?eventType=admin_key_rotated&status=anchored&limit=50
 */
router.get("/admin/audit-chain", requireAdmin, async (req: Request, res: Response) => {
  const eventType = typeof req.query.eventType === "string" ? req.query.eventType : null;
  const status = typeof req.query.status === "string" ? req.query.status : null;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const rows = await db.select().from(auditChainEventsTable).orderBy(desc(auditChainEventsTable.createdAt)).limit(limit);
  const filtered = rows.filter(r => {
    if (eventType && r.eventType !== eventType) return false;
    if (status && r.anchorStatus !== status) return false;
    return true;
  });
  res.json({
    chain: blockchainAuditStatus(),
    events: filtered.map(r => ({
      id: r.id,
      eventType: r.eventType,
      relatedEntity: r.relatedEntity,
      contextHash: r.contextHash,
      contextSnapshot: r.contextSnapshot,
      anchorProvider: r.anchorProvider,
      anchorTopicOrContractId: r.anchorTopicOrContractId,
      anchorSequenceNumber: r.anchorSequenceNumber,
      anchorTxId: r.anchorTxId,
      anchorConsensusTimestamp: r.anchorConsensusTimestamp,
      anchorStatus: r.anchorStatus,
      anchorError: r.anchorError,
      createdAt: r.createdAt,
      anchoredAt: r.anchoredAt,
      hashScanUrl: r.anchorTopicOrContractId
        ? hashScanUrl(r.anchorTopicOrContractId, r.anchorSequenceNumber, r.anchorTxId)
        : null,
    })),
  });
});

export default router;
