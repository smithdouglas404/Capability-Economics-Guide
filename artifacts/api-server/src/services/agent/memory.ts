import { db } from "@workspace/db";
import { agentMemoriesTable } from "@workspace/db";
import { desc, sql, and, gte } from "drizzle-orm";

export interface AgentMemory {
  id: number;
  memoryType: string;
  content: string;
  metadata: Record<string, unknown>;
  relevanceScore: number;
  accessCount: number;
  createdAt: Date;
}

type MemoryType = "pattern" | "observation" | "insight" | "decision_context";

export async function storeMemory(
  type: MemoryType,
  content: string,
  metadata: Record<string, unknown> = {},
  ttlDays: number = 90,
): Promise<AgentMemory> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);

  const [row] = await db.insert(agentMemoriesTable).values({
    memoryType: type,
    content,
    metadata,
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
  };
}

export async function recallMemories(
  query: string,
  type?: MemoryType,
  limit: number = 10,
): Promise<AgentMemory[]> {
  const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);

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

  const topResults = scored.slice(0, limit);
  const ids = topResults.map(r => r.memory.id);
  if (ids.length > 0) {
    await db.update(agentMemoriesTable)
      .set({
        accessCount: sql`${agentMemoriesTable.accessCount} + 1`,
        lastAccessedAt: new Date(),
      })
      .where(sql`${agentMemoriesTable.id} IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`);
  }

  return topResults.map(r => ({
    id: r.memory.id,
    memoryType: r.memory.memoryType,
    content: r.memory.content,
    metadata: (r.memory.metadata as Record<string, unknown>) || {},
    relevanceScore: r.score,
    accessCount: r.memory.accessCount,
    createdAt: r.memory.createdAt,
  }));
}

export async function getMemoryStats(): Promise<{
  totalMemories: number;
  byType: Record<string, number>;
  avgRelevance: number;
}> {
  const all = await db.select().from(agentMemoriesTable);

  const byType: Record<string, number> = {};
  let totalRelevance = 0;

  for (const m of all) {
    byType[m.memoryType] = (byType[m.memoryType] || 0) + 1;
    totalRelevance += m.relevanceScore ?? 1.0;
  }

  return {
    totalMemories: all.length,
    byType,
    avgRelevance: all.length > 0 ? totalRelevance / all.length : 0,
  };
}
