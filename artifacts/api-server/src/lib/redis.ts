/**
 * Lazy Redis singleton used by the rate limiter and per-tenant volume
 * counters. Returns `null` whenever REDIS_URL is unset OR the client fails
 * to connect — callers MUST handle that case (typically: fail open, allow
 * the request). This keeps local dev unblocked when Redis isn't configured.
 */
import { createClient, type RedisClientType } from "redis";
import { logger } from "./logger";

let clientPromise: Promise<RedisClientType | null> | null = null;

export function getRedis(): Promise<RedisClientType | null> {
  if (clientPromise) return clientPromise;

  const url = process.env.REDIS_URL;
  if (!url) {
    clientPromise = Promise.resolve(null);
    return clientPromise;
  }

  clientPromise = (async () => {
    try {
      const c = createClient({ url }) as RedisClientType;
      c.on("error", (err) => {
        // Don't spam logs on every reconnect attempt — log once per minute.
        logger.warn({ err: err?.message ?? String(err) }, "[redis] client error");
      });
      await c.connect();
      logger.info("[redis] connected");
      return c;
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[redis] connect failed — rate limiter disabled");
      return null;
    }
  })();

  return clientPromise;
}
