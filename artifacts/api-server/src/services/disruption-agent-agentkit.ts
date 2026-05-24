/**
 * Disruption Agent — AgentKit implementation.
 *
 * Mirrors the LangGraph implementation in `disruption-agent.ts` 1:1 — same
 * Haiku model, same system prompt, same 5 tools (read_latest_macro_digests,
 * recompute_dvx, get_disruption_ranking, inspect_capability_disruption_risk,
 * publish_disruption_risk_digest). Tools are re-declared via AgentKit's
 * `createTool` (incompatible with LangChain's `DynamicStructuredTool`),
 * but each handler calls the EXACT SAME underlying business-logic function
 * as the LangGraph version.
 *
 * Letta agent name `cvi-disruption-agent` is preserved (see AGENT_REGISTRY).
 * Mem0 + Letta calls go through services/agent/memory.ts +
 * services/agent/store.ts unchanged.
 */
import { createAgent, createNetwork, createTool, anthropic } from "@inngest/agent-kit";
import { z } from "zod";
import { getDisruptionRanking, computeDisruptionRisk } from "./disruption";
import { computeDVX } from "./dvx-engine";
import { ensureSharedStoreReady, getSharedStore, NS } from "./agent/store";
import { recallMemories, storeMemory } from "./agent/memory";
import type { AgentRunResult } from "./agent/base-agent";
import { DISRUPTION_AGENT_NAME } from "./disruption-agent";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are the Disruption Agent inside the Inflexcvi platform. Each cycle:

1. Read the latest macro-event digests (read_latest_macro_digests) so your work is biased by what's happening in the world right now.
2. Recompute DVX (recompute_dvx) so your data is fresh.
3. Pull the ranked list (get_disruption_ranking) and inspect the top 3-5 candidates (inspect_capability_disruption_risk) for those whose risk factors look anomalous relative to recent macro context.
4. Publish a digest (publish_disruption_risk_digest) summarizing the highest-risk capabilities and an overall severity tier.

Cost discipline: Haiku. One sequential pass — no recursion. Skip publishing if nothing changed materially since last cycle.`;

const readMacroDigestTool = createTool({
  name: "read_latest_macro_digests",
  description:
    "Read the 3 most-recent macro-event digests from the shared store (published by the Macro Event Agent). Use this to bias what capabilities you focus on this cycle.",
  parameters: z.object({}).strict(),
  handler: async () => {
    await ensureSharedStoreReady();
    const items = await getSharedStore().search(NS.macroEvents(), { limit: 3 });
    return JSON.stringify(items.map(i => i.value));
  },
});

const computeDvxTool = createTool({
  name: "recompute_dvx",
  description:
    "Run a full DVX (Disruption Velocity Index) recomputation cycle. Persists snapshot + per-capability components. Returns counts + industry breakdowns.",
  parameters: z.object({}).strict(),
  handler: async () => {
    const r = await computeDVX({ persist: true });
    return JSON.stringify({
      capabilitiesScored: r.capabilitiesScored,
      overallIndex: r.overallIndex,
      industryBreakdowns: Object.values(r.industryBreakdowns).slice(0, 8),
      llmCallsIssued: r.llmCallsIssued,
    });
  },
});

const getDisruptionRankingTool = createTool({
  name: "get_disruption_ranking",
  description:
    "Return the ranked list of capabilities by disruption risk. Pass limit (1-20).",
  parameters: z.object({
    limit: z.number().int().min(1).max(20).default(10),
  }).strict(),
  handler: async ({ limit }) => {
    const r = await getDisruptionRanking(true);
    return JSON.stringify({
      total: r.rows.length,
      top: r.rows.slice(0, Math.min(20, limit)),
    });
  },
});

const inspectCapabilityRiskTool = createTool({
  name: "inspect_capability_disruption_risk",
  description:
    "Inspect the per-capability disruption factor breakdown for one capability id. Use for the top candidates after get_disruption_ranking.",
  parameters: z.object({ capabilityId: z.number().int().positive() }).strict(),
  handler: async ({ capabilityId }) => {
    const r = await computeDisruptionRisk(capabilityId);
    if (!r) return JSON.stringify({ found: false });
    return JSON.stringify(r);
  },
});

const publishDisruptionRiskTool = createTool({
  name: "publish_disruption_risk_digest",
  description:
    "Publish a short summary of the highest-disruption capabilities this cycle, with their IDs and an overall severity tier. Other agents (Stack Optimizer) read this to bias their recommendations.",
  parameters: z.object({
    summary: z.string(),
    topCapabilityIds: z.array(z.number().int()),
    severity: z.enum(["low", "moderate", "high", "extreme"]),
  }).strict(),
  handler: async ({ summary, topCapabilityIds, severity }) => {
    await ensureSharedStoreReady();
    const key = `risk-${new Date().toISOString()}`;
    await getSharedStore().put(NS.disruptionRisks(), key, {
      summary,
      topCapabilityIds,
      severity,
      publishedAt: new Date().toISOString(),
      publishedBy: DISRUPTION_AGENT_NAME,
    });
    return JSON.stringify({ ok: true, key });
  },
});

async function buildMemoryContext(): Promise<string> {
  const contextParts: string[] = [];
  const recallTopic = DISRUPTION_AGENT_NAME.replace(/-/g, " ");

  try {
    const memories = await recallMemories(
      recallTopic,
      undefined,
      5,
      { category: "pattern", agentName: DISRUPTION_AGENT_NAME, criteria: "relevance" },
    );
    if (memories.length > 0) {
      const memLines = memories.map(m => `  - ${m.content.substring(0, 200)}`).join("\n");
      contextParts.push(`RELEVANT PATTERNS FROM YOUR MEMORY:\n${memLines}`);
    }
  } catch { /* non-fatal */ }

  try {
    const sharedMemories = await recallMemories(
      recallTopic,
      undefined,
      3,
      { category: "pattern", criteria: "relevance" },
    );
    if (sharedMemories.length > 0) {
      const memLines = sharedMemories.map(m => `  - ${m.content.substring(0, 200)}`).join("\n");
      contextParts.push(`INSTITUTIONAL PATTERNS (shared across all agents):\n${memLines}`);
    }
  } catch { /* non-fatal */ }

  try {
    const { getAgentPriorBlock } = await import("./agent/store");
    const priorBlock = await getAgentPriorBlock("industry_priors", DISRUPTION_AGENT_NAME);
    if (priorBlock && typeof priorBlock === "string" && priorBlock.length > 20) {
      contextParts.push(`YOUR ACCUMULATED BELIEFS (from past cycles):\n${priorBlock.substring(0, 800)}`);
    }
  } catch { /* non-fatal */ }

  try {
    await ensureSharedStoreReady();
    const synthItems = await getSharedStore().search(
      NS.sharedKnowledge("synthesis_brief"),
      { limit: 1 },
    );
    if (synthItems.length > 0) {
      const brief = (synthItems[0].value as { brief?: string }).brief;
      if (brief) contextParts.push(`LATEST CROSS-AGENT SYNTHESIS BRIEF:\n${brief.substring(0, 600)}`);
    }
  } catch { /* non-fatal */ }

  if (contextParts.length === 0) return "";
  return `\n\n--- MEMORY CONTEXT (use this to ground your work in accumulated evidence) ---\n${contextParts.join("\n\n")}\n--- END MEMORY CONTEXT ---`;
}

async function writePostRunMemory(output: string): Promise<void> {
  if (!output || output.length < 50) return;
  await storeMemory(
    "observation",
    `[${DISRUPTION_AGENT_NAME}] ${output.substring(0, 400)}`,
    { source: DISRUPTION_AGENT_NAME, agentRun: true },
    { category: "agent_run_summary", agentName: DISRUPTION_AGENT_NAME },
  ).catch(() => {});
}

export async function runDisruptionAgentAgentKit(): Promise<AgentRunResult> {
  const start = Date.now();
  const memoryContext = await buildMemoryContext();

  const agent = createAgent({
    name: DISRUPTION_AGENT_NAME,
    description: "Reads macro digest, recomputes DVX, ranks disruption, publishes digest.",
    system: SYSTEM_PROMPT + memoryContext,
    model: anthropic({
      model: HAIKU_MODEL,
      defaultParameters: {
        max_tokens: 2500,
        temperature: 0.2,
      },
    }),
    tools: [
      readMacroDigestTool,
      computeDvxTool,
      getDisruptionRankingTool,
      inspectCapabilityRiskTool,
      publishDisruptionRiskTool,
    ],
  });

  const network = createNetwork({
    name: "disruption-agentkit-network",
    agents: [agent],
    maxIter: 8,
  });

  try {
    const run = await network.run("Run your routine disruption cycle now.");
    const results = run.state.results;
    const lastResult = results.length > 0 ? results[results.length - 1] : undefined;

    let outputText = "";
    if (lastResult) {
      for (const msg of lastResult.output) {
        if (msg.type === "text" && msg.role === "assistant") {
          if (typeof msg.content === "string") {
            outputText += msg.content;
          } else {
            for (const part of msg.content) outputText += part.text;
          }
        }
      }
    }

    const toolCallCount = results.reduce((sum, r) => sum + r.toolCalls.length, 0);
    const durationMs = Date.now() - start;
    console.log(`[disruption-agent-agentkit] cycle complete: tools=${toolCallCount} duration=${durationMs}ms`);

    writePostRunMemory(outputText).catch(() => {});

    return { output: outputText, toolCallCount, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[disruption-agent-agentkit] cycle errored after ${durationMs}ms: ${message}`);
    return { output: `ERROR: ${message}`, toolCallCount: 0, durationMs };
  }
}
