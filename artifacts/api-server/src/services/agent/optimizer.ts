/**
 * Per-agent prompt optimizer — TypeScript equivalent of LangMem's
 * create_prompt_optimizer.
 *
 * Reads the last N rows of agent_runs, scores each outcome with a
 * simple heuristic, asks Haiku to rewrite the agent's instruction
 * block based on what correlated with high scores vs. errors, and
 * persists the new instructions back into the shared store under
 * NS.agentPriors(agentName).
 *
 * Intended cadence: weekly cron per agent. Cheap (~1 Haiku call per
 * agent per week). Never blocks the hot research path.
 *
 * Note: this complements — does NOT replace — the existing reflect
 * feedback loop that prompts Letta to update industry_priors after
 * contradictions. This optimizer rewrites the *agent's own
 * instructions* (how it should approach future runs), not its
 * beliefs about specific industries.
 */
import { ChatAnthropic } from "@langchain/anthropic";
import { db, agentRunsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { ensureSharedStoreReady, getSharedStore, NS } from "./store";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

const DEFAULT_INSTRUCTIONS =
  "No instructions persisted yet — first optimizer pass will write the initial baseline.";

/**
 * Heuristic score per run, in [0, 1].
 * - Errored runs → 0
 * - Otherwise: count of memories stored / 5, capped at 1
 * Future iteration: replace with a signal more strongly tied to user
 * outcomes (e.g., proposal approval rate, downstream CVI accuracy).
 */
function scoreRun(r: typeof agentRunsTable.$inferSelect): number {
  if (r.errorMessage) return 0;
  const memoriesStored = r.memoriesStored ?? 0;
  return Math.min(1, memoriesStored / 5);
}

export async function optimizeAgentInstructions(
  agentName: string,
  lookbackRuns = 20,
): Promise<{ optimized: boolean; basedOnRuns: number; reason?: string }> {
  await ensureSharedStoreReady();
  const store = getSharedStore();

  const recent = await db
    .select()
    .from(agentRunsTable)
    .orderBy(desc(agentRunsTable.startedAt))
    .limit(lookbackRuns);

  if (recent.length < 5) {
    return {
      optimized: false,
      basedOnRuns: recent.length,
      reason: `need ≥ 5 runs to optimize (have ${recent.length})`,
    };
  }

  const namespace = NS.agentPriors(agentName);
  const existing = await store.get(namespace, "instructions");
  const currentInstructions =
    typeof existing?.value === "string"
      ? existing.value
      : (existing?.value as { instructions?: string })?.instructions ?? DEFAULT_INSTRUCTIONS;

  const runSummaries = recent.map(r => {
    const s = scoreRun(r);
    return (
      `Run #${r.id} (${r.trigger}): score=${s.toFixed(2)}, ` +
      `memoriesStored=${r.memoriesStored}, perplexityCalls=${r.perplexityCalls}, ` +
      `industriesEvaluated=${r.industriesEvaluated}, ` +
      `capabilitiesResearched=${r.capabilitiesResearched}, ` +
      `error=${r.errorMessage ?? "none"}`
    );
  }).join("\n");

  const optimizerPrompt =
    `You are improving the standing instructions for an autonomous AI agent called "${agentName}".\n\n` +
    `CURRENT INSTRUCTIONS:\n${currentInstructions}\n\n` +
    `RECENT RUN PERFORMANCE (last ${recent.length} runs, most-recent first):\n${runSummaries}\n\n` +
    `Analyze the performance data. Identify what differentiates high-scoring runs from low-scoring or errored runs ` +
    `(memory yield, research depth, error patterns). Rewrite the instructions to bias future runs toward the ` +
    `high-scoring patterns and away from the failure modes.\n\n` +
    `Rules:\n` +
    `- Keep the same format and roughly the same length as the current instructions\n` +
    `- Be specific — name the patterns you observed (e.g. "skip targets with confidence < 0.4")\n` +
    `- If the data is ambiguous or there's no clear signal, return the existing instructions unchanged\n` +
    `- Output ONLY the new instructions text, no preamble or explanation`;

  const llm = new ChatAnthropic({
    model: HAIKU_MODEL,
    temperature: 0.2,
    maxTokens: 1500,
  });

  const response = await llm.invoke(optimizerPrompt);
  const raw = response.content;
  const newInstructions = Array.isArray(raw)
    ? raw.map(part => (typeof part === "string" ? part : "text" in part && typeof part.text === "string" ? part.text : "")).join("")
    : String(raw);

  if (!newInstructions || newInstructions.trim().length === 0) {
    return { optimized: false, basedOnRuns: recent.length, reason: "LLM returned empty content" };
  }

  await store.put(namespace, "instructions", {
    value: newInstructions.trim(),
    optimizedAt: new Date().toISOString(),
    basedOnRuns: recent.length,
    previousInstructionsHash: currentInstructions.slice(0, 80),
  });

  console.log(`[optimizer] rewrote instructions for "${agentName}" from ${recent.length} runs (model=${HAIKU_MODEL})`);
  return { optimized: true, basedOnRuns: recent.length };
}
