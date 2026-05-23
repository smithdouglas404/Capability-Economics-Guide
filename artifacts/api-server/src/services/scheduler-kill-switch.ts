/**
 * Runtime kill switch — DB-backed companion to the SCHEDULERS_DISABLED env var.
 *
 * - SCHEDULERS_DISABLED env var is the boot-time hammer: if it's set, the
 *   scheduler.ts startup logic skips wiring those crons at all.
 * - This DB table is the runtime toggle: each cron's tick callback queries
 *   it (with a 30s in-memory cache) and skips the tick if disabled.
 * - Admin UI writes to this table to toggle without redeploying.
 *
 * Schema:
 *   scheduler_kill_switches (
 *     name        TEXT PRIMARY KEY,   -- cron logical name, e.g. "macroEvent"
 *     disabled    BOOLEAN NOT NULL,
 *     reason      TEXT,               -- admin-supplied note for the audit trail
 *     updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *     updated_by  TEXT                -- admin identifier (kept simple)
 *   )
 *
 * Idempotent CREATE — runs on api-server boot, no migration needed.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const CACHE_TTL_MS = 30_000;

let cache: { disabled: Set<string>; expiresAt: number } | null = null;
let ensurePromise: Promise<void> | null = null;

export async function ensureKillSwitchTable(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS scheduler_kill_switches (
        name        TEXT PRIMARY KEY,
        disabled    BOOLEAN NOT NULL DEFAULT FALSE,
        reason      TEXT,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by  TEXT
      )
    `);
  })();
  return ensurePromise;
}

async function loadDisabledSet(): Promise<Set<string>> {
  await ensureKillSwitchTable();
  const rows = await db.execute(sql<{ name: string }>`
    SELECT name FROM scheduler_kill_switches WHERE disabled = TRUE
  `);
  const out = new Set<string>();
  const raw = (rows as unknown) as { rows?: Array<{ name: string }> } | Array<{ name: string }>;
  const data = Array.isArray(raw) ? raw : (raw.rows ?? []);
  for (const r of data) out.add(r.name);
  return out;
}

export async function isSchedulerDisabledRuntime(name: string): Promise<boolean> {
  if (cache && cache.expiresAt > Date.now()) {
    return cache.disabled.has(name);
  }
  try {
    const disabled = await loadDisabledSet();
    cache = { disabled, expiresAt: Date.now() + CACHE_TTL_MS };
    return disabled.has(name);
  } catch (err) {
    console.warn("[scheduler-kill-switch] read failed (failing open):", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function listKillSwitches(): Promise<Array<{ name: string; disabled: boolean; reason: string | null; updatedAt: Date; updatedBy: string | null }>> {
  await ensureKillSwitchTable();
  const rows = await db.execute(sql`
    SELECT name, disabled, reason, updated_at, updated_by FROM scheduler_kill_switches ORDER BY name
  `);
  const raw = (rows as unknown) as { rows?: Array<{ name: string; disabled: boolean; reason: string | null; updated_at: Date; updated_by: string | null }> } | Array<{ name: string; disabled: boolean; reason: string | null; updated_at: Date; updated_by: string | null }>;
  const data = Array.isArray(raw) ? raw : (raw.rows ?? []);
  return data.map(r => ({ name: r.name, disabled: r.disabled, reason: r.reason, updatedAt: r.updated_at, updatedBy: r.updated_by }));
}

export async function setKillSwitch(name: string, disabled: boolean, reason: string | null = null, updatedBy: string | null = null): Promise<void> {
  await ensureKillSwitchTable();
  await db.execute(sql`
    INSERT INTO scheduler_kill_switches (name, disabled, reason, updated_at, updated_by)
    VALUES (${name}, ${disabled}, ${reason}, NOW(), ${updatedBy})
    ON CONFLICT (name) DO UPDATE
    SET disabled = EXCLUDED.disabled,
        reason = EXCLUDED.reason,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by
  `);
  cache = null;
}

/** Names recognized by the scheduler — surface here so the admin UI can iterate. */
export const KNOWN_SCHEDULER_NAMES = [
  "routine", "watchdog", "rotation", "worldScan", "digest", "scheduledExports",
  "botLoop", "creditExpiry", "peerBenchmarks", "edgarRss", "cviSignals", "autoEnrich",
  "mem0Prune", "macroEvent", "disruption", "peerCoop", "stackOptimizer",
  "ontology", "synthesis", "temporalShift", "memoryRelationSnapshot",
  "featuredCaseStudy",
] as const;
