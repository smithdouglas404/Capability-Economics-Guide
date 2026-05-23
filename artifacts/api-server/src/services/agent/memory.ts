import { db } from "@workspace/db";
import { agentMemoriesTable } from "@workspace/db";
import { desc, sql, and, eq } from "drizzle-orm";
import { mem0AgentIdFor, buildIdentityTags } from "./agent-registry";
import { MemoryClient, type Memory as Mem0Memory } from "mem0ai";

// Cutover note: was "cei-autonomous-agent" before the Inflexcvi rebrand.
// Memories created under the old ID stay readable via mem0 search regardless
// of agent_id (mem0 filters but doesn't gatekeep historical content), so no
// data is lost — they just stop appearing in the default agent-scoped list.
//
// Now resolves per-call via mem0AgentIdFor() when an `agentName` is passed in
// options/options. Defaults to the shared "cvi-autonomous-agent" pool to
// preserve backward compat for the many call sites that don't yet pass an
// agentName (the constant below is the fallback default).
const MEM0_AGENT_ID = "cvi-autonomous-agent";

export type MemoryType = "pattern" | "observation" | "insight" | "decision_context";
export type MemoryCategory =
  | "capability_signal"
  | "industry_trend"
  | "contradiction"
  | "validated_pattern"
  | "decision"
  | "observation"
  | "pattern"
  | "agent_run_summary"
  | "recommendation_outcome"
  | "temporal_shift"
  | "synthesis";

export interface AgentMemory {
  id: string | number;
  memoryType: string;
  category?: string | null;
  runScope?: string | null;
  agentRunId?: number | null;
  content: string;
  metadata: Record<string, unknown>;
  relevanceScore: number;
  accessCount: number;
  createdAt: Date;
  source: "mem0" | "local";
  mem0Id?: string | null;
  mem0Status?: string | null;
}

export interface StoreOptions {
  category?: MemoryCategory;
  runId?: number | null;
  ttlDays?: number;
  context?: string;
  /**
   * Per-agent Mem0 namespace. When set, this memory is filed under the named
   * agent's mem0 agent_id (resolved via AGENT_REGISTRY) instead of the shared
   * cvi-autonomous-agent pool. Lets each specialized agent (macro-event,
   * disruption, peer-coop, stack-optimizer, ontology, synthesis) recall only
   * its own observations.
   */
  agentName?: string;
}

// ---------------------------------------------------------------------------
// Mem0 REST client — supports BOTH the self-hosted server AND Mem0 Cloud.
// Mode is auto-detected from MEM0_BASE_URL hostname:
//   - api.mem0.ai (or any *.mem0.ai host) → cloud platform
//     Auth header: Authorization: Token <m0-...>
//   - Anything else (Railway internal hostname, localhost, etc.)
//     → self-hosted v2.x server. Auth header: X-API-Key: <ADMIN_API_KEY>
// One env-var flip in Railway switches modes — no code redeploy.
// ---------------------------------------------------------------------------

interface Mem0Config {
  baseUrl: string;
  apiKey: string;
  /** true when talking to api.mem0.ai (cloud); false for self-hosted. */
  isCloud: boolean;
}

function getMem0Config(): Mem0Config | null {
  const rawBaseUrl = process.env.MEM0_BASE_URL;
  const apiKey = process.env.MEM0_API_KEY;
  if (!rawBaseUrl || !apiKey) {
    if (!rawBaseUrl && !apiKey) {
      console.warn("[Mem0] MEM0_BASE_URL and MEM0_API_KEY not set — using local DB only");
    } else {
      console.warn("[Mem0] Both MEM0_BASE_URL and MEM0_API_KEY must be set — using local DB only");
    }
    return null;
  }
  const baseUrl = rawBaseUrl.replace(/\/$/, "");
  // Cloud detection: hostname contains "mem0.ai" (api.mem0.ai or future
  // regional variants). Defensive — handle bare hostname, full URL, etc.
  const isCloud = /(^|\/\/|\.)mem0\.ai(\/|$|:)/i.test(baseUrl);
  return { baseUrl, apiKey, isCloud };
}

/**
 * Lazy singleton MemoryClient from the official `mem0ai` npm SDK.
 *
 * Replaced the hand-rolled `mem0Fetch` + `mapPath` + `buildAuthHeaders` stack
 * in the SDK-migration commit. The SDK handles:
 *   - Cloud (`api.mem0.ai`) vs self-hosted host detection
 *   - `Authorization: Token` (cloud) vs `Authorization: <api_key>` (self-hosted)
 *     under the hood — we just pass apiKey + host
 *   - Trailing-slash + /v1/ prefix path quirks
 *   - Typed error classes (AuthenticationError, RateLimitError, NetworkError,
 *     MemoryNotFoundError, MemoryQuotaExceededError, etc.) — see error
 *     translation in describeMem0Error() below.
 *   - `org_id` + `project_id` auto-population via .ping() so updateProject and
 *     project-scoped reads work without manual env-var threading.
 */
let mem0ClientSingleton: MemoryClient | null = null;
function getMem0Client(): MemoryClient | null {
  if (mem0ClientSingleton) return mem0ClientSingleton;
  const cfg = getMem0Config();
  if (!cfg) return null;
  // Self-hosted OSS has its own REST surface — see mem0SelfHostedRequest.
  // We deliberately do NOT construct the cloud SDK for self-hosted because
  // the SDK auto-pings via _initializeClient on first method access, which
  // 404s against the OSS server (no /v1/ping endpoint) and spams the log.
  if (!cfg.isCloud) return null;
  mem0ClientSingleton = new MemoryClient({ apiKey: cfg.apiKey, host: cfg.baseUrl });
  return mem0ClientSingleton;
}

/**
 * Self-hosted Mem0 OSS REST helper.
 *
 * The npm `mem0ai` SDK's methods (add, getAll, search, update, delete,
 * history) hit cloud-only paths (e.g. /v1/orgs/.../memories) that 404 on
 * self-hosted OSS. The OSS server exposes the simpler /memories surface
 * documented at GET https://<host>/openapi.json — paths without /v1/ prefix.
 *
 * Auth: X-API-Key with a server-issued API key (created via /api-keys
 * after /auth/register). NOT the cloud "Token m0-…" scheme.
 *
 * Used only when cfg.isCloud === false. Each wrapper below routes to
 * either the SDK (cloud) or this helper (self-hosted). The SDK path is
 * unchanged so the Mem0 Cloud configuration keeps working.
 */
async function mem0SelfHostedRequest<T>(
  cfg: Mem0Config,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: {
      "X-API-Key": cfg.apiKey,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mem0 self-hosted ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * Translate the SDK's typed error classes into operator-friendly messages
 * with concrete remediation. The SDK throws AuthenticationError, NetworkError,
 * RateLimitError, MemoryNotFoundError, MemoryQuotaExceededError — we surface
 * these with the same hints the old mem0Fetch wrapper used to emit.
 */
function describeMem0Error(op: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.constructor.name : "Error";
  const cfg = getMem0Config();
  if (name === "AuthenticationError" || /401|unauthor/i.test(msg)) {
    if (cfg?.isCloud) {
      return `Mem0 ${op} → 401: Mem0 Cloud rejected the API key. Verify MEM0_API_KEY starts with "m0-" and is valid at app.mem0.ai. Raw: ${msg.slice(0, 200)}`;
    }
    return `Mem0 ${op} → 401: api-server's MEM0_API_KEY does not match the self-hosted Mem0 ADMIN_API_KEY. Verify both env vars match in Railway. Raw: ${msg.slice(0, 200)}`;
  }
  if (/provider_auth_failed/i.test(msg)) {
    return `Mem0 ${op} → upstream LLM auth failed (self-hosted only). Fix on the Mem0 service: set OPENAI_API_KEY to a valid OpenRouter key and OPENAI_BASE_URL=https://openrouter.ai/api/v1. Raw: ${msg.slice(0, 200)}`;
  }
  return `Mem0 ${op} (${name}): ${msg.slice(0, 240)}`;
}

export function isMem0Available(): boolean {
  return !!(process.env.MEM0_BASE_URL && process.env.MEM0_API_KEY);
}

/**
 * One-time config of Mem0 Cloud project settings using the OFFICIAL
 * `mem0ai` npm SDK's `updateProject` method.
 *
 * The SDK handles:
 *   - The actual REST endpoint: `PATCH ${host}/api/v1/orgs/organizations/${orgId}/projects/${projectId}/`
 *     (which is undocumented in https://docs.mem0.ai/api-reference and was not
 *     guessable from the public docs)
 *   - The required `ping()` precursor that populates orgId + projectId from
 *     the server response
 *   - camelCase → snake_case conversion of the prompts body
 *
 * Custom categories teach Mem0's server-side fact-extraction prompt about
 * our 11-string MemoryCategory union so extracted memories get tagged with
 * canonical names rather than Mem0's generic defaults.
 *
 * Cloud-only. Non-fatal on failure; memories continue to flow with Mem0's
 * default categorization.
 */
export async function configureMem0CustomCategories(): Promise<void> {
  const cfg = getMem0Config();
  if (!cfg || !cfg.isCloud) return;

  const customCategories = [
    { capability_signal:      "Observed change in a capability's economics, maturity, or competitive position." },
    { industry_trend:         "A pattern across multiple capabilities in one industry — supply, demand, or regulation." },
    { validated_pattern:      "A prior recommendation or hypothesis that was confirmed by subsequent CVI movement." },
    { contradiction:          "A prior recommendation or hypothesis that was contradicted by subsequent outcomes." },
    { decision:               "A choice the agent made (research vs skip, store vs discard) and the rationale." },
    { observation:            "A raw factual observation from research, not yet promoted to a pattern." },
    { pattern:                "A repeating regularity observed across multiple research cycles." },
    { agent_run_summary:      "Post-cycle summary of what an agent did this run, written by its own pipeline." },
    { recommendation_outcome: "The 60-day CVI delta following a build/buy/outsource recommendation." },
    { temporal_shift:         "A capability-pair relationship weight changing materially over 30 days." },
    { synthesis:              "Cross-agent insight produced by the Synthesis Agent from multiple inputs." },
  ];

  const client = getMem0Client();
  if (!client) return;
  try {
    // ping() populates organizationId + projectId on the client; updateProject
    // requires both. The SDK throws a clear error if ping fails or if the
    // account isn't on an org/project plan tier.
    await client.ping();
    await client.updateProject({ customCategories });
    console.log(`[Mem0] custom_categories configured via SDK updateProject (${customCategories.length} categories)`);
  } catch (err) {
    console.log(`[Mem0] ${describeMem0Error("updateProject", err)} (non-fatal — Mem0 keeps default categorization)`);
  }
}

/**
 * Lightweight liveness probe — used by `/api/health/services`. Issues the
 * cheapest authenticated read available (list 1 memory) and throws on any
 * non-2xx so callers can classify the failure.
 */
export async function mem0Ping(): Promise<void> {
  if (!isMem0Available()) throw new Error("Mem0 not configured");
  const cfg = getMem0Config();
  if (!cfg) throw new Error("Mem0 config missing");

  if (cfg.isCloud) {
    // Cloud: SDK .ping() populates orgId + projectId for subsequent
    // project-scoped reads. Required path on Mem0 Cloud.
    const client = getMem0Client();
    if (!client) throw new Error("Mem0 client init failed");
    try { await client.ping(); }
    catch (err) { throw new Error(describeMem0Error("ping", err)); }
    return;
  }

  // Self-hosted OSS doesn't expose the cloud /ping endpoint and doesn't have
  // the org/project plumbing, so use the cheapest authenticated read instead.
  const res = await fetch(`${cfg.baseUrl}/memories?limit=1`, {
    headers: { "X-API-Key": cfg.apiKey },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Mem0 ping (self-hosted) → ${res.status}: ${body.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Conversational message builder (same logic as before)
// ---------------------------------------------------------------------------

function buildConversationalMessages(
  type: MemoryType,
  category: MemoryCategory | undefined,
  content: string,
  context: string | undefined,
  metadata: Record<string, unknown>,
): Array<{ role: "user" | "assistant"; content: string }> {
  const userPrompt = context
    ? context
    : `Logging a ${type}${category ? ` (${category})` : ""} from the latest CVI research cycle. Capture the durable facts so future cycles can recall and reason over them.`;

  const metaSummary = Object.entries(metadata)
    .filter(([k]) => !["mem0Id", "source", "category"].includes(k))
    .slice(0, 6)
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80)}`)
    .join("; ");

  const assistantBody = metaSummary
    ? `${content}\n\nKey signals: ${metaSummary}.`
    : content;

  return [
    { role: "user", content: userPrompt },
    { role: "assistant", content: assistantBody },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function storeMemory(
  type: MemoryType,
  content: string,
  metadata: Record<string, unknown> = {},
  options: StoreOptions = {},
): Promise<AgentMemory> {
  const { category, runId, ttlDays = 90, context, agentName } = options;
  const expiresAt = new Date(Date.now() + ttlDays * 86400000);
  // Resolve the Mem0 agent_id for this store. Falls back to the shared pool
  // if no agentName is provided (preserves backward compat).
  const resolvedAgentId = agentName ? mem0AgentIdFor(agentName) : MEM0_AGENT_ID;

  let mem0Id: string | null = null;
  let mem0EventId: string | null = null;
  let mem0Status: string | null = null;

  const cfg = getMem0Config();
  if (cfg) {
    try {
      const messages = buildConversationalMessages(type, category, content, context, metadata);
      // enable_graph: true is the SDK's documented per-request flag for
      // graph-store storage on Mem0 Cloud. Account/plan tier must support
      // graph mode — if not, the server silently degrades to vector-only.
      // (Self-hosted OSS doesn't have graph mode and the flag is ignored
      // there; we leave it out of the self-hosted body for cleanliness.)
      // tags: application-layer identity metadata that travels WITH each
      // memory — replaces server-side identity tracking (deprecated by Letta
      // upstream) and works with Mem0 Cloud's metadata.tags filter.
      const tags = buildIdentityTags(agentName);
      const baseMetadata = {
        ...metadata,
        memoryType: type,
        category: category ?? type,
        runId: runId ?? null,
        ttlDays,
        tags,
        // Stamp the ISO expiry so mem0Prune can filter on metadata.expiresAt
        // server-side. Without this, ttlDays is opaque to Mem0 and pgvector
        // grows unbounded.
        expiresAt: expiresAt.toISOString(),
      };
      let result: Mem0Memory[] | undefined;
      if (cfg.isCloud) {
        const client = getMem0Client();
        if (!client) throw new Error("Mem0 SDK client unavailable for cloud mode");
        result = await client.add(messages, {
          agent_id: resolvedAgentId,
          ...(runId !== null && runId !== undefined ? { run_id: `cycle-${runId}` } : {}),
          enable_graph: true,
          metadata: baseMetadata,
        });
      } else {
        // Self-hosted OSS: POST /memories returns { results: Memory[] } where
        // each item may have { id, memory, event, event_id, ... }. Empty
        // `results` is normal when no facts could be extracted (e.g., a
        // single-token user message); we surface that as a null id.
        const resp = await mem0SelfHostedRequest<{ results?: Mem0Memory[] }>(
          cfg,
          "POST",
          "/memories",
          {
            messages,
            agent_id: resolvedAgentId,
            ...(runId !== null && runId !== undefined ? { run_id: `cycle-${runId}` } : {}),
            metadata: baseMetadata,
          },
        );
        result = resp.results ?? [];
      }

      const first = result?.[0];
      mem0Id = first?.id ?? null;
      mem0EventId = (first as Mem0Memory & { event_id?: string })?.event_id ?? null;
      mem0Status = typeof first?.event === "string" ? first.event : null;
      console.log(`[Mem0] stored ${type}/${category ?? "uncategorized"} id=${mem0Id?.slice(0, 8) ?? "n/a"}`);
    } catch (err) {
      console.error("[Mem0]", describeMem0Error("store", err));
    }
  }

  const [row] = await db.insert(agentMemoriesTable).values({
    memoryType: type,
    category: category ?? null,
    runScope: runId !== null && runId !== undefined ? `cycle-${runId}` : null,
    agentRunId: runId ?? null,
    content,
    metadata: { ...metadata, source: isMem0Available() ? "mem0" : "local" },
    mem0Id,
    mem0EventId,
    mem0Status,
    relevanceScore: 1.0,
    expiresAt,
  }).returning();

  // Fire-and-forget entity extraction so the custom graph layer
  // (memory_entities / memory_relations) gains coverage on every
  // store call, not just the reflect.ts path. Previously only
  // reflect-node memories registered entities, leaving observations
  // from tools.ts and consolidator.ts invisible to graph traversal.
  // Dynamic import avoids the circular memory ↔ graphMemory cycle.
  void (async () => {
    try {
      const { extractEntitiesFromText, upsertEntity } = await import("./graphMemory");
      const entities = await extractEntitiesFromText(content);
      for (const e of entities) {
        await upsertEntity(e, { lastStoreCategory: category ?? type, lastRunId: runId ?? null });
      }
    } catch (err) {
      // Non-fatal: graph enrichment is supplementary to vector recall.
      console.debug("[storeMemory] entity extraction failed:", err instanceof Error ? err.message : err);
    }
  })();

  return {
    id: mem0Id || row.id,
    memoryType: type,
    category: category ?? null,
    runScope: row.runScope,
    agentRunId: runId ?? null,
    content,
    metadata: { ...metadata, mem0Id },
    relevanceScore: 1.0,
    accessCount: 0,
    createdAt: row.createdAt,
    source: isMem0Available() ? "mem0" : "local",
    mem0Id,
    mem0Status,
  };
}

export async function updateMemory(memoryId: string, newContent: string): Promise<boolean> {
  const cfg = getMem0Config();
  if (!cfg) return false;
  try {
    if (cfg.isCloud) {
      const client = getMem0Client();
      if (!client) return false;
      // SDK's update() takes { text, metadata?, timestamp? }. The cloud
      // path uses /v1/memories/{id}; SDK handles routing.
      await client.update(memoryId, { text: newContent });
    } else {
      // Self-hosted OSS: PUT /memories/{id} with { text } body.
      await mem0SelfHostedRequest<unknown>(cfg, "PUT", `/memories/${memoryId}`, { text: newContent });
    }
    await db.update(agentMemoriesTable)
      .set({ content: newContent })
      .where(eq(agentMemoriesTable.mem0Id, memoryId));
    console.log(`[Mem0] updated ${memoryId.slice(0, 8)}`);
    return true;
  } catch (err) {
    console.error("[Mem0]", describeMem0Error("update", err));
    return false;
  }
}

export async function deleteMemory(memoryId: string): Promise<boolean> {
  const cfg = getMem0Config();
  if (!cfg) return false;
  try {
    if (cfg.isCloud) {
      const client = getMem0Client();
      if (!client) return false;
      await client.delete(memoryId);
    } else {
      await mem0SelfHostedRequest<unknown>(cfg, "DELETE", `/memories/${memoryId}`);
    }
    await db.delete(agentMemoriesTable).where(eq(agentMemoriesTable.mem0Id, memoryId));
    console.log(`[Mem0] deleted ${memoryId.slice(0, 8)}`);
    return true;
  } catch (err) {
    console.error("[Mem0]", describeMem0Error("delete", err));
    return false;
  }
}

export async function getMemoryHistory(memoryId: string): Promise<unknown[]> {
  const cfg = getMem0Config();
  if (!cfg) return [];
  try {
    if (cfg.isCloud) {
      const client = getMem0Client();
      if (!client) return [];
      const result = await client.history(memoryId);
      return Array.isArray(result) ? result : [];
    }
    // Self-hosted OSS: GET /memories/{id}/history returns an array.
    const result = await mem0SelfHostedRequest<unknown>(cfg, "GET", `/memories/${memoryId}/history`);
    return Array.isArray(result) ? result : [];
  } catch (err) {
    console.error("[Mem0]", describeMem0Error("history", err));
    return [];
  }
}

export async function recallMemories(
  query: string,
  type?: MemoryType,
  limit: number = 10,
  options: {
    runId?: number;
    category?: MemoryCategory;
    minConfidence?: number;
    createdAfter?: Date;
    topic?: string;
    /**
     * Per-agent Mem0 namespace. When set, recall is scoped to the named
     * agent's mem0 agent_id (resolved via AGENT_REGISTRY) instead of the
     * shared cvi-autonomous-agent pool.
     */
    agentName?: string;
    /**
     * Mem0 Cloud `criteria` parameter — biases retrieval ranking by recency,
     * relevance, or completeness. Cloud-only; ignored on self-hosted.
     */
    criteria?: "recency" | "relevance" | "completeness";
  } = {},
): Promise<AgentMemory[]> {
  const results: AgentMemory[] = [];
  // Resolve the Mem0 agent_id for this recall. Falls back to the shared pool.
  const resolvedAgentId = options.agentName ? mem0AgentIdFor(options.agentName) : MEM0_AGENT_ID;

  const cfg = getMem0Config();
  if (cfg) {
    try {
      // SDK's search() takes a flat options object — agent_id at top level,
      // metadata as a flat dict, enable_graph for graph-mode recall. On
      // self-hosted OSS we POST /search with the same shape minus the
      // cloud-only enable_graph flag.
      const meta: Record<string, unknown> = {};
      if (type) meta.memoryType = type;
      if (options.category) meta.category = options.category;
      if (options.topic) meta.topic = options.topic;
      const searchOpts: Record<string, unknown> = {
        agent_id: resolvedAgentId,
        limit,
        threshold: 0.35,
      };
      if (cfg.isCloud) searchOpts.enable_graph = true;
      if (options.runId) searchOpts.run_id = `cycle-${options.runId}`;
      if (Object.keys(meta).length > 0) searchOpts.metadata = meta;
      if (options.criteria) searchOpts.criteria = options.criteria;
      if (options.createdAfter) searchOpts.start_date = options.createdAfter.toISOString();

      let found: Mem0Memory[];
      if (cfg.isCloud) {
        const client = getMem0Client();
        if (!client) throw new Error("Mem0 SDK client unavailable for cloud mode");
        found = await client.search(query, searchOpts);
      } else {
        const resp = await mem0SelfHostedRequest<Mem0Memory[] | { results?: Mem0Memory[] }>(
          cfg,
          "POST",
          "/search",
          { query, ...searchOpts },
        );
        found = Array.isArray(resp) ? resp : resp.results ?? [];
      }

      for (const m of found) {
        const mMeta = (m.metadata && typeof m.metadata === "object" ? m.metadata : {}) as Record<string, unknown>;
        const memType = (mMeta.memoryType as string) || type || "observation";
        const memCat = mMeta.category as string | undefined;
        // Server-side filtering is best-effort; defensively re-check.
        if (type && memType !== type) continue;
        if (options.category && memCat !== options.category) continue;
        results.push({
          id: m.id || `mem0-${Date.now()}`,
          memoryType: memType,
          category: memCat ?? null,
          runScope: (mMeta.runId as string) || null,
          content: m.memory || "",
          metadata: mMeta,
          relevanceScore: typeof m.score === "number" ? m.score : 0,
          accessCount: 0,
          createdAt: m.created_at ? new Date(m.created_at) : new Date(),
          source: "mem0",
          mem0Id: m.id ?? null,
        });
      }
      console.log(`[Mem0] recalled ${results.length} for "${query.slice(0, 50)}"`);
      if (results.length >= limit) return results.slice(0, limit);
    } catch (err) {
      console.error("[Mem0] search failed, falling back to local DB:", describeMem0Error("search", err));
    }
  }

  // Local DB fallback
  const now = new Date();
  const conditions = [
    sql`(${agentMemoriesTable.expiresAt} IS NULL OR ${agentMemoriesTable.expiresAt} > ${now})`,
  ];
  if (type) conditions.push(sql`${agentMemoriesTable.memoryType} = ${type}`);
  if (options.category) conditions.push(sql`${agentMemoriesTable.category} = ${options.category}`);

  const localMemories = await db
    .select()
    .from(agentMemoriesTable)
    .where(and(...conditions))
    .orderBy(desc(agentMemoriesTable.createdAt))
    .limit(200);

  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const scored = localMemories.map(m => {
    const text = (m.content + " " + JSON.stringify(m.metadata || {})).toLowerCase();
    let matchScore = 0;
    for (const kw of keywords) if (text.includes(kw)) matchScore += 1;
    const keywordRel = keywords.length > 0 ? matchScore / keywords.length : 0;
    const ageDays = (now.getTime() - m.createdAt.getTime()) / 86400000;
    const recency = Math.exp(-ageDays / 30);
    const score = keywordRel * 0.6 + recency * 0.3 + (m.relevanceScore ?? 1.0) * 0.1;
    return { memory: m, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const localResults = scored.slice(0, limit - results.length).map(r => ({
    id: r.memory.id,
    memoryType: r.memory.memoryType,
    category: r.memory.category,
    runScope: r.memory.runScope,
    agentRunId: r.memory.agentRunId,
    content: r.memory.content,
    metadata: (r.memory.metadata as Record<string, unknown>) || {},
    relevanceScore: r.score,
    accessCount: r.memory.accessCount,
    createdAt: r.memory.createdAt,
    source: "local" as const,
    mem0Id: r.memory.mem0Id,
    mem0Status: r.memory.mem0Status,
  }));

  return [...results, ...localResults].slice(0, limit);
}

export async function recallMemoriesBatch(type: MemoryType, limit: number = 100): Promise<AgentMemory[]> {
  const results: AgentMemory[] = [];

  const cfg = getMem0Config();
  if (cfg) {
    try {
      let found: Mem0Memory[] | { results?: Mem0Memory[] };
      if (cfg.isCloud) {
        const client = getMem0Client();
        if (!client) throw new Error("Mem0 SDK client unavailable for cloud mode");
        found = await client.getAll({ agent_id: MEM0_AGENT_ID, page_size: limit });
      } else {
        // Self-hosted OSS: GET /memories?agent_id=…&page_size=… returns
        // { results: Memory[] } directly.
        found = await mem0SelfHostedRequest<{ results?: Mem0Memory[] }>(
          cfg,
          "GET",
          `/memories?agent_id=${encodeURIComponent(MEM0_AGENT_ID)}&page_size=${limit}`,
        );
      }
      const list = Array.isArray(found) ? found : (found as { results?: Mem0Memory[] }).results ?? [];
      for (const m of list) {
        const meta = (m.metadata && typeof m.metadata === "object" ? m.metadata : {}) as Record<string, unknown>;
        const memType = (meta.memoryType as string) || "observation";
        if (memType !== type) continue;
        results.push({
          id: m.id || `mem0-${Date.now()}`,
          memoryType: memType,
          category: (meta.category as string) ?? null,
          runScope: (meta.runId as string) ?? null,
          content: m.memory || "",
          metadata: meta,
          relevanceScore: 0.8,
          accessCount: 0,
          createdAt: m.created_at ? new Date(m.created_at) : new Date(),
          source: "mem0",
          mem0Id: m.id ?? null,
        });
      }
      console.log(`[Mem0] batch recalled ${results.length} ${type} memories`);
      if (results.length >= limit) return results;
    } catch (err) {
      console.error("[Mem0]", describeMem0Error("getAll", err));
    }
  }

  const now = new Date();
  const localMemories = await db
    .select()
    .from(agentMemoriesTable)
    .where(and(
      sql`${agentMemoriesTable.memoryType} = ${type}`,
      sql`(${agentMemoriesTable.expiresAt} IS NULL OR ${agentMemoriesTable.expiresAt} > ${now})`,
    ))
    .orderBy(desc(agentMemoriesTable.createdAt))
    .limit(limit);

  for (const m of localMemories) {
    const isMem0Synced = m.mem0Id && results.some(r => r.mem0Id === m.mem0Id);
    if (!isMem0Synced) {
      results.push({
        id: m.id,
        memoryType: m.memoryType,
        category: m.category,
        runScope: m.runScope,
        agentRunId: m.agentRunId,
        content: m.content,
        metadata: (m.metadata as Record<string, unknown>) || {},
        relevanceScore: m.relevanceScore ?? 1.0,
        accessCount: m.accessCount,
        createdAt: m.createdAt,
        source: "local",
        mem0Id: m.mem0Id,
        mem0Status: m.mem0Status,
      });
    }
  }
  return results.slice(0, limit);
}

export function filterMemoriesForTarget(
  batch: AgentMemory[],
  industryName: string,
  capabilityName: string,
  limit: number = 3,
): AgentMemory[] {
  const keywords = `${industryName} ${capabilityName}`.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const now = Date.now();
  const scored = batch.map(m => {
    const text = (m.content + " " + JSON.stringify(m.metadata)).toLowerCase();
    let matchScore = 0;
    for (const kw of keywords) if (text.includes(kw)) matchScore += 1;
    const keywordRel = keywords.length > 0 ? matchScore / keywords.length : 0;
    const ageDays = (now - m.createdAt.getTime()) / 86400000;
    const recency = Math.exp(-ageDays / 30);
    return { memory: m, score: keywordRel * 0.7 + recency * 0.3 };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => ({ ...s.memory, relevanceScore: s.score }));
}

export async function getAllMemories(limit: number = 100): Promise<AgentMemory[]> {
  const results: AgentMemory[] = [];

  const clientAll = getMem0Client();
  if (clientAll) {
    try {
      const found = await clientAll.getAll({ agent_id: MEM0_AGENT_ID, page_size: limit });
      const list = Array.isArray(found) ? found : (found as { results?: Mem0Memory[] }).results ?? [];
      for (const m of list) {
        const meta = (m.metadata && typeof m.metadata === "object" ? m.metadata : {}) as Record<string, unknown>;
        results.push({
          id: m.id || `mem0-${Date.now()}`,
          memoryType: (meta.memoryType as string) || "observation",
          category: (meta.category as string) ?? null,
          runScope: (meta.runId as string) ?? null,
          content: m.memory || "",
          metadata: meta,
          relevanceScore: 1.0,
          accessCount: 0,
          createdAt: m.created_at ? new Date(m.created_at) : new Date(),
          source: "mem0",
          mem0Id: m.id ?? null,
        });
      }
    } catch (err) {
      console.error("[Mem0]", describeMem0Error("getAll", err));
    }
  }

  const localMemories = await db.select().from(agentMemoriesTable).orderBy(desc(agentMemoriesTable.createdAt)).limit(limit);
  for (const m of localMemories) {
    const isMem0Synced = m.mem0Id && results.some(r => r.mem0Id === m.mem0Id);
    if (!isMem0Synced) {
      results.push({
        id: m.id,
        memoryType: m.memoryType,
        category: m.category,
        runScope: m.runScope,
        agentRunId: m.agentRunId,
        content: m.content,
        metadata: (m.metadata as Record<string, unknown>) || {},
        relevanceScore: m.relevanceScore ?? 1.0,
        accessCount: m.accessCount,
        createdAt: m.createdAt,
        source: "local",
        mem0Id: m.mem0Id,
        mem0Status: m.mem0Status,
      });
    }
  }
  return results.slice(0, limit);
}

export async function getMemoryStats(): Promise<{
  totalMemories: number;
  byType: Record<string, number>;
  byCategory: Record<string, number>;
  byRunScope: Record<string, number>;
  pendingMem0Writes: number;
  avgRelevance: number;
  mem0Connected: boolean;
}> {
  let mem0Count = 0;
  const clientStats = getMem0Client();
  if (clientStats) {
    try {
      const found = await clientStats.getAll({ agent_id: MEM0_AGENT_ID, page_size: 200 });
      const list = Array.isArray(found) ? found : (found as { results?: Mem0Memory[] }).results ?? [];
      mem0Count = list.length;
    } catch { /* ignore */ }
  }

  const all = await db.select().from(agentMemoriesTable);
  const byType: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const byRunScope: Record<string, number> = {};
  let totalRelevance = 0;
  let localOnly = 0;
  let pending = 0;

  for (const m of all) {
    byType[m.memoryType] = (byType[m.memoryType] || 0) + 1;
    if (m.category) byCategory[m.category] = (byCategory[m.category] || 0) + 1;
    if (m.runScope) byRunScope[m.runScope] = (byRunScope[m.runScope] || 0) + 1;
    if (m.mem0Status === "PENDING") pending++;
    totalRelevance += m.relevanceScore ?? 1.0;
    if (!m.mem0Id) localOnly++;
  }

  return {
    totalMemories: mem0Count + localOnly,
    byType,
    byCategory,
    byRunScope,
    pendingMem0Writes: pending,
    avgRelevance: all.length > 0 ? totalRelevance / all.length : 0,
    mem0Connected: isMem0Available(),
  };
}

/**
 * Delete every Mem0 memory whose metadata.expiresAt is in the past.
 *
 * Mem0 itself never honors TTLs — the value lives only in metadata.
 * Without this sweep, pgvector accumulates stale observations from
 * old cycles that still surface in semantic search and bias the
 * agent's decisions toward outdated facts. Designed to be called
 * from a daily cron (services/agent/scheduler.ts).
 *
 * Returns the count of memories deleted. Non-fatal on individual
 * deletion failures — logs and continues.
 *
 * Per plan Phase 1.6.5.
 */
export async function mem0Prune(opts: { batchLimit?: number; dryRun?: boolean } = {}): Promise<{ scanned: number; deleted: number; failed: number; dryRun: boolean }> {
  if (!isMem0Available()) return { scanned: 0, deleted: 0, failed: 0, dryRun: !!opts.dryRun };
  const batchLimit = opts.batchLimit ?? 100;
  const nowIso = new Date().toISOString();
  let scanned = 0;
  let deleted = 0;
  let failed = 0;
  const clientPrune = getMem0Client();
  if (!clientPrune) return { scanned: 0, deleted: 0, failed: 0, dryRun: !!opts.dryRun };
  try {
    // Wildcard search via the SDK — pass a single space so older servers that
    // require a non-empty query still match against the metadata filter.
    const candidates = await clientPrune.search(" ", {
      agent_id: MEM0_AGENT_ID,
      metadata: { expiresAt: { lt: nowIso } },
      limit: batchLimit,
    });
    scanned = candidates.length;
    for (const m of candidates) {
      if (!m.id) continue;
      if (opts.dryRun) {
        deleted++;
        continue;
      }
      try {
        await clientPrune.delete(m.id);
        // Best-effort: also clear the foreign-key on the local mirror
        // so getAllMemories doesn't surface zombie pointers.
        await db.update(agentMemoriesTable).set({ mem0Id: null, mem0Status: "expired" }).where(eq(agentMemoriesTable.mem0Id, m.id));
        deleted++;
      } catch (err) {
        failed++;
        console.warn(`[mem0Prune] delete ${m.id.slice(0, 8)} failed:`, err instanceof Error ? err.message : err);
      }
    }
    console.log(`[mem0Prune] scanned=${scanned} deleted=${deleted} failed=${failed} dryRun=${!!opts.dryRun}`);
  } catch (err) {
    console.error("[mem0Prune] sweep failed:", err instanceof Error ? err.message : err);
  }
  return { scanned, deleted, failed, dryRun: !!opts.dryRun };
}
