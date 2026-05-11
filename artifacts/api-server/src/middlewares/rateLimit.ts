/**
 * Per-tenant API rate limiting.
 *
 * Why: a single noisy customer (or an abusive script) hammering /api can
 * starve every other tenant of throughput. We bucket requests per
 * *tenant identity* and enforce a per-minute ceiling that scales with
 * subscription tier.
 *
 * Tenant identity (in priority order):
 *   1. Clerk userId (authenticated humans + API keys, both populate
 *      req.auth.userId via apiKeyAuth)
 *   2. sessionToken from query/body/header (anonymous sandbox users)
 *   3. Client IP (last-resort bucket; shared across NAT but better than
 *      a global pool that one IP could exhaust)
 *
 * Tier ceilings are intentionally conservative — high enough that a
 * normal interactive UI never trips them, low enough that a runaway
 * script gets a friendly 429 in seconds rather than minutes.
 *
 * Backend: Redis sliding-minute counter (`INCR` + `EXPIRE`). When Redis
 * is unavailable we fail OPEN — better to serve traffic than break the
 * product, and the underlying app server still has its own protections.
 *
 * Skip list: health checks and webhooks (which have their own rate
 * shaping at the provider) bypass the limiter so internal probes and
 * Stripe/Didit retries are never throttled.
 */

import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, userMembershipsTable, membershipTiersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getRedis } from "../lib/redis";
import { resolveSessionToken } from "../lib/tenant-scope";
import { logger } from "../lib/logger";

const TIER_LIMITS_PER_MIN: Record<string, number> = {
  anonymous: 60,
  discovery: 120,
  briefing: 600,
  console: 1500,
  ledger: 1500,
  workbench: 1500,
  platform: 6000,
  admin: 100000, // operators bypass for all practical purposes
};

// IMPORTANT: this middleware is mounted at `/api`, which in Express 5
// strips the mount prefix from `req.path` (so `/api/healthz` becomes
// `/healthz` inside this middleware). Always match against `req.originalUrl`
// so the prefixes below are unambiguous and match the actual URL.
const SKIP_PREFIXES = [
  "/api/healthz",
  "/api/health",
  "/api/stripe-webhook",
  "/api/kyc-webhook",
  "/api/nowpayments-webhook",
];

const tierCache = new Map<string, { tier: string; expires: number }>();
const TIER_TTL_MS = 60_000;

async function tierForUser(userId: string): Promise<string> {
  const cached = tierCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.tier;
  try {
    const [row] = await db.select({ slug: membershipTiersTable.slug })
      .from(userMembershipsTable)
      .innerJoin(membershipTiersTable, eq(membershipTiersTable.id, userMembershipsTable.tierId))
      .where(and(
        eq(userMembershipsTable.userId, userId),
        eq(userMembershipsTable.status, "active"),
      ))
      .orderBy(desc(userMembershipsTable.requestedAt))
      .limit(1);
    const tier = row?.slug ?? "discovery";
    tierCache.set(userId, { tier, expires: Date.now() + TIER_TTL_MS });
    return tier;
  } catch {
    return "discovery";
  }
}

interface BucketIdentity {
  bucket: string;     // redis key suffix
  tenantId: string;   // for logging / admin volume
  tenantKind: "user" | "session" | "ip";
  tier: string;
}

async function identify(req: Request): Promise<BucketIdentity> {
  // Admin bypass for local dev mirrors requireTier semantics.
  if (process.env.ADMIN_AUTH_BYPASS === "1") {
    return { bucket: "admin:dev-admin", tenantId: "dev-admin", tenantKind: "user", tier: "admin" };
  }

  const auth = (() => { try { return getAuth(req); } catch { return null; } })();
  const userId = auth?.userId;
  const session = resolveSessionToken(req as unknown as Parameters<typeof resolveSessionToken>[0]);

  if (userId) {
    const tier = await tierForUser(userId);
    // When the caller passes BOTH a Clerk identity AND a sessionToken (e.g.
    // logged-in user poking at a public sandbox), bucket on the composite so
    // a high-tier user can't lend their per-minute quota to an anonymous
    // session and circumvent its 60/min ceiling.
    if (session) {
      return {
        bucket: `user:${userId}|session:${session}`,
        tenantId: `${userId}|${session}`,
        tenantKind: "user",
        tier,
      };
    }
    return { bucket: `user:${userId}`, tenantId: userId, tenantKind: "user", tier };
  }

  if (session) {
    return { bucket: `session:${session}`, tenantId: session, tenantKind: "session", tier: "anonymous" };
  }

  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  const ip = fwd || req.socket.remoteAddress || "unknown";
  return { bucket: `ip:${ip}`, tenantId: ip, tenantKind: "ip", tier: "anonymous" };
}

function shouldSkip(originalUrl: string): boolean {
  const pathname = originalUrl.split("?")[0] ?? originalUrl;
  return SKIP_PREFIXES.some(p => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Returns the current minute window (UTC) used as part of the redis key
 * so each minute gets its own counter that auto-expires.
 */
function currentMinute(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function currentDay(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

export const VOLUME_24H_KEY_PREFIX = "ce:apivol:";

/**
 * Anchor a security violation to Hedera. Throttled so a misbehaving client
 * doesn't blow up the chain — at most one anchor per (eventType + bucket
 * key) per hour. The bucket key is whatever identifier you pass in `context`
 * (typically rate-limit bucket id or IP hash).
 */
const securityAnchorThrottle = new Map<string, number>();
const SECURITY_ANCHOR_THROTTLE_MS = 60 * 60 * 1000;

export async function anchorSecurityViolation(
  reason: string,
  context: Record<string, string | number | boolean | null>,
): Promise<void> {
  const key = `${reason}:${context.bucket ?? context.ipHash ?? "unknown"}`;
  const last = securityAnchorThrottle.get(key) ?? 0;
  if (Date.now() - last < SECURITY_ANCHOR_THROTTLE_MS) return;
  securityAnchorThrottle.set(key, Date.now());
  try {
    const { anchorEvent, canonicalHash } = await import("../services/blockchain-audit");
    await anchorEvent("security_violation", {
      contextHash: canonicalHash({ reason, ...context, ts: new Date().toISOString() }),
      contextSnapshot: { reason, ...context },
    });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), reason }, "[rateLimit] anchor failed (non-fatal)");
  }
}

export function rateLimitMiddleware() {
  return async function rateLimit(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (shouldSkip(req.originalUrl)) { next(); return; }

    let id: BucketIdentity;
    try {
      id = await identify(req);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[rateLimit] identify failed");
      next();
      return;
    }

    const limit = TIER_LIMITS_PER_MIN[id.tier] ?? TIER_LIMITS_PER_MIN.anonymous;

    const redis = await getRedis();
    if (!redis) {
      // Fail open: surface the would-be bucket via response header so it's
      // visible during ops debugging but don't block the request.
      res.setHeader("X-RateLimit-Bucket", id.bucket);
      res.setHeader("X-RateLimit-Limit", String(limit));
      next();
      return;
    }

    const minute = currentMinute();
    const day = currentDay();
    const counterKey = `ce:rl:${id.bucket}:${minute}`;
    const volumeKey = `${VOLUME_24H_KEY_PREFIX}${day}:${id.tenantKind}:${id.tenantId}`;

    let used = 0;
    try {
      const multi = redis.multi();
      multi.incr(counterKey);
      multi.expire(counterKey, 90);     // a bit longer than the window so late requests still count
      multi.incr(volumeKey);
      multi.expire(volumeKey, 60 * 60 * 25); // ~25h so a full 24h read window always sees today's bucket
      const replies = await multi.exec();
      used = Number(replies?.[0] ?? 0);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[rateLimit] redis op failed — failing open");
      next();
      return;
    }

    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - used)));
    res.setHeader("X-RateLimit-Bucket", id.bucket);

    if (used > limit) {
      // Seconds until the current minute window rolls over.
      const retryAfter = 60 - new Date().getUTCSeconds();
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: "Rate limit exceeded",
        tier: id.tier,
        limitPerMin: limit,
        retryAfterSec: retryAfter,
      });
      // Anchor this as a security incident. Throttled: at most one anchor per
      // (bucket, hour) — see anchorSecurityViolation for the throttle.
      void anchorSecurityViolation("rate_limit_exceeded", {
        bucket: id.bucket,
        tier: id.tier,
        path: req.originalUrl,
        usedThisMinute: used,
        limitPerMin: limit,
      });
      return;
    }

    next();
  };
}
