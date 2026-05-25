import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { perplexityCacheTable, systemFlagsTable } from "@workspace/db";
import { eq, gt, sql, inArray } from "drizzle-orm";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface CachedResponse {
  choices: Array<{ message: { content: string } }>;
  citations?: string[];
}

function envInt(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, parsed);
}

const DEFAULT_TTL_HOURS = envInt("PERPLEXITY_CACHE_TTL_HOURS", 168, 1);

function isDisabled(): boolean {
  return process.env["PERPLEXITY_CACHE_DISABLED"] === "1";
}

/**
 * Per-endpoint TTL override system. Reads `system_flags.ppx_cache_ttl_<key>`
 * where `<key>` is the endpoint tag (e.g. "case-studies.generate", or the
 * prefix-only "csuite_perspective" for grouped families).
 *
 * Resolution order (first hit wins):
 *   1. system_flags['ppx_cache_ttl_<exact_endpoint>']     — admin per-endpoint
 *   2. system_flags['ppx_cache_ttl_<prefix-before-colon>'] — admin per-family
 *   3. system_flags['ppx_cache_ttl_default']               — admin global
 *   4. per-call `ttlHoursHint` from the callsite
 *   5. PERPLEXITY_CACHE_TTL_HOURS env var (default 168)
 *
 * Cached in-process for 30s to avoid hammering system_flags on every cache write.
 */
interface TtlCacheEntry { value: number; loadedAt: number }
const TTL_LOOKUP_CACHE = new Map<string, TtlCacheEntry>();
const TTL_LOOKUP_TTL_MS = 30_000;

async function resolveTtlHours(endpointKey: string | undefined, ttlHoursHint: number): Promise<number> {
  if (!endpointKey) return ttlHoursHint;
  const cached = TTL_LOOKUP_CACHE.get(endpointKey);
  if (cached && Date.now() - cached.loadedAt < TTL_LOOKUP_TTL_MS) return cached.value;

  const familyKey = endpointKey.split(":")[0];
  const lookupKeys = [
    `ppx_cache_ttl_${endpointKey}`,
    `ppx_cache_ttl_${familyKey}`,
    "ppx_cache_ttl_default",
  ];
  try {
    const rows = await db
      .select({ name: systemFlagsTable.flagName, value: systemFlagsTable.flagValue })
      .from(systemFlagsTable)
      .where(inArray(systemFlagsTable.flagName, lookupKeys));
    const byName = new Map(rows.map((r) => [r.name, r.value]));
    let resolved = ttlHoursHint;
    for (const k of lookupKeys) {
      const raw = byName.get(k);
      if (raw !== undefined) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n > 0) { resolved = n; break; }
      }
    }
    TTL_LOOKUP_CACHE.set(endpointKey, { value: resolved, loadedAt: Date.now() });
    return resolved;
  } catch {
    return ttlHoursHint;
  }
}

/** Invalidate the in-process TTL lookup cache (called from admin API after a save). */
export function invalidateTtlLookupCache(): void {
  TTL_LOOKUP_CACHE.clear();
}

export function hashRequest(model: string, messages: ChatMessage[]): string {
  const canonical = JSON.stringify({
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Returns the cached response for `key` if it exists and hasn't expired.
 * Increments `hit_count` and updates `last_hit_at` on hit.
 *
 * Returns null on miss, on disabled, or on any DB error (cache failures
 * never escalate — the live call will run instead).
 */
export async function lookupCache(key: string): Promise<CachedResponse | null> {
  if (isDisabled()) return null;
  try {
    const [row] = await db
      .select()
      .from(perplexityCacheTable)
      .where(eq(perplexityCacheTable.key, key))
      .limit(1);
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    // Fire-and-forget hit accounting; don't await — keeps the hot path fast.
    void db
      .update(perplexityCacheTable)
      .set({
        hitCount: sql`${perplexityCacheTable.hitCount} + 1`,
        lastHitAt: new Date(),
      })
      .where(eq(perplexityCacheTable.key, key))
      .catch(() => undefined);
    return row.response as CachedResponse;
  } catch {
    return null;
  }
}

/**
 * Stores a response under `key` with a TTL of PERPLEXITY_CACHE_TTL_HOURS.
 * Idempotent via ON CONFLICT DO UPDATE — re-runs with the same key extend
 * the expiry. Never throws — cache failures are non-fatal.
 */
export async function writeCache(
  key: string,
  model: string,
  response: CachedResponse,
  ttlHours: number = DEFAULT_TTL_HOURS,
  endpointKey?: string,
): Promise<void> {
  if (isDisabled()) return;
  try {
    const effectiveTtl = await resolveTtlHours(endpointKey, ttlHours);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + effectiveTtl * 60 * 60 * 1000);
    await db
      .insert(perplexityCacheTable)
      .values({
        key,
        model,
        response: response as unknown as Record<string, unknown>,
        createdAt: now,
        expiresAt,
        hitCount: 0,
      })
      .onConflictDoUpdate({
        target: perplexityCacheTable.key,
        set: {
          response: response as unknown as Record<string, unknown>,
          model,
          createdAt: now,
          expiresAt,
        },
      });
  } catch {
    // Cache write failures are silent — the response was returned to the
    // caller already; missing a cache write only costs one more LLM call.
  }
}

/**
 * Deletes expired rows. Safe to call from a low-frequency cron; not
 * required for correctness (lookupCache also enforces expiry at read time).
 */
export async function sweepExpired(): Promise<number> {
  if (isDisabled()) return 0;
  try {
    const result = await db
      .delete(perplexityCacheTable)
      .where(gt(sql`NOW()`, perplexityCacheTable.expiresAt));
    return (result as { rowCount?: number }).rowCount ?? 0;
  } catch {
    return 0;
  }
}
