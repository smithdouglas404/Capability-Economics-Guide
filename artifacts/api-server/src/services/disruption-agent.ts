/**
 * Disruption Agent — wraps services/disruption.ts + services/dvx-engine.ts.
 *
 * Reads the latest macro-event digest from NS.macroEvents() (published
 * by the Macro Event Agent), computes the disruption ranking + a
 * DVX cycle, and publishes the top disruption risks to
 * NS.disruptionRisks() for downstream agents (Stack Optimizer in
 * particular) to consume.
 *
 * Per Master Action Plan Phase 1.9 Step 3 / agent #1.
 */
import { tool } from "langchain";
import { z } from "zod/v4";
import { getDisruptionRanking, computeDisruptionRisk } from "./disruption";
import { computeDVX } from "./dvx-engine";
import { runReactAgent } from "./agent/base-agent";
import { ensureSharedStoreReady, getSharedStore, NS } from "./agent/store";

export const DISRUPTION_AGENT_NAME = "disruption-agent";

const readMacroDigestTool = tool(
  async () => {
    await ensureSharedStoreReady();
    const items = await getSharedStore().search(NS.macroEvents(), { limit: 3 });
    return JSON.stringify(items.map(i => i.value));
  },
  {
    name: "read_latest_macro_digests",
    description: "Read the 3 most-recent macro-event digests from the shared store (published by the Macro Event Agent). Use this to bias what capabilities you focus on this cycle.",
    schema: z.object({}).strict(),
  },
);

const computeDvxTool = tool(
  async () => {
    const r = await computeDVX({ persist: true });
    return JSON.stringify({
      capabilitiesScored: r.capabilitiesScored,
      overallIndex: r.overallIndex,
      industryBreakdowns: Object.values(r.industryBreakdowns).slice(0, 8),
      llmCallsIssued: r.llmCallsIssued,
    });
  },
  {
    name: "recompute_dvx",
    description: "Run a full DVX (Disruption Velocity Index) recomputation cycle. Persists snapshot + per-capability components. Returns counts + industry breakdowns.",
    schema: z.object({}).strict(),
  },
);

const getDisruptionRankingTool = tool(
  async ({ limit }) => {
    const r = await getDisruptionRanking(true);
    return JSON.stringify({
      total: r.rows.length,
      top: r.rows.slice(0, Math.min(20, limit)),
    });
  },
  {
    name: "get_disruption_ranking",
    description: "Return the ranked list of capabilities by disruption risk. Pass limit (1-20).",
    schema: z.object({
      limit: z.number().int().min(1).max(20).default(10),
    }).strict(),
  },
);

const inspectCapabilityRiskTool = tool(
  async ({ capabilityId }) => {
    const r = await computeDisruptionRisk(capabilityId);
    if (!r) return JSON.stringify({ found: false });
    return JSON.stringify(r);
  },
  {
    name: "inspect_capability_disruption_risk",
    description: "Inspect the per-capability disruption factor breakdown for one capability id. Use for the top candidates after get_disruption_ranking.",
    schema: z.object({ capabilityId: z.number().int().positive() }).strict(),
  },
);

const publishDisruptionRiskTool = tool(
  async ({ summary, topCapabilityIds, severity }) => {
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
  {
    name: "publish_disruption_risk_digest",
    description: "Publish a short summary of the highest-disruption capabilities this cycle, with their IDs and an overall severity tier. Other agents (Stack Optimizer) read this to bias their recommendations.",
    schema: z.object({
      summary: z.string(),
      topCapabilityIds: z.array(z.number().int()),
      severity: z.enum(["low", "moderate", "high", "extreme"]),
    }).strict(),
  },
);

const TOOLS = [readMacroDigestTool, computeDvxTool, getDisruptionRankingTool, inspectCapabilityRiskTool, publishDisruptionRiskTool];

const SYSTEM_PROMPT = `You are the Disruption Agent inside the Inflexcvi platform. Each cycle:

1. Read the latest macro-event digests (read_latest_macro_digests) so your work is biased by what's happening in the world right now.
2. Recompute DVX (recompute_dvx) so your data is fresh.
3. Pull the ranked list (get_disruption_ranking) and inspect the top 3-5 candidates (inspect_capability_disruption_risk) for those whose risk factors look anomalous relative to recent macro context.
4. Publish a digest (publish_disruption_risk_digest) summarizing the highest-risk capabilities and an overall severity tier.

Cost discipline: Haiku. One sequential pass — no recursion. Skip publishing if nothing changed materially since last cycle.`;

export async function runDisruptionAgent(): Promise<{ output: string; toolCallCount: number; durationMs: number }> {
  const result = await runReactAgent(
    {
      agentName: DISRUPTION_AGENT_NAME,
      systemPrompt: SYSTEM_PROMPT,
      tools: TOOLS,
      modelTier: "haiku",
      temperature: 0.2,
      maxTokens: 2500,
    },
    "Run your routine disruption cycle now.",
  );
  console.log(`[disruption-agent] cycle complete: tools=${result.toolCallCount} duration=${result.durationMs}ms`);
  return result;
}
