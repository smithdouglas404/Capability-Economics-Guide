/**
 * Operator-facing catalog of every runtime-tunable parameter that
 * controls agent/process behavior.
 *
 * Two purposes:
 *   1. Define what "normal" is — the default interval / enabled state
 *      / cost ceiling each agent ships with. Operators can pause/slow
 *      an agent during a heavy data-gathering phase and use these
 *      defaults to bring it back to "normal" later without having to
 *      remember the original values.
 *   2. Surface the cost-per-cycle so an operator can see what each knob
 *      actually costs in $$ before turning it.
 *
 * What this catalog COVERS:
 *   - The 8 autonomous agents (agent_schedules rows) with cron-based
 *     intervals, enabled state, per-cycle cost, default cadence.
 *   - System-wide tuning (agent_tuning row): perplexity cap, bot budget
 *     default, content backfill limit.
 *   - The global LLM kill switch (system_flags.llm_enabled).
 *
 * What this catalog DOES NOT cover:
 *   - Inngest function rate limits and cron expressions — code-level
 *     constants in inngest/functions/agents.ts. Surface them read-only
 *     so operators know what the hard ceilings are, but changing them
 *     requires a deploy.
 *   - Per-agent INNGEST_OWNS_* env vars — Railway env vars; show their
 *     current value as a read-only indicator that the agent IS running
 *     under Inngest's control.
 *   - Code constants like MAX_ITERATIONS, MAX_RESEARCH_PER_RUN — these
 *     are deliberately code-level circuit breakers; changing them
 *     requires a deploy.
 *
 * Cost estimates live in services/agent/scheduling.ts:PER_CYCLE_COST_USD.
 * If you bump those, also update the per-month projections that the
 * admin route returns.
 */

import { db, agentSchedulesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { PER_CYCLE_COST_USD, estimateMonthlyCost } from "./agent/scheduling";
import { getTuning, TUNING_DEFAULTS } from "./agent-tuning";
import { isLlmEnabled } from "./system-flags";

/** One day in seconds — the canonical "normal cadence" floor for cost-sensitive agents. */
const DAYS = 24 * 60 * 60;

/**
 * Per-agent defaults that ship with the codebase. These reflect the
 * cadence the team chose after the 2026-05-25 cost audit.
 *
 * Update here if you ever revise the "normal" cadence — the admin
 * reset-to-defaults action reads this table.
 */
export interface AgentDefault {
  shortName: string;
  displayName: string;
  description: string;
  defaultIntervalSeconds: number;
  /** Roughly $ per cycle when the agent runs (PER_CYCLE_COST_USD passthrough). */
  perCycleCostUsd: number;
  /** Default enabled state. All agents ship enabled. */
  defaultEnabled: boolean;
  /** Which INNGEST_OWNS_* flag controls whether this agent runs under Inngest. */
  inngestOwnsFlag: string;
}

export const AGENT_DEFAULTS: AgentDefault[] = [
  {
    shortName: "cvi-agent",
    displayName: "CVI Autonomous Agent",
    description:
      "The 9-phase capability research pipeline. Evaluates which capabilities are stale or volatile, decides whether to research/skip/reuse-memory, then refreshes consensus scores via Perplexity triangulation and regenerates downstream content (insights, leaderboards, white papers).",
    defaultIntervalSeconds: 2 * DAYS,
    perCycleCostUsd: PER_CYCLE_COST_USD["cvi-agent"] ?? 0.15,
    defaultEnabled: true,
    inngestOwnsFlag: "INNGEST_OWNS_CVI",
  },
  {
    shortName: "macro-event-agent",
    displayName: "Macro Event Agent",
    description:
      "Watches global macroeconomic + regulatory signals (rate decisions, regulatory rulings, GDP releases, earnings surprises) and translates them into structured impact deltas on the capability graph.",
    defaultIntervalSeconds: 2 * DAYS,
    perCycleCostUsd: PER_CYCLE_COST_USD["macro-event-agent"] ?? 0.03,
    defaultEnabled: true,
    inngestOwnsFlag: "INNGEST_OWNS_MACRO_EVENT",
  },
  {
    shortName: "disruption-agent",
    displayName: "Disruption Agent",
    description:
      "Scans the capability graph for new signal events, classifies them by quadrant pressure (velocity vs vulnerability), and queues high-confidence cases for the human-in-the-loop review queue.",
    defaultIntervalSeconds: 2 * DAYS,
    perCycleCostUsd: PER_CYCLE_COST_USD["disruption-agent"] ?? 0.05,
    defaultEnabled: true,
    inngestOwnsFlag: "INNGEST_OWNS_DISRUPTION",
  },
  {
    shortName: "peer-coop-agent",
    displayName: "Peer-Coop Agent",
    description:
      "Maintains peer-benchmark cohorts and tracks which organizations are valid comparators per (industry, size, region). Makes sure benchmark math compares like with like.",
    defaultIntervalSeconds: 2 * DAYS,
    perCycleCostUsd: PER_CYCLE_COST_USD["peer-coop-agent"] ?? 0.02,
    defaultEnabled: true,
    inngestOwnsFlag: "INNGEST_OWNS_PEER_COOP",
  },
  {
    shortName: "stack-optimizer-agent",
    displayName: "Stack Optimizer Agent",
    description:
      "Observes which LLM model/route succeeded per task across the platform and writes recommendations to agent_tuning so cron-driven workloads pick the cheapest model that still hits the quality bar.",
    defaultIntervalSeconds: 2 * DAYS,
    perCycleCostUsd: PER_CYCLE_COST_USD["stack-optimizer-agent"] ?? 0.05,
    defaultEnabled: true,
    inngestOwnsFlag: "INNGEST_OWNS_STACK_OPTIMIZER",
  },
  {
    shortName: "ontology-agent",
    displayName: "Ontology Agent",
    description:
      "Proposes new capability nodes and relationship edges from external research and submits them to the pending_review queue. Also writes entities into the world-model graph (Graphiti+FalkorDB).",
    defaultIntervalSeconds: 2 * DAYS,
    perCycleCostUsd: PER_CYCLE_COST_USD["ontology-agent"] ?? 0.04,
    defaultEnabled: true,
    inngestOwnsFlag: "INNGEST_OWNS_ONTOLOGY",
  },
  {
    shortName: "synthesis-agent",
    displayName: "Synthesis Agent",
    description:
      "Cross-agent intelligence layer. Reads every specialized agent's digest plus graph correlations + Mem0 patterns + temporal-shift signals; produces a unified daily strategic brief. Event-driven via a 10-min debounce on the 5 specialized agents' digest events.",
    defaultIntervalSeconds: 2 * DAYS,
    perCycleCostUsd: PER_CYCLE_COST_USD["synthesis-agent"] ?? 0.04,
    defaultEnabled: true,
    inngestOwnsFlag: "INNGEST_OWNS_SYNTHESIS",
  },
  {
    shortName: "disruption-vector-agent",
    displayName: "Disruption Vector Agent",
    description:
      "Forward-looking sibling to disruption-agent. Computes the Capability Disruption Index for 8 stale capabilities per cycle (Sonnet-class, ~$0.56/cycle) and publishes a 'disruption frontier' digest for the synthesis agent.",
    defaultIntervalSeconds: 2 * DAYS,
    perCycleCostUsd: PER_CYCLE_COST_USD["disruption-vector-agent"] ?? 0.56,
    defaultEnabled: true,
    inngestOwnsFlag: "INNGEST_OWNS_DISRUPTION_INDEX",
  },
];

const AGENT_BY_NAME = new Map(AGENT_DEFAULTS.map((a) => [a.shortName, a]));

export function isKnownAgent(shortName: string): boolean {
  return AGENT_BY_NAME.has(shortName);
}

export function getAgentDefault(shortName: string): AgentDefault | undefined {
  return AGENT_BY_NAME.get(shortName);
}

/**
 * Current state for one agent — joins the catalog default with the
 * live agent_schedules row + the per-agent INNGEST_OWNS_* flag state.
 */
export interface AgentSnapshot {
  shortName: string;
  displayName: string;
  description: string;
  enabled: boolean;
  defaultEnabled: boolean;
  intervalSeconds: number;
  defaultIntervalSeconds: number;
  perCycleCostUsd: number;
  estimatedMonthlyCostUsdAtCurrentCadence: number;
  estimatedMonthlyCostUsdAtDefaultCadence: number;
  monthlyCostDeltaUsd: number;
  lastRunAt: string | null;
  inngestOwnsFlag: string;
  inngestOwnsFlagValue: string;
  inngestOwned: boolean;
}

async function fetchAgentSchedulesMap(): Promise<Map<string, { intervalSeconds: number; enabled: boolean; lastRunAt: Date | null }>> {
  const rows = await db.select().from(agentSchedulesTable);
  return new Map(
    rows.map((r) => [
      r.agentName,
      { intervalSeconds: r.intervalSeconds, enabled: r.enabled, lastRunAt: r.lastRunAt },
    ]),
  );
}

export async function snapshotAgent(shortName: string): Promise<AgentSnapshot | null> {
  const def = AGENT_BY_NAME.get(shortName);
  if (!def) return null;
  const sched = (await fetchAgentSchedulesMap()).get(shortName);
  return buildAgentSnapshot(def, sched);
}

export async function snapshotAllAgents(): Promise<AgentSnapshot[]> {
  const sched = await fetchAgentSchedulesMap();
  return AGENT_DEFAULTS.map((def) => buildAgentSnapshot(def, sched.get(def.shortName)));
}

function buildAgentSnapshot(
  def: AgentDefault,
  sched: { intervalSeconds: number; enabled: boolean; lastRunAt: Date | null } | undefined,
): AgentSnapshot {
  const intervalSeconds = sched?.intervalSeconds ?? def.defaultIntervalSeconds;
  const enabled = sched?.enabled ?? def.defaultEnabled;
  const flagValue = process.env[def.inngestOwnsFlag] ?? "";
  return {
    shortName: def.shortName,
    displayName: def.displayName,
    description: def.description,
    enabled,
    defaultEnabled: def.defaultEnabled,
    intervalSeconds,
    defaultIntervalSeconds: def.defaultIntervalSeconds,
    perCycleCostUsd: def.perCycleCostUsd,
    estimatedMonthlyCostUsdAtCurrentCadence: enabled
      ? estimateMonthlyCost(def.shortName, intervalSeconds)
      : 0,
    estimatedMonthlyCostUsdAtDefaultCadence: estimateMonthlyCost(def.shortName, def.defaultIntervalSeconds),
    monthlyCostDeltaUsd: enabled
      ? estimateMonthlyCost(def.shortName, intervalSeconds) -
        estimateMonthlyCost(def.shortName, def.defaultIntervalSeconds)
      : -estimateMonthlyCost(def.shortName, def.defaultIntervalSeconds),
    lastRunAt: sched?.lastRunAt ? sched.lastRunAt.toISOString() : null,
    inngestOwnsFlag: def.inngestOwnsFlag,
    inngestOwnsFlagValue: flagValue,
    inngestOwned: flagValue === "1",
  };
}

/**
 * System-wide tuning snapshot. Joins agent_tuning + the LLM-master kill
 * switch into one view. Tuning defaults come from
 * services/agent-tuning.ts:TUNING_DEFAULTS.
 */
export interface SystemTuningSnapshot {
  llmEnabled: boolean;
  defaultLlmEnabled: boolean;

  routineIntervalHours: number;
  defaultRoutineIntervalHours: number;

  agentPerplexityCap: number;
  defaultAgentPerplexityCap: number;

  detailBackfillLimit: number;
  defaultDetailBackfillLimit: number;

  defaultBotBudgetUsdCap: number;
  defaultDefaultBotBudgetUsdCap: number;

  cviEpisodeMinIntervalMinutes: number;
  defaultCviEpisodeMinIntervalMinutes: number;
}

export async function snapshotSystem(): Promise<SystemTuningSnapshot> {
  const [tuning, llmOn] = await Promise.all([getTuning({ fresh: true }), isLlmEnabled()]);
  return {
    llmEnabled: llmOn,
    defaultLlmEnabled: true,

    routineIntervalHours: tuning.routineIntervalHours,
    defaultRoutineIntervalHours: TUNING_DEFAULTS.routineIntervalHours,

    agentPerplexityCap: tuning.agentPerplexityCap,
    defaultAgentPerplexityCap: TUNING_DEFAULTS.agentPerplexityCap,

    detailBackfillLimit: tuning.detailBackfillLimit,
    defaultDetailBackfillLimit: TUNING_DEFAULTS.detailBackfillLimit,

    defaultBotBudgetUsdCap: tuning.defaultBotBudgetUsdCap,
    defaultDefaultBotBudgetUsdCap: TUNING_DEFAULTS.defaultBotBudgetUsdCap,

    cviEpisodeMinIntervalMinutes: tuning.cviEpisodeMinIntervalMinutes,
    defaultCviEpisodeMinIntervalMinutes: TUNING_DEFAULTS.cviEpisodeMinIntervalMinutes,
  };
}

/**
 * Write helpers used by the admin route.
 */

export async function setAgentInterval(shortName: string, intervalSeconds: number): Promise<void> {
  if (!isKnownAgent(shortName)) {
    throw new Error(`Unknown agent: ${shortName}`);
  }
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 30 * DAYS) {
    throw new Error(`intervalSeconds must be an integer between 60 (1 min) and ${30 * DAYS} (30 days)`);
  }
  await db
    .insert(agentSchedulesTable)
    .values({
      agentName: shortName,
      intervalSeconds,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: agentSchedulesTable.agentName,
      set: { intervalSeconds, updatedAt: new Date() },
    });
}

export async function setAgentEnabled(shortName: string, enabled: boolean): Promise<void> {
  if (!isKnownAgent(shortName)) {
    throw new Error(`Unknown agent: ${shortName}`);
  }
  const def = AGENT_BY_NAME.get(shortName)!;
  await db
    .insert(agentSchedulesTable)
    .values({
      agentName: shortName,
      intervalSeconds: def.defaultIntervalSeconds,
      enabled,
    })
    .onConflictDoUpdate({
      target: agentSchedulesTable.agentName,
      set: { enabled, updatedAt: new Date() },
    });
}

/**
 * Reset a single agent (or all agents) back to its catalog defaults.
 * Uses INSERT ... ON CONFLICT so it works regardless of whether the
 * row exists yet.
 */
export async function resetAgentsToDefaults(shortNames?: string[]): Promise<{ reset: string[] }> {
  const targets = shortNames ?? AGENT_DEFAULTS.map((a) => a.shortName);
  const reset: string[] = [];
  for (const name of targets) {
    const def = AGENT_BY_NAME.get(name);
    if (!def) continue;
    await db
      .insert(agentSchedulesTable)
      .values({
        agentName: def.shortName,
        intervalSeconds: def.defaultIntervalSeconds,
        enabled: def.defaultEnabled,
      })
      .onConflictDoUpdate({
        target: agentSchedulesTable.agentName,
        set: {
          intervalSeconds: def.defaultIntervalSeconds,
          enabled: def.defaultEnabled,
          updatedAt: new Date(),
        },
      });
    reset.push(def.shortName);
  }
  return { reset };
}

/**
 * Pause means: set enabled=false on the schedule row, AND clear
 * lastRunAt so that when resumed the agent runs immediately rather
 * than waiting out a stale interval.
 */
export async function pauseAgents(shortNames: string[]): Promise<{ paused: string[] }> {
  const paused: string[] = [];
  for (const name of shortNames) {
    if (!isKnownAgent(name)) continue;
    await db
      .update(agentSchedulesTable)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(agentSchedulesTable.agentName, name));
    paused.push(name);
  }
  return { paused };
}

export async function resumeAgents(shortNames: string[]): Promise<{ resumed: string[] }> {
  const resumed: string[] = [];
  for (const name of shortNames) {
    if (!isKnownAgent(name)) continue;
    const def = AGENT_BY_NAME.get(name)!;
    // Re-enable AND clear lastRunAt so the agent runs on the next tick
    // rather than waiting out a stale interval.
    await db
      .insert(agentSchedulesTable)
      .values({
        agentName: name,
        intervalSeconds: def.defaultIntervalSeconds,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: agentSchedulesTable.agentName,
        set: { enabled: true, lastRunAt: sql`NULL`, updatedAt: new Date() },
      });
    resumed.push(name);
  }
  return { resumed };
}
