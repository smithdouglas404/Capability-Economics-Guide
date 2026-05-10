import { db } from "@workspace/db";
import { agentMemoriesTable } from "@workspace/db";
import { desc, sql, and, eq } from "drizzle-orm";

const MEM0_AGENT_ID = "cei-autonomous-agent";

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
// Mem0 REST client — talks to the self-hosted server via MEM0_BASE_URL
// ---------------------------------------------------------------------------

function getMem0Config(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.MEM0_BASE_URL;
  const apiKey = process.env.MEM0_API_KEY;
  if (!baseUrl || !apiKey) {
    if (!baseUrl && !apiKey) {
      console.warn("[Mem0] MEM0_BASE_URL and MEM0_API_KEY not set — using local DB only");
    } else {
      console.warn("[Mem0] Both MEM0_BASE_URL and MEM0_API_KEY must be set — using local DB only");
    }
    return null;
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
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
      "X-API-Key": cfg.apiKey,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Mem0 ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

function isMem0Available(): boolean {
  return !!(process.env.MEM0_BASE_URL && process.env.MEM0_API_KEY);
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
    : `Logging a ${type}${category ? ` (${category})` : ""} from the latest CEI research cycle. Capture the durable facts so future cycles can recall and reason over them.`;

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
    await mem0Fetch(`/memories/${memoryId}`, "PUT", { text: newContent });
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
  options: { runId?: number; category?: MemoryCategory } = {},
): Promise<AgentMemory[]> {
  const results: AgentMemory[] = [];

  if (isMem0Available()) {
    try {
      const res = await mem0Fetch("/search", "POST", {
        query,
        agent_id: MEM0_AGENT_ID,
        ...(options.runId ? { run_id: `cycle-${options.runId}` } : {}),
        limit,
      }) as { results?: Array<{ id?: string; memory?: string; score?: number; metadata?: Record<string, unknown>; created_at?: string }> };

      for (const m of res?.results ?? []) {
        const meta = m.metadata || {};
        const memType = (meta.memoryType as string) || type || "observation";
        const memCat = meta.category as string | undefined;
        if (type && memType !== type) continue;
        if (options.category && memCat !== options.category) continue;
        results.push({
          id: m.id || `mem0-${Date.now()}`,
          memoryType: memType,
          category: memCat ?? null,
          runScope: (meta.runId as string) || null,
          content: m.memory || "",
          metadata: meta,
          relevanceScore: m.score ?? 0.8,
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
