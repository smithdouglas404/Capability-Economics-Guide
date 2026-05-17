import { db } from "@workspace/db";
import { agentMemoriesTable } from "@workspace/db";
import { desc, sql, and, eq } from "drizzle-orm";

// Cutover note: was "cei-autonomous-agent" before the Inflexcvi rebrand.
// Memories created under the old ID stay readable via mem0 search regardless
// of agent_id (mem0 filters but doesn't gatekeep historical content), so no
// data is lost — they just stop appearing in the default agent-scoped list.
const MEM0_AGENT_ID = "cvi-autonomous-agent";

export type MemoryType = "pattern" | "observation" | "insight" | "decision_context";
export type MemoryCategory =
  | "capability_signal"
  | "industry_trend"
  | "contradiction"
  | "validated_pattern"
  | "decision"
  | "observation";

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

function buildAuthHeaders(cfg: Mem0Config): Record<string, string> {
  if (cfg.isCloud) {
    // Mem0 Platform (cloud) uses the legacy "Token" scheme, not Bearer.
    // The platform API key starts with m0-...
    return { Authorization: `Token ${cfg.apiKey}` };
  }
  // Self-hosted v2.x: X-API-Key (NOT Authorization: Bearer — that path
  // tries to verify the value as a JWT and rejects ADMIN_API_KEY).
  return { "X-API-Key": cfg.apiKey };
}

async function mem0Fetch(
  path: string,
  method: string,
  body?: unknown,
): Promise<unknown> {
  const cfg = getMem0Config();
  if (!cfg) throw new Error("Mem0 not configured");
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(cfg),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    // Surface the most-common operator misconfigs with actionable hints
    // instead of just dumping the raw 5xx. Mem0 self-hosted uses LiteLLM
    // under the hood, which calls an OpenAI-compatible endpoint. We route
    // those calls through OpenRouter (cost + single key surface), so the
    // Mem0 service's "OPENAI_API_KEY" var must hold an OpenRouter key and
    // OPENAI_BASE_URL must point at https://openrouter.ai/api/v1.
    if (res.status === 502 && text.includes("provider_auth_failed")) {
      throw new Error(
        `Mem0 ${method} ${path} → 502 provider_auth_failed: the Mem0 service's upstream LLM call failed auth. ` +
        `Fix in Railway on the Mem0 service: set OPENAI_API_KEY to a valid OpenRouter key and OPENAI_BASE_URL=https://openrouter.ai/api/v1. ` +
        `Raw: ${text.slice(0, 200)}`,
      );
    }
    if (res.status === 401) {
      throw new Error(
        `Mem0 ${method} ${path} → 401: api-server's MEM0_API_KEY does not match the Mem0 service's ADMIN_API_KEY. ` +
        `Sent via X-API-Key (NOT Authorization: Bearer). Verify both env vars match in Railway. Raw: ${text.slice(0, 200)}`,
      );
    }
    throw new Error(`Mem0 ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export function isMem0Available(): boolean {
  return !!(process.env.MEM0_BASE_URL && process.env.MEM0_API_KEY);
}

/**
 * Lightweight liveness probe — used by `/api/health/services`. Issues the
 * cheapest authenticated read available (list 1 memory) and throws on any
 * non-2xx so callers can classify the failure.
 */
export async function mem0Ping(): Promise<void> {
  if (!isMem0Available()) throw new Error("Mem0 not configured");
  await mem0Fetch(`/memories?agent_id=${MEM0_AGENT_ID}&limit=1`, "GET");
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
  const { category, runId, ttlDays = 90, context } = options;
  const expiresAt = new Date(Date.now() + ttlDays * 86400000);

  let mem0Id: string | null = null;
  let mem0EventId: string | null = null;
  let mem0Status: string | null = null;

  if (isMem0Available()) {
    try {
      const messages = buildConversationalMessages(type, category, content, context, metadata);
      const result = await mem0Fetch("/memories", "POST", {
        messages,
        agent_id: MEM0_AGENT_ID,
        ...(runId !== null && runId !== undefined ? { run_id: `cycle-${runId}` } : {}),
        metadata: {
          ...metadata,
          memoryType: type,
          category: category ?? type,
          runId: runId ?? null,
          ttlDays,
          // Stamp the ISO expiry so mem0Prune can filter on metadata.expiresAt
          // server-side. Without this, ttlDays is opaque to Mem0 and pgvector
          // grows unbounded.
          expiresAt: expiresAt.toISOString(),
        },
      }) as { results?: Array<{ id?: string; event_id?: string; event?: string }> };

      const first = result?.results?.[0];
      mem0Id = first?.id ?? null;
      mem0EventId = first?.event_id ?? null;
      mem0Status = first?.event ?? null;
      console.log(`[Mem0] stored ${type}/${category ?? "uncategorized"} id=${mem0Id?.slice(0, 8) ?? "n/a"}`);
    } catch (err) {
      console.error("[Mem0] store failed:", err instanceof Error ? err.message : err);
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
  if (!isMem0Available()) return false;
  try {
    // Mem0 self-hosted v2.x PUT /memories/{id} model is MemoryUpdateRequest
    // with field `data` (not `text`, which the hosted-cloud docs use). We
    // were sending `text` and the server was silently accepting then no-op'ing,
    // so refinement memories from reflectNode never actually persisted upstream.
    // Send both to stay compatible if the operator bumps to a version that
    // renames it; the server ignores unknown keys.
    await mem0Fetch(`/memories/${memoryId}`, "PUT", { data: newContent, text: newContent });
    await db.update(agentMemoriesTable)
      .set({ content: newContent })
      .where(eq(agentMemoriesTable.mem0Id, memoryId));
    console.log(`[Mem0] updated ${memoryId.slice(0, 8)}`);
    return true;
  } catch (err) {
    console.error("[Mem0] update failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function deleteMemory(memoryId: string): Promise<boolean> {
  if (!isMem0Available()) return false;
  try {
    await mem0Fetch(`/memories/${memoryId}`, "DELETE");
    await db.delete(agentMemoriesTable).where(eq(agentMemoriesTable.mem0Id, memoryId));
    console.log(`[Mem0] deleted ${memoryId.slice(0, 8)}`);
    return true;
  } catch (err) {
    console.error("[Mem0] delete failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function getMemoryHistory(memoryId: string): Promise<unknown[]> {
  if (!isMem0Available()) return [];
  try {
    const result = await mem0Fetch(`/memories/${memoryId}/history`, "GET") as unknown[];
    return Array.isArray(result) ? result : [];
  } catch (err) {
    console.error("[Mem0] history failed:", err instanceof Error ? err.message : err);
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
  } = {},
): Promise<AgentMemory[]> {
  const results: AgentMemory[] = [];

  if (isMem0Available()) {
    try {
      // Mem0 v1.0.0+ supports enhanced filters with logical (AND/OR/NOT)
      // and comparison (gt/gte/lt/lte/eq/ne/in/nin/contains/icontains)
      // operators evaluated at the vector store level. Push every
      // available predicate server-side so we don't burn the retrieval
      // budget on memories the caller would discard.
      //
      // Falls back to the basic single-level filter shape on older
      // servers via defensive re-check in the result loop below.
      const andClauses: Record<string, unknown>[] = [
        { agent_id: MEM0_AGENT_ID },
      ];
      if (options.runId) andClauses.push({ run_id: `cycle-${options.runId}` });
      if (type) andClauses.push({ metadata: { memoryType: type } });
      if (options.category) andClauses.push({ metadata: { category: options.category } });
      if (options.topic) andClauses.push({ metadata: { topic: options.topic } });
      if (typeof options.minConfidence === "number") {
        andClauses.push({ metadata: { confidence: { gte: options.minConfidence } } });
      }
      if (options.createdAfter) {
        andClauses.push({ created_at: { gte: options.createdAfter.toISOString() } });
      }

      const res = await mem0Fetch("/search", "POST", {
        query,
        filters: { AND: andClauses },
        limit,
        threshold: 0.35,
      }) as { results?: Array<{ id?: string; memory?: string; score?: number; metadata?: Record<string, unknown>; created_at?: string }> };

      for (const m of res?.results ?? []) {
        const meta = m.metadata || {};
        const memType = (meta.memoryType as string) || type || "observation";
        const memCat = meta.category as string | undefined;
        // Server-side filtering is best-effort; defensively re-check on
        // older server versions that ignore `filters`.
        if (type && memType !== type) continue;
        if (options.category && memCat !== options.category) continue;
        results.push({
          id: m.id || `mem0-${Date.now()}`,
          memoryType: memType,
          category: memCat ?? null,
          runScope: (meta.runId as string) || null,
          content: m.memory || "",
          metadata: meta,
          // Don't fabricate a score — downstream filterMemoriesForTarget
          // and the decide gate at graph.ts:208 use this as a real signal.
          // 0.8 inflated every result, making the "validated_pattern" gate
          // trigger on memories the vector search wasn't confident in.
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
      console.error("[Mem0] search failed, falling back to local DB:", err instanceof Error ? err.message : err);
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

  if (isMem0Available()) {
    try {
      const res = await mem0Fetch(`/memories?agent_id=${MEM0_AGENT_ID}&limit=${limit}`, "GET") as
        { results?: Array<{ id?: string; memory?: string; metadata?: Record<string, unknown>; created_at?: string }> };

      for (const m of res?.results ?? []) {
        const meta = m.metadata || {};
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
      console.error("[Mem0] getAll failed:", err instanceof Error ? err.message : err);
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

  if (isMem0Available()) {
    try {
      const res = await mem0Fetch(`/memories?agent_id=${MEM0_AGENT_ID}&limit=${limit}`, "GET") as
        { results?: Array<{ id?: string; memory?: string; metadata?: Record<string, unknown>; created_at?: string }> };

      for (const m of res?.results ?? []) {
        const meta = m.metadata || {};
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
      console.error("[Mem0] getAll failed:", err instanceof Error ? err.message : err);
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
  if (isMem0Available()) {
    try {
      const res = await mem0Fetch(`/memories?agent_id=${MEM0_AGENT_ID}&limit=200`, "GET") as
        { results?: unknown[] };
      mem0Count = res?.results?.length ?? 0;
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
  try {
    // Use a wildcard search to surface memories matching only the metadata
    // filter; older Mem0 versions that require a non-empty query may need
    // a string here, so we pass a single space which the server treats as
    // a no-op match against the AND filters.
    const res = await mem0Fetch("/search", "POST", {
      query: " ",
      filters: {
        AND: [
          { agent_id: MEM0_AGENT_ID },
          { metadata: { expiresAt: { lt: nowIso } } },
        ],
      },
      limit: batchLimit,
    }) as { results?: Array<{ id?: string }> };

    const candidates = res?.results ?? [];
    scanned = candidates.length;
    for (const m of candidates) {
      if (!m.id) continue;
      if (opts.dryRun) {
        deleted++;
        continue;
      }
      try {
        await mem0Fetch(`/memories/${m.id}`, "DELETE");
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
