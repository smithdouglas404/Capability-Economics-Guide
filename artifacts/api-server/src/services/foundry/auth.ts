/**
 * Foundry Token Auth — DB-managed token rotation.
 *
 * Replaces the env-var-only pattern for the Foundry API token. The token
 * is stored in the `system_secrets` table (keyName = "foundry_token") so
 * it can be rotated via the admin UI without a Railway redeploy.
 *
 * RESOLUTION ORDER (getFoundryToken):
 *   1. In-memory cache (valid for CACHE_TTL_MS)
 *   2. system_secrets DB row (keyName = "foundry_token")
 *   3. FOUNDRY_TOKEN / PALANTIR_TOKEN / PALANTIR_FOUNDRY_TOKEN env vars
 *      (legacy fallback — still works if the DB row doesn't exist yet)
 *
 * ROTATION (rotateFoundryToken):
 *   Writes the new token to the DB, appends an audit log entry, and
 *   invalidates the in-memory cache so the next call picks it up.
 */

import { createHash } from "node:crypto";
import { db, systemSecretsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import pino from "pino";

const logger = pino({ name: "foundry-auth" });

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface TokenCache {
  token: string;
  loadedAt: number;
}

let cache: TokenCache | null = null;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function pickEnvToken(): string | null {
  for (const name of ["FOUNDRY_TOKEN", "PALANTIR_TOKEN", "PALANTIR_FOUNDRY_TOKEN"]) {
    const v = process.env[name];
    if (v) return v;
  }
  return null;
}

export function invalidateFoundryTokenCache(): void {
  cache = null;
}

/**
 * Returns the current Foundry token, preferring the DB row over env vars.
 * Returns null if no token is configured anywhere.
 */
export async function getFoundryToken(): Promise<string | null> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) return cache.token;

  try {
    const [row] = await db
      .select()
      .from(systemSecretsTable)
      .where(eq(systemSecretsTable.keyName, "foundry_token"));

    if (row?.keyValue) {
      cache = { token: row.keyValue, loadedAt: now };
      return row.keyValue;
    }
  } catch (err) {
    logger.warn({ err }, "[foundry-auth] DB lookup failed — falling back to env var");
  }

  // Env var fallback
  const envToken = pickEnvToken();
  if (envToken) {
    cache = { token: envToken, loadedAt: now };
    return envToken;
  }

  return null;
}

/**
 * Returns token metadata (without the value) for the health endpoint.
 * The admin panel uses rotatedAt to show "last rotated X minutes ago".
 */
export async function getFoundryTokenMeta(): Promise<{
  source: "db" | "env" | "none";
  rotatedAt: Date | null;
  rotatedByUserId: string | null;
  ageMinutes: number | null;
  notifyEmail: string | null;
} | null> {
  try {
    const [row] = await db
      .select()
      .from(systemSecretsTable)
      .where(eq(systemSecretsTable.keyName, "foundry_token"));

    if (row) {
      const ageMs = Date.now() - row.rotatedAt.getTime();
      return {
        source: "db",
        rotatedAt: row.rotatedAt,
        rotatedByUserId: row.rotatedByUserId,
        ageMinutes: Math.floor(ageMs / 60_000),
        notifyEmail: row.notifyEmail,
      };
    }
  } catch {
    // ignore
  }

  const envToken = pickEnvToken();
  if (envToken) {
    return { source: "env", rotatedAt: null, rotatedByUserId: null, ageMinutes: null, notifyEmail: null };
  }

  return { source: "none", rotatedAt: null, rotatedByUserId: null, ageMinutes: null, notifyEmail: null };
}

/**
 * Rotate the Foundry token — writes to DB, appends audit log, invalidates cache.
 * Called by the admin UI route POST /api/admin/foundry/rotate-token.
 */
export async function rotateFoundryToken(
  newToken: string,
  rotatedByUserId: string | null,
  reason: string | null,
): Promise<void> {
  const previousHash = cache?.token ? sha256Hex(cache.token) : null;

  const auditEntry = {
    rotatedAt: new Date().toISOString(),
    rotatedByUserId,
    source: "manual_admin_ui" as const,
    reason,
    previousValueHash: previousHash,
  };

  const [existing] = await db
    .select()
    .from(systemSecretsTable)
    .where(eq(systemSecretsTable.keyName, "foundry_token"));

  if (existing) {
    await db
      .update(systemSecretsTable)
      .set({
        keyValue: newToken,
        rotatedAt: new Date(),
        rotatedByUserId,
        auditLog: [...(existing.auditLog ?? []), auditEntry],
      })
      .where(eq(systemSecretsTable.keyName, "foundry_token"));
  } else {
    await db.insert(systemSecretsTable).values({
      keyName: "foundry_token",
      keyValue: newToken,
      rotatedAt: new Date(),
      rotatedByUserId,
      auditLog: [auditEntry],
      autoRotateEnabled: false,
      rotationCadenceDays: 0,
      notifyEmail: process.env.ADMIN_NOTIFY_EMAIL ?? null,
    });
  }

  invalidateFoundryTokenCache();
  logger.info({ rotatedByUserId, reason }, "[foundry-auth] Foundry token rotated via admin UI");
}
