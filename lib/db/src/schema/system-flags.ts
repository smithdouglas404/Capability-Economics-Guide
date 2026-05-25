import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Global runtime feature flags. Singletons keyed by `flagName`. Edit via the
 * admin UI; takes effect within the cache TTL of consumers (typically 30s).
 *
 * Known flags:
 *
 *   "llm_enabled" — value "true" | "false". Master kill switch for ALL LLM
 *     calls (OpenRouter, Anthropic, OpenAI, Perplexity). When "false":
 *       - every agent_schedules-gated agent cron skips (services/agent/scheduling.ts)
 *       - HTTP middleware returns 503 + the maintenance message on every
 *         /api/* route except /api/health/*, /api/admin/*, /api/auth/*.
 *     Add new LLM callsites' check via services/system-flags.ts:isLlmEnabled().
 *
 *   "maintenance_message" — user-visible string returned in the 503 body
 *     when llm_enabled=false. Frontends should detect 503 and render this.
 *
 * The singleton-per-key pattern mirrors system_secrets — keeps the table
 * small and easy to reason about. Defaults are seeded by
 * scripts/src/seed-system-flags.ts (idempotent on re-run).
 */
export const systemFlagsTable = pgTable("system_flags", {
  flagName: text("flag_name").primaryKey(),
  flagValue: text("flag_value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: text("updated_by"),
});

export type SystemFlag = typeof systemFlagsTable.$inferSelect;
