import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import { systemSecretsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { anchorSecurityViolation } from "./rateLimit";

const adminCache = new Map<string, { isAdmin: boolean; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

export async function isClerkAdmin(userId: string): Promise<boolean> {
  const cached = adminCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.isAdmin;
  let isAdmin = false;
  try {
    const user = await clerkClient.users.getUser(userId);
    const role = (user.publicMetadata as { role?: string } | undefined)?.role;
    isAdmin = role === "admin";
  } catch {
    isAdmin = false;
  }
  adminCache.set(userId, { isAdmin, expiresAt: Date.now() + CACHE_TTL_MS });
  return isAdmin;
}

// In-memory cache of the current admin api key. Refreshed every 60s so a
// rotation propagates to all middleware invocations within at most a minute.
// Rotation invalidates this cache immediately (see invalidateAdminKeyCache).
let keyCache: { value: string | null; expiresAt: number } | null = null;
const KEY_CACHE_TTL_MS = 60_000;

/**
 * Returns the currently-active admin key. Source-of-truth priority:
 *   1. `system_secrets` row keyed `admin_api_key` (DB; rotatable via UI)
 *   2. `process.env.ADMIN_API_KEY` (bootstrap; env var on Railway)
 *
 * The DB row, once populated by the seed or first rotation, takes precedence.
 * The env var stays as a recovery path: if the DB is wiped, the env var key
 * still works.
 */
export async function getCurrentAdminKey(): Promise<string | null> {
  if (keyCache && keyCache.expiresAt > Date.now()) return keyCache.value;
  let dbValue: string | null = null;
  try {
    const [row] = await db.select().from(systemSecretsTable).where(eq(systemSecretsTable.keyName, "admin_api_key"));
    dbValue = row?.keyValue ?? null;
  } catch {
    dbValue = null;
  }
  const value = dbValue ?? process.env.ADMIN_API_KEY ?? null;
  keyCache = { value, expiresAt: Date.now() + KEY_CACHE_TTL_MS };
  return value;
}

/** Force the next call to re-read from DB. Use after a rotation. */
export function invalidateAdminKeyCache(): void {
  keyCache = null;
}

function constantTimeStringEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (process.env.ADMIN_AUTH_BYPASS === "1") { next(); return; }

  try {
    const auth = getAuth(req);
    const userId = auth?.userId;
    if (userId && await isClerkAdmin(userId)) {
      next();
      return;
    }
  } catch {
    // fall through to shared-key check
  }

  // Break-glass: shared admin key (scripts, CI, incident response).
  // Pulls the current value from DB first (so rotation works) and falls
  // back to env var. Constant-time compare against the provided header.
  const expected = await getCurrentAdminKey();
  const provided = req.headers["x-admin-key"];
  if (expected && typeof provided === "string" && constantTimeStringEq(provided, expected)) {
    next();
    return;
  }

  // High-signal security event: someone presented an x-admin-key header
  // that didn't match the current value. Anchor it. (Throttled inside
  // anchorSecurityViolation to one per IP+endpoint+hour.)
  if (typeof provided === "string" && provided.length > 0) {
    const ip = (req.ip ?? req.socket.remoteAddress ?? "unknown").toString();
    const ipHash = createHash("sha256").update(ip).digest("hex");
    void anchorSecurityViolation("admin_auth_failed", {
      bucket: `admin_auth:${ipHash}:${req.method}:${req.path}`,
      ipHash,
      method: req.method,
      path: req.path,
      providedKeyLength: provided.length,
    });
  }

  res.status(401).json({ error: "Unauthorized" });
}
