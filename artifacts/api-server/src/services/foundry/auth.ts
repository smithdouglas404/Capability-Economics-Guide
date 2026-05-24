/**
 * Foundry Token Auth — DB-managed token rotation + OAuth fallback.
 *
 * Token is stored in `system_secrets` (keyName = "foundry_token") so it can
 * be rotated via the admin UI without a Railway redeploy.
 *
 * RESOLUTION ORDER (getFoundryToken):
 *   1. In-memory cache (valid for CACHE_TTL_MS)
 *   2. system_secrets DB row (keyName = "foundry_token") — if minted via
 *      OAuth and < OAUTH_TOKEN_TTL_MS old, OR manually rotated (any age)
 *   3. FOUNDRY_TOKEN / PALANTIR_TOKEN / PALANTIR_FOUNDRY_TOKEN env vars
 *      (legacy fallback)
 *   4. OAuth client-credentials mint via FOUNDRY_CLIENT_ID +
 *      FOUNDRY_CLIENT_SECRET against {FOUNDRY_BASE_URL}/multipass/api/oauth2/token
 *      Minted token is cached to system_secrets so the admin UI's token-meta
 *      endpoint can surface "source: oauth_client_credentials, age: Xm" and
 *      the 30-min expiry cron can flag refresh failures.
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
// Palantir Foundry OAuth2 client-credentials tokens default to 1h TTL.
// Re-mint at 50 min to give a 10-min safety margin.
const OAUTH_TOKEN_TTL_MS = 50 * 60 * 1000;

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
 * OAuth client-credentials token minter for Palantir Foundry.
 *
 * Endpoint pattern (verified from Palantir docs):
 *   POST {FOUNDRY_BASE_URL}/multipass/api/oauth2/token
 *   Content-Type: application/x-www-form-urlencoded
 *   Body: grant_type=client_credentials&client_id=<id>&client_secret=<secret>
 *   Response: { access_token, token_type: "Bearer", expires_in: <seconds> }
 *
 * Requires FOUNDRY_BASE_URL + FOUNDRY_CLIENT_ID + FOUNDRY_CLIENT_SECRET on
 * the api-server env. Returns null on any failure (URL missing, creds
 * missing, network error, non-2xx response). Callers fall back to env-var
 * token if mint fails.
 */
async function mintFoundryTokenViaOAuth(): Promise<{ token: string; expiresIn: number } | null> {
  const baseUrl = (
    process.env.FOUNDRY_BASE_URL ??
    process.env.PALANTIR_URL ??
    process.env.PALANTIR_BASE_URL ??
    process.env.FOUNDRY_URL ??
    ""
  ).replace(/\/$/, "");
  const clientId = process.env.FOUNDRY_CLIENT_ID ?? process.env.PALANTIR_CLIENT_ID;
  const clientSecret = process.env.FOUNDRY_CLIENT_SECRET ?? process.env.PALANTIR_CLIENT_SECRET;
  if (!baseUrl) {
    logger.warn("[foundry-auth] OAuth mint skipped — FOUNDRY_BASE_URL not set");
    return null;
  }
  if (!clientId || !clientSecret) {
    logger.warn("[foundry-auth] OAuth mint skipped — FOUNDRY_CLIENT_ID / FOUNDRY_CLIENT_SECRET not set");
    return null;
  }
  try {
    const res = await fetch(`${baseUrl}/multipass/api/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      logger.warn({ status: res.status, body: text.slice(0, 240) }, "[foundry-auth] OAuth mint failed");
      return null;
    }
    const json = await res.json() as { access_token?: string; expires_in?: number };
    if (!json.access_token) {
      logger.warn({ json }, "[foundry-auth] OAuth response missing access_token");
      return null;
    }
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
    logger.info({ expiresIn }, "[foundry-auth] OAuth token minted via client_credentials");
    return { token: json.access_token, expiresIn };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[foundry-auth] OAuth mint threw");
    return null;
  }
}

/**
 * Persist an OAuth-minted token to system_secrets so the rotation tracker
 * can see it. Tagged with source="oauth_client_credentials" in the audit
 * log so subsequent calls know it's auto-minted (and re-mintable on expiry).
 */
// system_secrets.auditLog.source is a strict union ("bootstrap" |
// "manual_admin_ui" | "scheduled_auto" | "api_call") — OAuth mints use
// "scheduled_auto" (closest semantic match) and tag the OAuth-ness via a
// reason-prefix that downstream code matches on.
const OAUTH_MINT_REASON_PREFIX = "OAuth client_credentials mint";
async function persistMintedToken(token: string, expiresIn: number): Promise<void> {
  const auditEntry = {
    rotatedAt: new Date().toISOString(),
    rotatedByUserId: null,
    source: "scheduled_auto" as const,
    reason: `${OAUTH_MINT_REASON_PREFIX} (expires_in=${expiresIn}s)`,
    previousValueHash: null,
  };
  try {
    const [existing] = await db
      .select()
      .from(systemSecretsTable)
      .where(eq(systemSecretsTable.keyName, "foundry_token"));
    if (existing) {
      await db
        .update(systemSecretsTable)
        .set({
          keyValue: token,
          rotatedAt: new Date(),
          rotatedByUserId: null,
          auditLog: [...(existing.auditLog ?? []), auditEntry],
        })
        .where(eq(systemSecretsTable.keyName, "foundry_token"));
    } else {
      await db.insert(systemSecretsTable).values({
        keyName: "foundry_token",
        keyValue: token,
        rotatedAt: new Date(),
        rotatedByUserId: null,
        auditLog: [auditEntry],
        autoRotateEnabled: true,
        rotationCadenceDays: 0,
        notifyEmail: process.env.ADMIN_NOTIFY_EMAIL ?? null,
      });
    }
    // Emit `system.secret.expiring` so the Inngest function
    // `foundryTokenExpiryAlert` can step.sleepUntil(expiresAt - 30min) and
    // email the operator. Lazy-import to avoid pulling the inngest client
    // into the auth module's static graph (this file is hot on every API
    // call via getFoundryToken — keep the cold dep behind a runtime branch).
    if (expiresIn > 0) {
      try {
        const { inngest } = await import("../../inngest/client");
        const expiresAt = new Date(Date.now() + expiresIn * 1000);
        inngest.send({
          name: "system.secret.expiring",
          data: { secretName: "foundry", expiresAt: expiresAt.toISOString() },
        }).catch(err => {
          logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[foundry-auth] inngest.send(system.secret.expiring) failed (non-fatal)");
        });
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[foundry-auth] failed to import inngest client for expiry event");
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[foundry-auth] Failed to persist minted token (continuing with in-memory only)");
  }
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
      // Was this token minted via OAuth client_credentials? If so, check age
      // against OAUTH_TOKEN_TTL_MS and re-mint if stale. Manually-rotated
      // tokens (admin UI) are trusted at any age — the operator owns rotation.
      const lastAudit = (row.auditLog ?? [])[row.auditLog?.length ? row.auditLog.length - 1 : -1];
      const isOauthMinted = typeof (lastAudit as { reason?: string } | undefined)?.reason === "string"
        && (lastAudit as { reason: string }).reason.startsWith(OAUTH_MINT_REASON_PREFIX);
      const ageMs = now - row.rotatedAt.getTime();
      if (!isOauthMinted || ageMs < OAUTH_TOKEN_TTL_MS) {
        cache = { token: row.keyValue, loadedAt: now };
        return row.keyValue;
      }
      // Else: OAuth token is stale, fall through to re-mint below.
      logger.info({ ageMinutes: Math.round(ageMs / 60_000) }, "[foundry-auth] OAuth token stale — re-minting");
    }
  } catch (err) {
    logger.warn({ err }, "[foundry-auth] DB lookup failed — falling back to env var / OAuth mint");
  }

  // Env var fallback (legacy / break-glass)
  const envToken = pickEnvToken();
  if (envToken) {
    cache = { token: envToken, loadedAt: now };
    return envToken;
  }

  // OAuth client-credentials mint (last resort). Persists to DB so the
  // admin UI's token-meta endpoint surfaces the new token's source + age.
  const minted = await mintFoundryTokenViaOAuth();
  if (minted) {
    await persistMintedToken(minted.token, minted.expiresIn);
    cache = { token: minted.token, loadedAt: now };
    return minted.token;
  }

  return null;
}

/**
 * Returns token metadata (without the value) for the health endpoint.
 * The admin panel uses rotatedAt to show "last rotated X minutes ago".
 */
export async function getFoundryTokenMeta(): Promise<{
  source: "db" | "oauth_minted" | "env" | "none";
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
      const lastAudit = (row.auditLog ?? [])[row.auditLog?.length ? row.auditLog.length - 1 : -1];
      const reason = (lastAudit as { reason?: string } | undefined)?.reason ?? "";
      const source = reason.startsWith(OAUTH_MINT_REASON_PREFIX)
        ? "oauth_minted" as const
        : "db" as const;
      return {
        source,
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
