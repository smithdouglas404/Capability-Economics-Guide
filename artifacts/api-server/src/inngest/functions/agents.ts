import { inngest } from "../client";
import { runAgent } from "../../services/agent/graph";
import { runMacroEventAgent } from "../../services/macro-event-agent";
import { runDisruptionAgent } from "../../services/disruption-agent";
import { runPeerCoopAgent } from "../../services/peer-coop-agent";
import { runStackOptimizerAgent } from "../../services/stack-optimizer-agent";
import { runOntologyAgent } from "../../services/ontology-agent";
import { runSynthesisAgent } from "../../services/synthesis-agent";

// Phase 1 — Inngest cron wrappers around the 7 LangGraph agents.
//
// Each function:
//   - has a per-agent feature flag (INNGEST_OWNS_<NAME>) that gates whether
//     it runs at all; the matching setInterval in scheduler.ts is also
//     skipped when its flag is "1" so the same cron never double-runs
//   - uses `concurrency: { limit: 1 }` so two Inngest runs can't overlap
//     (replaces the enrichment_runs row-locking hack)
//   - retries twice on transient failures
//   - calls the agent's existing entry point via a single step.run() so the
//     LangGraph internals don't need any changes
//
// Cadences match the original scheduler.ts values.

const ownedBy = (flag: string) => process.env[flag] === "1";

export const cviAgentCron = inngest.createFunction(
  {
    id: "cvi-agent",
    triggers: [{ cron: "*/5 * * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_CVI")) return { skipped: "flag-off" };
    return await step.run("run-cvi", () => runAgent("inngest-cron"));
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
    return await step.run("run-macro-event", () => runMacroEventAgent());
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
    return await step.run("run-disruption", () => runDisruptionAgent());
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
    return await step.run("run-peer-coop", () => runPeerCoopAgent());
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
    return await step.run("run-stack-optimizer", () => runStackOptimizerAgent());
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
    return await step.run("run-ontology", () => runOntologyAgent());
  },
);

export const synthesisAgentCron = inngest.createFunction(
  {
    id: "synthesis-agent",
    triggers: [{ cron: "0 6 * * *" }],
    concurrency: { limit: 1 },
    retries: 2,
  },
  async ({ step }) => {
    if (!ownedBy("INNGEST_OWNS_SYNTHESIS")) return { skipped: "flag-off" };
    return await step.run("run-synthesis", () => runSynthesisAgent());
  },
);

export const agentFunctions = [
  cviAgentCron,
  macroEventAgentCron,
  disruptionAgentCron,
  peerCoopAgentCron,
  stackOptimizerAgentCron,
  ontologyAgentCron,
  synthesisAgentCron,
];
