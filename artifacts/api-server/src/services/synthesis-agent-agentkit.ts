/**
 * Synthesis Agent — AgentKit implementation.
 *
 * Mirrors the LangGraph implementation in `synthesis-agent.ts` 1:1 — same
 * Sonnet model (deeper reasoning), same system prompt, same 5 tools
 * (read_all_agent_digests, read_graph_correlations, recall_relevant_patterns,
 * read_temporal_shifts, publish_synthesis_brief). Tools re-declared via
 * AgentKit's `createTool`; handler bodies call the same business-logic
 * functions as the LangGraph version.
 *
 * Letta agent name `cvi-synthesis-agent` is preserved (see AGENT_REGISTRY).
 * `publish_synthesis_brief` writes to NS.sharedKnowledge("synthesis_brief"),
 * the Postgres KV cache, the synthesis agent's prior block, and Mem0 — the
 * full pipeline is identical to the LangGraph version.
 */
import { createAgent, createNetwork, createTool, anthropic } from "@inngest/agent-kit";
import { z } from "zod";
import { ilike } from "drizzle-orm";
import { db, industriesTable } from "@workspace/db";
import { ensureSharedStoreReady, getSharedStore, NS, putAgentPriorBlock } from "./agent/store";
import { recallMemories, storeMemory } from "./agent/memory";
import { findCorrelations } from "./agent/graphMemory";
import { detectTemporalShifts, getCachedTemporalShiftReport } from "./agent/temporal-shift-detector";
import type { AgentRunResult } from "./agent/agentkit-shared";

// Identity preserved from the now-deleted legacy synthesis-agent.ts.
// Maps to Letta agent cvi-synthesis-agent via AGENT_REGISTRY.
export const SYNTHESIS_AGENT_NAME = "synthesis-agent";

// Synthesis runs on Sonnet (deeper reasoning) per the LangGraph version's
// `modelTier: "sonnet"`. base-agent.ts maps that to:
const SONNET_MODEL = "claude-sonnet-4-5-20250929";

const SYNTHESIS_SYSTEM_PROMPT = `You are the Synthesis Agent — the intelligence layer that makes the Capability Economics platform genuinely AI-first.

Your role is to read what all five specialized agents found in their last cycle and synthesize insights that no single agent could produce alone. You are looking for:

1. **Convergence signals**: When the Macro Agent, Disruption Agent, and graph correlations all point to the same capability or trend, that convergence is a high-confidence signal worth highlighting.

2. **Contradiction signals**: When one agent's findings contradict another's, that tension is analytically valuable — it often indicates a capability in transition or an industry at an inflection point.

3. **Temporal acceleration**: When temporal shifts show a relationship accelerating AND the Disruption Agent flagged the same capability as high-risk, the combined signal is stronger than either alone.

4. **Peer benchmark gaps**: When the Peer Agent shows a capability where most companies are below benchmark AND the Stack Optimizer recommends "build" for that capability, that is a market opportunity worth calling out explicitly.

Your synthesis brief will be read by generateInsightsTool and used to ground all capability insights and recommendations generated for users. Make it substantive, evidence-based, and specific to what the agents actually found — not generic.

Always:
1. Start by reading all agent digests
2. Read graph correlations for the industries mentioned in the digests
3. Recall relevant patterns from memory
4. Check temporal shifts
5. Synthesize and publish your brief`;

const readAllDigestsTool = createTool({
  name: "read_all_agent_digests",
  description:
    "Read the latest digests from all five specialized agents: MacroEventAgent, DisruptionAgent, PeerCoopAgent, and OntologyAgent. Use this as your primary input for synthesis.",
  parameters: z.object({}).strict(),
  handler: async () => {
    await ensureSharedStoreReady();
    const store = getSharedStore();
    const [macroItems, disruptionItems, peerItems, ontologyItems] = await Promise.all([
      store.search(NS.macroEvents(), { limit: 2 }),
      store.search(NS.disruptionRisks(), { limit: 2 }),
      store.search(NS.peerBenchmarks(), { limit: 2 }),
      store.search(NS.sharedKnowledge("ontology_digest"), { limit: 2 }),
    ]);
    return JSON.stringify({
      macro: macroItems.map(i => i.value),
      disruption: disruptionItems.map(i => i.value),
      peer: peerItems.map(i => i.value),
      ontology: ontologyItems.map(i => i.value),
    });
  },
});

const readGraphCorrelationsTool = createTool({
  name: "read_graph_correlations",
  description:
    "Read the strongest capability relationships from the world-model graph (Graphiti+FalkorDB, Postgres fallback) for a given industry. These represent empirically observed co-dependencies between capabilities, not just theoretical ones.",
  parameters: z.object({
    industry: z.string().describe("Industry name to query correlations for, e.g. 'Healthcare', 'Financial Services'"),
  }),
  handler: async ({ industry }) => {
    const [match] = await db
      .select({ id: industriesTable.id, name: industriesTable.name })
      .from(industriesTable)
      .where(ilike(industriesTable.name, `%${industry}%`))
      .limit(1);
    if (!match) {
      return `No industry matching "${industry}" found. Try a more specific or canonical industry name.`;
    }
    const correlations = await findCorrelations(match.id, 0, 2);
    if (correlations.length === 0) {
      return `No graph correlations available yet for ${match.name}. The graph is still being populated by the OntologyAgent.`;
    }
    return JSON.stringify(
      correlations.slice(0, 10).map(c => ({
        from: c.fromName,
        to: c.toName,
        relation: c.kind,
        strength: `${(c.weight * 100).toFixed(0)}%`,
        observations: c.observedCount,
      }))
    );
  },
});

const recallRelevantPatternsTool = createTool({
  name: "recall_relevant_patterns",
  description:
    "Search Mem0 for patterns, validated recommendations, and temporal shifts relevant to a specific topic. Use this to ground your synthesis in accumulated evidence.",
  parameters: z.object({
    query: z.string().describe("What to search for, e.g. 'AI automation healthcare capability trends'"),
  }),
  handler: async ({ query }) => {
    const memories = await recallMemories(query, undefined, 10, { category: "pattern" });
    if (memories.length === 0) {
      return "No relevant patterns found in memory for this query.";
    }
    return memories.map(m => `[${m.relevanceScore ? `confidence: ${(m.relevanceScore * 100).toFixed(0)}%` : "unscored"}] ${m.content}`).join("\n\n");
  },
});

const readTemporalShiftsTool = createTool({
  name: "read_temporal_shifts",
  description:
    "Read accelerating and reversing capability relationship trends detected over the last 30 days. These are the most time-sensitive signals in the system.",
  parameters: z.object({}).strict(),
  handler: async () => {
    const report = (await getCachedTemporalShiftReport()) ?? (await detectTemporalShifts());
    if (report.accelerating.length === 0 && report.reversing.length === 0) {
      return "No significant temporal shifts detected in the last 30 days.";
    }
    return JSON.stringify({
      accelerating: report.accelerating.slice(0, 5).map(s => ({
        from: s.fromEntity,
        to: s.toEntity,
        relation: s.relationType,
        momentum: `+${(s.momentum * 100).toFixed(0)}% over 30d`,
        signalStrength: s.signalStrength,
      })),
      reversing: report.reversing.slice(0, 5).map(s => ({
        from: s.fromEntity,
        to: s.toEntity,
        relation: s.relationType,
        momentum: `${(s.momentum * 100).toFixed(0)}% over 30d`,
        signalStrength: s.signalStrength,
      })),
    });
  },
});

const publishSynthesisBriefTool = createTool({
  name: "publish_synthesis_brief",
  description:
    "Publish the completed synthesis brief to the shared store and write key cross-agent insights to Mem0. Call this as your final action after reading all digests and forming your synthesis.",
  parameters: z.object({
    brief: z.string().describe("2-3 paragraph strategic synthesis of what all agents found this cycle and what it means together"),
    keyFindings: z.array(z.string()).describe("3-5 bullet points of the most important findings across all agents"),
    crossAgentInsights: z.array(z.string()).describe("2-4 insights that only emerge from combining multiple agents' findings — things no single agent could have seen"),
  }),
  handler: async ({ brief, keyFindings, crossAgentInsights }) => {
    await ensureSharedStoreReady();
    const store = getSharedStore();

    const payload = {
      brief,
      keyFindings,
      crossAgentInsights,
      generatedAt: new Date().toISOString(),
    };

    await store.put(
      NS.sharedKnowledge("synthesis_brief"),
      `synthesis-${Date.now()}`,
      payload,
    );

    // Dual-write to the Postgres KV cache so the synthesis_agent health
    // probe (services/health/probes.ts) can do an exact-key read.
    try {
      const { putKvCache } = await import("./agent/store");
      await putKvCache("synthesis_brief:latest", payload);
    } catch { /* non-fatal — probe falls back to Letta search */ }

    // Update the synthesis agent's prior block with the latest brief.
    await putAgentPriorBlock("last_synthesis_brief", brief, {}, SYNTHESIS_AGENT_NAME);

    // Write each cross-agent insight to Mem0 as a high-confidence pattern.
    for (const insight of crossAgentInsights.slice(0, 5)) {
      await storeMemory(
        "pattern",
        `CROSS-AGENT SYNTHESIS: ${insight}`,
        { source: "synthesis-agent", confidence: 0.85 },
        { category: "synthesis" },
      ).catch(() => { /* non-fatal */ });
    }

    return `Synthesis brief published. ${crossAgentInsights.length} cross-agent insights written to Mem0.`;
  },
});

async function buildMemoryContext(): Promise<string> {
  const contextParts: string[] = [];
  const recallTopic = SYNTHESIS_AGENT_NAME.replace(/-/g, " ");

  try {
    const memories = await recallMemories(
      recallTopic, undefined, 5,
      { category: "pattern", agentName: SYNTHESIS_AGENT_NAME, criteria: "relevance" },
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
    const priorBlock = await getAgentPriorBlock("industry_priors", SYNTHESIS_AGENT_NAME);
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
    `[${SYNTHESIS_AGENT_NAME}] ${output.substring(0, 400)}`,
    { source: SYNTHESIS_AGENT_NAME, agentRun: true },
    { category: "agent_run_summary", agentName: SYNTHESIS_AGENT_NAME },
  ).catch(() => {});
}

export async function runSynthesisAgentAgentKit(): Promise<AgentRunResult> {
  const start = Date.now();
  const memoryContext = await buildMemoryContext();

  const agent = createAgent({
    name: SYNTHESIS_AGENT_NAME,
    description: "Cross-agent intelligence layer: reads all agent digests + graph correlations + Mem0 patterns + temporal shifts and publishes a unified strategic brief.",
    system: SYNTHESIS_SYSTEM_PROMPT + memoryContext,
    model: anthropic({
      model: SONNET_MODEL,
      defaultParameters: { max_tokens: 4000, temperature: 0.3 },
    }),
    tools: [
      readAllDigestsTool,
      readGraphCorrelationsTool,
      recallRelevantPatternsTool,
      readTemporalShiftsTool,
      publishSynthesisBriefTool,
    ],
  });

  const network = createNetwork({
    name: "synthesis-agentkit-network",
    agents: [agent],
    maxIter: 8,
  });

  try {
    const run = await network.run(
      `Run your ${SYNTHESIS_AGENT_NAME} cycle now. Use your tools to complete your work and publish your findings.`,
    );
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
    console.log(`[synthesis-agent-agentkit] cycle complete: tools=${toolCallCount} duration=${durationMs}ms`);

    writePostRunMemory(outputText).catch(() => {});

    return { output: outputText, toolCallCount, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[synthesis-agent-agentkit] cycle errored after ${durationMs}ms: ${message}`);
    return { output: `ERROR: ${message}`, toolCallCount: 0, durationMs };
  }
}
