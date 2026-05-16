/**
 * Stack Optimizer Agent — wraps services/stack-optimizer.ts.
 *
 * Reads disruption-risk + peer-benchmark digests from the shared
 * store, picks a high-priority set of capabilities to evaluate, and
 * generates build/buy/outsource recommendations.
 *
 * Per Master Action Plan Phase 1.9 Step 3 / agent #3.
 */
import { tool } from "langchain";
import { z } from "zod/v4";
import { recommendStack } from "./stack-optimizer";
import { runReactAgent } from "./agent/base-agent";
import { ensureSharedStoreReady, getSharedStore, NS } from "./agent/store";

export const STACK_OPTIMIZER_AGENT_NAME = "stack-optimizer-agent";

const readPriorityDigestsTool = tool(
  async () => {
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
  {
    name: "read_priority_context_digests",
    description: "Read the latest disruption-risk + peer-benchmark digests from the shared store to identify which capabilities most need stack recommendations this cycle.",
    schema: z.object({}).strict(),
  },
);

const generateRecommendationsTool = tool(
  async ({ capabilityIds, targetScore }) => {
    const r = await recommendStack({ targetCapabilityIds: capabilityIds, targetScore });
    return JSON.stringify({
      recommendations: r.recommendations.slice(0, 10),
      summary: r.summary,
    });
  },
  {
    name: "generate_stack_recommendations",
    description: "Generate build/buy/outsource recommendations for a list of capability ids. Pass targetScore (default 75 = top quartile).",
    schema: z.object({
      capabilityIds: z.array(z.number().int().positive()).min(1).max(20),
      targetScore: z.number().min(0).max(100).optional(),
    }).strict(),
  },
);

const publishRecommendationsTool = tool(
  async ({ summary, recommendationCount, topCapabilityIds }) => {
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
  {
    name: "publish_stack_recommendations",
    description: "Publish a short summary of this cycle's recommendations to the shared store so admins + downstream agents can see what was generated.",
    schema: z.object({
      summary: z.string(),
      recommendationCount: z.number().int().nonnegative(),
      topCapabilityIds: z.array(z.number().int()),
    }).strict(),
  },
);

const TOOLS = [readPriorityDigestsTool, generateRecommendationsTool, publishRecommendationsTool];

const SYSTEM_PROMPT = `You are the Stack Optimizer Agent. Each cycle:

1. Read the latest disruption-risk + peer-benchmark digests (read_priority_context_digests) to identify which capabilities are most under pressure right now.
2. Pick 5-15 high-priority capability IDs and call generate_stack_recommendations on them (with targetScore left default unless the digests suggest otherwise).
3. Publish a short summary (publish_stack_recommendations).

Cost discipline: Haiku. One pass.`;

export async function runStackOptimizerAgent(): Promise<{ output: string; toolCallCount: number; durationMs: number }> {
  const result = await runReactAgent(
    {
      agentName: STACK_OPTIMIZER_AGENT_NAME,
      systemPrompt: SYSTEM_PROMPT,
      tools: TOOLS,
      modelTier: "haiku",
      temperature: 0.2,
      maxTokens: 2500,
    },
    "Run your routine stack-recommendations cycle now.",
  );
  console.log(`[stack-optimizer-agent] cycle complete: tools=${result.toolCallCount} duration=${result.durationMs}ms`);
  return result;
}
