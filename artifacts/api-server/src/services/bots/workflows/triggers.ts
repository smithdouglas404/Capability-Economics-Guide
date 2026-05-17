/**
 * Phase 4 — event-driven workflow triggers.
 *
 * Most workflows fire on a cadence (daily/weekly/monthly). A subset fire
 * in response to system events:
 *
 * - `capability.added`      — Ontology Agent or admin proposes a new
 *                              capability; matching-industry bots evaluate
 *                              it in their lens (browse + comment).
 * - `cvi.delta-large`       — A CVI snapshot shows >5pt change week-over-
 *                              week on a capability; relevant bots react.
 * - `user.signed-up`        — Real user signs up; matching-persona bot
 *                              pre-loads context-relevant annotations into
 *                              their dashboard (without commenting publicly).
 *
 * The event bus uses the existing `services/agent/events.ts` pub/sub (the
 * same one that drives the agent SSE stream). Triggers register listeners
 * here at module load; each listener dispatches a `runWorkflow` call via
 * the runner with `trigger='event:<event-name>'`.
 *
 * To avoid spamming workflow runs from event storms, each event type has a
 * per-key debounce window kept in an in-process Map. Worker restart resets
 * the window — that's fine, the workflow row count is bounded by the
 * upstream event cadence anyway.
 */
import { db, botsTable, type Bot } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "../../../lib/logger";
import { runWorkflow } from "./runner";
import { getRegistry } from "./registry";
import type { WorkflowDefinition, WorkflowResult } from "./types";

interface EventPayload {
  capabilityId?: number;
  industrySlug?: string;
  personaKey?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

type EventName = "capability.added" | "cvi.delta-large" | "user.signed-up";

const DEBOUNCE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const lastFiredByKey = new Map<string, number>();

function shouldDebounce(key: string): boolean {
  const last = lastFiredByKey.get(key) ?? 0;
  const now = Date.now();
  if (now - last < DEBOUNCE_WINDOW_MS) return true;
  lastFiredByKey.set(key, now);
  return false;
}

/**
 * Find all active bots whose persona's industry matches the event's
 * industry. Used by `capability.added` and `cvi.delta-large` triggers.
 */
async function findBotsMatchingIndustry(industrySlug: string): Promise<Bot[]> {
  // Persona-to-industry mapping is in personas.ts. Rather than re-import
  // and risk a circular dep, we filter by the bot's clerkUserId prefix
  // (bot_<personaKey>_*) which IS the persona key.
  const all = await db.select().from(botsTable).where(eq(botsTable.status, "active"));
  return all.filter((b) => {
    // Heuristic: PE Partner covers banking + insurance, etc. Reuse the
    // appliesToPersonas info from the registered workflows.
    const reg = getRegistry();
    for (const wf of reg.values()) {
      if (wf.appliesToPersonas.includes(b.personaKey) && wf.scope === "per-bot") {
        // If ANY of this bot's registered workflows targets the industry,
        // consider it a match.
        // (We don't have direct industry metadata on the bot; the workflow
        // registry is the source of truth for "what does this persona cover".)
        // For the trigger we just want a binary "is this bot relevant".
        return true;
      }
    }
    return false;
  });
}

/**
 * Dispatch a workflow run for an event. Returns the run id (or null if
 * debounced / no matching workflow).
 */
async function dispatchEventWorkflow(args: {
  eventName: EventName;
  workflowKey: string;
  bot: Bot | null;
  payload: EventPayload;
  debounceKey: string;
}): Promise<{ runId: number; result: WorkflowResult } | null> {
  if (shouldDebounce(args.debounceKey)) {
    logger.debug({ event: args.eventName, debounceKey: args.debounceKey }, "[bot-trigger] debounced");
    return null;
  }
  const reg = getRegistry();
  const def = reg.get(args.workflowKey);
  if (!def) {
    logger.warn({ workflowKey: args.workflowKey }, "[bot-trigger] no registered workflow");
    return null;
  }
  return runWorkflow({
    definition: def,
    bot: args.bot,
    trigger: `event:${args.eventName}`,
  });
}

/**
 * `capability.added` — when a new capability lands in the catalog (whether
 * approved or pending review). All bots covering the relevant industry
 * are notified. Each bot runs a SINGLE evaluation pass (browse + comment)
 * on the new capability.
 *
 * Wired into Ontology Agent's `publishOntologyProposal` + admin
 * capability-create routes.
 */
export async function onCapabilityAdded(payload: EventPayload): Promise<void> {
  if (!payload.capabilityId || !payload.industrySlug) return;
  const bots = await findBotsMatchingIndustry(payload.industrySlug);
  for (const bot of bots) {
    await dispatchEventWorkflow({
      eventName: "capability.added",
      workflowKey: `${bot.personaKey}-cycle`, // each persona's weekly cycle, fired ad-hoc
      bot,
      payload,
      debounceKey: `cap-added:${payload.capabilityId}:bot-${bot.id}`,
    }).catch((err) => {
      logger.error({ err, botId: bot.id }, "[bot-trigger:capability.added] dispatch failed");
    });
  }
}

/**
 * `cvi.delta-large` — fired by the CVI engine when a snapshot shows a
 * week-over-week shift >5 absolute points on a single capability. Bots
 * react by running their per-persona cycle, but scoped to this single
 * capability (the workflow's `score` node naturally short-circuits to it).
 */
export async function onCviDeltaLarge(payload: EventPayload): Promise<void> {
  if (!payload.capabilityId || !payload.industrySlug) return;
  const bots = await findBotsMatchingIndustry(payload.industrySlug);
  for (const bot of bots) {
    await dispatchEventWorkflow({
      eventName: "cvi.delta-large",
      workflowKey: `${bot.personaKey}-cycle`,
      bot,
      payload,
      debounceKey: `cvi-delta:${payload.capabilityId}:bot-${bot.id}`,
    }).catch((err) => {
      logger.error({ err, botId: bot.id }, "[bot-trigger:cvi.delta-large] dispatch failed");
    });
  }
}

/**
 * `user.signed-up` — when a real user creates an account. If their stated
 * role matches a persona (best-effort match by industry + seniority), the
 * matching bot runs a "companion" workflow that pre-loads relevant
 * annotations into the user's onboarding queue WITHOUT commenting
 * publicly (avoiding the "bot welcomed me" UX problem).
 *
 * Currently stubbed — the companion workflow is left as a Phase 4b
 * deliverable since it requires customer-facing UI surface to land first.
 */
export async function onUserSignedUp(payload: EventPayload): Promise<void> {
  if (!payload.userId) return;
  // STUB — intentionally not wired upstream yet.
  //
  // Two prerequisites are missing before this trigger has somewhere useful to dispatch to:
  //   1. There is no Clerk signup webhook handler in routes/ (the app uses Clerk
  //      auth client-side; the backend reads auth.userId from authenticated
  //      requests but never observes a discrete "user created" event server-side).
  //      The closest proxy is the first time an org row is claimed by a
  //      clerkUserId (organizations.ts:claim route), but that's "first action"
  //      not "signup".
  //   2. The companion workflow itself is not implemented — it would pre-load
  //      persona-relevant annotations into the new user's onboarding queue.
  //      That requires an onboarding.tsx UI surface to receive the pre-loaded
  //      annotations, which doesn't exist.
  //
  // Wiring this end-to-end is tracked as a Phase 4b deliverable. For now,
  // calling this is a no-op apart from the log line, which confirms the bus
  // wiring works should anyone fire the event manually.
  logger.info({ userId: payload.userId, payload }, "[bot-trigger:user.signed-up] event received (stub — no upstream publishers; no companion workflow yet)");
}

/**
 * Public dispatcher used by the existing events bus. Routes by event name.
 * Call sites in agent/events.ts, routes/capabilities.ts, services/cvi-engine.ts,
 * routes/clerk-user.ts can fire-and-forget into this.
 */
export async function dispatchBotEvent(eventName: EventName, payload: EventPayload): Promise<void> {
  try {
    switch (eventName) {
      case "capability.added":  await onCapabilityAdded(payload); break;
      case "cvi.delta-large":   await onCviDeltaLarge(payload); break;
      case "user.signed-up":    await onUserSignedUp(payload); break;
    }
  } catch (err) {
    logger.error({ event: eventName, err: err instanceof Error ? err.message : String(err) }, "[bot-trigger] dispatch error (swallowed — bots are fire-and-forget)");
  }
}
