/**
 * Scheduled admin-key rotation.
 *
 * Once per CHECK_INTERVAL_MS, look at the system_secrets row for
 * "admin_api_key". If auto-rotate is enabled and the current key is older
 * than rotationCadenceDays, rotate it: generate a fresh key, write the new
 * row, append an audit_log entry, anchor on Hedera (if configured), and
 * email the new key to notifyEmail via Resend.
 *
 * Failure modes:
 *   - Email send fails → log; rotation still completes (key is in DB,
 *     operator can recover via /api/admin/security/admin-key-history).
 *   - Hedera anchor fails → log; DB-side audit row still written.
 *   - DB unreachable → log; nothing rotates; next tick retries.
 *
 * Started from src/index.ts on server boot. Lazy: if NEVER configured
 * (auto_rotate_enabled = false), this checker is a single SELECT every
 * 24h that does nothing.
 */
import { createHash, randomBytes } from "node:crypto";
import { db, systemSecretsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { invalidateAdminKeyCache } from "../middlewares/requireAdmin";
import { anchorEvent } from "./blockchain-audit";
import { sendEmail } from "./email";
import { logger } from "../lib/logger";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

function generateKey(): string {
  return randomBytes(32).toString("base64url");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function checkAndRotate(): Promise<void> {
  let row: typeof systemSecretsTable.$inferSelect | undefined;
  try {
    [row] = await db.select().from(systemSecretsTable).where(eq(systemSecretsTable.keyName, "admin_api_key"));
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[scheduled-rotation] DB unreachable, skipping");
    return;
  }
  if (!row) {
    // No row yet — env-var key still in use. Auto-rotation requires an
    // initial manual rotation to establish the row.
    return;
  }
  if (!row.autoRotateEnabled) return;

  // Update lastAutoCheckAt even when not rotating, so operators know the
  // checker ran.
  const now = new Date();
  const ageMs = now.getTime() - row.rotatedAt.getTime();
  const cadenceMs = row.rotationCadenceDays * 24 * 60 * 60 * 1000;
  if (ageMs < cadenceMs) {
    await db.update(systemSecretsTable)
      .set({ lastAutoCheckAt: now })
      .where(eq(systemSecretsTable.id, row.id));
    return;
  }

  // Time to rotate.
  const newKey = generateKey();
  const previousValueHash = sha256(row.keyValue);
  const auditEntry = {
    rotatedAt: now.toISOString(),
    rotatedByUserId: "auto" as const,
    source: "scheduled_auto" as const,
    reason: `Auto-rotation after ${row.rotationCadenceDays} days`,
    previousValueHash,
  };

  // Persist new key + audit log first (don't lose the rotation if Hedera /
  // email fails).
  await db.update(systemSecretsTable).set({
    keyValue: newKey,
    rotatedAt: now,
    rotatedByUserId: "auto",
    lastAutoCheckAt: now,
    auditLog: [...(row.auditLog ?? []), auditEntry].slice(-100),
  }).where(eq(systemSecretsTable.id, row.id));
  invalidateAdminKeyCache();
  logger.info({ rotationCadenceDays: row.rotationCadenceDays }, "[scheduled-rotation] ADMIN_API_KEY auto-rotated");

  // Anchor on Hedera (best-effort, async — fire-and-forget).
  void anchorEvent("admin_key_rotated", {
    contextHash: previousValueHash,
    contextSnapshot: { source: "scheduled_auto", cadenceDays: row.rotationCadenceDays },
    relatedEntity: `system_secrets:${row.id}`,
  });

  // Notify operator via email (best-effort).
  if (row.notifyEmail) {
    try {
      await sendEmail({
        to: row.notifyEmail,
        subject: "[Capability Economics] Admin API key auto-rotated",
        text: [
          "Your Capability Economics admin API key was rotated automatically as scheduled.",
          "",
          "The previous key has stopped working immediately. Save the new value below into your password manager and paste it into the admin UI's Admin Key field.",
          "",
          `New admin key:`,
          `${newKey}`,
          "",
          `Rotated at: ${now.toISOString()}`,
          `Next auto-rotation: ${new Date(now.getTime() + cadenceMs).toISOString()}`,
          "",
          "Blockchain anchor: submitted to Hedera (or skipped if not configured) — check /admin/audit-chain for the receipt.",
        ].join("\n"),
      });
      logger.info({ to: row.notifyEmail }, "[scheduled-rotation] notification email sent");
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), to: row.notifyEmail },
        "[scheduled-rotation] email send failed — operator must retrieve key via admin UI or DB",
      );
    }
  } else {
    logger.warn("[scheduled-rotation] no notifyEmail configured — operator MUST retrieve the new key via /admin/case-studies before they get locked out");
  }
}

let timer: NodeJS.Timeout | null = null;

export function startScheduledRotation(): void {
  if (timer) return;
  // Initial check 60s after boot (let the app settle), then daily.
  setTimeout(() => { void checkAndRotate(); }, 60_000);
  timer = setInterval(() => { void checkAndRotate(); }, CHECK_INTERVAL_MS);
}

export function stopScheduledRotation(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
