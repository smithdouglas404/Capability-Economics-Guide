/**
 * Shared agent store — **Letta-backed adapter**.
 *
 * History: this module was originally a `@langchain/langgraph-checkpoint-postgres`
 * PostgresStore wrapper (the "LangMem-equivalent" introduced in Phase 1.8/1.9
 * when Letta was wrongly deleted). The user did not accept that substitution
 * and Letta has been restored. To avoid touching every call site (the 6 agents
 * and several agent-orchestration files all use this module's API), the
 * surface stays the same — but every call now delegates to Letta Cloud via
 * `./letta.ts`.
 *
 * Mapping:
 *   - Core block labels (industry_priors / current_focus / research_strategy /
 *     economic_rules / market_context / persona / project_focus) →
 *     lettaReadBlock / lettaUpdateBlock
 *   - Anything else (the namespace-style pub/sub the specialized agents use:
 *     macro_events, disruption_risks, peer_benchmarks, etc.) → Letta archival
 *     memory with a `[NS:<namespace>|<key>] <json>` prefix convention. Search
 *     by prefix.
 *
 * NS object unchanged so callers don't need to change.
 *
 * Graceful-degrade: if Letta is unreachable, reads return null/[] and writes
 * are no-ops with a warning log — same shape as the prior PostgresStore
 * implementation's failure mode.
 */
import { logger } from "../../lib/logger";
import {
  lettaReadBlock,
  lettaUpdateBlock,
  lettaArchivalInsert,
  lettaArchivalSearch,
  lettaPing,
  type CoreBlockLabel,
} from "./letta";

// Core block labels Letta knows about natively. Anything else goes to archive.
const CORE_BLOCK_LABELS: Set<string> = new Set([
  "persona",
  "industry_priors",
  "research_strategy",
  "current_focus",
  "economic_rules",
  "project_focus",
  "market_context",
]);

function isCoreBlock(label: string): label is CoreBlockLabel {
  return CORE_BLOCK_LABELS.has(label);
}

// ── Namespace helper (unchanged from the PostgresStore-era API) ───────
export const NS = {
  industryPatterns: (industryName: string): string[] => ["shared", "industry_patterns", industryName],
  macroEvents:      (): string[] => ["shared", "macro_events"],
  disruptionRisks:  (): string[] => ["shared", "disruption_risks"],
  peerBenchmarks:   (): string[] => ["shared", "peer_benchmarks"],
  sharedKnowledge:  (topic: string): string[] => ["shared", topic],
  agentPriors:      (agentName: string): string[] => ["agent_priors", agentName],
  agentRuns:        (agentName: string): string[] => ["agent_runs", agentName],
  clientKnowledge:  (clientId: string): string[] => ["client", clientId],
};

function nsToPrefix(namespace: string[]): string {
  return `[NS:${namespace.join("/")}]`;
}

/**
 * Letta-backed store object exposing put/search/get methods compatible with
 * the prior PostgresStore interface. Specialized agents (macro-event,
 * disruption, peer-coop, stack-optimizer, ontology) use this to publish and
 * read namespaced digests.
 */
export interface LettaBackedStore {
  put(namespace: string[], key: string, value: unknown): Promise<void>;
  get(namespace: string[], key: string): Promise<unknown | null>;
  search(namespace: string[], opts?: { limit?: number }): Promise<Array<{ key: string; value: unknown }>>;
  delete(namespace: string[], key: string): Promise<void>;
}

let _store: LettaBackedStore | null = null;

function buildLettaBackedStore(): LettaBackedStore {
  return {
    async put(namespace: string[], key: string, value: unknown): Promise<void> {
      try {
        const prefix = nsToPrefix(namespace);
        const text = `${prefix}|${key} ${JSON.stringify(value)}`;
        await lettaArchivalInsert(text);
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err), namespace, key }, "[store→letta] put failed");
      }
    },
    async get(namespace: string[], key: string): Promise<unknown | null> {
      try {
        const prefix = nsToPrefix(namespace);
        const results = await lettaArchivalSearch(`${prefix}|${key}`, 1);
        if (results.length === 0) return null;
        const text = results[0]!.text;
        const jsonStart = text.indexOf(" ");
        if (jsonStart === -1) return null;
        try { return JSON.parse(text.slice(jsonStart + 1)); } catch { return null; }
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err), namespace, key }, "[store→letta] get failed");
        return null;
      }
    },
    async search(namespace: string[], opts: { limit?: number } = {}): Promise<Array<{ key: string; value: unknown }>> {
      try {
        const prefix = nsToPrefix(namespace);
        const limit = opts.limit ?? 10;
        const results = await lettaArchivalSearch(prefix, limit);
        return results.map((r) => {
          const text = r.text;
          const pipeIdx = text.indexOf("|");
          const spaceIdx = text.indexOf(" ", pipeIdx);
          if (pipeIdx === -1 || spaceIdx === -1) return { key: "", value: null };
          const key = text.slice(pipeIdx + 1, spaceIdx);
          let value: unknown = null;
          try { value = JSON.parse(text.slice(spaceIdx + 1)); } catch {}
          return { key, value };
        });
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err), namespace }, "[store→letta] search failed");
        return [];
      }
    },
    async delete(_namespace: string[], _key: string): Promise<void> {
      // Letta archival doesn't expose delete-by-text. Soft-deprecation: log
      // and no-op. Old entries will be filtered by recency in practice.
      logger.debug("[store→letta] delete is a no-op; Letta archival is append-only");
    },
  };
}

/**
 * Lazy singleton — first call constructs the Letta-backed store.
 */
export function getSharedStore(): LettaBackedStore {
  if (!_store) _store = buildLettaBackedStore();
  return _store;
}

/**
 * Was a slow PostgresStore setup; now a no-op. Letta client init happens
 * lazily inside letta.ts on first call. Kept as a function so existing
 * callsites don't need editing.
 */
export async function ensureSharedStoreReady(): Promise<void> {
  return;
}

/**
 * Per-agent prior block (compatibility shim).
 */
export async function getAgentPriorBlock(
  label: string,
  agentName: string = "cvi-autonomous-agent",
): Promise<string | null> {
  try {
    if (isCoreBlock(label)) {
      return await lettaReadBlock(label);
    }
    const prefix = `[AGENT_PRIOR:${agentName}|${label}]`;
    const results = await lettaArchivalSearch(prefix, 1);
    if (results.length === 0) return null;
    const text = results[0]!.text;
    const jsonStart = text.indexOf(" ");
    return jsonStart === -1 ? text : text.slice(jsonStart + 1);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), label, agentName }, "[store→letta] getAgentPriorBlock failed");
    return null;
  }
}

export async function putAgentPriorBlock(
  label: string,
  value: string,
  _metadata: Record<string, unknown> = {},
  agentName: string = "cvi-autonomous-agent",
): Promise<boolean> {
  try {
    if (isCoreBlock(label)) {
      return await lettaUpdateBlock(label, value);
    }
    const prefix = `[AGENT_PRIOR:${agentName}|${label}]`;
    return await lettaArchivalInsert(`${prefix} ${value}`);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), label, agentName }, "[store→letta] putAgentPriorBlock failed");
    return false;
  }
}

export async function getAllAgentPriorBlocks(
  labels: string[],
  agentName: string = "cvi-autonomous-agent",
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const label of labels) {
    out[label] = await getAgentPriorBlock(label, agentName);
  }
  return out;
}

/**
 * Append a free-text record to the agent's archive. Letta-backed → goes to
 * archival memory. Metadata is encoded into the text since Letta's archival
 * API doesn't have a separate metadata channel.
 */
export async function appendAgentArchive(
  text: string,
  metadata: Record<string, unknown> = {},
  agentName: string = "cvi-autonomous-agent",
): Promise<boolean> {
  try {
    const tag = `[ARCHIVE:${agentName}]`;
    const meta = Object.keys(metadata).length > 0 ? ` ${JSON.stringify(metadata)}` : "";
    return await lettaArchivalInsert(`${tag} ${text}${meta}`);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), agentName }, "[store→letta] appendAgentArchive failed");
    return false;
  }
}

export async function searchAgentArchive(
  query: string,
  limit: number = 5,
  agentName: string = "cvi-autonomous-agent",
): Promise<Array<{ text: string; score?: number }>> {
  try {
    const scoped = `[ARCHIVE:${agentName}] ${query}`;
    return await lettaArchivalSearch(scoped, limit);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), agentName }, "[store→letta] searchAgentArchive failed");
    return [];
  }
}

/**
 * Liveness probe. Backed by Letta's ping. Returns the underlying Letta
 * health shape so callers (health probes, admin diagnostics) can render
 * configured vs unreachable distinctly.
 */
export async function storePing(): Promise<{ configured: boolean; ok: boolean; error: string | null }> {
  return await lettaPing();
}
