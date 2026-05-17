import type { Letta as LettaClient } from "@letta-ai/letta-client";
import type { AgentState } from "@letta-ai/letta-client/resources/agents/agents";
import type { LettaResponse, AssistantMessage, Message } from "@letta-ai/letta-client/resources/agents/messages";
import { emitAgentEvent } from "./events";
import { LETTA_CUSTOM_TOOLS } from "./letta-tools";
import { AGENT_REGISTRY, type AgentRegistryEntry, lettaAgentNameFor } from "./agent-registry";

const LETTA_API_KEY = process.env.LETTA_API_KEY || undefined;
const LETTA_BASE_URL = process.env.LETTA_BASE_URL || (LETTA_API_KEY ? "https://api.letta.ai" : "http://localhost:8283");
const LETTA_ENABLED = Boolean(LETTA_API_KEY || process.env.LETTA_BASE_URL);
// Renamed during the Inflexcvi cutover. If an agent already exists under the
// old "cei-autonomous-agent" name on the Letta service, it stays alive but
// orphaned — findOrCreate matches by name, so the old one is ignored and a
// fresh "cvi-autonomous-agent" gets seeded with core blocks. Rename it in
// the Letta admin UI if you want to preserve its accumulated memory.
const LETTA_AGENT_NAME = "cvi-autonomous-agent";
// Letta model handle format: "<provider>/<openrouter-model-id>".
// We default to Sonnet 4.6 via OpenRouter (matches the rest of the platform
// after the Phase 0 cutover); operator can override via LETTA_MODEL env.
// IMPORTANT: this handle won't exist in Letta's registry until the Letta
// service has OPENROUTER_API_KEY set in its Railway env — Letta only
// catalogs handles for providers whose keys are configured. Without that,
// agent runs fail with "Handle ... not found, must be one of []".
const LETTA_MODEL = process.env.LETTA_MODEL || "openrouter/anthropic/claude-sonnet-4.6";
const LETTA_EMBEDDING = process.env.LETTA_EMBEDDING || "letta/letta-free";
const RETRY_COOLDOWN_MS = 60_000;

export type CoreBlockLabel =
  | "persona"
  | "industry_priors"
  | "research_strategy"
  | "current_focus"
  | "economic_rules"
  | "project_focus"
  | "market_context";

/**
 * read_only blocks are operator-defined policy: the Letta agent can
 * see them but its core_memory_replace tool cannot rewrite them. Keeps
 * a noisy synthesis pass from corrupting the agent's persona or its
 * research strategy.
 *
 * economic_rules is read_only from the AGENT's perspective — it can
 * read the thresholds but must propose changes via the write-tool
 * queue (services/agent/letta-tools.ts). The api-server still writes
 * to it directly via syncEconomicRulesToLetta when an admin edits the
 * underlying economic_rules table.
 */
const CORE_BLOCKS: Array<{ label: CoreBlockLabel; value: string; description: string; limit: number; readOnly?: boolean }> = [
  {
    label: "persona",
    value:
      "I am the CVI Autonomous Agent — a senior capability economics analyst. I track how industry capabilities evolve over time, " +
      "identify durable moats, flag fragile ones, and surface cross-industry analogies. I prefer evidence over speculation, " +
      "I update my beliefs when contradicted, and I reason about second-order effects on enterprise value.",
    description: "Identity and reasoning style for the agent.",
    limit: 4000,
    readOnly: true,
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
    readOnly: true,
  },
  {
    label: "current_focus",
    value: "(initialized — updated each cycle with the targeted industries and the reasoning trigger)",
    description: "What the agent is currently working on this cycle.",
    limit: 2000,
  },
  {
    label: "economic_rules",
    value: "(empty — synced from the economic_rules Postgres table by services/agent/economic-rules-sync.ts on boot and on admin edits)",
    description: "Admin-tunable strategic thresholds the agent reasons against (CVI floor, DVX ceiling, posterior variance limit, DVX factor weights, EVaR alarm levels). When a live data point crosses one of these, the agent should file a write proposal rather than silently note it.",
    limit: 4000,
    readOnly: true,
  },
  {
    label: "project_focus",
    value: "(no project pinned — operating in routine cycle mode across all industries)",
    description: "The user's currently pinned project / use case (e.g. 'M&A diligence on payments-fintech consolidation'). When non-empty, the agent biases priority toward capabilities in the pinned scope.",
    limit: 2000,
  },
  {
    label: "market_context",
    value: "(empty — populated by scheduler when macro events are detected via EDGAR + CVI-signal polling)",
    description: "Current macro-economic and regulatory context biasing this cycle. Rolling 5 most-recent macro events. Examples: Fed rate decision, major regulatory ruling, sector-wide earnings surprise.",
    limit: 3000,
  },
];

let lettaClient: LettaClient | null = null;
let lettaAgentId: string | null = null;
// Cached archive id for archival memory operations. Letta Cloud requires an
// attached archive before passages.create / passages.search will succeed —
// the agent-level endpoints return 404 / 400 ("No conversation history found")
// without one. Set by ensureAttachedArchive() during doInit().
let lettaArchiveId: string | null = null;
let lettaConnected = false;
let lastAttemptAt = 0;
let initPromise: Promise<boolean> | null = null;

/**
 * Per-agent Letta state — one entry per AGENT_REGISTRY row. Populated by
 * registerAllAgents() during doInit() after the primary cvi-autonomous-agent
 * is up. Each entry holds the agent's id + its attached archive id so the
 * per-agent variants of lettaArchivalInsert / lettaReadBlock / etc. can
 * target the right Letta agent.
 *
 * The existing single-agent `lettaAgentId` / `lettaArchiveId` globals are
 * preserved for backward compatibility — they continue to point at the
 * cvi-autonomous-agent (also present in this map under "cvi-autonomous-agent").
 */
type AgentLettaState = { agentId: string; archiveId: string | null };
const lettaAgentMap = new Map<string, AgentLettaState>();

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
          create: (body: { label: string; value: string; description?: string; limit?: number; read_only?: boolean }) => Promise<{ id: string }>;
        }).create({
          label: block.label,
          value: block.value,
          description: block.description,
          limit: block.limit,
          ...(block.readOnly ? { read_only: true } : {}),
        });
        await (lettaClient.agents.blocks as unknown as {
          attach: (blockID: string, params: { agent_id: string }) => Promise<unknown>;
        }).attach(created.id, { agent_id: lettaAgentId });
        console.log(`[Letta] Created + attached core block "${block.label}"${block.readOnly ? " (read-only)" : ""} (${created.id})`);
      } catch (err) {
        console.log(`[Letta] Could not create block ${block.label}: ${err instanceof Error ? err.message : err}`);
      }
    }
  } catch (err) {
    console.log(`[Letta] Block enumeration failed: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Idempotently upsert each tool in LETTA_CUSTOM_TOOLS and attach it to
 * the agent. Letta auto-generates the JSON schema from the Python source's
 * signature + docstring, so we only ship source + name + description.
 *
 * Without these tools, the Letta agent can only reply to messages — it
 * has no autonomous read access to live CVI state, recent reflections,
 * or Mem0. Registering them turns it into a real agent that can call
 * back into the api-server between user messages.
 */
async function ensureCustomTools(): Promise<void> {
  if (!lettaClient || !lettaAgentId) return;
  for (const tool of LETTA_CUSTOM_TOOLS) {
    try {
      const upserted = await (lettaClient.tools as unknown as {
        upsert: (body: { source_code: string; description?: string }) => Promise<{ id: string; name?: string }>;
      }).upsert({
        source_code: tool.sourceCode,
        description: tool.description,
      });
      await (lettaClient.agents.tools as unknown as {
        attach: (toolID: string, params: { agent_id: string }) => Promise<unknown>;
      }).attach(upserted.id, { agent_id: lettaAgentId });
      console.log(`[Letta] Upserted + attached tool "${tool.name}" (${upserted.id})`);
    } catch (err) {
      console.log(`[Letta] Tool ${tool.name} registration failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * Letta Cloud requires the agent to have at least one attached archive before
 * `agents.passages.create` / `agents.passages.search` will succeed. Without an
 * archive these endpoints return 404 ("Not Found" from the internal vector
 * store) and 400 ("No conversation history found. Please send a message first
 * to enable search.") respectively.
 *
 * On boot: list the agent's archives, take the first one if any exist, else
 * create + attach a fresh "cvi-default-archive" and cache its id at module
 * scope. lettaArchivalInsert / lettaArchivalSearch use this archive directly
 * via the top-level archives.passages / passages.search endpoints (which work
 * regardless of agent chat history).
 *
 * Non-fatal on failure: archival just stays disabled, core memory blocks
 * (lettaReadBlock / lettaUpdateBlock) continue to work.
 */
async function ensureAttachedArchive(): Promise<void> {
  if (!lettaClient || !lettaAgentId) return;
  try {
    // Letta SDK shape (v1.11.x): list method lives at the TOP-LEVEL
    // archives resource (filtered by agent_id), not under agents.archives.
    // The latter only exposes attach/detach. Filtering at top-level is the
    // documented way per the SDK type `ArchiveListParams.agentId`.
    const lc = lettaClient as unknown as {
      archives: {
        list: (query: { agentId: string }) => AsyncIterable<{ id: string; name?: string }> | Promise<AsyncIterable<{ id: string; name?: string }>>;
        create: (body: { name: string }) => Promise<{ id: string }>;
      };
      agents: {
        archives: { attach: (archiveId: string, params: { agent_id: string }) => Promise<unknown> };
      };
    };
    const page = await lc.archives.list({ agentId: lettaAgentId });
    const attached: Array<{ id: string; name?: string }> = [];
    for await (const a of page as AsyncIterable<{ id: string; name?: string }>) {
      attached.push(a);
    }
    if (attached.length > 0) {
      lettaArchiveId = attached[0]!.id;
      console.log(`[Letta] Archive reused — id=${lettaArchiveId} name=${attached[0]!.name ?? "(unnamed)"}`);
      return;
    }
    // Create + attach a fresh archive for this agent.
    const created = await lc.archives.create({ name: `${LETTA_AGENT_NAME}-archive` });
    await lc.agents.archives.attach(created.id, { agent_id: lettaAgentId });
    lettaArchiveId = created.id;
    console.log(`[Letta] Archive created + attached — id=${lettaArchiveId} name=${LETTA_AGENT_NAME}-archive`);
  } catch (err) {
    console.log(`[Letta] Archive setup failed (non-fatal, archival memory disabled): ${err instanceof Error ? err.message : err}`);
    lettaArchiveId = null;
  }
}

/**
 * Find-or-create a Letta agent for a single registry entry. Idempotent:
 * if an agent with the registry's `lettaAgentName` already exists in the
 * org, reuse it; otherwise create with the entry's persona + initial focus
 * memory blocks + sleeptime configured. Also ensures the agent has an
 * attached archive so passages.create / passages.search will work.
 *
 * Returns the agent state record (agentId + archiveId) or null on failure.
 * Failure is non-fatal — the agent just won't be available in the per-agent
 * map; the platform continues running on the shared cvi-autonomous-agent.
 */
async function registerLettaAgent(entry: AgentRegistryEntry, existingAgents: AgentState[]): Promise<AgentLettaState | null> {
  if (!lettaClient) return null;
  try {
    const existing = existingAgents.find((a) => a.name === entry.lettaAgentName);
    let agentId: string;
    if (existing) {
      agentId = existing.id;
      console.log(`[Letta] Reused agent "${entry.lettaAgentName}" (${agentId})`);
    } else {
      // Per-agent memory blocks: persona (read-only identity) + current_focus
      // (mutable working memory) + industry_priors (accumulated beliefs).
      const newAgent = await (lettaClient.agents as unknown as {
        create: (body: Record<string, unknown>) => Promise<{ id: string; managed_group?: { id: string } }>;
      }).create({
        name: entry.lettaAgentName,
        description: `${entry.persona.slice(0, 200)}…`,
        include_base_tools: true,
        model: entry.lettaModel,
        embedding: LETTA_EMBEDDING,
        enable_sleeptime: entry.enableSleeptime,
        memory_blocks: [
          { label: "persona", value: entry.persona, description: "Identity and reasoning style for this agent.", limit: 4000, read_only: true },
          { label: "current_focus", value: entry.initialFocus, description: "What this agent is currently working on this cycle.", limit: 2000 },
          { label: "industry_priors", value: "(empty — populated as the agent observes patterns)", description: "Stable validated beliefs accumulated by this specific agent.", limit: 8000 },
        ],
      });
      agentId = newAgent.id;
      console.log(`[Letta] Created agent "${entry.lettaAgentName}" (${agentId}) with sleeptime=${entry.enableSleeptime}`);
    }

    // Attach an archive to this agent so archival memory ops work.
    let archiveId: string | null = null;
    try {
      const lc = lettaClient as unknown as {
        archives: {
          list: (query: { agentId: string }) => AsyncIterable<{ id: string; name?: string }> | Promise<AsyncIterable<{ id: string; name?: string }>>;
          create: (body: { name: string }) => Promise<{ id: string }>;
        };
        agents: { archives: { attach: (archiveId: string, params: { agent_id: string }) => Promise<unknown> } };
      };
      const page = await lc.archives.list({ agentId });
      const attached: Array<{ id: string }> = [];
      for await (const a of page as AsyncIterable<{ id: string }>) attached.push(a);
      if (attached.length > 0) {
        archiveId = attached[0]!.id;
      } else {
        const created = await lc.archives.create({ name: `${entry.lettaAgentName}-archive` });
        await lc.agents.archives.attach(created.id, { agent_id: agentId });
        archiveId = created.id;
        console.log(`[Letta] Created + attached archive for "${entry.lettaAgentName}" (archive=${archiveId})`);
      }
    } catch (err) {
      console.log(`[Letta] Archive setup for "${entry.lettaAgentName}" failed (non-fatal): ${err instanceof Error ? err.message : err}`);
    }

    return { agentId, archiveId };
  } catch (err) {
    console.log(`[Letta] registerLettaAgent("${entry.lettaAgentName}") failed (non-fatal): ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Register every agent in AGENT_REGISTRY. Called from doInit() after the
 * primary cvi-autonomous-agent setup so the agentsList is already paid for.
 * Populates lettaAgentMap. Idempotent — safe to call on every boot.
 */
async function registerAllAgents(existingAgents: AgentState[]): Promise<void> {
  if (!lettaClient) return;
  let successes = 0;
  for (const entry of AGENT_REGISTRY) {
    const state = await registerLettaAgent(entry, existingAgents);
    if (state) {
      lettaAgentMap.set(entry.shortName, state);
      successes++;
    }
  }
  console.log(`[Letta] Registered ${successes}/${AGENT_REGISTRY.length} agents from AGENT_REGISTRY`);
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
      // enable_sleeptime: true tells Letta to spin up a background
      // "sleep-time agent" that shares this primary agent's memory blocks
      // and runs every N steps to synthesize history into core memory.
      // Native Letta version of what our custom consolidator.ts has been
      // doing manually. Both can coexist — Letta handles the Letta-block
      // half, our consolidator keeps the Mem0-side dedup half — until
      // we verify sleep-time output quality matches.
      const newAgent = await (lettaClient.agents as unknown as {
        create: (body: Record<string, unknown>) => Promise<{ id: string; managed_group?: { id: string } }>;
      }).create({
        name: LETTA_AGENT_NAME,
        description: "CVI Autonomous Agent — tracks capability economics patterns, institutional memory, and research decisions.",
        include_base_tools: true,
        model: LETTA_MODEL,
        embedding: LETTA_EMBEDDING,
        enable_sleeptime: true,
        memory_blocks: CORE_BLOCKS.map((b) => ({
          label: b.label,
          value: b.value,
          description: b.description,
          limit: b.limit,
          ...(b.readOnly ? { read_only: true } : {}),
        })),
      });
      lettaAgentId = newAgent.id;
      console.log(`[Letta] Connected — created agent "${LETTA_AGENT_NAME}" (${lettaAgentId}) with ${CORE_BLOCKS.length} blocks + sleep-time enabled`);

      // Configure sleep-time cadence. Frequency 1 = run after every
      // primary step; our primary agent only "steps" once per 30-min
      // cycle so this maps to ~daily sleep-time runs. Non-fatal on
      // failure: agent works without the freq tweak, just at the
      // default 5-step cadence.
      if (newAgent.managed_group?.id) {
        try {
          // The `groups` resource isn't typed on this SDK version yet —
          // cast through unknown to invoke. If the runtime lacks it
          // (older Letta server), the call throws and we log + continue
          // with default sleep-time cadence (5 steps).
          await ((lettaClient as unknown as {
            groups?: { update: (groupId: string, config: Record<string, unknown>) => Promise<unknown> };
          }).groups?.update(newAgent.managed_group.id, {
            manager_config: { sleeptime_agent_frequency: 1 },
          }) ?? Promise.reject(new Error("Letta SDK lacks groups resource — using default cadence")));
          console.log(`[Letta] Sleep-time frequency configured on group ${newAgent.managed_group.id}`);
        } catch (err) {
          console.log(`[Letta] Sleep-time frequency config failed (non-fatal): ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    await ensureCoreBlocks();
    await ensureCustomTools();
    await ensureAttachedArchive();

    // Register all 7 AGENT_REGISTRY agents in Letta. Idempotent — reuses by
    // name on subsequent boots. The cvi-autonomous-agent we just set up above
    // is also in the registry, so registerAllAgents will reuse its agentId
    // and also seed its archive id into lettaAgentMap.
    await registerAllAgents(agentsList);
    // If the primary agent setup didn't get an archive (legacy path), backfill
    // it from the registry map so single-agent callers can still use archival.
    if (!lettaArchiveId) {
      const primary = lettaAgentMap.get("cvi-autonomous-agent");
      if (primary?.archiveId) {
        lettaArchiveId = primary.archiveId;
      }
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
  if (!lettaClient || !lettaArchiveId) return false;
  try {
    // Write directly to the attached archive (not the agent-mediated endpoint
    // — that one 404s on Letta Cloud when the agent's vector index hasn't been
    // bootstrapped yet, which happens for every fresh agent).
    await Promise.race([
      (lettaClient as unknown as {
        archives: { passages: { create: (archiveId: string, body: { text: string }) => Promise<unknown> } };
      }).archives.passages.create(lettaArchiveId, { text }),
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
  if (!lettaClient || !lettaArchiveId) return [];
  try {
    // Search via the top-level passages endpoint scoped to our archive_id.
    // The agent-mediated endpoint 400s on Letta Cloud with "No conversation
    // history found. Please send a message first to enable search." because
    // Cloud's agent-search path requires a prior chat message — ours doesn't
    // have one. The archive-scoped path works regardless.
    const result = await Promise.race([
      (lettaClient as unknown as {
        passages: { search: (body: { archive_id: string; query: string; limit?: number }) => Promise<unknown> };
      }).passages.search({ archive_id: lettaArchiveId, query, limit }),
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

/**
 * Live liveness check used by `/api/health/services`. Hits the Letta server's
 * health endpoint with a short timeout. Distinguishes "not configured" (no
 * env vars), "down" (configured but unreachable / 5xx / auth failed), and
 * "ok" — and updates the cached `lettaConnected` flag as a side effect so
 * subsequent agent ops have an accurate view.
 */
export async function lettaPing(): Promise<{
  configured: boolean;
  ok: boolean;
  error: string | null;
}> {
  if (!LETTA_ENABLED) return { configured: false, ok: false, error: null };
  try {
    if (!lettaClient) {
      const { default: Letta } = await import("@letta-ai/letta-client");
      lettaClient = new Letta({
        baseURL: LETTA_BASE_URL,
        ...(LETTA_API_KEY ? { apiKey: LETTA_API_KEY } : {}),
      });
    }
    await Promise.race([
      lettaClient.health(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Letta /health timed out")), 12000)),
    ]);
    lettaConnected = true;
    return { configured: true, ok: true, error: null };
  } catch (err) {
    lettaConnected = false;
    return { configured: true, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Read every core block in a single parallel pass — used by the admin
 * memory-stats endpoint so operators can inspect the agent's entire
 * working memory state in one round-trip instead of N sequential calls.
 *
 * Returns null for any block that fails to read (Letta down, block not
 * yet created, timeout). Never throws.
 *
 * Per plan Phase 1.6.5.
 */
export async function lettaReadAllBlocks(): Promise<Record<CoreBlockLabel, string | null>> {
  const init: Record<CoreBlockLabel, string | null> = {
    persona: null,
    industry_priors: null,
    research_strategy: null,
    current_focus: null,
    economic_rules: null,
    project_focus: null,
    market_context: null,
  };
  if (!lettaConnected && !await initLettaClient()) return init;
  const labels = CORE_BLOCKS.map((b) => b.label);
  const results = await Promise.all(labels.map((label) => lettaReadBlock(label)));
  for (let i = 0; i < labels.length; i++) {
    init[labels[i]!] = results[i] ?? null;
  }
  return init;
}

// ─── Per-agent accessors ──────────────────────────────────────────────────────
// Public API surface for the 6 specialized agents (macro-event, disruption,
// peer-coop, stack-optimizer, ontology, synthesis) and the primary cvi
// agent. All look up the agent's id via lettaAgentMap; fall back to the
// primary cvi-autonomous-agent if the registry entry is unknown — preserves
// backward compat for any callers passing legacy / unknown names.

/**
 * Return the Letta agent_id for a given AGENT_REGISTRY short name, or null
 * if the agent isn't registered (e.g. during the brief startup window before
 * registerAllAgents() completes, or if Letta is offline).
 */
export function getLettaAgentId(shortName: string): string | null {
  // Try direct match first
  const direct = lettaAgentMap.get(shortName);
  if (direct) return direct.agentId;
  // Try via registry's name-resolution
  const resolved = lettaAgentNameFor(shortName);
  const fallback = lettaAgentMap.get(resolved);
  if (fallback) return fallback.agentId;
  // Last resort: the primary agent (preserves backward compat)
  return lettaAgentId;
}

/**
 * Return the Letta archive_id for a given AGENT_REGISTRY short name, or null
 * if the agent has no attached archive yet.
 */
export function getLettaArchiveId(shortName: string): string | null {
  const direct = lettaAgentMap.get(shortName);
  if (direct?.archiveId) return direct.archiveId;
  const resolved = lettaAgentNameFor(shortName);
  const fallback = lettaAgentMap.get(resolved);
  if (fallback?.archiveId) return fallback.archiveId;
  return lettaArchiveId; // fallback to primary
}

/**
 * Per-agent archival insert. Writes a passage to the named agent's archive.
 * Falls back to the primary cvi-autonomous-agent if shortName is unknown.
 */
export async function lettaArchivalInsertFor(shortName: string, text: string): Promise<boolean> {
  if (!lettaConnected && !await initLettaClient()) return false;
  const archiveId = getLettaArchiveId(shortName);
  if (!lettaClient || !archiveId) return false;
  try {
    await Promise.race([
      (lettaClient as unknown as {
        archives: { passages: { create: (archiveId: string, body: { text: string }) => Promise<unknown> } };
      }).archives.passages.create(archiveId, { text }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
    ]);
    emitAgentEvent({ type: "letta_archival_insert", chars: text.length });
    return true;
  } catch (err) {
    if (LETTA_ENABLED) console.error(`[Letta] archival insert (${shortName}) failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Per-agent archival search. Queries the named agent's archive only.
 */
export async function lettaArchivalSearchFor(shortName: string, query: string, limit: number = 5): Promise<Array<{ text: string; score?: number }>> {
  if (!lettaConnected && !await initLettaClient()) return [];
  const archiveId = getLettaArchiveId(shortName);
  if (!lettaClient || !archiveId) return [];
  try {
    const result = await Promise.race([
      (lettaClient as unknown as {
        passages: { search: (body: { archive_id: string; query: string; limit?: number }) => Promise<unknown> };
      }).passages.search({ archive_id: archiveId, query, limit }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
    ]);
    const items = Array.isArray(result) ? result : ((result as { results?: unknown[] })?.results ?? []);
    return (items as Array<{ text?: string; content?: string; score?: number }>)
      .map((p) => ({ text: p.text || p.content || "", score: p.score }))
      .filter((p) => p.text);
  } catch (err) {
    if (LETTA_ENABLED) console.error(`[Letta] archival search (${shortName}) failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Per-agent core-block read. Each registered agent has its own persona,
 * current_focus, and industry_priors blocks; this reads them by agent name.
 */
export async function lettaReadBlockFor(shortName: string, label: string): Promise<string | null> {
  if (!lettaConnected && !await initLettaClient()) return null;
  const agentId = getLettaAgentId(shortName);
  if (!lettaClient || !agentId) return null;
  try {
    const block = await (lettaClient.agents.blocks as unknown as {
      retrieve: (label: string, params: { agent_id: string }) => Promise<{ value?: string }>;
    }).retrieve(label, { agent_id: agentId });
    return block?.value ?? null;
  } catch (err) {
    if (LETTA_ENABLED) console.error(`[Letta] block read (${shortName}/${label}) failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Per-agent core-block write.
 */
export async function lettaUpdateBlockFor(shortName: string, label: string, value: string): Promise<boolean> {
  if (!lettaConnected && !await initLettaClient()) return false;
  const agentId = getLettaAgentId(shortName);
  if (!lettaClient || !agentId) return false;
  try {
    await (lettaClient.agents.blocks as unknown as {
      update: (label: string, params: { agent_id: string; value: string }) => Promise<unknown>;
    }).update(label, { agent_id: agentId, value });
    return true;
  } catch (err) {
    if (LETTA_ENABLED) console.error(`[Letta] block update (${shortName}/${label}) failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Diagnostic: returns the agent_id / archive_id map for every registered
 * agent. Used by /api/health/services to surface registration state.
 */
export function getRegisteredAgents(): Array<{ shortName: string; agentId: string; archiveId: string | null }> {
  return Array.from(lettaAgentMap.entries()).map(([shortName, state]) => ({
    shortName,
    agentId: state.agentId,
    archiveId: state.archiveId,
  }));
}

initLettaClient().catch(() => {});
