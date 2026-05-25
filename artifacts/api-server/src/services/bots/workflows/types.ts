/**
 * Shared types for bot workflows. Each workflow is a self-contained
 * `WorkflowDefinition` exposing a `run(ctx)` function. Implementations
 * may be procedural sequences (preferred for LLM-free workflows) or
 * AgentKit Networks (for workflows whose steps include LLM reasoning).
 * The runner + scheduler + admin UI only see the common envelope below.
 */
import type { Bot } from "@workspace/db";

/**
 * Cadence specification for when a workflow should fire.
 *
 * - `daily`     — once per day per bot (or once per day system-wide for
 *                  bot-less workflows). Fires at first scheduler tick after
 *                  the persona's local "morning" (defaults to 9am UTC).
 * - `weekly`    — once per (7 × 24h) window.
 * - `bi-weekly` — once per (14 × 24h) window.
 * - `monthly`   — once per calendar month.
 * - `quarterly` — once per calendar quarter.
 * - `event:<name>` — fires when a matching event is published (Phase 4).
 */
export type WorkflowCadence =
  | "daily"
  | "weekly"
  | "bi-weekly"
  | "monthly"
  | "quarterly"
  | `event:${string}`;

/**
 * Workflow scope.
 *
 * - `per-bot`     — runs once per matching bot per cadence window.
 *                    Receives a `bot` argument.
 * - `system-wide` — runs once system-wide per cadence window. No `bot`
 *                    argument; aggregates across all bots/data.
 */
export type WorkflowScope = "per-bot" | "system-wide";

/**
 * Static metadata for a registered workflow. The actual graph is built
 * by `buildGraph()` at registration time and cached.
 */
export interface WorkflowDefinition<TState = Record<string, unknown>> {
  /** Stable key — used for cadence tracking, lookups, and DB rows. */
  key: string;
  /** Human-readable label for admin UI. */
  label: string;
  /** Persona-key filter: workflow only fires for bots matching one of these. Ignored when scope='system-wide'. */
  appliesToPersonas: string[];
  cadence: WorkflowCadence;
  scope: WorkflowScope;
  /** One-paragraph description for admin UI tooltips and the pitchbook. */
  description: string;
  /**
   * Estimated $ cost ceiling per run, used by the scheduler to skip when
   * the bot's remaining budget is insufficient. Cents.
   */
  estimatedCostCents: number;
  /**
   * Run the workflow. The runner wraps the invocation in DB tracking +
   * budget accounting; this function only needs to return the result
   * envelope.
   */
  run(ctx: WorkflowRunContext): Promise<WorkflowResult<TState>>;
}

/**
 * Context passed to every workflow invocation. The runner constructs it.
 */
export interface WorkflowRunContext {
  /** DB row id of the workflow run for trace attribution. */
  runId: number;
  /** Bot row (null for system-wide workflows). */
  bot: Bot | null;
  /** Cents remaining in the per-bot or system budget at start of run. */
  budgetRemainingCents: number;
  /** Trigger source recorded on the workflow run. */
  trigger: string;
  /**
   * Append a step trace row. Workflows call this once per logical step
   * so the admin UI can render a step timeline.
   */
  recordStep(step: WorkflowStepTrace): Promise<void>;
  /**
   * Re-check the budget mid-workflow. Workflows should call this BEFORE
   * any expensive node (Perplexity, Sonnet) and short-circuit with
   * status='budget_exhausted' if `false` is returned.
   */
  hasBudgetFor(estimatedCostCents: number): Promise<boolean>;
}

/**
 * Step trace row appended by workflow nodes via `ctx.recordStep`.
 */
export interface WorkflowStepTrace {
  stepName: string;
  stepIndex: number;
  status: "ok" | "error" | "skipped_budget" | "no_op";
  costCents: number;
  durationMs: number;
  payload?: Record<string, unknown>;
  errorMessage?: string;
}

/**
 * Final result envelope returned by every workflow. The runner persists
 * this to `bot_workflow_runs`.
 */
export interface WorkflowResult<TState = Record<string, unknown>> {
  status: "completed" | "failed" | "budget_exhausted" | "no_op";
  state: TState;
  artifactIds: Record<string, number[]>;
  totalCostCents: number;
  errorMessage?: string;
}
