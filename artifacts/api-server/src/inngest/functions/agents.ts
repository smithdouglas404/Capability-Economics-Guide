import { inngest } from "../client";
import { withStep } from "../step-context";
import { runAgent } from "../../services/agent/graph";
import { runMacroEventAgent } from "../../services/macro-event-agent";
import { runDisruptionAgent } from "../../services/disruption-agent";
import { runPeerCoopAgent } from "../../services/peer-coop-agent";
import { runStackOptimizerAgent } from "../../services/stack-optimizer-agent";
import { runOntologyAgent } from "../../services/ontology-agent";
import { runSynthesisAgent } from "../../services/synthesis-agent";

// Phase 2 — Inngest cron wrappers around the 7 LangGraph agents, now using
// AsyncLocalStorage to thread the `step` context down into the agent code.
//
// Each function:
//   - has a per-agent feature flag (INNGEST_OWNS_<NAME>) that gates whether
//     it runs at all; the matching setInterval in scheduler.ts is also
//     skipped when its flag is "1" so the same cron never double-runs
//   - uses `concurrency: { limit: 1 }` so two Inngest runs can't overlap
//     (replaces the enrichment_runs row-locking hack)
//   - retries twice on transient failures
//   - calls the agent's existing entry point inside `withStep(step, …)` so
//     individual LLM / tool calls inside the agent can opt into their own
//     step.run via `maybeStepRun()` for per-call retry granularity.
//     See step-context.ts and the call sites in services/agent/base-agent.ts
//     + services/agent/graph.ts.
//
// Cadences match the original scheduler.ts values.
//
// Phase 5 (2026-05-23) — event-driven Synthesis Agent fan-in:
//   - the 5 specialized agents now emit `agent/<slug>/digest-published`
//     after their step.run() returns, via step.sendEvent (durable, part of
//     the run record)
//   - synthesisAgentOnDigest is the new primary trigger: it listens on all
//     5 digest events with a 10-minute debounce so it fires once after the
//     last digest in a wave settles, instead of running on a fixed 24h cron
//   - synthesisAgentDailyFloor preserves the old `0 6 * * *` cron behind
//     `INNGEST_SYNTHESIS_DAILY_FLOOR=1` (default off) as a belt-and-
//     suspenders safety net while event-driven gets proven in prod

const ownedBy = (flag: string) => process.env[flag] === "1";

type SpecializedAgentResult = {
  output: string;
  toolCallCount: number;
  durationMs: number;
};

// Helper: build the event payload that every specialized agent emits when
// its digest is published to the shared store. Keep this shape stable —
// the Synthesis Agent (and any future consumers) will key off it.
const digestEventPayload = (
  agentName: string,
  result: SpecializedAgentResult,
) => ({
  agentName,
  runFinishedAt: new Date().toISOString(),
  durationMs: result.durationMs,
  toolCallCount: result.toolCallCount,
});

export const cviAgentCron = inngest.createFunction(
  {
    id: "cvi-agent",
    triggers: [{ cron: "*/5 * * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_CVI")) return { skipped: "flag-off" };
    return await withStep(step, () => runAgent("inngest-cron"));
  },
);

export const macroEventAgentCron = inngest.createFunction(
  {
    id: "macro-event-agent",
    triggers: [{ cron: "*/30 * * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_MACRO_EVENT")) return { skipped: "flag-off" };
    const result = await withStep(step, () => runMacroEventAgent());
    await step.sendEvent("emit-digest", {
      name: "agent/macro-event/digest-published",
      data: digestEventPayload("macro-event-agent", result),
    });
    return result;
  },
);

export const disruptionAgentCron = inngest.createFunction(
  {
    id: "disruption-agent",
    triggers: [{ cron: "0 * * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_DISRUPTION")) return { skipped: "flag-off" };
    const result = await withStep(step, () => runDisruptionAgent());
    await step.sendEvent("emit-digest", {
      name: "agent/disruption/digest-published",
      data: digestEventPayload("disruption-agent", result),
    });
    return result;
  },
);

export const peerCoopAgentCron = inngest.createFunction(
  {
    id: "peer-coop-agent",
    triggers: [{ cron: "0 */6 * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_PEER_COOP")) return { skipped: "flag-off" };
    const result = await withStep(step, () => runPeerCoopAgent());
    await step.sendEvent("emit-digest", {
      name: "agent/peer-coop/digest-published",
      data: digestEventPayload("peer-coop-agent", result),
    });
    return result;
  },
);

export const stackOptimizerAgentCron = inngest.createFunction(
  {
    id: "stack-optimizer-agent",
    triggers: [{ cron: "0 0 * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_STACK_OPTIMIZER")) return { skipped: "flag-off" };
    const result = await withStep(step, () => runStackOptimizerAgent());
    await step.sendEvent("emit-digest", {
      name: "agent/stack-optimizer/digest-published",
      data: digestEventPayload("stack-optimizer-agent", result),
    });
    return result;
  },
);

export const ontologyAgentCron = inngest.createFunction(
  {
    id: "ontology-agent",
    triggers: [{ cron: "0 */4 * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_ONTOLOGY")) return { skipped: "flag-off" };
    const result = await withStep(step, () => runOntologyAgent());
    await step.sendEvent("emit-digest", {
      name: "agent/ontology/digest-published",
      data: digestEventPayload("ontology-agent", result),
    });
    return result;
  },
);

// Phase 5 — Synthesis Agent: event-driven fan-in across all 5 specialized
// agents. `debounce` makes it fire once 10 minutes after the LAST digest
// event in a wave (any new digest within the window resets the timer), so
// a burst of agent completions yields one synthesis run, not five.
//
// SDK note: `debounce` is supported in inngest@4.4.0 (verified in
// node_modules/inngest/types.d.ts — both the createFunction options shape
// and the API schema include it).
export const synthesisAgentOnDigest = inngest.createFunction(
  {
    id: "synthesis-agent",
    triggers: [
      { event: "agent/macro-event/digest-published" },
      { event: "agent/disruption/digest-published" },
      { event: "agent/peer-coop/digest-published" },
      { event: "agent/stack-optimizer/digest-published" },
      { event: "agent/ontology/digest-published" },
    ],
    debounce: { period: "10m", key: "synthesis" },
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_SYNTHESIS")) return { skipped: "flag-off" };
    return await withStep(step, () => runSynthesisAgent());
  },
);

// Optional daily floor — disabled by default. Set
// `INNGEST_SYNTHESIS_DAILY_FLOOR=1` to keep the legacy `0 6 * * *` cron
// alive as a safety net. Once event-driven synthesis is proven, this can
// stay off permanently or be removed entirely.
export const synthesisAgentDailyFloor = inngest.createFunction(
  {
    id: "synthesis-agent-daily-floor",
    triggers: [{ cron: "0 6 * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_SYNTHESIS")) return { skipped: "flag-off" };
    if (!ownedBy("INNGEST_SYNTHESIS_DAILY_FLOOR")) {
      return { skipped: "daily-floor-off" };
    }
    return await withStep(step, () => runSynthesisAgent());
  },
);

export const agentFunctions = [
  cviAgentCron,
  macroEventAgentCron,
  disruptionAgentCron,
  peerCoopAgentCron,
  stackOptimizerAgentCron,
  ontologyAgentCron,
  synthesisAgentOnDigest,
  synthesisAgentDailyFloor,
];
