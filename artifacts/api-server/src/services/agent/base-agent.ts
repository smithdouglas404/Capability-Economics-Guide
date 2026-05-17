/**
 * Base helper for the specialized autonomous agents (macro-event,
 * disruption, peer-coop, stack-optimizer, ontology, synthesis).
 *
 * Per CLAUDE.md: NO LangGraph supervisor. Each agent is autonomous and
 * coordinates via the shared PostgresStore.
 *
 * AI-FIRST UPGRADE (Phase 6):
 * Every agent now:
 * 1. Recalls the top 5 most relevant Mem0 patterns before acting
 * 2. Reads its own prior block (accumulated beliefs) from PostgresStore
 * 3. Reads the latest synthesis brief from the SynthesisAgent
 * 4. Injects all of the above into the system prompt as context
 * 5. Writes a post-run memory summary to Mem0 after completing
 *
 * This is what makes agents learn from each other and from their own
 * past — not just from current-cycle data.
 */
import { createAgent } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { recallMemories, storeMemory } from "./memory";
import { getAgentPriorBlock, getSharedStore, NS, ensureSharedStoreReady } from "./store";

const DEFAULT_HAIKU = "claude-haiku-4-5-20251001";
const DEFAULT_SONNET = "claude-sonnet-4-5-20250929";

export interface AgentRunResult {
  output: string;
  toolCallCount: number;
  durationMs: number;
}

export interface AgentConfig {
  /** Agent identifier — used for NS.agentPriors(agentName) writes. */
  agentName: string;
  /** System prompt — should describe role + how to use the tools. */
  systemPrompt: string;
  /** Tools the agent can invoke. */
  tools: DynamicStructuredTool[];
  /**
   * "haiku" (default — fast, cheap, fine for routine cycles) or
   * "sonnet" (deeper reasoning for end-of-cycle synthesis runs).
   */
  modelTier?: "haiku" | "sonnet";
  /** Default 0.2 — keep deterministic-ish unless the agent needs creativity. */
  temperature?: number;
  /** Default 2000 tokens. */
  maxTokens?: number;
  /**
   * Optional topic hint for Mem0 recall — if provided, the recall query
   * will be biased toward this topic. Defaults to the agent's name.
   */
  recallTopic?: string;
  /**
   * Whether to skip Mem0 recall for this run. Useful for one-off
   * admin-triggered runs where memory context is not relevant.
   * Defaults to false (recall is enabled).
   */
  skipMemoryRecall?: boolean;
}

/**
 * Build the memory context block that is injected into every agent's
 * system prompt. Pulls from three sources:
 * 1. Mem0 semantic recall (top 5 relevant patterns)
 * 2. Agent's own prior block (accumulated beliefs from past cycles)
 * 3. Latest synthesis brief (cross-agent intelligence)
 */
async function buildMemoryContext(
  agentName: string,
  recallTopic: string,
): Promise<string> {
  const contextParts: string[] = [];

  // 1. Mem0 semantic recall
  try {
    const memories = await recallMemories(
      recallTopic,
      undefined,
      5,
      { category: "pattern" },
    );
    if (memories.length > 0) {
      const memLines = memories
        .map(m => `  - ${m.content.substring(0, 200)}`)
        .join("\n");
      contextParts.push(`RELEVANT PATTERNS FROM MEMORY:\n${memLines}`);
    }
  } catch {
    // Non-fatal — agent runs without memory context if Mem0 is down
  }

  // 2. Agent's own prior block
  try {
    const priorBlock = await getAgentPriorBlock(agentName, "industry_priors");
    if (priorBlock && typeof priorBlock === "string" && priorBlock.length > 20) {
      contextParts.push(`YOUR ACCUMULATED BELIEFS (from past cycles):\n${priorBlock.substring(0, 800)}`);
    }
  } catch {
    // Non-fatal
  }

  // 3. Latest synthesis brief
  try {
    await ensureSharedStoreReady();
    const synthItems = await getSharedStore().search(
      NS.sharedKnowledge("synthesis_brief"),
      { limit: 1 },
    );
    if (synthItems.length > 0) {
      const brief = (synthItems[0].value as { brief?: string }).brief;
      if (brief) {
        contextParts.push(`LATEST CROSS-AGENT SYNTHESIS BRIEF:\n${brief.substring(0, 600)}`);
      }
    }
  } catch {
    // Non-fatal — synthesis brief may not exist yet
  }

  if (contextParts.length === 0) return "";

  return `\n\n--- MEMORY CONTEXT (use this to ground your work in accumulated evidence) ---\n${contextParts.join("\n\n")}\n--- END MEMORY CONTEXT ---`;
}

/**
 * Write a post-run memory summary to Mem0. Called after the agent
 * completes its run to capture what it found for future recall.
 */
async function writePostRunMemory(
  agentName: string,
  output: string,
): Promise<void> {
  if (!output || output.length < 50) return;

  // Summarize the output to a concise memory entry
  const summary = output.substring(0, 400);
  await storeMemory(
    "observation",
    `[${agentName}] ${summary}`,
    { source: agentName, agentRun: true },
    { category: "agent_run_summary" },
  ).catch(() => {
    // Non-fatal
  });
}

/**
 * Invoke an agent with a single user message and return the final
 * answer + bookkeeping. Tools are tool-callable autonomously by the
 * agent within the same invocation.
 *
 * Automatically injects Mem0 patterns, prior blocks, and synthesis
 * brief into the system prompt before invocation, and writes a
 * post-run memory summary to Mem0 after completion.
 */
export async function runReactAgent(
  config: AgentConfig,
  userInput?: string,
): Promise<AgentRunResult> {
  const start = Date.now();

  // Build memory context unless explicitly skipped
  let memoryContext = "";
  if (!config.skipMemoryRecall) {
    const recallTopic = config.recallTopic ?? config.agentName.replace(/-/g, " ");
    memoryContext = await buildMemoryContext(config.agentName, recallTopic);
  }

  // Inject memory context into system prompt
  const enrichedSystemPrompt = config.systemPrompt + memoryContext;

  const model = new ChatAnthropic({
    model: config.modelTier === "sonnet" ? DEFAULT_SONNET : DEFAULT_HAIKU,
    temperature: config.temperature ?? 0.2,
    maxTokens: config.maxTokens ?? 2000,
  });

  const agent = createAgent({
    model,
    tools: config.tools,
    systemPrompt: enrichedSystemPrompt,
  });

  const input = userInput ?? `Run your ${config.agentName} cycle now. Use your tools to complete your work and publish your findings.`;

  const result = await agent.invoke({
    messages: [{ role: "user", content: input }],
  });

  // ReactAgent returns { messages: BaseMessage[] }. The final assistant
  // message is the agent's answer; intermediate tool_use/tool_result
  // messages let us count tool calls for cost/perf reporting.
  const messages = result.messages ?? [];
  const finalAssistant = [...messages].reverse().find((m: { getType?: () => string }) =>
    typeof m.getType === "function" ? m.getType() === "ai" : false,
  );
  const rawContent = (finalAssistant as { content?: unknown })?.content ?? "";
  const output = Array.isArray(rawContent)
    ? rawContent.map((p: unknown) => (typeof p === "string" ? p : (p as { text?: string }).text ?? "")).join("")
    : String(rawContent);

  const toolCallCount = messages.filter((m: { getType?: () => string }) =>
    typeof m.getType === "function" ? m.getType() === "tool" : false,
  ).length;

  // Write post-run memory summary (non-blocking)
  if (!config.skipMemoryRecall) {
    writePostRunMemory(config.agentName, output).catch(() => {});
  }

  return { output, toolCallCount, durationMs: Date.now() - start };
}
