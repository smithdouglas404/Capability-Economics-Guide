/**
 * Synthesis Agent — AI-FIRST cross-agent intelligence layer.
 *
 * This is the agent that makes the system genuinely intelligent rather than
 * a collection of independent processes. It runs after all five specialized
 * agents have completed their cycles and:
 *
 * 1. Reads all five agent digests from the shared store
 * 2. Reads the top 10 graph correlations from Neo4j (findCorrelations)
 * 3. Reads the top 10 most relevant Mem0 patterns for the current context
 * 4. Reads temporal shift signals from the last 24h
 * 5. Uses Claude Sonnet to synthesize a unified strategic brief
 * 6. Writes the brief to NS.sharedKnowledge("synthesis_brief") for
 *    generateInsightsTool to consume
 * 7. Writes key cross-agent findings to Mem0 as high-confidence patterns
 *
 * The synthesis brief is what elevates this from "five agents that each
 * do their own thing" to "a system that reasons about the whole picture."
 *
 * Runs daily after the stack optimizer agent (the last in the chain).
 */
import { tool } from "langchain";
import { z } from "zod/v4";
import { ilike } from "drizzle-orm";
import { db, industriesTable } from "@workspace/db";
import { runReactAgent, type AgentRunResult } from "./agent/base-agent";
import { ensureSharedStoreReady, getSharedStore, NS, putAgentPriorBlock } from "./agent/store";
import { recallMemories, storeMemory } from "./agent/memory";
import { findCorrelations } from "./agent/graphMemory";
import { detectTemporalShifts } from "./agent/temporal-shift-detector";

export const SYNTHESIS_AGENT_NAME = "synthesis-agent";

// ─── Tools ────────────────────────────────────────────────────────────────────

const readAllDigestsTool = tool(
  async () => {
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
  {
    name: "read_all_agent_digests",
    description: "Read the latest digests from all five specialized agents: MacroEventAgent, DisruptionAgent, PeerCoopAgent, and OntologyAgent. Use this as your primary input for synthesis.",
    schema: z.object({}).strict(),
  },
);

const readGraphCorrelationsTool = tool(
  async ({ industry }) => {
    // findCorrelations is keyed on integer industryId — resolve the name first.
    // ILIKE is intentionally fuzzy so "Healthcare" matches "Healthcare & Life Sciences" etc.
    const [match] = await db
      .select({ id: industriesTable.id, name: industriesTable.name })
      .from(industriesTable)
      .where(ilike(industriesTable.name, `%${industry}%`))
      .limit(1);
    if (!match) {
      return `No industry matching "${industry}" found. Try a more specific or canonical industry name.`;
    }
    // capabilityId=0 widens the predicate to industry-only matches in findCorrelations.
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
  {
    name: "read_graph_correlations",
    description: "Read the strongest capability relationships from the Neo4j graph for a given industry. These represent empirically observed co-dependencies between capabilities, not just theoretical ones.",
    schema: z.object({
      industry: z.string().describe("Industry name to query correlations for, e.g. 'Healthcare', 'Financial Services'"),
    }),
  },
);

const recallRelevantPatternsTool = tool(
  async ({ query }) => {
    const memories = await recallMemories(query, undefined, 10, { category: "pattern" });
    if (memories.length === 0) {
      return "No relevant patterns found in memory for this query.";
    }
    return memories.map(m => `[${m.relevanceScore ? `confidence: ${(m.relevanceScore * 100).toFixed(0)}%` : "unscored"}] ${m.content}`).join("\n\n");
  },
  {
    name: "recall_relevant_patterns",
    description: "Search Mem0 for patterns, validated recommendations, and temporal shifts relevant to a specific topic. Use this to ground your synthesis in accumulated evidence.",
    schema: z.object({
      query: z.string().describe("What to search for, e.g. 'AI automation healthcare capability trends'"),
    }),
  },
);

const readTemporalShiftsTool = tool(
  async () => {
    const report = await detectTemporalShifts();
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
  {
    name: "read_temporal_shifts",
    description: "Read accelerating and reversing capability relationship trends detected over the last 30 days. These are the most time-sensitive signals in the system.",
    schema: z.object({}).strict(),
  },
);

const publishSynthesisBriefTool = tool(
  async ({ brief, keyFindings, crossAgentInsights }) => {
    await ensureSharedStoreReady();
    const store = getSharedStore();

    const payload = {
      brief,
      keyFindings,
      crossAgentInsights,
      generatedAt: new Date().toISOString(),
    };

    // Write to shared store for generateInsightsTool to consume
    await store.put(
      NS.sharedKnowledge("synthesis_brief"),
      `synthesis-${Date.now()}`,
      payload,
    );

    // Also update the synthesis agent's prior block so future runs
    // start with context about what the last synthesis concluded.
    // Signature: putAgentPriorBlock(label, value, metadata, agentName).
    await putAgentPriorBlock("last_synthesis_brief", brief, {}, SYNTHESIS_AGENT_NAME);

    // Write each cross-agent insight to Mem0 as a high-confidence pattern
    for (const insight of crossAgentInsights.slice(0, 5)) {
      await storeMemory(
        "pattern",
        `CROSS-AGENT SYNTHESIS: ${insight}`,
        { source: "synthesis-agent", confidence: 0.85 },
        { category: "synthesis" },
      ).catch(() => {
        // Non-fatal
      });
    }

    return `Synthesis brief published. ${crossAgentInsights.length} cross-agent insights written to Mem0.`;
  },
  {
    name: "publish_synthesis_brief",
    description: "Publish the completed synthesis brief to the shared store and write key cross-agent insights to Mem0. Call this as your final action after reading all digests and forming your synthesis.",
    schema: z.object({
      brief: z.string().describe("2-3 paragraph strategic synthesis of what all agents found this cycle and what it means together"),
      keyFindings: z.array(z.string()).describe("3-5 bullet points of the most important findings across all agents"),
      crossAgentInsights: z.array(z.string()).describe("2-4 insights that only emerge from combining multiple agents' findings — things no single agent could have seen"),
    }),
  },
);

// ─── System Prompt ─────────────────────────────────────────────────────────────

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

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runSynthesisAgent(): Promise<AgentRunResult> {
  return runReactAgent({
    agentName: SYNTHESIS_AGENT_NAME,
    systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
    tools: [
      readAllDigestsTool,
      readGraphCorrelationsTool,
      recallRelevantPatternsTool,
      readTemporalShiftsTool,
      publishSynthesisBriefTool,
    ],
    modelTier: "sonnet", // Synthesis requires deeper reasoning
    temperature: 0.3,
    maxTokens: 4000,
  });
}
