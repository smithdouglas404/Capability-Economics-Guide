/**
 * Runtime-configurable agent schedule gating.
 *
 * Each Inngest agent cron calls `shouldRunAgent(name)` at the top of its
 * handler. The function reads the `agent_schedules` row for that agent,
 * compares `lastRunAt` to the configured `intervalSeconds`, and decides
 * whether to proceed. The static Inngest cron expression in `agents.ts`
 * becomes a "max-allowed cadence" — the schedule row is the actual
 * cadence, tunable from the admin UI without a redeploy.
 *
 * Default rows are seeded by `scripts/src/seed-agent-schedules.ts` (run
 * once per environment; idempotent on re-run).
 *
 * Failure mode: if the row doesn't exist (un-seeded) or the DB read
 * throws, we DEFAULT TO RUNNING. The agent has its own cron throttle as a
 * defense-in-depth backstop. Refusing-to-run on a transient DB blip would
 * be a bigger product problem than one extra cycle.
 */

import { db, agentSchedulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger";

export type ShouldRunResult =
  | { run: true; reason?: string }
  | { run: false; reason: string };

/**
 * Gate-and-claim: if the agent should run, atomically updates `lastRunAt`
 * BEFORE returning so a concurrent cron tick can't double-fire. The agent
 * doesn't need to write lastRunAt itself.
 */
export async function shouldRunAgent(agentName: string): Promise<ShouldRunResult> {
  try {
    const [row] = await db
      .select()
      .from(agentSchedulesTable)
      .where(eq(agentSchedulesTable.agentName, agentName))
      .limit(1);

    if (!row) {
      // No schedule row → fall through to running. Operator hasn't
      // configured anything for this agent; static cron is the only gate.
      logger.warn({ agentName }, "agent_schedules row missing — running unguarded");
      return { run: true, reason: "no-schedule-row" };
    }

    if (!row.enabled) {
      return { run: false, reason: "disabled" };
    }

    if (row.lastRunAt) {
      const elapsedMs = Date.now() - row.lastRunAt.getTime();
      const elapsedSeconds = Math.floor(elapsedMs / 1000);
      if (elapsedSeconds < row.intervalSeconds) {
        return {
          run: false,
          reason: `interval-not-elapsed (${elapsedSeconds}s elapsed < ${row.intervalSeconds}s required)`,
        };
      }
    }

    // Atomically claim this run by stamping lastRunAt. If a concurrent cron
    // ticked between the SELECT above and this UPDATE, both would set
    // lastRunAt close together — Inngest's per-function concurrency limit
    // (1 by default in agents.ts) prevents both from actually proceeding.
    await db
      .update(agentSchedulesTable)
      .set({ lastRunAt: new Date() })
      .where(eq(agentSchedulesTable.agentName, agentName));

    return { run: true };
  } catch (err) {
    logger.error({ err, agentName }, "shouldRunAgent failed — running unguarded");
    return { run: true, reason: "db-error-fallback" };
  }
}

/**
 * Friendly cost estimate for the admin UI. Per-cycle costs are rough
 * order-of-magnitude — they aren't read by anything load-bearing.
 */
export const PER_CYCLE_COST_USD: Record<string, number> = {
  "cvi-agent": 0.15,                // 9-phase pipeline + content gen
  "macro-event-agent": 0.03,
  "disruption-agent": 0.05,
  "peer-coop-agent": 0.02,
  "stack-optimizer-agent": 0.05,
  "ontology-agent": 0.04,
  "synthesis-agent": 0.04,
  "disruption-vector-agent": 0.56,  // Sonnet-class, 8 caps × scoring
};

export function estimateMonthlyCost(agentName: string, intervalSeconds: number): number {
  const perCycle = PER_CYCLE_COST_USD[agentName] ?? 0.05;
  const cyclesPerMonth = (30 * 24 * 60 * 60) / intervalSeconds;
  return perCycle * cyclesPerMonth;
}
