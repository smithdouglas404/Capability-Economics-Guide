import crypto from "node:crypto";
import { db, apiKeysTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

const KEY_PREFIX = "ce_live_";
const RAW_LENGTH_BYTES = 32; // 32 bytes → 43 chars base64url

export const ALL_V1_SCOPES = [
  "read:industries",
  "read:capabilities",
  "read:cvi",
  "read:macro-events",
  "read:value-chain",
] as const;
export type V1Scope = typeof ALL_V1_SCOPES[number];

/** Generate a new API key. The raw value is returned ONCE; only a hash is stored. */
export function generateApiKey(): { raw: string; prefix: string; hashed: string } {
  const random = crypto.randomBytes(RAW_LENGTH_BYTES).toString("base64url");
  const raw = `${KEY_PREFIX}${random}`;
  const prefix = raw.slice(0, 12); // "ce_live_abCd"
  const hashed = hashApiKey(raw);
  return { raw, prefix, hashed };
}

export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export type ResolvedApiKey = {
  keyId: number;
  userId: string;
  orgId: string | null;
  scopes: string[];
  rateLimitPerMin: number | null;
  monthlyQuota: number | null;
  monthlyUsageCount: number;
  quotaResetAt: Date | null;
};

/**
 * Resolve an incoming Authorization header to the full key row, or null if
 * invalid. Updates lastUsedAt on a successful lookup (best-effort; errors
 * ignored). Quota and rate-limit enforcement live in the v1 middleware so
 * legacy callers via apiKeyAuth still work without metering.
 */
export async function resolveApiKey(authHeader: string | undefined): Promise<ResolvedApiKey | null> {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const raw = match?.[1];
  if (!raw || !raw.startsWith(KEY_PREFIX)) return null;

  const hashed = hashApiKey(raw);
  const [row] = await db
    .select()
    .from(apiKeysTable)
    .where(and(eq(apiKeysTable.hashedKey, hashed), isNull(apiKeysTable.revokedAt)))
    .limit(1);
  if (!row) return null;

  // Best-effort lastUsedAt update.
  db.update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, row.id))
    .catch((err) => logger.warn({ err, keyId: row.id }, "[api-keys] failed to update lastUsedAt"));

  return {
    keyId: row.id,
    userId: row.userId,
    orgId: row.orgId ?? null,
    scopes: (row.scopes as string[] | null) ?? [],
    rateLimitPerMin: row.rateLimitPerMin ?? null,
    monthlyQuota: row.monthlyQuota ?? null,
    monthlyUsageCount: row.monthlyUsageCount ?? 0,
    quotaResetAt: row.quotaResetAt ?? null,
  };
}

/** First day of next UTC month, used as the next quota reset boundary. */
export function nextMonthlyResetAt(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

/**
 * Atomically: reset the monthly counter if the reset boundary has passed,
 * then increment it by 1. Returns the new counter value or null on DB error.
 * Single SQL statement so two concurrent requests can't both reset.
 */
export async function incrementMonthlyUsage(keyId: number): Promise<number | null> {
  try {
    const now = new Date();
    const nextReset = nextMonthlyResetAt(now);
    const result = await db.execute<{ monthly_usage_count: number }>(sql`
      UPDATE api_keys
         SET monthly_usage_count = CASE
               WHEN quota_reset_at IS NULL OR quota_reset_at <= ${now} THEN 1
               ELSE monthly_usage_count + 1
             END,
             quota_reset_at = CASE
               WHEN quota_reset_at IS NULL OR quota_reset_at <= ${now} THEN ${nextReset}
               ELSE quota_reset_at
             END
       WHERE id = ${keyId}
       RETURNING monthly_usage_count
    `);
    // node-postgres returns { rows: [...] }; drizzle's pg-driver type also
    // exposes .rows for raw sql execute results.
    const rows = (result as unknown as { rows?: Array<{ monthly_usage_count: number }> }).rows
      ?? (Array.isArray(result) ? (result as unknown as Array<{ monthly_usage_count: number }>) : []);
    return rows[0]?.monthly_usage_count ?? null;
  } catch (err) {
    logger.warn({ err, keyId }, "[api-keys] incrementMonthlyUsage failed");
    return null;
  }
}
