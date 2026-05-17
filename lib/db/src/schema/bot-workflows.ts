import { pgTable, serial, integer, text, timestamp, jsonb, real, index } from "drizzle-orm/pg-core";
import { botsTable } from "./bots";

/**
 * Bot workflow runs — one row per LangGraph workflow invocation against a
 * bot. Each workflow is a multi-step orchestration that carries state
 * across nodes (e.g., "browse top-EVaR caps → score → for each: assess +
 * deep-dive + annotate"). Unlike `bot_actions` (one row per discrete
 * action), this captures the higher-level *investigation* the bot was
 * pursuing — the causal chain from finding → decision → published artifact.
 *
 * `botId` is nullable for system-level cross-bot workflows owned by the
 * scheduler (e.g., Cross-Bot Consensus Map, Bot-to-CVI Calibration).
 *
 * `state` jsonb holds the final LangGraph state (or current state for
 * in-progress runs). Schema is workflow-specific; consumers parse based
 * on `workflowKey`.
 *
 * `artifactIds` jsonb maps artifact-table → array of inserted ids so the
 * admin UI can render "this workflow produced 3 annotations + 1 listing"
 * without scanning every artifact table.
 */
export const botWorkflowRunsTable = pgTable(
  "bot_workflow_runs",
  {
    id: serial("id").primaryKey(),
    // Null for system-level workflows owned by the scheduler.
    botId: integer("bot_id").references(() => botsTable.id, { onDelete: "set null" }),
    // Stable identifier matching a registered workflow (e.g., "pe-weekly-diligence",
    // "cross-bot-consensus-map"). Looked up against the in-process registry.
    workflowKey: text("workflow_key").notNull(),
    // Trigger source: "scheduled" | "manual" | "event:<event-name>".
    trigger: text("trigger").notNull().default("scheduled"),
    // pending | in_progress | completed | failed | budget_exhausted
    status: text("status").notNull().default("pending"),
    // Final LangGraph state object (or current if in-progress).
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
    // {annotations: [12, 13], marketplaceListings: [4], assessments: [...]}
    artifactIds: jsonb("artifact_ids").$type<Record<string, number[]>>().notNull().default({}),
    // Total LLM cost in cents across all workflow nodes.
    costCents: integer("cost_cents").notNull().default(0),
    // Cap that was in effect for this run (snapshot at start for audit).
    budgetCapCentsAtStart: integer("budget_cap_cents_at_start"),
    // Free-form error message if status='failed' or status='budget_exhausted'.
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    // Wall-clock duration in milliseconds (null until completed).
    durationMs: integer("duration_ms"),
  },
  (table) => [
    index("bot_workflow_runs_bot_idx").on(table.botId),
    index("bot_workflow_runs_key_idx").on(table.workflowKey),
    index("bot_workflow_runs_started_idx").on(table.startedAt),
  ],
);

export type BotWorkflowRun = typeof botWorkflowRunsTable.$inferSelect;
export type NewBotWorkflowRun = typeof botWorkflowRunsTable.$inferInsert;

/**
 * Per-step trace for a workflow run. One row per LangGraph node invocation
 * within a run. Lets the admin UI render a step-by-step timeline for
 * debugging (e.g., "browseTopEvarCaps took 200ms, found 12 caps; scoreFindings
 * took 50ms, picked 3; forEach.assess[cap=18] took 8.2s, cost $0.12 …").
 */
export const botWorkflowStepsTable = pgTable(
  "bot_workflow_steps",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").notNull().references(() => botWorkflowRunsTable.id, { onDelete: "cascade" }),
    stepName: text("step_name").notNull(),
    // Sequence index within the run (0-based, monotonic).
    stepIndex: integer("step_index").notNull(),
    status: text("status").notNull(), // ok | error | skipped_budget | no_op
    costCents: integer("cost_cents").notNull().default(0),
    durationMs: integer("duration_ms").notNull(),
    // Step-specific payload — what was found, what was decided, etc.
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
  },
  (table) => [
    index("bot_workflow_steps_run_idx").on(table.runId),
  ],
);

export type BotWorkflowStep = typeof botWorkflowStepsTable.$inferSelect;
export type NewBotWorkflowStep = typeof botWorkflowStepsTable.$inferInsert;
