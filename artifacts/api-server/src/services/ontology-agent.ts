/**
 * Ontology Agent — wraps services/agent/graphMemory.ts +
 * services/foundry/sync.ts.
 *
 * Reads all other agents' outputs from the shared store, extracts
 * entities + records relations into the custom graph layer, and
 * triggers a Foundry sync so external consumers can see updates.
 *
 * Per Master Action Plan Phase 1.9 Step 3 / agent #5.
 */
import { tool } from "langchain";
import { z } from "zod/v4";
import { extractEntitiesFromText, upsertEntity, getGraphStats } from "./agent/graphMemory";
import { runFoundrySyncOnce, getFoundryAlertState } from "./foundry/sync";
import { runReactAgent } from "./agent/base-agent";
import { ensureSharedStoreReady, getSharedStore, NS } from "./agent/store";

export const ONTOLOGY_AGENT_NAME = "ontology-agent";

const readAllAgentOutputsTool = tool(
  async () => {
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
  {
    name: "read_all_agent_outputs",
    description: "Read the latest digests from every other specialized agent (macro, disruption, peer-coop, stack-optimizer) so you can extract cross-agent entities + relationships.",
    schema: z.object({}).strict(),
  },
);

const extractAndRegisterTool = tool(
  async ({ texts }) => {
    let totalEntities = 0;
    for (const text of texts.slice(0, 20)) {
      const entities = await extractEntitiesFromText(text);
      for (const e of entities) {
        await upsertEntity(e, { source: ONTOLOGY_AGENT_NAME, registeredAt: new Date().toISOString() });
        totalEntities++;
      }
    }
    return JSON.stringify({ registered: totalEntities });
  },
  {
    name: "extract_and_register_entities",
    description: "Extract entities (industry / capability / concept / metric / actor) from the provided text snippets and register them in the custom graph layer. Pass an array of strings (max 20).",
    schema: z.object({
      texts: z.array(z.string()).min(1).max(20),
    }).strict(),
  },
);

const graphStatsTool = tool(
  async () => {
    const s = await getGraphStats();
    return JSON.stringify(s);
  },
  {
    name: "get_graph_stats",
    description: "Get current entity + relation counts and the top relations in the graph.",
    schema: z.object({}).strict(),
  },
);

const foundrySyncTool = tool(
  async () => {
    const alert = getFoundryAlertState();
    if (!alert.active) {
      // No alert state — skip the sync rather than spamming Foundry
      // every cycle. Real sync still runs from its own cron.
      return JSON.stringify({ skipped: true, reason: "foundry alert not active" });
    }
    const r = await runFoundrySyncOnce(`ontology-agent cycle ${new Date().toISOString()}`);
    return JSON.stringify(r);
  },
  {
    name: "trigger_foundry_sync_if_alerted",
    description: "Trigger a one-shot Foundry sync, but only if Foundry's alert state says one is needed. Otherwise skip.",
    schema: z.object({}).strict(),
  },
);

const TOOLS = [readAllAgentOutputsTool, extractAndRegisterTool, graphStatsTool, foundrySyncTool];

const SYSTEM_PROMPT = `You are the Ontology Agent. Each cycle:

1. Read all other agents' latest digests (read_all_agent_outputs).
2. Extract entities + relationships from the digest text (extract_and_register_entities) — pass the most-information-dense strings from the digests as the texts array (their summary fields).
3. Optionally check get_graph_stats to confirm registration.
4. If Foundry has an alerted sync pending, trigger it (trigger_foundry_sync_if_alerted).

Cost discipline: Haiku. One pass — don't loop.`;

export async function runOntologyAgent(): Promise<{ output: string; toolCallCount: number; durationMs: number }> {
  const result = await runReactAgent(
    {
      agentName: ONTOLOGY_AGENT_NAME,
      systemPrompt: SYSTEM_PROMPT,
      tools: TOOLS,
      modelTier: "haiku",
      temperature: 0.2,
      maxTokens: 2000,
    },
    "Run your routine ontology cycle now.",
  );
  console.log(`[ontology-agent] cycle complete: tools=${result.toolCallCount} duration=${result.durationMs}ms`);
  return result;
}
