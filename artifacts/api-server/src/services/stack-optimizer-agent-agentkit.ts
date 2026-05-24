/**
 * Stack Optimizer Agent — AgentKit implementation.
 *
 * Mirrors the LangGraph implementation in `stack-optimizer-agent.ts` 1:1 —
 * same Haiku model, same system prompt, same 3 tools
 * (read_priority_context_digests, generate_stack_recommendations,
 * publish_stack_recommendations). Tools re-declared via AgentKit's
 * `createTool`; handler bodies call the same business-logic functions.
 *
 * Letta agent name `cvi-stack-optimizer-agent` is preserved (see AGENT_REGISTRY).
 */
import { createAgent, createNetwork, createTool, anthropic } from "@inngest/agent-kit";
import { z } from "zod";
import { recommendStack } from "./stack-optimizer";
import { ensureSharedStoreReady, getSharedStore, NS } from "./agent/store";
import { recallMemories, storeMemory } from "./agent/memory";
import type { AgentRunResult } from "./agent/agentkit-shared";

// Identity preserved from the now-deleted legacy stack-optimizer-agent.ts.
// Maps to Letta agent cvi-stack-optimizer-agent via AGENT_REGISTRY.
export const STACK_OPTIMIZER_AGENT_NAME = "stack-optimizer-agent";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are the Stack Optimizer Agent. Each cycle:

1. Read the latest disruption-risk + peer-benchmark digests (read_priority_context_digests) to identify which capabilities are most under pressure right now.
2. Pick 5-15 high-priority capability IDs and call generate_stack_recommendations on them (with targetScore left default unless the digests suggest otherwise).
3. Publish a short summary (publish_stack_recommendations).

Cost discipline: Haiku. One pass.`;

const readPriorityDigestsTool = createTool({
  name: "read_priority_context_digests",
  description:
    "Read the latest disruption-risk + peer-benchmark digests from the shared store to identify which capabilities most need stack recommendations this cycle.",
  parameters: z.object({}).strict(),
  handler: async () => {
    await ensureSharedStoreReady();
    const [risks, benchmarks] = await Promise.all([
      getSharedStore().search(NS.disruptionRisks(), { limit: 3 }),
      getSharedStore().search(NS.peerBenchmarks(), { limit: 2 }),
    ]);
    return JSON.stringify({
      disruptionRisks: risks.map(r => r.value),
      peerBenchmarks: benchmarks.map(r => r.value),
    });
  },
});

const generateRecommendationsTool = createTool({
  name: "generate_stack_recommendations",
  description:
    "Generate build/buy/outsource recommendations for a list of capability ids. Pass targetScore (default 75 = top quartile).",
  parameters: z.object({
    capabilityIds: z.array(z.number().int().positive()).min(1).max(20),
    targetScore: z.number().min(0).max(100).optional(),
  }).strict(),
  handler: async ({ capabilityIds, targetScore }) => {
    const r = await recommendStack({ targetCapabilityIds: capabilityIds, targetScore });
    return JSON.stringify({
      recommendations: r.recommendations.slice(0, 10),
      summary: r.summary,
    });
  },
});

const publishRecommendationsTool = createTool({
  name: "publish_stack_recommendations",
  description:
    "Publish a short summary of this cycle's recommendations to the shared store so admins + downstream agents can see what was generated.",
  parameters: z.object({
    summary: z.string(),
    recommendationCount: z.number().int().nonnegative(),
    topCapabilityIds: z.array(z.number().int()),
  }).strict(),
  handler: async ({ summary, recommendationCount, topCapabilityIds }) => {
    await ensureSharedStoreReady();
    const key = `stack-${new Date().toISOString()}`;
    await getSharedStore().put(NS.sharedKnowledge("stack_recommendations"), key, {
      summary,
      recommendationCount,
      topCapabilityIds,
      publishedAt: new Date().toISOString(),
      publishedBy: STACK_OPTIMIZER_AGENT_NAME,
    });
    return JSON.stringify({ ok: true, key });
  },
});

async function buildMemoryContext(): Promise<string> {
  const contextParts: string[] = [];
  const recallTopic = STACK_OPTIMIZER_AGENT_NAME.replace(/-/g, " ");

  try {
    const memories = await recallMemories(
      recallTopic, undefined, 5,
      { category: "pattern", agentName: STACK_OPTIMIZER_AGENT_NAME, criteria: "relevance" },
    );
    if (memories.length > 0) {
      const memLines = memories.map(m => `  - ${m.content.substring(0, 200)}`).join("\n");
      contextParts.push(`RELEVANT PATTERNS FROM YOUR MEMORY:\n${memLines}`);
    }
  } catch { /* non-fatal */ }

  try {
    const sharedMemories = await recallMemories(
      recallTopic, undefined, 3,
      { category: "pattern", criteria: "relevance" },
    );
    if (sharedMemories.length > 0) {
      const memLines = sharedMemories.map(m => `  - ${m.content.substring(0, 200)}`).join("\n");
      contextParts.push(`INSTITUTIONAL PATTERNS (shared across all agents):\n${memLines}`);
    }
  } catch { /* non-fatal */ }

  try {
    const { getAgentPriorBlock } = await import("./agent/store");
    const priorBlock = await getAgentPriorBlock("industry_priors", STACK_OPTIMIZER_AGENT_NAME);
    if (priorBlock && typeof priorBlock === "string" && priorBlock.length > 20) {
      contextParts.push(`YOUR ACCUMULATED BELIEFS (from past cycles):\n${priorBlock.substring(0, 800)}`);
    }
  } catch { /* non-fatal */ }

  try {
    await ensureSharedStoreReady();
    const synthItems = await getSharedStore().search(
      NS.sharedKnowledge("synthesis_brief"), { limit: 1 },
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
    `[${STACK_OPTIMIZER_AGENT_NAME}] ${output.substring(0, 400)}`,
    { source: STACK_OPTIMIZER_AGENT_NAME, agentRun: true },
    { category: "agent_run_summary", agentName: STACK_OPTIMIZER_AGENT_NAME },
  ).catch(() => {});
}

export async function runStackOptimizerAgentAgentKit(): Promise<AgentRunResult> {
  const start = Date.now();
  const memoryContext = await buildMemoryContext();

  const agent = createAgent({
    name: STACK_OPTIMIZER_AGENT_NAME,
    description: "Reads disruption + peer digests, generates build/buy/outsource recommendations.",
    system: SYSTEM_PROMPT + memoryContext,
    model: anthropic({
      model: HAIKU_MODEL,
      defaultParameters: { max_tokens: 2500, temperature: 0.2 },
    }),
    tools: [readPriorityDigestsTool, generateRecommendationsTool, publishRecommendationsTool],
  });

  const network = createNetwork({
    name: "stack-optimizer-agentkit-network",
    agents: [agent],
    maxIter: 6,
  });

  try {
    const run = await network.run("Run your routine stack-recommendations cycle now.");
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
    console.log(`[stack-optimizer-agent-agentkit] cycle complete: tools=${toolCallCount} duration=${durationMs}ms`);

    writePostRunMemory(outputText).catch(() => {});

    return { output: outputText, toolCallCount, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[stack-optimizer-agent-agentkit] cycle errored after ${durationMs}ms: ${message}`);
    return { output: `ERROR: ${message}`, toolCallCount: 0, durationMs };
  }
}
