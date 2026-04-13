import type { Letta as LettaClient } from "@letta-ai/letta-client";
import type { AgentState } from "@letta-ai/letta-client/resources/agents/agents";
import type { LettaResponse, AssistantMessage, Message } from "@letta-ai/letta-client/resources/agents/messages";
import { emitAgentEvent } from "./events";

const LETTA_API_KEY = process.env.LETTA_API_KEY || undefined;
const LETTA_BASE_URL = process.env.LETTA_BASE_URL || (LETTA_API_KEY ? "https://api.letta.ai" : "http://localhost:8283");
const LETTA_AGENT_NAME = "cei-autonomous-agent";
const LETTA_MODEL = process.env.LETTA_MODEL || "openrouter/anthropic/claude-3-5-sonnet-20241022";
const LETTA_EMBEDDING = process.env.LETTA_EMBEDDING || "letta/letta-free";
const RETRY_COOLDOWN_MS = 60_000;

let lettaClient: LettaClient | null = null;
let lettaAgentId: string | null = null;
let lettaConnected = false;
let lastAttemptAt = 0;
let initPromise: Promise<boolean> | null = null;

function extractAssistantText(messages: Message[]): string {
  return messages
    .filter((m): m is AssistantMessage => m.message_type === "assistant_message")
    .map((m) => {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .filter((part): part is { type: "text"; text: string } => "type" in part && part.type === "text")
          .map((part) => part.text)
          .join("");
      }
      return "";
    })
    .join("\n");
}

async function doInit(): Promise<boolean> {
  try {
    const { default: Letta } = await import("@letta-ai/letta-client");
    lettaClient = new Letta({
      baseURL: LETTA_BASE_URL,
      ...(LETTA_API_KEY ? { apiKey: LETTA_API_KEY } : {}),
    });

    // Health check is optional — some Letta versions / Docker images don't expose it.
    // If it fails we still attempt to reach the agents API as the real connectivity test.
    try {
      await Promise.race([
        lettaClient.health(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
      ]);
    } catch {
      // Non-fatal — continue and let the agents.list() call be the real gate.
    }

    const agentsList: AgentState[] = [];
    const agentsPage = await lettaClient.agents.list();
    for await (const agent of agentsPage) {
      agentsList.push(agent);
    }

    const existing = agentsList.find((a) => a.name === LETTA_AGENT_NAME);

    if (existing) {
      lettaAgentId = existing.id;
      console.log(`[Letta] Connected — found agent "${LETTA_AGENT_NAME}" (${lettaAgentId})`);
    } else {
      const newAgent = await lettaClient.agents.create({
        name: LETTA_AGENT_NAME,
        description: "CEI Autonomous Agent — tracks capability economics patterns, institutional memory, and research decisions across industries.",
        include_base_tools: true,
        model: LETTA_MODEL,
        embedding: LETTA_EMBEDDING,
      });
      lettaAgentId = newAgent.id;
      console.log(`[Letta] Connected — created agent "${LETTA_AGENT_NAME}" (${lettaAgentId})`);
    }

    lettaConnected = true;
    emitAgentEvent({ type: "letta_connected", agentId: lettaAgentId });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[Letta] Not available (${msg}) — running without Letta stateful agent`);
    lettaClient = null;
    lettaAgentId = null;
    lettaConnected = false;
    return false;
  }
}

async function initLettaClient(): Promise<boolean> {
  if (lettaConnected) return true;

  const now = Date.now();
  if (now - lastAttemptAt < RETRY_COOLDOWN_MS) return false;

  if (initPromise) return initPromise;

  lastAttemptAt = now;
  initPromise = doInit().finally(() => { initPromise = null; });
  return initPromise;
}

export async function lettaSendMessage(content: string): Promise<string | null> {
  if (!lettaConnected && !await initLettaClient()) return null;
  if (!lettaClient || !lettaAgentId) return null;

  try {
    const response: LettaResponse = await Promise.race([
      lettaClient.agents.messages.create(lettaAgentId, {
        messages: [{ role: "user", content }],
      }) as Promise<LettaResponse>,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]);

    const text = extractAssistantText(response.messages);

    emitAgentEvent({
      type: "letta_response",
      agentId: lettaAgentId,
      responseLength: text.length,
    });

    return text || null;
  } catch (err) {
    console.error("[Letta] Message failed:", err instanceof Error ? err.message : err);
    lettaConnected = false;
    return null;
  }
}

export async function lettaRecordCycle(summary: string): Promise<void> {
  await lettaSendMessage(
    `[CEI Research Cycle Complete] ${summary}\n\nPlease update your memory blocks with any notable patterns or trends from this cycle.`
  );
}

export function getLettaStatus(): {
  connected: boolean;
  agentId: string | null;
  baseUrl: string;
} {
  return {
    connected: lettaConnected,
    agentId: lettaAgentId,
    baseUrl: LETTA_BASE_URL,
  };
}

initLettaClient().catch(() => {});
