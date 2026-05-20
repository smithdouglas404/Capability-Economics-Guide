/**
 * Weekly capability-disruption digest.
 *
 * Builds a payload of: top 5 disruption-watch entries, top 5 net-new
 * capabilities, and the 3 most recent severe macro events — optionally
 * filtered by the subscriber's industry/capability segments.
 *
 * Delivers via email (Resend) or Slack incoming webhook. Both channels
 * gracefully no-op if not configured; the subscription row's lastError
 * field captures the reason for any failure so the user can see it in
 * their settings.
 *
 * The cron driver (services/agent/scheduler.ts) calls runDigestSweep()
 * on a weekly cadence — it iterates active subscriptions where
 * lastSentAt is null or older than the frequency, builds + sends, and
 * updates lastSentAt/lastError per row.
 */
import { db } from "@workspace/db";
import {
  digestSubscriptionsTable,
  industriesTable,
  capabilitiesTable,
  macroEventsTable,
} from "@workspace/db";
import { eq, gte, desc, inArray } from "drizzle-orm";
import { getDisruptionWatch, type DisruptionWatchEntry } from "./disruption";
import { getNewCapabilityWatch, type NewCapabilityEntry } from "./new-capabilities";
import { sendCapabilityDigestEmail } from "./email";
import { logger } from "../lib/logger";

export interface DigestPayload {
  generatedAt: string;
  windowDays: number;
  segments: {
    industryNames: string[];
    capabilityNames: string[];
  };
  disruptionWatch: DisruptionWatchEntry[];
  newCapabilities: NewCapabilityEntry[];
  macroEvents: Array<{
    id: number;
    title: string;
    eventType: string;
    severity: number;
    sentimentDirection: string;
    startedAt: string;
    description: string;
  }>;
}

export async function buildDigest(opts: {
  industryIds: number[];
  capabilityIds: number[];
  windowDays?: number;
}): Promise<DigestPayload> {
  const windowDays = opts.windowDays ?? 7;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [disruption, newCaps, allIndustries] = await Promise.all([
    getDisruptionWatch({ limit: 5 }),
    getNewCapabilityWatch({ maxAgeMonths: 24, minScore: 30, limit: 50 }),
    db.select().from(industriesTable),
  ]);

  const indById = new Map(allIndustries.map(i => [i.id, i]));

  // Apply segment filters on the watch + new-caps. Empty arrays = no filter.
  const filteredDisruption = opts.industryIds.length === 0 && opts.capabilityIds.length === 0
    ? disruption.rows
    : disruption.rows.filter(r =>
      (opts.industryIds.length === 0 || opts.industryIds.includes(r.industryId))
      && (opts.capabilityIds.length === 0 || opts.capabilityIds.includes(r.capabilityId))
    );

  const filteredNewCaps = opts.industryIds.length === 0 && opts.capabilityIds.length === 0
    ? newCaps.rows.slice(0, 5)
    : newCaps.rows.filter(r =>
      (opts.industryIds.length === 0 || opts.industryIds.includes(r.industryId))
      && (opts.capabilityIds.length === 0 || opts.capabilityIds.includes(r.capabilityId))
    ).slice(0, 5);

  // Macro events touching segments in the last `windowDays`. When no segment,
  // include the top 3 by severity.
  const macroRows = await db
    .select({
      id: macroEventsTable.id,
      title: macroEventsTable.title,
      eventType: macroEventsTable.eventType,
      severity: macroEventsTable.severity,
      sentimentDirection: macroEventsTable.sentimentDirection,
      startedAt: macroEventsTable.startedAt,
      description: macroEventsTable.description,
      affectedIndustryIds: macroEventsTable.affectedIndustryIds,
      affectedCapabilityIds: macroEventsTable.affectedCapabilityIds,
    })
    .from(macroEventsTable)
    .where(gte(macroEventsTable.startedAt, since))
    .orderBy(desc(macroEventsTable.severity))
    .limit(20);

  const filteredMacro = macroRows.filter(m => {
    if (opts.industryIds.length === 0 && opts.capabilityIds.length === 0) return true;
    const affInd = (m.affectedIndustryIds ?? []) as number[];
    const affCap = (m.affectedCapabilityIds ?? []) as number[];
    return (opts.industryIds.length > 0 && affInd.some(id => opts.industryIds.includes(id)))
      || (opts.capabilityIds.length > 0 && affCap.some(id => opts.capabilityIds.includes(id)));
  }).slice(0, 3).map(m => ({
    id: m.id,
    title: m.title,
    eventType: m.eventType,
    severity: m.severity,
    sentimentDirection: m.sentimentDirection,
    startedAt: m.startedAt.toISOString(),
    description: m.description,
  }));

  // Resolve segment names for the email header.
  const industryNames = opts.industryIds.map(id => indById.get(id)?.name).filter((n): n is string => !!n);
  let capabilityNames: string[] = [];
  if (opts.capabilityIds.length > 0) {
    const caps = await db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name })
      .from(capabilitiesTable).where(inArray(capabilitiesTable.id, opts.capabilityIds));
    capabilityNames = caps.map(c => c.name);
  }

  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    segments: { industryNames, capabilityNames },
    disruptionWatch: filteredDisruption.slice(0, 5),
    newCapabilities: filteredNewCaps,
    macroEvents: filteredMacro,
  };
}

// ─── HTML formatter ──────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}

export function formatDigestHtml(p: DigestPayload, appBaseUrl: string): { subject: string; html: string; text: string } {
  const segLine = p.segments.industryNames.length > 0
    ? `Filtered to ${p.segments.industryNames.join(", ")}`
    : "Across all tracked industries";

  const subject = `Capability Disruption Digest · ${new Date(p.generatedAt).toLocaleDateString()} · ${p.disruptionWatch.length + p.newCapabilities.length} moves`;

  const link = (path: string) => `${appBaseUrl.replace(/\/$/, "")}${path}`;

  const disruptionRows = p.disruptionWatch.length === 0
    ? `<p style="color:#888;font-style:italic;">No capabilities meet the disruption watch threshold this week.</p>`
    : p.disruptionWatch.map(d => `
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">
            <a href="${link(`/capability/${d.capabilityId}`)}" style="color:#0a0a0f;text-decoration:none;font-weight:600;">${escapeHtml(d.capabilityName)}</a>
            <div style="color:#666;font-size:12px;margin-top:2px;">${escapeHtml(d.industryName)}</div>
          </td>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;">
            <span style="color:#ef4444;font-weight:600;">${(d.probability * 100).toFixed(0)}%</span>
            <div style="color:#666;font-size:11px;margin-top:2px;">P(disrupt)</div>
          </td>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;">
            <span style="color:#10b981;font-weight:600;">+${(d.velocity ?? 0).toFixed(1)}</span>
            <div style="color:#666;font-size:11px;margin-top:2px;">velocity</div>
          </td>
        </tr>
      `).join("");

  const newCapRows = p.newCapabilities.length === 0
    ? `<p style="color:#888;font-style:italic;">No net-new capabilities to report this week.</p>`
    : p.newCapabilities.map(c => `
        <tr>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">
            <a href="${link(`/capability/${c.capabilityId}`)}" style="color:#0a0a0f;text-decoration:none;font-weight:600;">${escapeHtml(c.capabilityName)}</a>
            <div style="color:#666;font-size:12px;margin-top:2px;">${escapeHtml(c.industryName)} · ${c.ageMonths.toFixed(0)}mo old</div>
          </td>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;">
            <span style="color:#0a0a0f;font-weight:600;">${c.consensusScore?.toFixed(0) ?? "—"}</span>
            <div style="color:#666;font-size:11px;margin-top:2px;">CVI</div>
          </td>
          <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;">
            <span style="color:#10b981;font-weight:600;">+${(c.velocity ?? 0).toFixed(1)}</span>
            <div style="color:#666;font-size:11px;margin-top:2px;">velocity</div>
          </td>
        </tr>
      `).join("");

  const macroRows = p.macroEvents.length === 0
    ? ""
    : `
      <h2 style="font-family:Georgia,serif;font-size:18px;color:#0a0a0f;margin:32px 0 8px 0;">Macro events this week</h2>
      <table style="width:100%;border-collapse:collapse;">
        ${p.macroEvents.map(m => `
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">
              <strong style="color:#0a0a0f;">${escapeHtml(m.title)}</strong>
              <span style="color:#666;font-size:11px;margin-left:8px;">severity ${m.severity.toFixed(1)} · ${m.sentimentDirection}</span>
              <p style="color:#444;font-size:13px;margin:4px 0 0 0;">${escapeHtml(m.description.slice(0, 200))}${m.description.length > 200 ? "…" : ""}</p>
            </td>
          </tr>
        `).join("")}
      </table>
    `;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a2e;">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;padding:32px 24px;">
    <div style="border-bottom:1px solid #e5e7eb;padding-bottom:16px;margin-bottom:24px;">
      <div style="font-family:monospace;font-size:11px;color:#4f6ef7;letter-spacing:0.18em;text-transform:uppercase;">Inflexcvi · weekly digest</div>
      <h1 style="font-family:Georgia,serif;font-size:28px;color:#0a0a0f;margin:8px 0 4px 0;line-height:1.15;">What moved this week.</h1>
      <div style="color:#666;font-size:13px;">${segLine} · ${new Date(p.generatedAt).toLocaleDateString()}</div>
    </div>

    <h2 style="font-family:Georgia,serif;font-size:18px;color:#0a0a0f;margin:0 0 8px 0;">Disruption Watch</h2>
    <p style="color:#666;font-size:13px;margin:0 0 12px 0;">High probability of disruption, rising velocity, recent macro exposure.</p>
    <table style="width:100%;border-collapse:collapse;">${disruptionRows}</table>

    <h2 style="font-family:Georgia,serif;font-size:18px;color:#0a0a0f;margin:32px 0 8px 0;">Net-new capabilities</h2>
    <p style="color:#666;font-size:13px;margin:0 0 12px 0;">Capabilities that did not exist 24 months ago and now show meaningful CVI.</p>
    <table style="width:100%;border-collapse:collapse;">${newCapRows}</table>

    ${macroRows}

    <div style="margin-top:40px;padding-top:24px;border-top:1px solid #e5e7eb;text-align:center;">
      <a href="${link("/disruption")}" style="display:inline-block;padding:12px 24px;background:#0a0a0f;color:#ffffff;text-decoration:none;font-family:monospace;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;">Open the live disruption feed</a>
      <div style="margin-top:16px;color:#888;font-size:12px;">
        <a href="${link("/account/notifications")}" style="color:#4f6ef7;text-decoration:none;">Manage digest preferences</a>
        ·
        <a href="${link("/workbench")}" style="color:#4f6ef7;text-decoration:none;">Open the workbench</a>
      </div>
    </div>
  </div>
</body></html>`;

  const text = [
    `Inflexcvi · weekly digest`,
    `${segLine} · ${new Date(p.generatedAt).toLocaleDateString()}`,
    ``,
    `── Disruption Watch ──`,
    ...p.disruptionWatch.map(d => `- ${d.capabilityName} (${d.industryName}) · P(disrupt) ${(d.probability * 100).toFixed(0)}% · velocity +${(d.velocity ?? 0).toFixed(1)}`),
    ``,
    `── Net-new capabilities ──`,
    ...p.newCapabilities.map(c => `- ${c.capabilityName} (${c.industryName}) · ${c.ageMonths.toFixed(0)}mo old · CVI ${c.consensusScore?.toFixed(0) ?? "—"} · velocity +${(c.velocity ?? 0).toFixed(1)}`),
    ``,
    p.macroEvents.length > 0 ? "── Macro events ──" : "",
    ...p.macroEvents.map(m => `- ${m.title} · severity ${m.severity.toFixed(1)} · ${m.sentimentDirection}`),
    ``,
    `Live feed: ${link("/disruption")}`,
    `Manage preferences: ${link("/account/notifications")}`,
  ].filter(Boolean).join("\n");

  return { subject, html, text };
}

// ─── Slack formatter ─────────────────────────────────────────────────────────

export function formatDigestSlack(p: DigestPayload, appBaseUrl: string): Record<string, unknown> {
  const link = (path: string) => `${appBaseUrl.replace(/\/$/, "")}${path}`;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: `Capability Disruption Digest · ${new Date(p.generatedAt).toLocaleDateString()}` },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: p.segments.industryNames.length > 0 ? `_Filtered to ${p.segments.industryNames.join(", ")}_` : "_All tracked industries_" }],
    },
    { type: "divider" },
  ];

  if (p.disruptionWatch.length > 0) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Disruption Watch*" } });
    p.disruptionWatch.forEach(d => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<${link(`/capability/${d.capabilityId}`)}|*${d.capabilityName}*> (${d.industryName})\nP(disrupt) *${(d.probability * 100).toFixed(0)}%* · velocity *+${(d.velocity ?? 0).toFixed(1)}*`,
        },
      });
    });
  }

  if (p.newCapabilities.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Net-new capabilities*" } });
    p.newCapabilities.forEach(c => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<${link(`/capability/${c.capabilityId}`)}|*${c.capabilityName}*> (${c.industryName})\n${c.ageMonths.toFixed(0)}mo old · CVI *${c.consensusScore?.toFixed(0) ?? "—"}* · velocity *+${(c.velocity ?? 0).toFixed(1)}*`,
        },
      });
    });
  }

  if (p.macroEvents.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Macro events this week*" } });
    p.macroEvents.forEach(m => {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${m.title}* — severity ${m.severity.toFixed(1)} · ${m.sentimentDirection}\n${m.description.slice(0, 200)}${m.description.length > 200 ? "…" : ""}`,
        },
      });
    });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "actions",
    elements: [
      { type: "button", text: { type: "plain_text", text: "Open live disruption feed" }, url: link("/disruption") },
      { type: "button", text: { type: "plain_text", text: "Open workbench" }, url: link("/workbench") },
    ],
  });

  return {
    text: `Capability Disruption Digest · ${new Date(p.generatedAt).toLocaleDateString()}`,
    blocks,
  };
}

// ─── Senders ─────────────────────────────────────────────────────────────────

async function sendToSlack(webhookUrl: string, payload: Record<string, unknown>): Promise<void> {
  const r = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Slack webhook ${r.status}: ${body.slice(0, 200)}`);
  }
}

export interface DeliveryResult {
  ok: boolean;
  channel: "email" | "slack";
  destination: string;
  error?: string;
}

/**
 * Build + send for a single subscription. Returns the delivery result;
 * does not update the lastSentAt — caller (the sweep) does that.
 */
export async function buildAndSendForSubscription(sub: typeof digestSubscriptionsTable.$inferSelect, options: {
  destinationEmail?: string | null;
  appBaseUrl: string;
}): Promise<DeliveryResult> {
  const payload = await buildDigest({
    industryIds: sub.industryIds ?? [],
    capabilityIds: sub.capabilityIds ?? [],
    windowDays: sub.frequency === "daily" ? 1 : 7,
  });

  if (sub.channel === "slack") {
    const webhook = sub.slackWebhookUrl;
    if (!webhook) return { ok: false, channel: "slack", destination: "", error: "No Slack webhook URL configured" };
    try {
      const slackBody = formatDigestSlack(payload, options.appBaseUrl);
      await sendToSlack(webhook, slackBody);
      return { ok: true, channel: "slack", destination: webhook.replace(/\/services\/.*/, "/services/***") };
    } catch (err) {
      return { ok: false, channel: "slack", destination: webhook.replace(/\/services\/.*/, "/services/***"), error: (err as Error).message };
    }
  }

  // Email path.
  const to = sub.emailOverride ?? options.destinationEmail ?? null;
  if (!to) return { ok: false, channel: "email", destination: "", error: "No email address (no Clerk primary email + no override)" };
  try {
    const { subject, html, text } = formatDigestHtml(payload, options.appBaseUrl);
    await sendCapabilityDigestEmail({ to, subject, html, text });
    return { ok: true, channel: "email", destination: to };
  } catch (err) {
    return { ok: false, channel: "email", destination: to, error: (err as Error).message };
  }
}

/**
 * Iterate every active subscription whose lastSentAt is past the frequency
 * threshold. Send to each in series (to keep Resend/Slack rate-limits sane).
 * Caller decides cadence — scheduler invokes this weekly.
 */
export async function runDigestSweep(opts?: { force?: boolean; appBaseUrl?: string }): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  results: Array<{ subscriptionId: number; userId: string; result: DeliveryResult }>;
}> {
  const force = opts?.force ?? false;
  const appBaseUrl = opts?.appBaseUrl ?? process.env.APP_BASE_URL ?? "";
  const now = Date.now();
  const weeklyCutoff = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const dailyCutoff = new Date(now - 24 * 60 * 60 * 1000);

  const subs = await db.select().from(digestSubscriptionsTable).where(eq(digestSubscriptionsTable.active, true));
  const due = force ? subs : subs.filter(s => {
    if (!s.lastSentAt) return true;
    const cutoff = s.frequency === "daily" ? dailyCutoff : weeklyCutoff;
    return s.lastSentAt < cutoff;
  });

  let succeeded = 0;
  let failed = 0;
  const results: Array<{ subscriptionId: number; userId: string; result: DeliveryResult }> = [];

  for (const sub of due) {
    // Resolve email from Clerk if needed.
    let destinationEmail: string | null = sub.emailOverride;
    if (sub.channel === "email" && !destinationEmail) {
      try {
        const { clerkClient } = await import("@clerk/express");
        const user = await clerkClient.users.getUser(sub.userId);
        destinationEmail = user.primaryEmailAddress?.emailAddress
          ?? user.emailAddresses[0]?.emailAddress
          ?? null;
      } catch (err) {
        logger.warn({ err, userId: sub.userId }, "[digest] failed to resolve Clerk email");
      }
    }

    const result = await buildAndSendForSubscription(sub, { destinationEmail, appBaseUrl });
    results.push({ subscriptionId: sub.id, userId: sub.userId, result });

    await db.update(digestSubscriptionsTable).set({
      lastSentAt: result.ok ? new Date() : sub.lastSentAt,
      lastError: result.ok ? null : (result.error ?? "Unknown error"),
      updatedAt: new Date(),
    }).where(eq(digestSubscriptionsTable.id, sub.id));

    if (result.ok) succeeded += 1;
    else failed += 1;
  }

  return { attempted: due.length, succeeded, failed, results };
}

