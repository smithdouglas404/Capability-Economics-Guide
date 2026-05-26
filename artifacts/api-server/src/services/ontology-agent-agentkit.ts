/**
 * Ontology Agent — AgentKit parallel implementation (Phase 8 shadow eval).
 *
 * Mirrors the LangGraph implementation in `ontology-agent.ts` 1:1 — same
 * tools, same system prompt, same Haiku model tier. Built on
 * `@inngest/agent-kit`'s Network + Agent + createTool primitives instead
 * of LangChain `tool()` + `createAgent`.
 *
 * Why a parallel implementation: per CLAUDE.md 2026-05-18, the 7 LangGraph
 * agents are not being migrated wholesale. AgentKit gets a 2-week shadow
 * eval on the lowest-blast-radius agent (ontology — simplest tools, all
 * idempotent) to compare output quality, tool-call count, and duration
 * before deciding whether to widen the migration.
 *
 * **Output is NOT published to `NS.sharedKnowledge`.** The legacy
 * LangGraph `runOntologyAgent()` retains the authoritative path. This
 * implementation only writes its run record to `agent_shadow_runs` via
 * the Inngest function in `inngest/functions/agents.ts`.
 *
 * Tools are intentionally re-declared with AgentKit's `createTool` (not
 * reused from `ontology-agent.ts`) because AgentKit's `Tool.Any` shape
 * differs from LangChain's `DynamicStructuredTool`. The HANDLERS — the
 * actual business logic — call the same `extractEntitiesFromText` /
 * `upsertEntity` / `getGraphStats` / `runFoundrySyncOnce` / shared-store
 * functions as the LangGraph version, so the comparison is meaningful.
 */
import { createAgent, createNetwork, createTool, anthropic } from "@inngest/agent-kit";
import { z } from "zod";
import { extractEntitiesFromText, upsertEntity, getGraphStats } from "./agent/graphMemory";
import { runFoundrySyncOnce, getFoundryAlertState } from "./foundry/sync";
import { ensureSharedStoreReady, getSharedStore, NS } from "./agent/store";
import type { AgentRunResult } from "./agent/agentkit-shared";

// Identity preserved from the now-deleted legacy ontology-agent.ts.
// Maps to Letta agent cvi-ontology-agent via AGENT_REGISTRY.
export const ONTOLOGY_AGENT_NAME = "ontology-agent";

// Same model tier the LangGraph version uses ("haiku" in base-agent.ts maps
// to claude-haiku-4-5-20251001).
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// Same system prompt verbatim from ontology-agent.ts. Do NOT diverge — the
// comparison is only meaningful if the only difference is the framework.
const SYSTEM_PROMPT = `You are the Ontology Agent. Each cycle:

1. Read all other agents' latest digests (read_all_agent_outputs).
2. Extract entities + relationships from the digest text (extract_and_register_entities) — pass the most-information-dense strings from the digests as the texts array (their summary fields).
3. Optionally check get_graph_stats to confirm registration.
4. If Foundry has an alerted sync pending, trigger it (trigger_foundry_sync_if_alerted).

Cost discipline: Haiku. One pass — don't loop.`;

const readAllAgentOutputsTool = createTool({
  name: "read_all_agent_outputs",
  description:
    "Read the latest digests from every other specialized agent (macro, disruption, peer-coop, stack-optimizer) so you can extract cross-agent entities + relationships.",
  parameters: z.object({}).strict(),
  handler: async () => {
    await ensureSharedStoreReady();
    const store = getSharedStore();
    const [macro, risks, benchmarks, stack] = await Promise.all([
      store.search(NS.macroEvents(), { limit: 3 }),
      store.search(NS.disruptionRisks(), { limit: 3 }),
      store.search(NS.peerBenchmarks(), { limit: 2 }),
      store.search(NS.sharedKnowledge("stack_recommendations"), { limit: 3 }),
    ]);
    return JSON.stringify({
      macroEvents: macro.map(i => i.value),
      disruptionRisks: risks.map(i => i.value),
      peerBenchmarks: benchmarks.map(i => i.value),
      stackRecommendations: stack.map(i => i.value),
    });
  },
});

const extractAndRegisterTool = createTool({
  name: "extract_and_register_entities",
  description:
    "Extract entities (industry / capability / concept / metric / actor) from the provided text snippets and register them in the custom graph layer. Pass an array of strings (max 20).",
  parameters: z.object({
    texts: z.array(z.string()).min(1).max(20),
  }).strict(),
  handler: async ({ texts }) => {
    let totalEntities = 0;
    for (const text of texts.slice(0, 20)) {
      const entities = await extractEntitiesFromText(text);
      for (const e of entities) {
        await upsertEntity(e, {
          source: ONTOLOGY_AGENT_NAME,
          registeredAt: new Date().toISOString(),
        });
        totalEntities++;
      }
    }
    return JSON.stringify({ registered: totalEntities });
  },
});

const graphStatsTool = createTool({
  name: "get_graph_stats",
  description: "Get current entity + relation counts and the top relations in the graph.",
  parameters: z.object({}).strict(),
  handler: async () => {
    const s = await getGraphStats();
    return JSON.stringify(s);
  },
});

const foundrySyncTool = createTool({
  name: "trigger_foundry_sync_if_alerted",
  description:
    "Trigger a one-shot Foundry sync, but only if Foundry's alert state says one is needed. Otherwise skip.",
  parameters: z.object({}).strict(),
  handler: async () => {
    const alert = getFoundryAlertState();
    if (!alert.active) {
      return JSON.stringify({ skipped: true, reason: "foundry alert not active" });
    }
    const r = await runFoundrySyncOnce(
      `${ONTOLOGY_AGENT_NAME} cycle ${new Date().toISOString()}`,
    );
    return JSON.stringify(r);
  },
});

const ontologyAgentAgentKit = createAgent({
  name: ONTOLOGY_AGENT_NAME,
  description:
    "Cross-agent ontology extraction + Foundry sync (AgentKit Phase 8 shadow eval).",
  system: SYSTEM_PROMPT,
  model: anthropic({
    model: HAIKU_MODEL,
    defaultParameters: {
      max_tokens: 2000,
      // Match the LangGraph base-agent.ts default (temperature 0.2).
      temperature: 0.2,
    },
  }),
  tools: [
    readAllAgentOutputsTool,
    extractAndRegisterTool,
    graphStatsTool,
    foundrySyncTool,
  ],
});

// Single-agent network — no routing needed. AgentKit's default behavior with
// a single agent is to invoke it once and stop (no defaultRouter required).
// We cap maxIter at 5 to defend against the model accidentally looping over
// tool calls — the prompt explicitly says "one pass — don't loop".
const network = createNetwork({
  name: "ontology-agentkit-network",
  agents: [ontologyAgentAgentKit],
  maxIter: 5,
  // AgentKit's default router needs a model when no explicit router is
  // passed. Without it network.run() fails with "No router or model
  // defined in network". Cheap routing-LLM only used for termination.
  defaultModel: anthropic({
    model: HAIKU_MODEL,
    defaultParameters: { max_tokens: 1000, temperature: 0.2 },
  }),
});

/**
 * Run one ontology cycle via AgentKit. Returns the same `AgentRunResult`
 * shape as `runOntologyAgent` so the shadow Inngest function can persist
 * both rows symmetrically.
 *
 * Failure mode: if AgentKit / Anthropic / a tool throws, we surface a
 * non-zero `durationMs` plus the error message in `output` so the shadow
 * row records the failure. We do NOT rethrow — the cron should not retry
 * on a shadow failure (the langgraph run is the authoritative path).
 */
export async function runOntologyAgentAgentKit(): Promise<AgentRunResult> {
  const start = Date.now();
  try {
    const run = await network.run(
      "Run your routine ontology cycle now.",
    );

    // NetworkRun exposes state.results — one AgentResult per agent invocation
    // in the network loop. For a single-agent network this is almost always
    // length 1, but we defensively scan all results.
    const results = run.state.results;
    const lastResult = results.length > 0 ? results[results.length - 1] : undefined;

    // Reduce output[] (a heterogeneous Message[] of text/tool_call/tool_result)
    // down to a single output string. Only assistant text messages contribute
    // to the surfaceable answer.
    let outputText = "";
    if (lastResult) {
      for (const msg of lastResult.output) {
        if (msg.type === "text" && msg.role === "assistant") {
          if (typeof msg.content === "string") {
            outputText += msg.content;
          } else {
            for (const part of msg.content) {
              outputText += part.text;
            }
          }
        }
      }
    }

    // Tool calls across all agent iterations in this network run.
    const toolCallCount = results.reduce(
      (sum, r) => sum + r.toolCalls.length,
      0,
    );

    const durationMs = Date.now() - start;
    console.log(
      `[ontology-agent-agentkit] cycle complete: tools=${toolCallCount} duration=${durationMs}ms`,
    );
    return { output: outputText, toolCallCount, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[ontology-agent-agentkit] cycle errored after ${durationMs}ms: ${message}`,
    );
    return { output: `ERROR: ${message}`, toolCallCount: 0, durationMs };
  }
}
