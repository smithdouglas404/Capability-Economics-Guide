import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { isRedisConfigured, getRedis } from "../services/alpha/redis";
import { getCachedSchemaStatus, verifySchema } from "../lib/schema-check";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Redis diagnostic — reports whether REDIS_URL is set AND whether a live
 * PING succeeds. Useful for confirming the running container actually sees
 * the Redis env var after a Railway config change.
 */
router.get("/healthz/redis", async (_req, res) => {
  const configured = isRedisConfigured();
  if (!configured) {
    res.json({ configured: false, connected: false, error: "REDIS_URL not set" });
    return;
  }
  try {
    const client = getRedis();
    const result = await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ping timeout")), 3000)),
    ]);
    res.json({ configured: true, connected: result === "PONG" });
  } catch (err) {
    res.json({ configured: true, connected: false, error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Schema diagnostic — reports whether every load-bearing table exists. Runs
 * a fresh check if no boot-time result is cached. Used by the admin
 * Enrichment Health panel and by anyone debugging "why isn't this working?"
 * when a feature silently degrades.
 */
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
