import { Router, type Request, type Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { db, systemSecretsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireAdmin, invalidateAdminKeyCache } from "../middlewares/requireAdmin";
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
      hint: "No rotation history yet — admin key is sourced from the ADMIN_API_KEY env var.",
    });
    return;
  }
  res.json({
    rotations: row.auditLog ?? [],
    rotatedAt: row.rotatedAt,
    rotatedByUserId: row.rotatedByUserId,
    currentSource: "db",
  });
});

export default router;
