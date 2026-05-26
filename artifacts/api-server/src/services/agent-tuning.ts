import { db, agentTuningTable, type AgentTuning } from "@workspace/db";
import { eq } from "drizzle-orm";

const DEFAULTS = {
  routineIntervalHours: 96,
  detailBackfillLimit: 15,
  agentPerplexityCap: 6,
  defaultBotBudgetUsdCap: 40,
  cviEpisodeMinIntervalMinutes: 10,
} as const;

const CACHE_TTL_MS = 60_000;

interface Cached {
  value: AgentTuning;
  fetchedAt: number;
}

let cache: Cached | null = null;

function defaultRow(): AgentTuning {
  return {
    id: 1,
    routineIntervalHours: DEFAULTS.routineIntervalHours,
    detailBackfillLimit: DEFAULTS.detailBackfillLimit,
    agentPerplexityCap: DEFAULTS.agentPerplexityCap,
    defaultBotBudgetUsdCap: DEFAULTS.defaultBotBudgetUsdCap,
    cviEpisodeMinIntervalMinutes: DEFAULTS.cviEpisodeMinIntervalMinutes,
    updatedAt: new Date(0),
    updatedBy: null,
  };
}

/**
 * Read the runtime tuning row. Returns defaults if the row doesn't exist
 * yet (first boot before any admin has saved). Cached 60s so consumers in
 * hot paths (scheduler tick, agent decide loop) don't hit the DB on every
 * call. Falls back to defaults on any DB error (including "table does not
 * exist" before drizzle-kit push) so the scheduler keeps running.
 */
export async function getTuning(opts: { fresh?: boolean } = {}): Promise<AgentTuning> {
  if (!opts.fresh && cache && (Date.now() - cache.fetchedAt) < CACHE_TTL_MS) {
    return cache.value;
  }
  try {
    const rows = await db.select().from(agentTuningTable).where(eq(agentTuningTable.id, 1)).limit(1);
    const value: AgentTuning = rows[0] ?? defaultRow();
    cache = { value, fetchedAt: Date.now() };
    return value;
  } catch (err) {
    // Table may not exist yet (drizzle-kit push pending) — degrade to defaults.
    // Cache the fallback so we don't spam the DB with the same failing query.
    const value = defaultRow();
    cache = { value, fetchedAt: Date.now() };
    console.warn("[agent-tuning] getTuning failed, using defaults:", err instanceof Error ? err.message : err);
    return value;
  }
}

export interface TuningPatch {
  routineIntervalHours?: number;
  detailBackfillLimit?: number;
  agentPerplexityCap?: number;
  defaultBotBudgetUsdCap?: number;
  cviEpisodeMinIntervalMinutes?: number;
  updatedBy?: string | null;
}

/**
 * Upsert row 1 with the supplied fields. Validates ranges so admins can't
 * brick the scheduler with a 0-hour interval or burn the budget with a
 * 500-call Perplexity cap.
 */
export async function saveTuning(patch: TuningPatch): Promise<AgentTuning> {
  if (patch.routineIntervalHours != null) {
    if (!(patch.routineIntervalHours >= 0.25 && patch.routineIntervalHours <= 720)) {
      throw new Error("routineIntervalHours must be between 0.25 and 720");
    }
  }
  if (patch.detailBackfillLimit != null) {
    if (!Number.isInteger(patch.detailBackfillLimit) || patch.detailBackfillLimit < 0 || patch.detailBackfillLimit > 500) {
      throw new Error("detailBackfillLimit must be an integer between 0 and 500");
    }
  }
  if (patch.agentPerplexityCap != null) {
    if (!Number.isInteger(patch.agentPerplexityCap) || patch.agentPerplexityCap < 0 || patch.agentPerplexityCap > 100) {
      throw new Error("agentPerplexityCap must be an integer between 0 and 100");
    }
  }
  if (patch.defaultBotBudgetUsdCap != null) {
    if (!(patch.defaultBotBudgetUsdCap >= 0 && patch.defaultBotBudgetUsdCap <= 10000)) {
      throw new Error("defaultBotBudgetUsdCap must be between 0 and 10000 USD");
    }
  }
  if (patch.cviEpisodeMinIntervalMinutes != null) {
    if (!Number.isInteger(patch.cviEpisodeMinIntervalMinutes) || patch.cviEpisodeMinIntervalMinutes < 0 || patch.cviEpisodeMinIntervalMinutes > 10080) {
      throw new Error("cviEpisodeMinIntervalMinutes must be an integer between 0 (no throttle) and 10080 (one week)");
    }
  }

  const existing = await db.select().from(agentTuningTable).where(eq(agentTuningTable.id, 1)).limit(1);
  const next = {
    id: 1,
    routineIntervalHours: patch.routineIntervalHours ?? existing[0]?.routineIntervalHours ?? DEFAULTS.routineIntervalHours,
    detailBackfillLimit: patch.detailBackfillLimit ?? existing[0]?.detailBackfillLimit ?? DEFAULTS.detailBackfillLimit,
    agentPerplexityCap: patch.agentPerplexityCap ?? existing[0]?.agentPerplexityCap ?? DEFAULTS.agentPerplexityCap,
    defaultBotBudgetUsdCap: patch.defaultBotBudgetUsdCap ?? existing[0]?.defaultBotBudgetUsdCap ?? DEFAULTS.defaultBotBudgetUsdCap,
    cviEpisodeMinIntervalMinutes: patch.cviEpisodeMinIntervalMinutes ?? existing[0]?.cviEpisodeMinIntervalMinutes ?? DEFAULTS.cviEpisodeMinIntervalMinutes,
    updatedAt: new Date(),
    updatedBy: patch.updatedBy ?? null,
  };

  if (existing[0]) {
    await db.update(agentTuningTable).set(next).where(eq(agentTuningTable.id, 1));
  } else {
    await db.insert(agentTuningTable).values(next);
  }

  cache = null;
  return next;
}

export function clearTuningCache(): void {
  cache = null;
}

export const TUNING_DEFAULTS = DEFAULTS;
