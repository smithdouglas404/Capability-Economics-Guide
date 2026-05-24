/**
 * Peer Co-op Agent — AgentKit implementation.
 *
 * Mirrors the LangGraph implementation in `peer-coop-agent.ts` 1:1 — same
 * Haiku model, same system prompt, same 3 tools (list_contributing_organizations,
 * get_peer_percentiles, publish_peer_benchmark_digest). Tools re-declared via
 * AgentKit's `createTool` (incompatible with LangChain's `DynamicStructuredTool`);
 * handler bodies call the same business-logic functions as the LangGraph version.
 *
 * Letta agent name `cvi-peer-coop-agent` is preserved (see AGENT_REGISTRY).
 */
import { createAgent, createNetwork, createTool, anthropic } from "@inngest/agent-kit";
import { z } from "zod";
import { db, organizationsTable } from "@workspace/db";
import { getContributorStatus, getPeerPercentiles } from "./peer-coop";
import { ensureSharedStoreReady, getSharedStore, NS } from "./agent/store";
import { recallMemories, storeMemory } from "./agent/memory";
import type { AgentRunResult } from "./agent/agentkit-shared";

// Identity preserved from the now-deleted legacy peer-coop-agent.ts.
// Maps to Letta agent cvi-peer-coop-agent via AGENT_REGISTRY.
export const PEER_COOP_AGENT_NAME = "peer-coop-agent";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are the Peer Co-op Agent. Each cycle:

1. List contributing organizations (list_contributing_organizations).
2. Sample percentile data from 2-4 representative orgs (get_peer_percentiles) to spot capabilities where cohort coverage is healthy vs sparse.
3. Publish a single benchmark digest (publish_peer_benchmark_digest) with coverage stats so the Stack Optimizer Agent knows which capabilities have credible peer context vs need-more-data.

Cost discipline: Haiku. Don't sample every organization — pick representatives.`;

const listContributingOrgsTool = createTool({
  name: "list_contributing_organizations",
  description:
    "List organizations currently contributing to peer-coop benchmarks, with their contributor status (membership, capabilities-published, eligibility).",
  parameters: z.object({}).strict(),
  handler: async () => {
    const orgs = await db.select().from(organizationsTable).limit(25);
    const statuses = await Promise.all(orgs.map(o => getContributorStatus(o.id).catch(() => null)));
    return JSON.stringify(orgs.map((o, i) => ({
      id: o.id,
      name: o.name,
      status: statuses[i] ?? null,
    })).filter(x => x.status));
  },
});

const getPercentilesTool = createTool({
  name: "get_peer_percentiles",
  description:
    "Get the peer-cohort percentiles for a single organization (where they sit relative to their k-anonymity cohort on each scored capability).",
  parameters: z.object({ organizationId: z.number().int().positive() }).strict(),
  handler: async ({ organizationId }) => {
    const r = await getPeerPercentiles(organizationId);
    if (!r) return JSON.stringify({ found: false });
    return JSON.stringify(r);
  },
});

const publishBenchmarkDigestTool = createTool({
  name: "publish_peer_benchmark_digest",
  description:
    "Publish a rollup of peer-coop benchmark coverage (which capabilities have enough cohort members to surface percentiles, which don't yet).",
  parameters: z.object({
    summary: z.string(),
    cohortCoverage: z.array(z.object({
      capabilityName: z.string(),
      contributorCount: z.number().int().nonnegative(),
      median: z.number().nullable(),
    })),
    organizationsSampled: z.number().int().nonnegative(),
  }).strict(),
  handler: async ({ summary, cohortCoverage, organizationsSampled }) => {
    await ensureSharedStoreReady();
    const key = `bench-${new Date().toISOString()}`;
    await getSharedStore().put(NS.peerBenchmarks(), key, {
      summary,
      cohortCoverage,
      organizationsSampled,
      publishedAt: new Date().toISOString(),
      publishedBy: PEER_COOP_AGENT_NAME,
    });
    return JSON.stringify({ ok: true, key });
  },
});

async function buildMemoryContext(): Promise<string> {
  const contextParts: string[] = [];
  const recallTopic = PEER_COOP_AGENT_NAME.replace(/-/g, " ");

  try {
    const memories = await recallMemories(
      recallTopic, undefined, 5,
      { category: "pattern", agentName: PEER_COOP_AGENT_NAME, criteria: "relevance" },
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
    const priorBlock = await getAgentPriorBlock("industry_priors", PEER_COOP_AGENT_NAME);
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
    `[${PEER_COOP_AGENT_NAME}] ${output.substring(0, 400)}`,
    { source: PEER_COOP_AGENT_NAME, agentRun: true },
    { category: "agent_run_summary", agentName: PEER_COOP_AGENT_NAME },
  ).catch(() => {});
}

export async function runPeerCoopAgentAgentKit(): Promise<AgentRunResult> {
  const start = Date.now();
  const memoryContext = await buildMemoryContext();

  const agent = createAgent({
    name: PEER_COOP_AGENT_NAME,
    description: "Polls peer-coop k-anonymity cohort benchmarks and publishes a digest.",
    system: SYSTEM_PROMPT + memoryContext,
    model: anthropic({
      model: HAIKU_MODEL,
      defaultParameters: { max_tokens: 2000, temperature: 0.2 },
    }),
    tools: [listContributingOrgsTool, getPercentilesTool, publishBenchmarkDigestTool],
  });

  const network = createNetwork({
    name: "peer-coop-agentkit-network",
    agents: [agent],
    maxIter: 6,
  });

  try {
    const run = await network.run("Run your routine peer-benchmarks cycle now.");
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
    console.log(`[peer-coop-agent-agentkit] cycle complete: tools=${toolCallCount} duration=${durationMs}ms`);

    writePostRunMemory(outputText).catch(() => {});

    return { output: outputText, toolCallCount, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[peer-coop-agent-agentkit] cycle errored after ${durationMs}ms: ${message}`);
    return { output: `ERROR: ${message}`, toolCallCount: 0, durationMs };
  }
}
