import { pgTable, serial, text, timestamp, jsonb, integer, real, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
  cviBeforeIndex: real("cvi_before_index"),
  cviAfterIndex: real("cvi_after_index"),
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

/**
 * Proposed actions from the Letta autonomous agent that mutate canonical
 * platform data. Every write that Letta might want to make goes here first
 * with status="pending"; a human (admin) approves or rejects via the admin
 * UI, and approval flips status to "applied" while the per-type applier
 * mutates the actual table.
 *
 * Why a queue and not direct writes:
 *   1. Agent reasoning can hallucinate or misread a contradiction; a bad
 *      direct write to economic_rules or industry_priors corrupts the
 *      institutional memory and is hard to roll back.
 *   2. Every proposal carries the agent's chain-of-thought rationale
 *      ("why I think this rule should change") so admins can audit the
 *      reasoning, not just the outcome.
 *   3. proposal expires after 30 days if no one acts on it — keeps the
 *      queue from growing unbounded.
 *
 * Per plan Phase 1.5.1.
 */
export const agentProposalsTable = pgTable(
  "agent_proposals",
  {
    id: serial("id").primaryKey(),
    agentRunId: integer("agent_run_id"),
    proposalType: text("proposal_type").notNull(),
    targetEntity: text("target_entity").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    agentRationale: text("agent_rationale"),
    status: text("status").notNull().default("pending"),
    proposedBy: text("proposed_by").notNull().default("letta-agent"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at"),
    reviewNotes: text("review_notes"),
    appliedAt: timestamp("applied_at"),
    expiresAt: timestamp("expires_at").default(sql`now() + interval '30 days'`).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    queueIdx: index("agent_proposals_queue_idx").on(t.status, t.createdAt),
    targetIdx: index("agent_proposals_target_idx").on(t.targetEntity, t.status),
  }),
);

/**
 * Admin-tunable strategic thresholds the Letta agent reasons against
 * (CVI floor, DVX ceiling, posterior-variance limit, etc.). Distinct from
 * agent_tuning which holds operational tunables (Perplexity cap, interval).
 *
 * The rendered content of this table is serialized into the Letta
 * "economic_rules" core memory block on every change so the agent sees
 * threshold updates immediately, not on next consolidator cycle.
 *
 * Per plan Phase 1.5.1.
 */
export const economicRulesTable = pgTable("economic_rules", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  unit: text("unit"),
  description: text("description").notNull(),
  lastUpdatedBy: text("last_updated_by"),
  lastUpdatedAt: timestamp("last_updated_at").defaultNow().notNull(),
});

/**
 * Runtime scheduler kill-switch table — created at boot by
 * services/scheduler-kill-switch.ts. Declared here so drizzle-kit
 * recognizes it and doesn't prompt about renames during deploy.
 */
export const schedulerKillSwitchesTable = pgTable("scheduler_kill_switches", {
  name: text("name").primaryKey(),
  disabled: boolean("disabled").notNull().default(false),
  reason: text("reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by"),
});

/**
 * Small key/value cache for agent-published artifacts that health probes need
 * to read with exact-key reliability. Background: the shared store
 * (services/agent/store.ts) is Letta archival memory, which uses semantic
 * search — fine for in-LLM tool calls but unreliable for "does X exist yet?"
 * probes against short keys (synthesis_brief, temporal_shifts, etc.). Agents
 * dual-write to Letta (for LLM consumption) AND here (for probe reads).
 *
 * Not a general key/value store — only used for caches the health endpoint
 * tracks. Idempotent upserts on key.
 */
export const agentKvCacheTable = pgTable("agent_kv_cache", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AgentProposal = typeof agentProposalsTable.$inferSelect;
export type EconomicRule = typeof economicRulesTable.$inferSelect;
export type SchedulerKillSwitch = typeof schedulerKillSwitchesTable.$inferSelect;
export type AgentKvCacheEntry = typeof agentKvCacheTable.$inferSelect;
