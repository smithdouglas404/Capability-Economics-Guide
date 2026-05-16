/**
 * Base helper for the specialized autonomous agents (macro-event,
 * disruption, peer-coop, stack-optimizer, ontology).
 *
 * Per CLAUDE.md: NO LangGraph supervisor. Each agent is autonomous and
 * coordinates via the shared PostgresStore.
 *
 * langchain v1.x: `AgentExecutor` is gone — replaced by `createAgent`
 * which returns a `ReactAgent`. The user's Master Action Plan referenced
 * the v0.x AgentExecutor name; we use the v1 equivalent without breaking
 * the intent.
 */
import { createAgent } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import type { DynamicStructuredTool } from "@langchain/core/tools";

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
}

/**
 * Invoke an agent with a single user message and return the final
 * answer + bookkeeping. Tools are tool-callable autonomously by the
 * agent within the same invocation.
 */
export async function runReactAgent(
  config: AgentConfig,
  userInput: string,
): Promise<AgentRunResult> {
  const start = Date.now();
  const model = new ChatAnthropic({
    model: config.modelTier === "sonnet" ? DEFAULT_SONNET : DEFAULT_HAIKU,
    temperature: config.temperature ?? 0.2,
    maxTokens: config.maxTokens ?? 2000,
  });

  const agent = createAgent({
    model,
    tools: config.tools,
    systemPrompt: config.systemPrompt,
  });

  const result = await agent.invoke({
    messages: [{ role: "user", content: userInput }],
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

  return { output, toolCallCount, durationMs: Date.now() - start };
}
