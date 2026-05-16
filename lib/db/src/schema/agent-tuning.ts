import { pgTable, integer, real, timestamp, text } from "drizzle-orm/pg-core";

/**
 * Single-row tuning table for runtime knobs that need to change without a
 * deploy. Mirrors the alpha_config pattern (id=1 enforced on read/write).
 *
 * Each knob also exists as a hardcoded default in code so the system still
 * runs if the row is missing. The service layer (services/agent-tuning.ts)
 * upserts row 1 on first save and returns code defaults on first read.
 *
 * Knobs:
 * - routineIntervalHours: how often the autonomous CEI agent runs a routine
 *   cycle. Previously a const in scheduler.ts (8h then 96h).
 * - detailBackfillLimit: how many null-detail capability_economics rows the
 *   post-run safety-net sweep fills per cycle. Previously hardcoded 15.
 * - agentPerplexityCap: max perplexity_research tool calls a single agent
 *   run may issue before short-circuiting (runaway-loop circuit breaker).
 *   Previously MAX_RESEARCH_PER_RUN in services/agent/graph.ts.
 * - defaultBotBudgetUsdCap: default monthly LLM-spend cap (USD) applied to
 *   each newly-provisioned synthetic agent. Per-bot overrides at provision
 *   time still win, but the system-wide default is admin-editable here so
 *   no value is ever truly hardcoded.
 */
export const agentTuningTable = pgTable("agent_tuning", {
  id: integer("id").primaryKey().default(1),
  routineIntervalHours: real("routine_interval_hours").notNull().default(96),
  detailBackfillLimit: integer("detail_backfill_limit").notNull().default(15),
  agentPerplexityCap: integer("agent_perplexity_cap").notNull().default(6),
  defaultBotBudgetUsdCap: real("default_bot_budget_usd_cap").notNull().default(40),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: text("updated_by"),
});

export type AgentTuning = typeof agentTuningTable.$inferSelect;
export type NewAgentTuning = typeof agentTuningTable.$inferInsert;
