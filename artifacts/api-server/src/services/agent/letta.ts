import type { Letta as LettaClient } from "@letta-ai/letta-client";
import type { AgentState } from "@letta-ai/letta-client/resources/agents/agents";
import type { LettaResponse, AssistantMessage, Message } from "@letta-ai/letta-client/resources/agents/messages";
import { emitAgentEvent } from "./events";

const LETTA_API_KEY = process.env.LETTA_API_KEY || undefined;
const LETTA_BASE_URL = process.env.LETTA_BASE_URL || (LETTA_API_KEY ? "https://api.letta.ai" : "http://localhost:8283");
const LETTA_ENABLED = Boolean(LETTA_API_KEY || process.env.LETTA_BASE_URL);
const LETTA_AGENT_NAME = "cei-autonomous-agent";
const LETTA_MODEL = process.env.LETTA_MODEL || "openrouter/anthropic/claude-3.7-sonnet";
const LETTA_EMBEDDING = process.env.LETTA_EMBEDDING || "letta/letta-free";
const RETRY_COOLDOWN_MS = 60_000;

export type CoreBlockLabel = "persona" | "industry_priors" | "research_strategy" | "current_focus";

const CORE_BLOCKS: Array<{ label: CoreBlockLabel; value: string; description: string; limit: number }> = [
  {
    label: "persona",
    value:
      "I am the CEI Autonomous Agent — a senior capability economics analyst. I track how industry capabilities evolve over time, " +
      "identify durable moats, flag fragile ones, and surface cross-industry analogies. I prefer evidence over speculation, " +
      "I update my beliefs when contradicted, and I reason about second-order effects on enterprise value.",
    description: "Identity and reasoning style for the agent.",
    limit: 4000,
  },
  {
    label: "industry_priors",
    value: "(empty — populated by the reflect node when high-confidence patterns are detected)",
    description: "Stable, validated beliefs about each industry's capability dynamics. Updated on contradiction or refinement.",
    limit: 8000,
  },
  {
    label: "research_strategy",
    value:
      "Routine cycles: prioritize stale (>7d) capabilities, low-confidence (<0.5), and high-velocity (|v|>0.1) signals. " +
      "Always recall before deciding. Reflect: contradiction → flag; refinement → update; novel → add. " +
      "Sleeptime consolidator runs daily to promote repeat patterns into validated_pattern category.",
    description: "How the agent decides what to research, what to recall, and what to consolidate.",
    limit: 4000,
  },
  {
    label: "current_focus",
    value: "(initialized — updated each cycle with the targeted industries and the reasoning trigger)",
    description: "What the agent is currently working on this cycle.",
    limit: 2000,
  },
];

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

async function ensureCoreBlocks(): Promise<void> {
  if (!lettaClient || !lettaAgentId) return;
  try {
    const existing = lettaClient.agents.blocks.list(lettaAgentId);
    const existingLabels = new Set<string>();
    for await (const blk of existing) {
      const label = (blk as unknown as { label?: string }).label;
      if (label) existingLabels.add(label);
    }
    for (const block of CORE_BLOCKS) {
      if (existingLabels.has(block.label)) continue;
      try {
        const created = await (lettaClient.blocks as unknown as {
          create: (body: { label: string; value: string; description?: string; limit?: number }) => Promise<{ id: string }>;
        }).create({
          label: block.label,
          value: block.value,
          description: block.description,
          limit: block.limit,
        });
        await (lettaClient.agents.blocks as unknown as {
          attach: (blockID: string, params: { agent_id: string }) => Promise<unknown>;
        }).attach(created.id, { agent_id: lettaAgentId });
        console.log(`[Letta] Created + attached core block "${block.label}" (${created.id})`);
      } catch (err) {
        console.log(`[Letta] Could not create block ${block.label}: ${err instanceof Error ? err.message : err}`);
      }
    }
  } catch (err) {
    console.log(`[Letta] Block enumeration failed: ${err instanceof Error ? err.message : err}`);
  }
}

async function doInit(): Promise<boolean> {
  try {
    const { default: Letta } = await import("@letta-ai/letta-client");
    lettaClient = new Letta({
      baseURL: LETTA_BASE_URL,
      ...(LETTA_API_KEY ? { apiKey: LETTA_API_KEY } : {}),
    });

    try {
      await Promise.race([
        lettaClient.health(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
      ]);
    } catch { /* fall through */ }

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
      const newAgent = await (lettaClient.agents as unknown as {
        create: (body: Record<string, unknown>) => Promise<{ id: string }>;
      }).create({
        name: LETTA_AGENT_NAME,
        description: "CEI Autonomous Agent — tracks capability economics patterns, institutional memory, and research decisions.",
        include_base_tools: true,
        model: LETTA_MODEL,
        embedding: LETTA_EMBEDDING,
        memory_blocks: CORE_BLOCKS.map((b) => ({
          label: b.label,
          value: b.value,
          description: b.description,
          limit: b.limit,
        })),
      });
      lettaAgentId = newAgent.id;
      console.log(`[Letta] Connected — created agent "${LETTA_AGENT_NAME}" (${lettaAgentId}) with ${CORE_BLOCKS.length} blocks`);
    }

    await ensureCoreBlocks();

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
  if (!LETTA_ENABLED) return false;
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
    emitAgentEvent({ type: "letta_response", agentId: lettaAgentId, responseLength: text.length });
    return text || null;
  } catch (err) {
    if (LETTA_ENABLED) console.error("[Letta] Message failed:", err instanceof Error ? err.message : err);
    lettaConnected = false;
    return null;
  }
}

export async function lettaUpdateBlock(label: CoreBlockLabel, value: string): Promise<boolean> {
  if (!lettaConnected && !await initLettaClient()) return false;
  if (!lettaClient || !lettaAgentId) return false;
  try {
    await Promise.race([
      (lettaClient.agents.blocks as unknown as {
        update: (label: string, params: { agent_id: string; value: string }) => Promise<unknown>;
      }).update(label, { agent_id: lettaAgentId, value }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    emitAgentEvent({ type: "letta_block_updated", block: label, length: value.length });
    return true;
  } catch (err) {
    if (LETTA_ENABLED) console.error(`[Letta] block update ${label} failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}

export async function lettaReadBlock(label: CoreBlockLabel): Promise<string | null> {
  if (!lettaConnected && !await initLettaClient()) return null;
  if (!lettaClient || !lettaAgentId) return null;
  try {
    const block = await Promise.race([
      (lettaClient.agents.blocks as unknown as {
        retrieve: (label: string, params: { agent_id: string }) => Promise<{ value?: string }>;
      }).retrieve(label, { agent_id: lettaAgentId }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
    ]);
    return block.value ?? null;
  } catch (err) {
    if (LETTA_ENABLED) console.error(`[Letta] block read ${label} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function lettaArchivalInsert(text: string): Promise<boolean> {
  if (!lettaConnected && !await initLettaClient()) return false;
  if (!lettaClient || !lettaAgentId) return false;
  try {
    await Promise.race([
      lettaClient.agents.passages.create(lettaAgentId, { text }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
    ]);
    emitAgentEvent({ type: "letta_archival_insert", chars: text.length });
    return true;
  } catch (err) {
    if (LETTA_ENABLED) console.error("[Letta] archival insert failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function lettaArchivalSearch(query: string, limit: number = 5): Promise<Array<{ text: string; score?: number }>> {
  if (!lettaConnected && !await initLettaClient()) return [];
  if (!lettaClient || !lettaAgentId) return [];
  try {
    const result = await Promise.race([
      (lettaClient.agents.passages as unknown as {
        search: (agentID: string, params: { query?: string; search?: string; limit?: number; top_k?: number }) => Promise<unknown>;
      }).search(lettaAgentId, { query, search: query, limit, top_k: limit }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
    ]);
    const items = Array.isArray(result) ? result : ((result as { results?: unknown[] })?.results ?? []);
    return (items as Array<{ text?: string; content?: string; score?: number }>)
      .map((p) => ({ text: p.text || p.content || "", score: p.score }))
      .filter((p) => p.text);
  } catch (err) {
    if (LETTA_ENABLED) console.error("[Letta] archival search failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function lettaRecordCycle(summary: string): Promise<void> {
  await lettaUpdateBlock("current_focus", summary);
  await lettaArchivalInsert(`[cycle] ${summary}`);
}

export function getLettaStatus(): {
  connected: boolean;
  agentId: string | null;
  baseUrl: string;
  blocks: string[];
} {
  return {
    connected: lettaConnected,
    agentId: lettaAgentId,
    baseUrl: LETTA_BASE_URL,
    blocks: CORE_BLOCKS.map(b => b.label),
  };
}

initLettaClient().catch(() => {});
