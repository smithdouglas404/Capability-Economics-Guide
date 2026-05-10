import { db } from "@workspace/db";
import {
  userSubscriptionsTable,
  notificationDeliveriesTable,
  capabilitiesTable,
  industriesTable,
  ceiComponentsTable,
  type UserSubscription,
  type MacroEvent,
} from "@workspace/db";
import { and, eq, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getClerkUserSummary } from "./clerk-user";
import { isEmailConfigured, sendAlertEmail, sendDigestEmail } from "./email";
import { deriveLifecycleStage } from "./lifecycle";

/**
 * Subscription evaluation + delivery.
 *
 * Hooked into:
 *   - computeCEI()      → after a snapshot is persisted, evaluates capability
 *                         threshold + lifecycle change subscriptions.
 *   - createMacroEvent() → fires macro_event subscriptions matching the new
 *                         event's industry and severity.
 *   - computeCompanyScores() → fires quadrant_transition subscriptions.
 *
 * Realtime subscriptions deliver immediately. daily_digest subs are queued
 * (status="queued") in notification_deliveries and flushed by
 * `sendDailyDigests()` (idempotent, safe to call from cron).
 */

type CondCapThreshold = { capabilityId: number; direction: "above" | "below"; threshold: number };
type CondLifecycle = { capabilityId: number };
type CondMacro = { industryId?: number; minSeverity: number };
type CondQuadrant = { capabilityId?: number; industryId?: number };

export interface CreateSubscriptionInput {
  userId: string;
  targetType: "capability_threshold" | "lifecycle_change" | "macro_event" | "quadrant_transition";
  targetId?: number | null;
  condition: Record<string, unknown>;
  channel?: "email" | "slack" | "webhook";
  channelTarget?: string | null;
  frequency?: "realtime" | "daily_digest";
  label?: string | null;
}

export async function createSubscription(input: CreateSubscriptionInput): Promise<UserSubscription> {
  const [row] = await db.insert(userSubscriptionsTable).values({
    userId: input.userId,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    condition: input.condition,
    channel: input.channel ?? "email",
    channelTarget: input.channelTarget ?? null,
    frequency: input.frequency ?? "realtime",
    label: input.label ?? null,
    active: 1,
  }).returning();
  return row;
}

export async function listUserSubscriptions(userId: string): Promise<UserSubscription[]> {
  return db.select().from(userSubscriptionsTable).where(eq(userSubscriptionsTable.userId, userId)).orderBy(desc(userSubscriptionsTable.createdAt));
}

export async function deleteSubscription(userId: string, id: number): Promise<boolean> {
  const result = await db.delete(userSubscriptionsTable)
    .where(and(eq(userSubscriptionsTable.id, id), eq(userSubscriptionsTable.userId, userId)))
    .returning();
  return result.length > 0;
}

export async function setSubscriptionActive(userId: string, id: number, active: boolean): Promise<boolean> {
  const result = await db.update(userSubscriptionsTable)
    .set({ active: active ? 1 : 0 })
    .where(and(eq(userSubscriptionsTable.id, id), eq(userSubscriptionsTable.userId, userId)))
    .returning();
  return result.length > 0;
}

// ─────────────────── Evaluation hooks ───────────────────

/**
 * Snapshot of per-capability state used for change detection. Built once
 * at the start of evaluateAfterCEI and diffed against the just-persisted
 * cei_components rows.
 */
interface CapState {
  consensusScore: number;
  velocity: number;
  lifecycle: ReturnType<typeof deriveLifecycleStage>;
}

/**
 * Compare the previous and current cei_components state and fire any
 * matching capability_threshold / lifecycle_change subscriptions.
 *
 * `prevByCapId` should be a snapshot taken *before* the new computeCEI
 * persisted its updates — the engine handles capturing this and passes
 * it in. If absent, only threshold (above/below) checks fire.
 */
export async function evaluateAfterCEI(prevByCapId: Map<number, CapState>): Promise<void> {
  const subs = await db.select().from(userSubscriptionsTable).where(and(
    eq(userSubscriptionsTable.active, 1),
    sql`${userSubscriptionsTable.targetType} IN ('capability_threshold','lifecycle_change')`,
  ));
  if (!subs.length) return;
  const currByCapId = await snapshotCapStates();

  for (const sub of subs) {
    try {
      if (sub.targetType === "capability_threshold") {
        const cond = sub.condition as unknown as CondCapThreshold;
        const curr = currByCapId.get(cond.capabilityId);
        const prev = prevByCapId.get(cond.capabilityId);
        if (!curr) continue;
        const crossedUp = cond.direction === "above" && curr.consensusScore >= cond.threshold && (!prev || prev.consensusScore < cond.threshold);
        const crossedDown = cond.direction === "below" && curr.consensusScore <= cond.threshold && (!prev || prev.consensusScore > cond.threshold);
        if (!crossedUp && !crossedDown) continue;
        const cap = await getCapabilityName(cond.capabilityId);
        await dispatch(sub, {
          subject: `${cap ?? "Capability"} crossed ${cond.direction} ${cond.threshold}`,
          body: `${cap ?? `Capability #${cond.capabilityId}`} score is now ${curr.consensusScore.toFixed(1)} (was ${prev?.consensusScore.toFixed(1) ?? "—"}).`,
          payload: { capabilityId: cond.capabilityId, current: curr.consensusScore, previous: prev?.consensusScore ?? null, threshold: cond.threshold, direction: cond.direction },
        });
      } else if (sub.targetType === "lifecycle_change") {
        const cond = sub.condition as unknown as CondLifecycle;
        const curr = currByCapId.get(cond.capabilityId);
        const prev = prevByCapId.get(cond.capabilityId);
        if (!curr || !prev || curr.lifecycle === prev.lifecycle) continue;
        const cap = await getCapabilityName(cond.capabilityId);
        await dispatch(sub, {
          subject: `${cap ?? "Capability"} lifecycle: ${prev.lifecycle} → ${curr.lifecycle}`,
          body: `${cap ?? `Capability #${cond.capabilityId}`} moved from ${prev.lifecycle} to ${curr.lifecycle} on the latest CEI snapshot.`,
          payload: { capabilityId: cond.capabilityId, previousStage: prev.lifecycle, currentStage: curr.lifecycle },
        });
      }
    } catch (err) {
      logger.warn({ err, subscriptionId: sub.id }, "[subscriptions] evaluation failed");
    }
  }
}

/**
 * Pre-compute a per-capability CapState map for diffing. cei_components is
 * unique by (capabilityId, industryId), so a capability can appear in
 * multiple industries. We aggregate to a single global value per capability
 * by averaging across industries — making subscription diffs deterministic
 * regardless of insertion order.
 */
export async function snapshotCapStates(): Promise<Map<number, CapState>> {
  const [components, caps] = await Promise.all([
    db.select().from(ceiComponentsTable),
    db.select().from(capabilitiesTable),
  ]);
  const capById = new Map(caps.map(c => [c.id, c]));
  const grouped = new Map<number, { score: number[]; vel: number[] }>();
  for (const c of components) {
    const g = grouped.get(c.capabilityId) ?? { score: [], vel: [] };
    g.score.push(c.consensusScore);
    g.vel.push(c.velocity);
    grouped.set(c.capabilityId, g);
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const out = new Map<number, CapState>();
  for (const [capId, g] of grouped) {
    const consensusScore = avg(g.score);
    const velocity = avg(g.vel);
    out.set(capId, {
      consensusScore,
      velocity,
      lifecycle: deriveLifecycleStage({
        consensusScore,
        velocity,
        benchmarkScore: capById.get(capId)?.benchmarkScore ?? null,
      }),
    });
  }
  return out;
}

async function getCapabilityName(capId: number): Promise<string | null> {
  const [r] = await db.select({ name: capabilitiesTable.name }).from(capabilitiesTable).where(eq(capabilitiesTable.id, capId)).limit(1);
  return r?.name ?? null;
}

/** Fire macro_event subs matching the new event's industry + severity. */
export async function evaluateAfterMacroEvent(event: MacroEvent): Promise<void> {
  const subs = await db.select().from(userSubscriptionsTable).where(and(
    eq(userSubscriptionsTable.active, 1),
    eq(userSubscriptionsTable.targetType, "macro_event"),
  ));
  if (!subs.length) return;
  const affected = (event.affectedIndustryIds ?? []) as number[];
  const industries = await db.select().from(industriesTable);
  const industryNameById = new Map(industries.map(i => [i.id, i.name]));

  for (const sub of subs) {
    try {
      const cond = sub.condition as unknown as CondMacro;
      if (event.severity < (cond.minSeverity ?? 0)) continue;
      if (cond.industryId && affected.length && !affected.includes(cond.industryId)) continue;
      const indNames = affected.map(id => industryNameById.get(id) ?? `#${id}`).join(", ") || "Global";
      await dispatch(sub, {
        subject: `Macro event (severity ${event.severity}): ${event.title}`,
        body: `${event.description ?? event.title}\n\nAffected: ${indNames}\nDecays over: ${event.decayDays} days.`,
        payload: { eventId: event.id, severity: event.severity, industries: affected, sentimentDirection: event.sentimentDirection },
      });
    } catch (err) {
      logger.warn({ err, subscriptionId: sub.id }, "[subscriptions] macro evaluation failed");
    }
  }
}

/**
 * Fire quadrant_transition subs when a CAPABILITY's consensus quadrant
 * changes (per industry). Quadrants live on the capability_economics
 * table (hot/emerging/cooling/table_stakes) — not on companies — so this
 * evaluator is keyed on (capabilityId, industryId). Wired from
 * services/alpha/enrich.ts after each enrichment row is written.
 */
export async function evaluateAfterQuadrantChange(
  capabilityId: number,
  industryId: number,
  prevQuadrant: string | null,
  currQuadrant: string | null,
): Promise<void> {
  if (!currQuadrant || prevQuadrant === currQuadrant) return;
  const subs = await db.select().from(userSubscriptionsTable).where(and(
    eq(userSubscriptionsTable.active, 1),
    eq(userSubscriptionsTable.targetType, "quadrant_transition"),
  ));
  if (!subs.length) return;
  const capName = await getCapabilityName(capabilityId);
  for (const sub of subs) {
    try {
      const cond = sub.condition as unknown as CondQuadrant;
      if (cond.capabilityId && cond.capabilityId !== capabilityId) continue;
      if (cond.industryId && cond.industryId !== industryId) continue;
      await dispatch(sub, {
        subject: `${capName ?? `Capability #${capabilityId}`} moved to ${currQuadrant}`,
        body: `Quadrant transition: ${prevQuadrant ?? "—"} → ${currQuadrant}.`,
        payload: { capabilityId, industryId, previousQuadrant: prevQuadrant, currentQuadrant: currQuadrant },
      });
    } catch (err) {
      logger.warn({ err, subscriptionId: sub.id }, "[subscriptions] quadrant evaluation failed");
    }
  }
}

// ─────────────────── Delivery ───────────────────

interface DispatchPayload {
  subject: string;
  body: string;
  payload: Record<string, unknown>;
}

async function dispatch(sub: UserSubscription, content: DispatchPayload): Promise<void> {
  // Daily digest: queue and let the digest job send a single email.
  if (sub.frequency === "daily_digest") {
    await db.insert(notificationDeliveriesTable).values({
      subscriptionId: sub.id,
      userId: sub.userId,
      channel: sub.channel,
      subject: content.subject,
      body: content.body,
      payload: content.payload,
      status: "queued",
    });
    await db.update(userSubscriptionsTable).set({ lastTriggeredAt: new Date() }).where(eq(userSubscriptionsTable.id, sub.id));
    return;
  }

  // Realtime: send now, log result.
  let status: "sent" | "failed" | "skipped" = "skipped";
  let errorMessage: string | null = null;
  try {
    if (sub.channel === "email") {
      if (!isEmailConfigured()) {
        status = "skipped";
        errorMessage = "email not configured";
      } else {
        const summary = await getClerkUserSummary(sub.userId);
        if (!summary.email) {
          status = "skipped";
          errorMessage = "no email on file";
        } else {
          const delivered = await sendAlertEmail({ to: summary.email, name: summary.firstName, subject: content.subject, body: content.body });
          status = delivered ? "sent" : "skipped";
          if (!delivered) errorMessage = "email provider not configured";
        }
      }
    } else if (sub.channel === "slack" || sub.channel === "webhook") {
      if (!sub.channelTarget) {
        status = "failed";
        errorMessage = "missing channelTarget url";
      } else if (!isSafeOutboundUrl(sub.channelTarget)) {
        status = "failed";
        errorMessage = "url blocked (private/unsafe)";
      } else {
        const resp = await fetch(sub.channelTarget, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.channel === "slack"
            ? { text: `*${content.subject}*\n${content.body}` }
            : { subject: content.subject, body: content.body, payload: content.payload }),
          signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) {
          status = "failed";
          errorMessage = `webhook ${resp.status}`;
        } else {
          status = "sent";
        }
      }
    }
  } catch (err) {
    status = "failed";
    errorMessage = err instanceof Error ? err.message : String(err);
    logger.warn({ err, subscriptionId: sub.id, channel: sub.channel }, "[subscriptions] delivery failed");
  }

  await db.insert(notificationDeliveriesTable).values({
    subscriptionId: sub.id,
    userId: sub.userId,
    channel: sub.channel,
    subject: content.subject,
    body: content.body,
    payload: content.payload,
    status,
    errorMessage,
    sentAt: status === "sent" ? new Date() : null,
  });
  await db.update(userSubscriptionsTable).set({ lastTriggeredAt: new Date() }).where(eq(userSubscriptionsTable.id, sub.id));
}

/**
 * SSRF guard for user-supplied webhook URLs (slack/webhook channels).
 * Blocks non-http(s) schemes and obvious private/loopback/link-local hosts.
 * Note: this is a best-effort guard — a determined attacker can still use
 * a public DNS name pointing at a private IP. Behind a corporate egress
 * proxy/firewall this is acceptable; for harder isolation, deploy with
 * an explicit egress allowlist.
 */
function isSafeOutboundUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host === "0.0.0.0" || host === "::1") return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  // IPv4 private/loopback/link-local ranges
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
    if (a === 10) return false;
    if (a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 0) return false;
  }
  if (host.startsWith("[")) return false; // raw IPv6 — be strict
  return true;
}

/**
 * Daily digest job. Aggregates all queued email deliveries by user, sends
 * one email per user, and marks the digested rows as sent. Non-email
 * queued rows are marked skipped (daily-digest is email-only by policy
 * — slack/webhook subs must use realtime; the create route enforces this).
 * Idempotent — safe to call from cron or admin-triggered.
 */
export async function sendDailyDigests(): Promise<{ usersNotified: number; itemsSent: number; itemsSkipped: number }> {
  const queued = await db.select().from(notificationDeliveriesTable).where(eq(notificationDeliveriesTable.status, "queued"));
  if (!queued.length) return { usersNotified: 0, itemsSent: 0, itemsSkipped: 0 };

  // Mark any non-email queued rows as skipped — the create route should
  // already prevent these, but stale rows from policy-changes shouldn't
  // sit forever.
  const stale = queued.filter(q => q.channel !== "email").map(q => q.id);
  let itemsSkipped = 0;
  if (stale.length) {
    await db.update(notificationDeliveriesTable)
      .set({ status: "skipped", errorMessage: "daily_digest is email-only" })
      .where(sql`${notificationDeliveriesTable.id} = ANY(${stale})`);
    itemsSkipped += stale.length;
  }

  const byUser = new Map<string, typeof queued>();
  for (const q of queued) {
    if (q.channel !== "email") continue;
    const arr = byUser.get(q.userId) ?? [];
    arr.push(q);
    byUser.set(q.userId, arr);
  }

  let usersNotified = 0;
  let itemsSent = 0;
  const now = new Date();

  for (const [userId, items] of byUser) {
    if (!isEmailConfigured()) {
      itemsSkipped += items.length;
      continue;
    }
    const summary = await getClerkUserSummary(userId);
    if (!summary.email) {
      await db.update(notificationDeliveriesTable)
        .set({ status: "skipped", errorMessage: "no email on file" })
        .where(and(eq(notificationDeliveriesTable.userId, userId), eq(notificationDeliveriesTable.status, "queued")));
      itemsSkipped += items.length;
      continue;
    }
    try {
      const delivered = await sendDigestEmail({
        to: summary.email,
        name: summary.firstName,
        items: items.map(i => ({ subject: i.subject, body: i.body })),
      });
      const ids = items.map(i => i.id);
      if (delivered) {
        await db.update(notificationDeliveriesTable)
          .set({ status: "sent", sentAt: now })
          .where(sql`${notificationDeliveriesTable.id} = ANY(${ids})`);
        usersNotified += 1;
        itemsSent += items.length;
      } else {
        await db.update(notificationDeliveriesTable)
          .set({ status: "skipped", errorMessage: "email provider not configured" })
          .where(sql`${notificationDeliveriesTable.id} = ANY(${ids})`);
        itemsSkipped += items.length;
      }
    } catch (err) {
      logger.warn({ err, userId }, "[subscriptions] digest send failed");
      await db.update(notificationDeliveriesTable)
        .set({ status: "failed", errorMessage: err instanceof Error ? err.message : String(err) })
        .where(sql`${notificationDeliveriesTable.id} = ANY(${items.map(i => i.id)})`);
    }
  }
  return { usersNotified, itemsSent, itemsSkipped };
}

export async function recentDeliveries(userId: string, limit = 25): Promise<typeof notificationDeliveriesTable.$inferSelect[]> {
  return db.select().from(notificationDeliveriesTable)
    .where(eq(notificationDeliveriesTable.userId, userId))
    .orderBy(desc(notificationDeliveriesTable.createdAt))
    .limit(limit);
}
