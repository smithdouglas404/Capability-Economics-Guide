/**
 * Global runtime feature flags — read frequently, written rarely.
 *
 * Backed by lib/db's system_flags table. Cached in-memory with a 30s TTL so
 * we don't hammer Postgres on every LLM call or every cron tick. Cache TTL
 * is short enough that toggling the kill switch from the admin UI takes
 * effect within seconds.
 *
 * Defaults if the row doesn't exist or the DB read fails:
 *   - llm_enabled → true (do NOT silently kill LLMs on a DB blip)
 *   - maintenance_message → generic copy
 *
 * The "fail-open" default matches the project-wide graceful-degrade pattern:
 * the admin must explicitly turn the kill switch ON; we never auto-disable.
 */

import { db, systemFlagsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const CACHE_TTL_MS = 30_000;

type CacheEntry = { value: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();

const DEFAULT_MAINTENANCE_MESSAGE =
  "The application is temporarily under maintenance. Please try again in a few minutes.";

async function readFlag(flagName: string, fallback: string): Promise<string> {
  const cached = cache.get(flagName);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const [row] = await db
      .select()
      .from(systemFlagsTable)
      .where(eq(systemFlagsTable.flagName, flagName))
      .limit(1);
    const value = row?.flagValue ?? fallback;
    cache.set(flagName, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch (err) {
    logger.warn({ err, flagName }, "system_flags read failed — using fallback");
    return fallback;
  }
}

/**
 * Master LLM kill switch. Every LLM caller should check this before firing
 * a request. Returns true unless flag is explicitly set to "false".
 *
 * Defaults to true (fail-open) so a missing table or transient DB failure
 * doesn't silently halt the entire product.
 */
export async function isLlmEnabled(): Promise<boolean> {
  const v = await readFlag("llm_enabled", "true");
  return v !== "false";
}

export async function getMaintenanceMessage(): Promise<string> {
  return await readFlag("maintenance_message", DEFAULT_MAINTENANCE_MESSAGE);
}

/**
 * Force a re-read on the next call. Use after the admin route writes a new
 * value so the change appears immediately instead of waiting for TTL expiry.
 */
export function invalidateFlagCache(flagName?: string): void {
  if (flagName) cache.delete(flagName);
  else cache.clear();
}

/**
 * Setter used by the admin route. Upserts the row and invalidates cache.
 */
export async function setFlag(
  flagName: string,
  flagValue: string,
  updatedBy: string,
  description?: string,
): Promise<void> {
  await db
    .insert(systemFlagsTable)
    .values({
      flagName,
      flagValue,
      description: description ?? null,
      updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: systemFlagsTable.flagName,
      set: {
        flagValue,
        description: description ?? null,
        updatedBy,
        updatedAt: new Date(),
      },
    });
  invalidateFlagCache(flagName);
}
