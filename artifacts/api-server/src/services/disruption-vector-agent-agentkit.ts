/**
 * Disruption Vector Agent — AgentKit implementation.
 *
 * 8th specialized agent in the autonomous network — sibling to
 * `disruption-agent-agentkit` (current DVX) but forward-looking: computes
 * the Capability Disruption Index for stale leaf capabilities and publishes
 * a "frontier" digest to NS.disruptionRisks() for the synthesis agent.
 *
 * Cost discipline: Sonnet (one DI score = ~$0.04, one narrative = ~$0.03).
 * Per-cycle budget is 8 caps = ~$0.56. Inngest cron every 6 hours (cron
 * expression in `inngest/functions/agents.ts`).
 *
 * No AGENT_REGISTRY entry — preserves the legacy fallback to the shared
 * `cvi-autonomous-agent` Mem0 pool, matching pre-migration behavior.
 */
import { createAgent, createNetwork, createTool, anthropic } from "@inngest/agent-kit";
import { z } from "zod";
import { db, capabilitiesTable, industriesTable, disruptionPlaybookArchetypesTable, capabilityDisruptionIndexTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { ensureSharedStoreReady, getSharedStore, NS } from "./agent/store";
import { recallMemories, storeMemory } from "./agent/memory";
import { scoreCapabilityDisruption, persistDisruptionScore, listStaleCapabilityIds } from "./disruption-index";
import { composeDisruptionNarrative, findCandidateDisruptors } from "./disruption-narrative";
import type { AgentRunResult } from "./agent/agentkit-shared";

export const DISRUPTION_VECTOR_AGENT_NAME = "disruption-vector-agent";

const SONNET_MODEL = "claude-sonnet-4-5-20250929";

// Tracks how many cap-scores landed in the current run. Logged at the end
// so the cron's stdout shows progress per cycle.
let lastCycleScored = 0;

const SYSTEM_PROMPT = `You are the Disruption Vector Agent inside the Inflexcvi platform. Your job is to keep the forward-looking Capability Disruption Index (DI) fresh and to publish a "disruption frontier" digest for downstream agents.

Each cycle:
  1. read_context_digests — pull recent macro-events + disruption-risk digests so your scoring is biased by what's moving NOW.
  2. list_stale_capabilities — find leaf caps whose DI is stale (>7d) or never computed. Default limit 8 per cycle (cost discipline).
  3. score_capability — for each stale cap, run a full DI cycle (sub-scores + narrative + candidate disruptors + persist).
  4. get_top_di — pull the current leaderboard so you can ground the frontier digest in real top scores.
  5. publish_frontier_digest — publish a short summary + top capability ids + severity tier.

Be honest about uncertainty. A capability with sparse alpha enrichment won't have great sub-scores — say so in the narrative the persist step generates. Don't fabricate companies, scores, or rationales. Skip publishing the frontier digest if nothing meaningfully changed this cycle.

Cost discipline: Sonnet (one DI score = ~$0.04, one narrative = ~$0.03). Per-cycle budget is 8 caps = ~$0.56. The agent runs every 6 hours.`;

const readContextDigestsTool = createTool({
  name: "read_context_digests",
  description: "Read the 3 most-recent macro-event and disruption-risk digests so this cycle's DI scoring is biased by what's actually happening.",
  parameters: z.object({}).strict(),
  handler: async () => {
    await ensureSharedStoreReady();
    const [macro, risks] = await Promise.all([
      getSharedStore().search(NS.macroEvents(), { limit: 3 }),
      getSharedStore().search(NS.disruptionRisks(), { limit: 3 }),
    ]);
    return JSON.stringify({
      macroEvents: macro.map((i) => i.value),
      disruptionRisks: risks.map((i) => i.value),
    });
  },
});

const listStaleCapsTool = createTool({
  name: "list_stale_capabilities",
  description: "List leaf capabilities whose Disruption Index is stale (>N days) or never computed. Default 7 days. Pass limit (1-20).",
  parameters: z.object({
    stalenessDays: z.number().int().min(0).max(90).default(7),
    limit: z.number().int().min(1).max(20).default(8),
  }).strict(),
  handler: async ({ stalenessDays, limit }) => {
    const ids = await listStaleCapabilityIds(stalenessDays, limit);
    if (ids.length === 0) return JSON.stringify({ total: 0, capabilities: [] });
    const rows = await Promise.all(
      ids.map((id) =>
        db
          .select({ id: capabilitiesTable.id, name: capabilitiesTable.name, industryId: capabilitiesTable.industryId })
          .from(capabilitiesTable)
          .where(eq(capabilitiesTable.id, id))
          .limit(1)
          .then((r) => r[0]),
      ),
    );
    return JSON.stringify({ total: rows.length, capabilities: rows.filter(Boolean) });
  },
});

const scoreCapabilityTool = createTool({
  name: "score_capability",
  description: "Compute the Disruption Index for one capability (sub-scores + composite + playbook match + narrative + candidate disruptors) and persist. Pass capabilityId. Optional runId for traceability.",
  parameters: z.object({
    capabilityId: z.number().int().positive(),
    runId: z.number().int().positive().optional(),
  }).strict(),
  handler: async ({ capabilityId, runId }) => {
    const result = await scoreCapabilityDisruption(capabilityId);
    if (!result) return JSON.stringify({ ok: false, error: `capability ${capabilityId} not found` });

    const [cap] = await db
      .select({ name: capabilitiesTable.name, industryId: capabilitiesTable.industryId })
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.id, capabilityId))
      .limit(1);
    const [industry] = cap
      ? await db
          .select({ name: industriesTable.name })
          .from(industriesTable)
          .where(eq(industriesTable.id, cap.industryId))
          .limit(1)
      : [];

    const [archetype] = result.topPlaybookId
      ? await db
          .select()
          .from(disruptionPlaybookArchetypesTable)
          .where(eq(disruptionPlaybookArchetypesTable.id, result.topPlaybookId))
          .limit(1)
      : [];

    const candidates = cap ? await findCandidateDisruptors(capabilityId, cap.industryId, 5) : [];
    const narrative = cap
      ? await composeDisruptionNarrative(
          result,
          cap.name,
          industry?.name ?? "Unknown industry",
          archetype ?? null,
          candidates,
        )
      : null;

    await persistDisruptionScore(result, narrative, candidates, runId ?? null);
    lastCycleScored++;

    return JSON.stringify({
      ok: true,
      capabilityId,
      compositeDi: result.compositeDi,
      topPlaybook: result.topPlaybookName,
      topPlaybookSimilarity: result.topPlaybookSimilarity,
      candidatesFound: candidates.length,
    });
  },
});

const publishFrontierDigestTool = createTool({
  name: "publish_frontier_digest",
  description: "Publish this cycle's 'disruption frontier' — newly elevated DI scores — to the shared store. Synthesis-agent reads this. Pass a 1-3 sentence summary, the top capability ids by composite DI from this cycle, and a severity tier.",
  parameters: z.object({
    summary: z.string(),
    topCapabilityIds: z.array(z.number().int()),
    severity: z.enum(["low", "moderate", "high", "extreme"]),
  }).strict(),
  handler: async ({ summary, topCapabilityIds, severity }) => {
    await ensureSharedStoreReady();
    const key = `disruption-frontier-${new Date().toISOString()}`;
    await getSharedStore().put(NS.disruptionRisks(), key, {
      kind: "frontier",
      summary,
      topCapabilityIds,
      severity,
      publishedAt: new Date().toISOString(),
      publishedBy: DISRUPTION_VECTOR_AGENT_NAME,
    });
    return JSON.stringify({ ok: true, key });
  },
});

const getTopDiTool = createTool({
  name: "get_top_di",
  description: "Return the current top capabilities by composite Disruption Index. Use to ground the published frontier digest in actual leaders.",
  parameters: z.object({ limit: z.number().int().min(1).max(20).default(10) }).strict(),
  handler: async ({ limit }) => {
    const rows = await db
      .select({
        capabilityId: capabilityDisruptionIndexTable.capabilityId,
        compositeDi: capabilityDisruptionIndexTable.compositeDi,
        topPlaybookId: capabilityDisruptionIndexTable.topPlaybookId,
        computedAt: capabilityDisruptionIndexTable.computedAt,
      })
      .from(capabilityDisruptionIndexTable)
      .orderBy(desc(capabilityDisruptionIndexTable.compositeDi))
      .limit(Math.min(20, limit));
    return JSON.stringify({ rows });
  },
});

async function buildMemoryContext(): Promise<string> {
  const contextParts: string[] = [];
  const recallTopic = DISRUPTION_VECTOR_AGENT_NAME.replace(/-/g, " ");

  try {
    const memories = await recallMemories(
      recallTopic,
      undefined,
      5,
      { category: "pattern", agentName: DISRUPTION_VECTOR_AGENT_NAME, criteria: "relevance" },
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
    const priorBlock = await getAgentPriorBlock("industry_priors", DISRUPTION_VECTOR_AGENT_NAME);
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
    `[${DISRUPTION_VECTOR_AGENT_NAME}] ${output.substring(0, 400)}`,
    { source: DISRUPTION_VECTOR_AGENT_NAME, agentRun: true },
    { category: "agent_run_summary", agentName: DISRUPTION_VECTOR_AGENT_NAME },
  ).catch(() => {});
}

export async function runDisruptionVectorAgentAgentKit(): Promise<AgentRunResult> {
  const start = Date.now();
  lastCycleScored = 0;
  const memoryContext = await buildMemoryContext();
  const graphContext = await (await import("./agent/build-graph-context")).buildGraphContext();

  const agent = createAgent({
    name: DISRUPTION_VECTOR_AGENT_NAME,
    description: "Computes the forward-looking Capability Disruption Index for stale leaf capabilities and publishes a frontier digest.",
    system: SYSTEM_PROMPT + memoryContext + graphContext,
    model: anthropic({
      model: SONNET_MODEL,
      defaultParameters: {
        max_tokens: 4000,
        temperature: 0.2,
      },
    }),
    tools: [
      readContextDigestsTool,
      listStaleCapsTool,
      scoreCapabilityTool,
      publishFrontierDigestTool,
      getTopDiTool,
    ],
  });

  const network = createNetwork({
    name: "disruption-vector-agentkit-network",
    agents: [agent],
    maxIter: 20,
  });

  try {
    const run = await network.run("Run your routine disruption-vector cycle now. Score 8 stale capabilities and publish a frontier digest.");
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
    console.log(`[disruption-vector-agent-agentkit] cycle complete: scored=${lastCycleScored} tools=${toolCallCount} duration=${durationMs}ms`);

    writePostRunMemory(outputText).catch(() => {});

    return { output: outputText, toolCallCount, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[disruption-vector-agent-agentkit] cycle errored after ${durationMs}ms: ${message}`);
    return { output: `ERROR: ${message}`, toolCallCount: 0, durationMs };
  }
}
