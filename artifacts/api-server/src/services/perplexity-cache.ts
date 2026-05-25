import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { perplexityCacheTable } from "@workspace/db";
import { eq, gt, sql } from "drizzle-orm";

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

const DEFAULT_TTL_HOURS = envInt("PERPLEXITY_CACHE_TTL_HOURS", 24, 1);

function isDisabled(): boolean {
  return process.env["PERPLEXITY_CACHE_DISABLED"] === "1";
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
): Promise<void> {
  if (isDisabled()) return;
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
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
