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
  try {
    await sendRawStrict(payload);
  } catch (err) {
    logger.warn({ err, to: payload.to, subject: payload.subject }, "[email] send failed");
  }
}

/**
 * Like sendRaw but throws on provider error so callers (e.g. notification
 * dispatch) can record an accurate sent/failed status. Returns true on
 * delivery, throws on provider failure, or returns false when email is
 * not configured (caller should treat as "skipped", not "sent").
 */
async function sendRawStrict(payload: EmailPayload): Promise<boolean> {
  const client = getResendClient();
  const from = process.env.EMAIL_FROM;
  if (!client || !from) {
    logger.info(
      { to: payload.to, subject: payload.subject },
      "[email] RESEND_API_KEY or EMAIL_FROM not configured — email skipped",
    );
    return false;
  }
  const { data, error } = await client.emails.send({
    from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  });
  if (error) {
    throw new Error(typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : String(error));
  }
  logger.info({ id: data?.id, to: payload.to, subject: payload.subject }, "[email] sent");
  return true;
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

export async function sendListingApprovedEmail({ to, name, listingTitle }: { to: string; name?: string | null; listingTitle: string }): Promise<void> {
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi there,";
  await sendRaw({
    to,
    subject: `Your listing "${listingTitle}" is live in the marketplace`,
    html: wrap(`
      <p>${greeting}</p>
      <p>Your listing <strong>${escapeHtml(listingTitle)}</strong> has been approved and is now live in the Capability Economics marketplace.</p>
      <p>You'll start earning the moment someone purchases it. Payouts arrive via Stripe on your configured schedule.</p>
      <p><a href="${appUrl("/marketplace/sell")}" style="display: inline-block; background: #4338ca; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">View your listings</a></p>
      <p>— The Capability Economics team</p>
    `),
  });
}

export async function sendListingRejectedEmail({ to, name, listingTitle, reason }: { to: string; name?: string | null; listingTitle: string; reason: string }): Promise<void> {
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi there,";
  await sendRaw({
    to,
    subject: `Update on your marketplace listing "${listingTitle}"`,
    html: wrap(`
      <p>${greeting}</p>
      <p>We couldn't approve your listing <strong>${escapeHtml(listingTitle)}</strong> in its current form.</p>
      <p><strong>Feedback from our moderation team:</strong><br/>${escapeHtml(reason)}</p>
      <p>You can edit the listing and resubmit — no need to start over.</p>
      <p><a href="${appUrl("/marketplace/sell")}" style="display: inline-block; background: #4338ca; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Edit your listing</a></p>
    `),
  });
}

export async function sendOrgInviteEmail({ to, orgName, inviterName, acceptUrl }: { to: string; orgName: string; inviterName?: string | null; acceptUrl: string }): Promise<void> {
  await sendRaw({
    to,
    subject: `You've been invited to join ${orgName} on Capability Economics`,
    html: wrap(`
      <p>Hi there,</p>
      <p>${inviterName ? `<strong>${escapeHtml(inviterName)}</strong>` : "An administrator"} has invited you to join <strong>${escapeHtml(orgName)}</strong> on Capability Economics.</p>
      <p>Accept the invite to gain access to your team's membership tier and shared resources.</p>
      <p><a href="${acceptUrl}" style="display: inline-block; background: #4338ca; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Accept invite</a></p>
      <p style="font-size: 12px; color: #888;">This invite expires in 7 days. If you weren't expecting it you can ignore this email.</p>
    `),
  });
}

export async function sendPaymentFailedEmail({ to, name, tierName, amountCents }: { to: string; name?: string | null; tierName: string; amountCents: number | null }): Promise<void> {
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi there,";
  const amt = amountCents ? `$${(amountCents / 100).toFixed(2)}` : "your latest charge";
  await sendRaw({
    to,
    subject: `Payment failed — action required for your ${tierName} membership`,
    html: wrap(`
      <p>${greeting}</p>
      <p>We weren't able to process ${amt} for your <strong>${tierName}</strong> membership.</p>
      <p>Stripe will automatically retry over the next few days, but you can update your card now to avoid any interruption.</p>
      <p><a href="${appUrl("/account")}" style="display: inline-block; background: #4338ca; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Update payment method</a></p>
      <p>— The Capability Economics team</p>
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

/** Returns true on actual delivery; false when email is not configured (caller: "skipped"). Throws on provider failure. */
export async function sendAlertEmail({ to, name, subject, body }: { to: string; name?: string | null; subject: string; body: string }): Promise<boolean> {
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi there,";
  const safeBody = escapeHtml(body).replace(/\n/g, "<br/>");
  return sendRawStrict({
    to,
    subject: `[Alert] ${subject}`,
    html: wrap(`
      <p>${greeting}</p>
      <p><strong>${escapeHtml(subject)}</strong></p>
      <p>${safeBody}</p>
      <p><a href="${appUrl("/account?tab=notifications")}" style="display: inline-block; background: #4338ca; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Manage your alerts</a></p>
    `),
  });
}

/** Returns true on actual delivery; false when email is not configured / no items. Throws on provider failure. */
export async function sendDigestEmail({ to, name, items }: { to: string; name?: string | null; items: Array<{ subject: string; body: string }> }): Promise<boolean> {
  if (!items.length) return false;
  const greeting = name ? `Hi ${name.split(" ")[0]},` : "Hi there,";
  const list = items.map(i => `
    <div style="border-left: 3px solid #4338ca; padding: 8px 12px; margin: 12px 0; background: #f8f8fb;">
      <div style="font-weight: 600; margin-bottom: 4px;">${escapeHtml(i.subject)}</div>
      <div style="font-size: 13px; color: #555;">${escapeHtml(i.body).replace(/\n/g, "<br/>")}</div>
    </div>
  `).join("");
  return sendRawStrict({
    to,
    subject: `Your daily Capability Economics digest — ${items.length} alert${items.length === 1 ? "" : "s"}`,
    html: wrap(`
      <p>${greeting}</p>
      <p>Here's a summary of the alerts triggered for you today:</p>
      ${list}
      <p><a href="${appUrl("/account?tab=notifications")}" style="display: inline-block; background: #4338ca; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">Manage your alerts</a></p>
    `),
  });
}

// ───────────────────── Helpers ─────────────────────

function appUrl(path: string): string {
  const base = process.env.APP_BASE_URL ?? "https://capabilityeconomics-staging.up.railway.app";
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Capability-disruption digest delivery — caller supplies the full HTML/text
 * (no wrapper). Distinct from the older notification-digest sendDigestEmail
 * which takes a list of items. Throws on provider failure so the
 * subscription's lastError can record what went wrong.
 */
export async function sendCapabilityDigestEmail(args: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const ok = await sendRawStrict({ to: args.to, subject: args.subject, html: args.html, text: args.text });
  if (!ok) {
    throw new Error("Email not configured (RESEND_API_KEY or EMAIL_FROM missing)");
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
