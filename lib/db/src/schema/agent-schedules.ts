import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Per-agent runtime-configurable schedule. Read by every Inngest cron handler
 * via shouldRunAgent(); the underlying cron expression in agents.ts fires at
 * a fixed "max-allowed cadence" and the schedule gates whether the agent
 * actually does work this cycle.
 *
 * Operator-managed via the admin UI at /admin/agent-schedules. No code
 * deploy needed to retune; cadence changes take effect on the next cron tick.
 *
 * Defaults match the static Inngest crons at the time of the 2026-05-25 cost
 * audit. CVI's default is 172800s (48h) — the value the user explicitly set
 * after the LLM-per-cycle math was surfaced.
 */
export const agentSchedulesTable = pgTable("agent_schedules", {
  agentName: text("agent_name").primaryKey(),
  intervalSeconds: integer("interval_seconds").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  description: text("description"),
  /**
   * Set by shouldRunAgent() (or its caller) immediately BEFORE starting a
   * run so concurrent crons can't both pass the gate. Used to compute
   * "elapsed since last attempt" — not "since last success" — by design.
   * If a run hangs or fails, the next attempt waits the full interval
   * instead of retrying immediately, which is the safer default for
   * cost-controlled agents.
   */
  lastRunAt: timestamp("last_run_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: text("updated_by"),
});

export const insertAgentScheduleSchema = createInsertSchema(agentSchedulesTable).omit({ updatedAt: true });
export type InsertAgentSchedule = z.infer<typeof insertAgentScheduleSchema>;
export type AgentSchedule = typeof agentSchedulesTable.$inferSelect;
