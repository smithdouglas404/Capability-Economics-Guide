import { inngest } from "../client";
import { withStep } from "../step-context";
import { runCviAgentAgentKit } from "../../services/cvi-agent-agentkit";
import { runMacroEventAgentAgentKit } from "../../services/macro-event-agent-agentkit";
import { runDisruptionAgentAgentKit } from "../../services/disruption-agent-agentkit";
import { runPeerCoopAgentAgentKit } from "../../services/peer-coop-agent-agentkit";
import { runStackOptimizerAgentAgentKit } from "../../services/stack-optimizer-agent-agentkit";
import { runOntologyAgentAgentKit } from "../../services/ontology-agent-agentkit";
import { runSynthesisAgentAgentKit } from "../../services/synthesis-agent-agentkit";
import { autoEnrichTick } from "../../services/agent/scheduler";
import { runDisruptionVectorAgent } from "../../services/disruption-vector-agent";

// Phase 2 — Inngest cron wrappers around the 7 agents, using AsyncLocalStorage
// to thread the `step` context down into agent code.
//
// AgentKit migration COMPLETE (Phase 9, 2026-05-24):
// All 7 agents now run on `@inngest/agent-kit` v0.13.2. The previous
// per-agent `USE_LANGGRAPH_*` kill-switch has been removed along with the
// legacy LangChain/LangGraph implementations — each cron unconditionally
// calls its AgentKit `run<Agent>AgentKit()` entry point.
//
// Each function:
//   - has a per-agent ownership flag (INNGEST_OWNS_<NAME>) that gates whether
//     it runs at all; the matching setInterval in scheduler.ts is also
//     skipped when its flag is "1" so the same cron never double-runs
//   - uses `concurrency: { limit: 1 }` so two Inngest runs can't overlap
//   - retries twice on transient failures
//   - threads the `step` context via `withStep(step, …)` so any nested
//     `maybeStepRun()` calls inside the AgentKit handlers get their own
//     Inngest step boundaries (per-call retry granularity).
//
// Cadences match the original scheduler.ts values.
//
// Phase 5 (2026-05-23) — event-driven Synthesis Agent fan-in:
//   - the 5 specialized agents each emit `agent/<slug>/digest-published`
//     after their AgentKit run finishes, via step.sendEvent (durable, part
//     of the run record)
//   - synthesisAgentOnDigest is the primary trigger: it listens on all
//     5 digest events with a 10-minute debounce so it fires once after the
//     last digest in a wave settles
//   - synthesisAgentDailyFloor preserves the old `0 6 * * *` cron behind
//     `INNGEST_SYNTHESIS_DAILY_FLOOR=1` (default off) as a belt-and-
//     suspenders safety net.

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
    triggers: [{ cron: "0 0 */2 * *" }],
    concurrency: { limit: 1 },
    // Cadence dropped from `*/5 * * * *` (every 5 min) to `0 0 */2 * *`
    // (00:00 UTC every 2nd day) on 2026-05-25 after a cost audit:
    // - Phase 8 (generateContent) fires up to ~34 LLM calls per cycle
    //   (8 industries × 4 content tools + c-suite + case study), each
    //   ~$0.005-$0.02. Even with each tool's "skip if recently
    //   generated" gate, the 5-min cron was costing $400-$2,500/month.
    // - The CVI snapshot itself (the cvi_snapshots row) is pure math
    //   so freshness is cheap, but the Perplexity research +
    //   content-gen halo around it is not.
    // - User-visible CVI scores rarely shift on a sub-hour timescale.
    //   48h is the chosen floor; finer cadence will land via the
    //   admin-configurable agent_schedules table (next commit).
    // The throttle below is a defense-in-depth backstop against a
    // cron-trigger backlog after a Railway restart.
    throttle: { limit: 6, period: "1h", key: "global" },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_CVI")) return { skipped: "flag-off" };
    return await withStep(step, () => runCviAgentAgentKit("inngest-cron"));
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
    const result = await withStep(step, () => runMacroEventAgentAgentKit());
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
    const result = await withStep(step, () => runDisruptionAgentAgentKit());
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
    const result = await withStep(step, () => runPeerCoopAgentAgentKit());
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
    const result = await withStep(step, () => runStackOptimizerAgentAgentKit());
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
    const result = await withStep(step, () => runOntologyAgentAgentKit());
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
    return await withStep(step, () => runSynthesisAgentAgentKit());
  },
);

// Optional daily floor — disabled by default. Set
// `INNGEST_SYNTHESIS_DAILY_FLOOR=1` to keep the legacy `0 6 * * *` cron
// alive as a safety net.
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
    return await withStep(step, () => runSynthesisAgentAgentKit());
  },
);

/**
 * Auto-enrich tick — durable replacement for the hourly setInterval that
 * keeps capability_alpha + dependency_scores fresh. The setInterval path
 * was vulnerable to Railway container restarts: a kill mid-enrichment left
 * the run row in "interrupted" state and the next manual sweep often
 * inherited a backlog that itself got killed. Inngest's step-level retry
 * + cross-restart resumption fixes that — each LLM call inside the
 * enrichment LangGraph is its own retriable step (see maybeStepRun wraps
 * in services/enrichment/graph.ts).
 *
 * Cadence matches AUTO_ENRICH_INTERVAL_MS (1 hour). Activate by setting
 * INNGEST_OWNS_AUTO_ENRICH=1 on capabilityeconomics; the matching
 * setInterval in scheduler.ts no-ops when that flag is set.
 */
export const autoEnrichCron = inngest.createFunction(
  {
    id: "agent.auto-enrich",
    triggers: [{ cron: "0 * * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_AUTO_ENRICH")) return { skipped: "flag-off" };
    await withStep(step, () => autoEnrichTick());
    return { ok: true };
  },
);

/**
 * Disruption Vector Agent — computes the forward-looking Capability
 * Disruption Index for 8 stale capabilities per cycle, publishes a
 * "disruption frontier" digest to the shared store for synthesis-agent.
 *
 * Cadence: every 6 hours (matches the cost discipline noted in
 * services/disruption-vector-agent.ts — ~$0.56/cycle Sonnet budget).
 * Activate via INNGEST_OWNS_DISRUPTION_INDEX=1 on capabilityeconomics.
 * No in-process setInterval counterpart — this agent is Inngest-only.
 *
 * NOTE: disruption-vector-agent is NOT one of the 7 migrated agents —
 * it still uses services/agent/base-agent.ts (LangChain `createAgent` +
 * ChatAnthropic). Migrating it is out of scope for the Phase 9 7-agent
 * AgentKit migration. base-agent.ts is retained for that single caller.
 */
export const disruptionVectorAgentCron = inngest.createFunction(
  {
    id: "agent.disruption-vector",
    triggers: [{ cron: "0 */6 * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_DISRUPTION_INDEX")) return { skipped: "flag-off" };
    const result = await withStep(step, () => runDisruptionVectorAgent());
    return { ok: true, toolCallCount: result.toolCallCount, durationMs: result.durationMs };
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
  autoEnrichCron,
  disruptionVectorAgentCron,
];
