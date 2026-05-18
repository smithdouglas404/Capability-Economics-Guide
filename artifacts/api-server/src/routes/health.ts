import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getCachedSchemaStatus, verifySchema } from "../lib/schema-check";
import { getAllServiceHealth } from "../services/health/probes";

const router: IRouter = Router();

/**
 * Aggregated upstream service health — Mem0, Letta, OpenRouter, Anthropic,
 * Perplexity, Foundry, Stripe, Clerk. Cached 60s per service; never blocks
 * page load. Drives the dismissible degraded-mode banner and `/system-status`
 * detail page on the frontend.
 */
router.get("/health/services", async (_req, res) => {
  try {
    const result = await getAllServiceHealth();
    res.json(result);
  } catch (err) {
    res.status(500).json({
      overall: "down",
      services: [],
      generatedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Schema diagnostic — reports whether every load-bearing table exists. Runs
 * a fresh check if no boot-time result is cached. Used by the admin
 * Enrichment Health panel and by anyone debugging "why isn't this working?"
 * when a feature silently degrades.
 */
/**
 * Redis connection probe — reports whether the Redis client used by
 * requireApiKey (sliding-window rate limit) and rateLimit middleware
 * is reachable. Called by the admin enrichment panel and any debugging
 * around 503 "quota_check_unavailable" responses on the v1 surface.
 * Restored after the BullMQ removal (commit f84dfb7) left the frontend
 * call to /api/healthz/redis dangling without a backing route.
 */
router.get("/healthz/redis", async (_req, res) => {
  const { getRedis } = await import("../lib/redis");
  const configured = !!(process.env.REDIS_URL || process.env.REDIS_HOST);
  try {
    const redis = await getRedis();
    if (!redis) { res.json({ configured, connected: false }); return; }
    const pong = await redis.ping();
    res.json({ configured: true, connected: pong === "PONG" });
  } catch (err) {
    res.json({ configured, connected: false, error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/healthz/schema", async (_req, res) => {
  const cached = getCachedSchemaStatus();
  if (cached) { res.json(cached); return; }
  try {
    const status = await verifySchema();
    res.json(status);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
