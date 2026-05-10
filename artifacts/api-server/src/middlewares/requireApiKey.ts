/**
 * v1 Public Data License auth + metering middleware.
 *
 * Mounted on the `/v1` router (NOT on `/api`) so the developer surface has
 * stable URLs independent of the in-app `/api` namespace. Every request:
 *   1. Requires `Authorization: Bearer ce_live_...` — there is no anonymous
 *      access to the v1 surface.
 *   2. Checks the key has the requested scope (`requireApiKey("read:cei")`).
 *   3. Atomically bumps the per-key monthly usage counter and rejects if the
 *      key has a `monthlyQuota` and is over it.
 *   4. Enforces a per-key sliding-minute rate limit via Redis. Falls back to
 *      the tier default (1500/min) when the key has no override; fails OPEN
 *      if Redis is unavailable.
 *   5. On response finish, appends a row to `api_request_log` for the
 *      developer usage panel. Logs to admin_audit_log only on quota
 *      exhaustion / rate-limit denial to avoid table bloat.
 */
import type { Request, Response, NextFunction } from "express";
import { db, apiRequestLogTable } from "@workspace/db";
import { resolveApiKey, incrementMonthlyUsage, type ResolvedApiKey } from "../services/api-keys";
import { logAdminAction } from "../services/audit-log";
import { getRedis } from "../lib/redis";
import { logger } from "../lib/logger";

const DEFAULT_RATE_LIMIT_PER_MIN = 1500;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKey?: ResolvedApiKey;
    }
  }
}

/**
 * True sliding-window rate limiter via a Redis sorted set:
 *   ZADD on the request, ZREMRANGEBYSCORE to drop entries older than 60s,
 *   ZCARD to count what's left in the window. PEXPIRE keeps the key bounded.
 *
 * Returns the number of requests in the trailing 60s window (this one
 * inclusive), or null if Redis is unavailable so the caller fails open.
 */
async function slidingWindowCount(redis: Awaited<ReturnType<typeof getRedis>>, keyId: number): Promise<number | null> {
  if (!redis) return null;
  const now = Date.now();
  const cutoff = now - 60_000;
  const setKey = `ce:v1rl:sw:${keyId}`;
  const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
  try {
    const multi = redis.multi();
    multi.zRemRangeByScore(setKey, 0, cutoff);
    multi.zAdd(setKey, { score: now, value: member });
    multi.zCard(setKey);
    multi.pExpire(setKey, 90_000);
    const replies = await multi.exec();
    return Number(replies?.[2] ?? 0);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), keyId }, "[v1] sliding window failed");
    return null;
  }
}

export function requireApiKey(scope: string) {
  return async function v1Auth(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startedAt = Date.now();
    const header = req.headers.authorization;

    let resolved: ResolvedApiKey | null = null;
    try {
      resolved = await resolveApiKey(header);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[v1] resolveApiKey failed");
    }

    if (!resolved) {
      res.status(401).json({
        error: "unauthorized",
        message: "Provide an API key via 'Authorization: Bearer ce_live_...'. Issue one at /developers.",
      });
      return;
    }

    if (!resolved.scopes.includes(scope)) {
      res.status(403).json({
        error: "insufficient_scope",
        requiredScope: scope,
        message: `This endpoint requires the ${scope} scope. Re-issue the key with the required scope.`,
      });
      return;
    }

    // Per-key sliding-window rate limit (60s trailing window).
    const limit = resolved.rateLimitPerMin ?? DEFAULT_RATE_LIMIT_PER_MIN;
    const redis = await getRedis();
    res.setHeader("X-RateLimit-Limit", String(limit));
    const used = await slidingWindowCount(redis, resolved.keyId);
    if (used != null) {
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, limit - used)));
      if (used > limit) {
        res.setHeader("Retry-After", "60");
        void logAdminAction(req, {
          action: "data_api.rate_limited",
          targetType: "api_key",
          targetId: resolved.keyId,
          details: { limitPerMin: limit, used, path: req.originalUrl },
        });
        res.status(429).json({
          error: "rate_limited",
          limitPerMin: limit,
          retryAfterSec: 60,
        });
        return;
      }
    }

    // Quota: atomic increment then compare. If the key has a quota and the
    // increment fails, fail-CLOSED — we cannot honour the contract otherwise.
    const newUsage = await incrementMonthlyUsage(resolved.keyId);
    if (newUsage == null && resolved.monthlyQuota != null) {
      logger.warn({ keyId: resolved.keyId }, "[v1] quota increment failed for quota-bound key — failing closed");
      res.status(503).json({
        error: "quota_check_unavailable",
        message: "Could not verify monthly quota. Please retry shortly.",
      });
      return;
    }
    if (newUsage != null) {
      resolved.monthlyUsageCount = newUsage;
      if (resolved.monthlyQuota != null) {
        res.setHeader("X-Quota-Limit", String(resolved.monthlyQuota));
        res.setHeader("X-Quota-Used", String(newUsage));
        res.setHeader("X-Quota-Remaining", String(Math.max(0, resolved.monthlyQuota - newUsage)));
        if (newUsage > resolved.monthlyQuota) {
          void logAdminAction(req, {
            action: "data_api.quota_exhausted",
            targetType: "api_key",
            targetId: resolved.keyId,
            details: { quota: resolved.monthlyQuota, used: newUsage, path: req.originalUrl },
          });
          res.status(429).json({
            error: "quota_exhausted",
            monthlyQuota: resolved.monthlyQuota,
            used: newUsage,
            message: "Monthly request quota for this API key has been exhausted. Upgrade or wait for the next UTC month.",
          });
          return;
        }
      }
    }

    req.apiKey = resolved;

    // Log on response finish so we capture the final status code.
    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      // Best-effort — never block the request.
      db.insert(apiRequestLogTable).values({
        keyId: resolved!.keyId,
        method: req.method,
        path: req.originalUrl.split("?")[0]!.slice(0, 500),
        statusCode: res.statusCode,
        durationMs,
      }).catch((err) => logger.warn({ err, keyId: resolved!.keyId }, "[v1] failed to write api_request_log"));
    });

    next();
  };
}
