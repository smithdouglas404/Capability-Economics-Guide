/**
 * Foundry token expiry-alert helper. Emails the operator 30 minutes before
 * the active foundry_token row's projected expiry, so they can rotate the
 * token via the admin UI before the next hourly sync starts 401-ing.
 *
 * Event-driven: the Inngest function `foundryTokenExpiryAlert` listens on
 * `system.secret.expiring` and `step.sleepUntil` until expiry - 30 min,
 * then calls {@link sendFoundryExpiryEmail}. The event is emitted by
 * `POST /api/admin/foundry/rotate-token` (with the new token's expected
 * lifetime) or by the OAuth client-credentials mint path.
 *
 * Recipient resolution:
 *   1. system_secrets.notifyEmail for the foundry_token row (preferred —
 *      configurable per-token via PATCH /api/admin/foundry/notify-email)
 *   2. ADMIN_NOTIFY_EMAIL env var fallback
 *   3. Skip silently if neither is set (warn-level log only).
 *
 * Graceful degrade: when RESEND_API_KEY / EMAIL_FROM aren't configured,
 * {@link sendEmail} returns false and we log instead of throwing — the
 * Inngest function still returns "ok" so the run doesn't show as failed.
 */
import { db, systemSecretsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendEmail } from "../email";
import pino from "pino";

const logger = pino({ name: "foundry-expiry-alert" });

export interface FoundryExpiringEvent {
  secretName: string;
  /** ISO timestamp when the token is expected to expire. */
  expiresAt: string;
}

export interface ExpiryAlertResult {
  sent: boolean;
  to: string | null;
  reason?: string;
}

/**
 * Send the 30-min-before-expiry email. Idempotent — call as many times as
 * Inngest retries; downstream Resend dedup is the operator's call. Never
 * throws; returns { sent: false, reason } when skipped so the caller can
 * still report success to Inngest.
 */
export async function sendFoundryExpiryEmail(
  event: FoundryExpiringEvent,
): Promise<ExpiryAlertResult> {
  if (event.secretName !== "foundry") {
    return { sent: false, to: null, reason: `unsupported secretName: ${event.secretName}` };
  }

  let to: string | null = null;
  try {
    const [row] = await db
      .select({ notifyEmail: systemSecretsTable.notifyEmail })
      .from(systemSecretsTable)
      .where(eq(systemSecretsTable.keyName, "foundry_token"));
    to = row?.notifyEmail ?? null;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "DB lookup for notifyEmail failed");
  }
  if (!to) to = process.env.ADMIN_NOTIFY_EMAIL ?? null;
  if (!to) {
    logger.warn("no notifyEmail configured on system_secrets.foundry_token row or ADMIN_NOTIFY_EMAIL — expiry alert skipped");
    return { sent: false, to: null, reason: "no-recipient" };
  }

  const expiresAt = new Date(event.expiresAt);
  const minutesUntilExpiry = Math.round((expiresAt.getTime() - Date.now()) / 60_000);

  const subject = "[Inflexcvi] Foundry API token expires in ~30 minutes";
  const text = [
    `Your Foundry / Palantir API token is projected to expire at ${expiresAt.toISOString()}`,
    `(in ~${minutesUntilExpiry} minutes from now).`,
    "",
    "Action required: rotate the token via the admin UI before expiry, or the",
    "hourly Postgres → Foundry mirror sync will start failing with http_401.",
    "",
    "How to rotate:",
    "  1. Visit /admin/foundry in the admin UI",
    "  2. Click \"Rotate token\" and paste the new value",
    "  3. (Or POST /api/admin/foundry/rotate-token with the new token)",
    "",
    "If you've already rotated the token, you can ignore this email.",
  ].join("\n");

  const ok = await sendEmail({ to, subject, text });
  if (ok) {
    logger.info({ to, expiresAt: event.expiresAt }, "foundry expiry alert email sent");
    return { sent: true, to };
  }
  logger.warn({ to }, "foundry expiry alert email send returned false (email transport not configured?)");
  return { sent: false, to, reason: "email-transport-skipped" };
}
