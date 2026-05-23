import { inngest } from "../client";
import {
  detectTemporalShifts,
  writeMemoryRelationSnapshots,
} from "../../services/agent/temporal-shift-detector";

// Phase 6 — Inngest wrappers around long-running maintenance crons.
// Same flag-gated cutover pattern as Phase 1.
//
// scoreRecommendationAccuracy (60-day dormant scoring) is not yet on a
// scheduler.ts cron — when it is, add a third Inngest function here that
// uses step.sleepUntil(insightDate + 60d) after an `agent.insight.created`
// event trigger.

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

export const maintenanceFunctions = [
  temporalShiftDetectorCron,
  memoryRelationSnapshotCron,
];
