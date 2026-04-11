import MemoryClient from "mem0ai";
import type { Memory as Mem0Memory } from "mem0ai";
import { db } from "@workspace/db";
import { agentMemoriesTable } from "@workspace/db";
import { desc, sql, and } from "drizzle-orm";

const MEM0_AGENT_ID = "cei-autonomous-agent";
const MEM0_APP_ID = "capability-economics";

let mem0Client: InstanceType<typeof MemoryClient> | null = null;

function getMem0Client(): InstanceType<typeof MemoryClient> | null {
  if (mem0Client) return mem0Client;
  const apiKey = process.env.MEM0_API_KEY;
  if (!apiKey) {
    console.warn("[Mem0] MEM0_API_KEY not set — Mem0 Cloud disabled, using local DB fallback");
    return null;
  }
  mem0Client = new MemoryClient({ apiKey });
  console.log("[Mem0] Cloud client initialized");
  return mem0Client;
}

export interface AgentMemory {
  id: string | number;
  memoryType: string;
  content: string;
  metadata: Record<string, unknown>;
  relevanceScore: number;
  accessCount: number;
  createdAt: Date;
  source: "mem0" | "local";
}

type MemoryType = "pattern" | "observation" | "insight" | "decision_context";

export async function storeMemory(
  type: MemoryType,
  content: string,
  metadata: Record<string, unknown> = {},
  ttlDays: number = 90,
): Promise<AgentMemory> {
  const client = getMem0Client();

  if (client) {
    try {
      const messages = [
        { role: "user" as const, content: `[${type}] ${content}` },
      ];
      const result = await client.add(messages, {
        agent_id: MEM0_AGENT_ID,
        app_id: MEM0_APP_ID,
        metadata: { ...metadata, memoryType: type, ttlDays },
      });

      const memoryId = Array.isArray(result) && result[0]?.id
        ? result[0].id
        : `mem0-${Date.now()}`;

      console.log(`[Mem0] Stored ${type} memory: ${memoryId}`);

      const [localRow] = await db.insert(agentMemoriesTable).values({
        memoryType: type,
        content,
        metadata: { ...metadata, mem0Id: memoryId, source: "mem0" },
        relevanceScore: 1.0,
        expiresAt: new Date(Date.now() + ttlDays * 86400000),
      }).returning();

      return {
        id: memoryId,
        memoryType: type,
        content,
        metadata: { ...metadata, mem0Id: memoryId },
        relevanceScore: 1.0,
        accessCount: 0,
        createdAt: localRow.createdAt,
        source: "mem0",
      };
    } catch (err) {
      console.error("[Mem0] Store failed, falling back to local DB:", err);
    }
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);

  const [row] = await db.insert(agentMemoriesTable).values({
    memoryType: type,
    content,
    metadata: { ...metadata, source: "local" },
    relevanceScore: 1.0,
    expiresAt,
  }).returning();

  return {
    id: row.id,
    memoryType: row.memoryType,
    content: row.content,
    metadata: (row.metadata as Record<string, unknown>) || {},
    relevanceScore: row.relevanceScore ?? 1.0,
    accessCount: row.accessCount,
    createdAt: row.createdAt,
    source: "local",
  };
}

export async function recallMemories(
  query: string,
  type?: MemoryType,
  limit: number = 10,
): Promise<AgentMemory[]> {
  const client = getMem0Client();
  const results: AgentMemory[] = [];

  if (client) {
    try {
      const searchQuery = type ? `[${type}] ${query}` : query;
      const mem0Results = await client.search(searchQuery, {
        agent_id: MEM0_AGENT_ID,
        app_id: MEM0_APP_ID,
        limit,
      });

      for (const m of mem0Results) {
        results.push({
          id: m.id || `mem0-${Date.now()}`,
          memoryType: (m.metadata as Record<string, unknown>)?.memoryType as string || type || "observation",
          content: m.memory || m.data?.memory || "",
          metadata: (m.metadata as Record<string, unknown>) || {},
          relevanceScore: m.score ?? 0.8,
          accessCount: 0,
          createdAt: m.created_at ? new Date(m.created_at) : new Date(),
          source: "mem0",
        });
      }

      console.log(`[Mem0] Recalled ${results.length} memories for query: "${query.slice(0, 50)}..."`);

      if (results.length >= limit) return results.slice(0, limit);
    } catch (err) {
      console.error("[Mem0] Search failed, falling back to local DB:", err);
    }
  }

  const now = new Date();
  const conditions = [
    sql`(${agentMemoriesTable.expiresAt} IS NULL OR ${agentMemoriesTable.expiresAt} > ${now})`,
  ];

  if (type) {
    conditions.push(sql`${agentMemoriesTable.memoryType} = ${type}`);
  }

  const allMemories = await db
    .select()
    .from(agentMemoriesTable)
    .where(and(...conditions))
    .orderBy(desc(agentMemoriesTable.createdAt))
    .limit(200);

  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  const scored = allMemories.map(m => {
    const text = m.content.toLowerCase();
    const meta = JSON.stringify(m.metadata || {}).toLowerCase();
    const combined = text + " " + meta;

    let matchScore = 0;
    for (const kw of keywords) {
      if (combined.includes(kw)) matchScore += 1;
    }
    const keywordRelevance = keywords.length > 0 ? matchScore / keywords.length : 0;

    const ageDays = (now.getTime() - m.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const recencyBoost = Math.exp(-ageDays / 30);

    const score = keywordRelevance * 0.6 + recencyBoost * 0.3 + (m.relevanceScore ?? 1.0) * 0.1;

    return { memory: m, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const localResults = scored.slice(0, limit - results.length).map(r => ({
    id: r.memory.id,
    memoryType: r.memory.memoryType,
    content: r.memory.content,
    metadata: (r.memory.metadata as Record<string, unknown>) || {},
    relevanceScore: r.score,
    accessCount: r.memory.accessCount,
    createdAt: r.memory.createdAt,
    source: "local" as const,
  }));

  const ids = localResults.map(r => r.id).filter((id): id is number => typeof id === "number");
  if (ids.length > 0) {
    await db.update(agentMemoriesTable)
      .set({
        accessCount: sql`${agentMemoriesTable.accessCount} + 1`,
        lastAccessedAt: new Date(),
      })
      .where(sql`${agentMemoriesTable.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
  }

  return [...results, ...localResults].slice(0, limit);
}

export async function getAllMemories(limit: number = 100): Promise<AgentMemory[]> {
  const client = getMem0Client();
  const results: AgentMemory[] = [];

  if (client) {
    try {
      const mem0All = await client.getAll({
        agent_id: MEM0_AGENT_ID,
        app_id: MEM0_APP_ID,
        page_size: limit,
      });

      for (const m of mem0All) {
        results.push({
          id: m.id || `mem0-${Date.now()}`,
          memoryType: (m.metadata as Record<string, unknown>)?.memoryType as string || "observation",
          content: m.memory || m.data?.memory || "",
          metadata: (m.metadata as Record<string, unknown>) || {},
          relevanceScore: m.score ?? 1.0,
          accessCount: 0,
          createdAt: m.created_at ? new Date(m.created_at) : new Date(),
          source: "mem0",
        });
      }
    } catch (err) {
      console.error("[Mem0] getAll failed:", err);
    }
  }

  const localMemories = await db
    .select()
    .from(agentMemoriesTable)
    .orderBy(desc(agentMemoriesTable.createdAt))
    .limit(limit);

  for (const m of localMemories) {
    const localMeta = (m.metadata as Record<string, unknown>) || {};
    const isMem0Synced = results.some(r =>
      typeof r.id === "string" && localMeta.mem0Id === r.id
    );
    if (!isMem0Synced) {
      results.push({
        id: m.id,
        memoryType: m.memoryType,
        content: m.content,
        metadata: (m.metadata as Record<string, unknown>) || {},
        relevanceScore: m.relevanceScore ?? 1.0,
        accessCount: m.accessCount,
        createdAt: m.createdAt,
        source: "local",
      });
    }
  }

  return results.slice(0, limit);
}

export async function getMemoryStats(): Promise<{
  totalMemories: number;
  byType: Record<string, number>;
  avgRelevance: number;
  mem0Connected: boolean;
}> {
  const client = getMem0Client();
  let mem0Count = 0;

  if (client) {
    try {
      const mem0All = await client.getAll({
        agent_id: MEM0_AGENT_ID,
        app_id: MEM0_APP_ID,
        page_size: 200,
      });
      mem0Count = mem0All.length;
    } catch {
      // ignore
    }
  }

  const all = await db.select().from(agentMemoriesTable);

  const byType: Record<string, number> = {};
  let totalRelevance = 0;
  let localOnlyCount = 0;

  for (const m of all) {
    byType[m.memoryType] = (byType[m.memoryType] || 0) + 1;
    totalRelevance += m.relevanceScore ?? 1.0;
    const meta = (m.metadata as Record<string, unknown>) || {};
    if (!meta.mem0Id) localOnlyCount++;
  }

  return {
    totalMemories: mem0Count + localOnlyCount,
    byType,
    avgRelevance: all.length > 0 ? totalRelevance / all.length : 0,
    mem0Connected: client !== null,
  };
}
