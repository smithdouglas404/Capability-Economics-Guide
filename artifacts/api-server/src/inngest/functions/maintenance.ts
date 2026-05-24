import { inngest } from "../client";
import {
  detectTemporalShifts,
  writeMemoryRelationSnapshots,
} from "../../services/agent/temporal-shift-detector";
import { scoreRecommendationByInsightId } from "../../services/agent/recommendation-feedback";
import { sendFoundryExpiryEmail } from "../../services/foundry/expiry-alert";

// Phase 6 — Inngest wrappers around long-running maintenance crons.
// Same flag-gated cutover pattern as Phase 1.
//
// Phase 6 follow-up (2026-05-23):
//   - recommendationFeedbackOnInsight replaces the dormant-poll model with
//     event-driven `step.sleepUntil(createdAt + 60d)`. Triggered by
//     `agent.insight.created` emitted from generateInsightsTool in
//     services/agent/tools.ts.
//   - foundryTokenExpiryAlert replaces the (never-implemented) 30-min
//     expiry cron with event-driven `step.sleepUntil(expiresAt - 30min)`.
//     Triggered by `system.secret.expiring` emitted from the rotate-token
//     admin route + the OAuth client_credentials mint path in
//     services/foundry/auth.ts.

const ownedBy = (flag: string) => process.env[flag] === "1";

export const temporalShiftDetectorCron = inngest.createFunction(
  {
    id: "temporal-shift-detector",
    triggers: [{ cron: "0 */6 * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_TEMPORAL_SHIFT")) return { skipped: "flag-off" };
    return await step.run("detect", () => detectTemporalShifts());
  },
);

export const memoryRelationSnapshotCron = inngest.createFunction(
  {
    id: "memory-relation-snapshot",
    triggers: [{ cron: "0 0 * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_MEMORY_SNAPSHOT")) return { skipped: "flag-off" };
    return await step.run("write-snapshots", () => writeMemoryRelationSnapshots());
  },
);

// Phase 6 follow-up: event-driven 60-day recommendation-accuracy scoring.
// Replaces the bulk dormant-poll path (`scoreRecommendationAccuracy`) with
// one Inngest run per insight that sleeps until exactly 60 days after the
// insight was created, then scores just that one recommendation. The bulk
// path remains in services/agent/recommendation-feedback.ts as the fallback
// when INNGEST_OWNS_RECOMMENDATION_FEEDBACK != 1.
export const recommendationFeedbackOnInsight = inngest.createFunction(
  {
    id: "recommendation-feedback",
    triggers: [{ event: "agent.insight.created" }],
    // Per-insight key (one in-flight per insight) instead of the prior
    // global cap of 4 — duplicate `agent.insight.created` events for the
    // same insightId (already deduped at the emit site, but defense in
    // depth) won't bypass the upstream idempotency and double-schedule
    // the 60-day sleeper.
    concurrency: { limit: 5, key: "event.data.insightId" },
    retries: 2,
  },
  async ({ event, step }) => {
    if (!ownedBy("INNGEST_OWNS_RECOMMENDATION_FEEDBACK")) return { skipped: "flag-off" };
    const createdAt = new Date(event.data.createdAt as string);
    const wakeAt = new Date(createdAt.getTime() + 60 * 86400 * 1000);
    await step.sleepUntil("wait-60d", wakeAt);
    return await step.run("score-recommendation", () =>
      scoreRecommendationByInsightId(event.data.insightId as number),
    );
  },
);

// Phase 6 follow-up: event-driven 30-min-before-expiry alert email.
// Replaces the (never-implemented) `foundryTokenExpiryCheck` polling cron
// referenced in services/agent/scheduler.ts. The rotate-token admin route
// and OAuth client_credentials mint path emit `system.secret.expiring`
// with the new token's projected expiry; this function sleeps until
// (expiresAt - 30min) and emails the operator.
export const foundryTokenExpiryAlert = inngest.createFunction(
  {
    id: "foundry-token-expiry-alert",
    triggers: [{ event: "system.secret.expiring" }],
    retries: 2,
  },
  async ({ event, step }) => {
    if (!ownedBy("INNGEST_OWNS_FOUNDRY_ALERT")) return { skipped: "flag-off" };
    const expiresAt = new Date(event.data.expiresAt as string);
    const alertAt = new Date(expiresAt.getTime() - 30 * 60 * 1000);
    // If the operator emitted the event with < 30 minutes runway, fire the
    // alert immediately rather than sleeping into the past (Inngest treats
    // a past sleepUntil as instant, but be explicit).
    if (alertAt.getTime() > Date.now()) {
      await step.sleepUntil("wait-until-30min-before-expiry", alertAt);
    }
    return await step.run("send-alert", () => sendFoundryExpiryEmail({
      secretName: event.data.secretName as string,
      expiresAt: event.data.expiresAt as string,
    }));
  },
);

export const maintenanceFunctions = [
  temporalShiftDetectorCron,
  memoryRelationSnapshotCron,
  recommendationFeedbackOnInsight,
  foundryTokenExpiryAlert,
];
