import { Resend } from "resend";
import { logger } from "../lib/logger";

/**
 * Transactional email sender. All templates gracefully no-op when
 * RESEND_API_KEY is not configured, logging a notice but never throwing —
 * so deploys without email credentials still function.
 *
 * Configure:
 *   RESEND_API_KEY   — API key from resend.com/api-keys
 *   EMAIL_FROM       — verified sender, e.g. "Capability Economics <no-reply@yourdomain.com>"
 *   APP_BASE_URL     — for building links in email bodies (fallback: inferred from request if available)
 */

type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  resendClient = new Resend(key);
  return resendClient;
}

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
}

async function sendRaw(payload: EmailPayload): Promise<void> {
  const client = getResendClient();
  const from = process.env.EMAIL_FROM;
  if (!client || !from) {
    logger.info(
      { to: payload.to, subject: payload.subject },
      "[email] RESEND_API_KEY or EMAIL_FROM not configured — email skipped",
    );
    return;
  }
  try {
    const { data, error } = await client.emails.send({
      from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });
    if (error) {
      logger.warn({ err: error, to: payload.to, subject: payload.subject }, "[email] resend returned error");
      return;
    }
    logger.info({ id: data?.id, to: payload.to, subject: payload.subject }, "[email] sent");
  } catch (err) {
    logger.warn({ err, to: payload.to, subject: payload.subject }, "[email] send failed");
  }
}

/** Minimal HTML wrapper — keeps all emails visually consistent without pulling a renderer in. */
function wrap(body: string): string {
  return `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /></head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
    <div style="margin-bottom: 24px;">
      <div style="display: inline-block; width: 40px; height: 40px; background: #4338ca; color: white; border-radius: 6px; text-align: center; line-height: 40px; font-family: Georgia, serif; font-weight: bold; font-size: 22px;">CE</div>
      <div style="display: inline-block; margin-left: 10px; vertical-align: middle; font-family: Georgia, serif; font-size: 18px;">Capability Economics</div>
    </div>
    ${body}
    <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 32px 0 16px;" />
    <p style="font-size: 12px; color: #888;">If you weren't expecting this email you can safely ignore it.</p>
  </body>
</html>`;
}

// ───────────────────── Templates ─────────────────────

export async function sendWelcomeEmail({ to, name, tierName }: { to: string; name?: string | null; tierName: string }): Promise<void> {
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi there,";
  await sendRaw({
    to,
    subject: `Welcome to Capability Economics — ${tierName} membership request received`,
    html: wrap(`
      <p>${greeting}</p>
      <p>Thanks for signing up for the <strong>${tierName}</strong> tier. We've received your request and our team will review it shortly.</p>
      <p>You'll get a follow-up email as soon as your membership is activated.</p>
      <p>— The Capability Economics team</p>
    `),
  });
}

export async function sendApprovalEmail({ to, name, tierName }: { to: string; name?: string | null; tierName: string }): Promise<void> {
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi there,";
  await sendRaw({
    to,
    subject: `Your ${tierName} membership is active`,
    html: wrap(`
      <p>${greeting}</p>
      <p>Good news — your <strong>${tierName}</strong> membership has been approved. You now have full access to the capabilities that ship with this tier.</p>
      <p><a href="${appUrl("/")}" style="display: inline-block; background: #4338ca; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Open your dashboard</a></p>
      <p>— The Capability Economics team</p>
    `),
  });
}

export async function sendRejectionEmail({ to, name, tierName, reason }: { to: string; name?: string | null; tierName: string; reason: string }): Promise<void> {
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi there,";
  await sendRaw({
    to,
    subject: `Update on your ${tierName} membership request`,
    html: wrap(`
      <p>${greeting}</p>
      <p>Your recent request for the <strong>${tierName}</strong> tier could not be approved at this time.</p>
      <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
      <p>If you believe this was in error, reply to this email and we'll take another look.</p>
      <p>— The Capability Economics team</p>
    `),
  });
}

export async function sendHoldEmail({ to, name, reason }: { to: string; name?: string | null; reason: string }): Promise<void> {
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi there,";
  await sendRaw({
    to,
    subject: `Your Capability Economics account has been placed on hold`,
    html: wrap(`
      <p>${greeting}</p>
      <p>Your account access has been temporarily suspended.</p>
      <p><strong>Reason:</strong> ${escapeHtml(reason)}</p>
      <p>Please reply to this email to resolve this and restore access.</p>
      <p>— The Capability Economics team</p>
    `),
  });
}

export async function sendReactivatedEmail({ to, name, tierName }: { to: string; name?: string | null; tierName: string }): Promise<void> {
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi there,";
  await sendRaw({
    to,
    subject: `Your ${tierName} membership is active again`,
    html: wrap(`
      <p>${greeting}</p>
      <p>Your <strong>${tierName}</strong> membership has been reactivated. Welcome back.</p>
      <p><a href="${appUrl("/")}" style="display: inline-block; background: #4338ca; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Open your dashboard</a></p>
    `),
  });
}

export async function sendCompEmail({ to, name, tierName, notes }: { to: string; name?: string | null; tierName: string; notes?: string | null }): Promise<void> {
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi there,";
  await sendRaw({
    to,
    subject: `You've been granted a ${tierName} membership`,
    html: wrap(`
      <p>${greeting}</p>
      <p>An administrator has granted you access to <strong>${tierName}</strong>. No payment is required.</p>
      ${notes ? `<p><em>Note: ${escapeHtml(notes)}</em></p>` : ""}
      <p><a href="${appUrl("/")}" style="display: inline-block; background: #4338ca; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Open your dashboard</a></p>
    `),
  });
}

export async function sendTierChangedEmail({ to, name, fromTier, toTier }: { to: string; name?: string | null; fromTier: string; toTier: string }): Promise<void> {
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi there,";
  await sendRaw({
    to,
    subject: `Your membership has been updated to ${toTier}`,
    html: wrap(`
      <p>${greeting}</p>
      <p>Your membership has been changed from <strong>${fromTier}</strong> to <strong>${toTier}</strong>.</p>
      <p>Your credit allocation has been updated to match the new tier.</p>
      <p><a href="${appUrl("/")}" style="display: inline-block; background: #4338ca; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Open your dashboard</a></p>
    `),
  });
}

// ───────────────────── Helpers ─────────────────────

function appUrl(path: string): string {
  const base = process.env.APP_BASE_URL ?? "https://capabilityeconomics-staging.up.railway.app";
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
