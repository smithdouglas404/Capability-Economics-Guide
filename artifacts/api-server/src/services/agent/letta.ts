import { emitAgentEvent } from "./events";

const LETTA_BASE_URL = process.env.LETTA_BASE_URL || "http://localhost:8283";
const LETTA_API_KEY = process.env.LETTA_API_KEY || undefined;
const LETTA_AGENT_NAME = "cei-autonomous-agent";
const RETRY_COOLDOWN_MS = 60_000;

let lettaClient: any = null;
let lettaAgentId: string | null = null;
let lettaConnected = false;
let lastAttemptAt = 0;
let initPromise: Promise<boolean> | null = null;

async function doInit(): Promise<boolean> {
  try {
    const { default: Letta } = await import("@letta-ai/letta-client");
    lettaClient = new Letta({
      baseURL: LETTA_BASE_URL,
      ...(LETTA_API_KEY ? { apiKey: LETTA_API_KEY } : {}),
    });

    const health = await Promise.race([
      lettaClient.health(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);

    if (!health) throw new Error("Health check failed");

    const agentsPage = await lettaClient.agents.list();
    const agentsList: any[] = [];
    if (agentsPage && typeof agentsPage[Symbol.asyncIterator] === "function") {
      for await (const agent of agentsPage) {
        agentsList.push(agent);
      }
    } else if (Array.isArray(agentsPage)) {
      agentsList.push(...agentsPage);
    } else if (agentsPage?.items) {
      agentsList.push(...agentsPage.items);
    } else if (agentsPage?.data) {
      agentsList.push(...agentsPage.data);
    }

    const existing = agentsList.find((a: any) => a.name === LETTA_AGENT_NAME);

    if (existing) {
      lettaAgentId = existing.id;
      console.log(`[Letta] Connected — found agent "${LETTA_AGENT_NAME}" (${lettaAgentId})`);
    } else {
      const newAgent = await lettaClient.agents.create({
        name: LETTA_AGENT_NAME,
        description: "CEI Autonomous Agent — tracks capability economics patterns, institutional memory, and research decisions across industries.",
        include_base_tools: true,
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
    const response = await Promise.race([
      lettaClient.agents.messages.create(lettaAgentId, {
        messages: [{ role: "user", content }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
    ]) as any;

    const assistantMessages = Array.isArray(response)
      ? response
          .filter((m: any) => m.message_type === "assistant_message" || m.role === "assistant")
          .map((m: any) => m.content || m.message || "")
          .join("\n")
      : "";

    emitAgentEvent({
      type: "letta_response",
      agentId: lettaAgentId,
      responseLength: assistantMessages.length,
    });

    return assistantMessages || null;
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
