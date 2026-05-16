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

  // Per-agent private instructions — the forward-path replacement for
  // Letta core blocks. Optimizer rewrites these weekly per-agent.
  agentPriors:      (agentName: string): string[] => ["agent_priors", agentName],

  // Per-client / per-tenant memory — VCR-style multi-client surfaces.
  clientKnowledge:  (clientId: string): string[] => ["client", clientId],
} as const;
