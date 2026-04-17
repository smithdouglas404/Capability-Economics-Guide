import { pgTable, serial, text, timestamp, jsonb, integer, real, boolean } from "drizzle-orm/pg-core";

export const agentRunsTable = pgTable("agent_runs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("pending"),
  trigger: text("trigger").notNull().default("scheduled"),
  industriesEvaluated: integer("industries_evaluated").notNull().default(0),
  capabilitiesResearched: integer("capabilities_researched").notNull().default(0),
  capabilitiesSkipped: integer("capabilities_skipped").notNull().default(0),
  perplexityCalls: integer("perplexity_calls").notNull().default(0),
  memoriesRecalled: integer("memories_recalled").notNull().default(0),
  memoriesStored: integer("memories_stored").notNull().default(0),
  decisions: jsonb("decisions").$type<Array<{
    capabilityId: number;
    industryId: string;
    action: "research" | "skip" | "use_memory";
    reason: string;
    timestamp: string;
  }>>().default([]),
  ceiBeforeIndex: real("cei_before_index"),
  ceiAfterIndex: real("cei_after_index"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const agentMemoriesTable = pgTable("agent_memories", {
  id: serial("id").primaryKey(),
  memoryType: text("memory_type").notNull(),
  category: text("category"),
  runScope: text("run_scope"),
  agentRunId: integer("agent_run_id"),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  mem0Id: text("mem0_id"),
  mem0EventId: text("mem0_event_id"),
  mem0Status: text("mem0_status"),
  relevanceScore: real("relevance_score").default(1.0),
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: timestamp("last_accessed_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
