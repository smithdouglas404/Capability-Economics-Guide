/**
 * Shared agent store — the TypeScript answer to LangMem's BaseStore +
 * AsyncPostgresStore. Backed by the existing DATABASE_URL Postgres so
 * no new service is required.
 *
 * Why this matters: LangMem (the Python library) gives agents a
 * namespaced shared blackboard so a discovery one agent makes can be
 * read by every other agent. We've been doing that ad-hoc by writing
 * into agent_memories and reading it back, but namespaces give a
 * cleaner contract — each agent knows where to look and what to publish.
 *
 * Architecture rule (per CLAUDE.md): NO LangGraph supervisor. Agents
 * coordinate through this store, not through a routing node.
 *
 * Namespace conventions live in the NS object below. Always go through
 * NS.* to construct namespaces — never inline string arrays.
 */
// PostgresStore is exported from the /store subpath, not the package
// root. The root only exports PostgresSaver (for run checkpointing).
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";

let _store: PostgresStore | null = null;
let _setupPromise: Promise<void> | null = null;

/**
 * Lazy singleton — instantiated on first call so the constructor's
 * connection setup doesn't block module load. setup() runs once and
 * is awaited by every getSharedStore() call until it resolves.
 *
 * Constructor takes PostgresStoreConfig.connectionOptions which can be
 * a connection string OR a pg.PoolConfig object — we use the string
 * form since DATABASE_URL is what every other service in this repo
 * uses.
 */
export function getSharedStore(): PostgresStore {
  if (_store) return _store;
  const connString = process.env.DATABASE_URL;
  if (!connString) throw new Error("DATABASE_URL is required for the shared agent store");
  _store = new PostgresStore({ connectionOptions: connString });
  _setupPromise = _store.setup();
  return _store;
}

/**
 * Await this before the first put/get/search call to ensure the
 * underlying tables exist. Idempotent: setup() creates tables only
 * when missing. Subsequent calls reuse the cached promise.
 */
export async function ensureSharedStoreReady(): Promise<void> {
  if (!_store) getSharedStore();
  if (_setupPromise) await _setupPromise;
}

/**
 * Namespace constants — keep all callers using the same shape. Adding a
 * new namespace? Add a helper here and document it in CLAUDE.md.
 */
export const NS = {
  // Shared knowledge: written by one agent, read by all others.
  industryPatterns: (industryName: string): string[] => ["shared", "industry_patterns", industryName],
  macroEvents:      (): string[] => ["shared", "macro_events"],
  disruptionRisks:  (): string[] => ["shared", "disruption_risks"],
  peerBenchmarks:   (): string[] => ["shared", "peer_benchmarks"],
  // Generic shared knowledge namespace — for cross-cutting writes that
  // don't fit a more specific helper above.
  sharedKnowledge:  (topic: string): string[] => ["shared", topic],

  // Per-agent private instructions — the forward-path replacement for
  // Letta core blocks. Optimizer rewrites these weekly per-agent.
  agentPriors:      (agentName: string): string[] => ["agent_priors", agentName],

  // Per-agent run/archive log — replaces lettaArchivalInsert. Each
  // entry gets a generated key (timestamp-based) so writes are
  // additive.
  agentRuns:        (agentName: string): string[] => ["agent_runs", agentName],

  // Per-client / per-tenant memory — VCR-style multi-client surfaces.
  clientKnowledge:  (clientId: string): string[] => ["client", clientId],
} as const;

// ---------------------------------------------------------------------------
// LANGMEM-EQUIVALENT HELPERS — 1:1 mechanical replacements for the most-
// common Letta call sites. Adopt these so consumer files migrate with
// minimal edits and the underlying transport can swap without rewrites.
//
// Per CLAUDE.md "Letta Migration": these are the forward path. Letta's
// own helpers (lettaReadBlock/lettaUpdateBlock/lettaArchivalInsert/
// lettaArchivalSearch) remain available from services/agent/letta.ts
// until Step 6 of the migration (when letta.ts itself is deleted).
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_NAME = "cvi-autonomous-agent";

/**
 * Read a single named block from an agent's priors namespace.
 * Returns null if absent or store unavailable. Mirrors lettaReadBlock.
 */
export async function getAgentPriorBlock(
  label: string,
  agentName: string = DEFAULT_AGENT_NAME,
): Promise<string | null> {
  try {
    await ensureSharedStoreReady();
    const item = await getSharedStore().get(NS.agentPriors(agentName), label);
    if (!item) return null;
    const v = item.value;
    if (typeof v === "string") return v;
    if (v && typeof v === "object" && typeof (v as { value?: unknown }).value === "string") {
      return (v as { value: string }).value;
    }
    return null;
  } catch (err) {
    console.warn(`[store] getAgentPriorBlock(${label}) failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Write a single named block to an agent's priors namespace.
 * Stores `{ value, updatedAt, ...metadata }`. Mirrors lettaUpdateBlock.
 * Returns true on success, false on store failure (non-fatal).
 */
export async function putAgentPriorBlock(
  label: string,
  value: string,
  metadata: Record<string, unknown> = {},
  agentName: string = DEFAULT_AGENT_NAME,
): Promise<boolean> {
  try {
    await ensureSharedStoreReady();
    await getSharedStore().put(NS.agentPriors(agentName), label, {
      value,
      updatedAt: new Date().toISOString(),
      ...metadata,
    });
    return true;
  } catch (err) {
    console.warn(`[store] putAgentPriorBlock(${label}) failed:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Read every block in an agent's priors namespace in one parallel pass.
 * Mirrors lettaReadAllBlocks. `labels` enumerates the labels of interest
 * (we don't list-all because the store may carry additional non-block
 * keys in the same namespace).
 */
export async function getAllAgentPriorBlocks(
  labels: string[],
  agentName: string = DEFAULT_AGENT_NAME,
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const label of labels) out[label] = null;
  try {
    const results = await Promise.all(
      labels.map(label => getAgentPriorBlock(label, agentName)),
    );
    labels.forEach((label, i) => { out[label] = results[i] ?? null; });
  } catch {
    // Already swallowed per-block above; defensive.
  }
  return out;
}

/**
 * Append a free-text record to an agent's archival namespace. Key is
 * monotonic by ISO timestamp + random suffix so concurrent appends
 * don't collide. Mirrors lettaArchivalInsert.
 */
export async function appendAgentArchive(
  text: string,
  metadata: Record<string, unknown> = {},
  agentName: string = DEFAULT_AGENT_NAME,
): Promise<boolean> {
  try {
    await ensureSharedStoreReady();
    const key = `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`;
    await getSharedStore().put(NS.agentRuns(agentName), key, {
      text,
      createdAt: new Date().toISOString(),
      ...metadata,
    });
    return true;
  } catch (err) {
    console.warn("[store] appendAgentArchive failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Search an agent's archival namespace. Mirrors lettaArchivalSearch but
 * the search backend is the PostgresStore's filter+pagination (NOT
 * vector semantic search — the store can do vector search only if
 * embeddings are configured, which we have not done).
 *
 * Behavior: if `query` is provided AND embeddings are configured at the
 * store level, the underlying PostgresStore will do hybrid retrieval.
 * Otherwise it falls back to newest-first listing. Either way returns
 * `{ text, score? }[]`.
 */
export async function searchAgentArchive(
  query: string,
  limit: number = 5,
  agentName: string = DEFAULT_AGENT_NAME,
): Promise<Array<{ text: string; score?: number }>> {
  try {
    await ensureSharedStoreReady();
    const items = await getSharedStore().search(NS.agentRuns(agentName), {
      query: query || undefined,
      limit,
    });
    return items
      .map(item => {
        const v = item.value as { text?: string };
        return { text: v?.text ?? "", score: item.score };
      })
      .filter(p => p.text);
  } catch (err) {
    console.warn("[store] searchAgentArchive failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Cheap connectivity probe — used by health/probes.ts to replace
 * lettaPing. List up to 1 item in the shared root namespace; success
 * means the underlying Postgres is reachable and the store tables
 * exist.
 */
export async function storePing(): Promise<void> {
  await ensureSharedStoreReady();
  await getSharedStore().search(["shared"], { limit: 1 });
}
