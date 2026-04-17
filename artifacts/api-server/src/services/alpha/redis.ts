import IORedis, { type RedisOptions } from "ioredis";
import { logger as log } from "../../lib/logger";

let connection: IORedis | null = null;
let connectionLogged = false;

function buildOptions(url: string): RedisOptions {
  const isTls = url.startsWith("rediss://");
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    ...(isTls ? { tls: {} } : {}),
  };
}

export function getRedis(): IORedis {
  if (connection) return connection;
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is not configured. The enrichment job queue cannot start without it.");
  }
  connection = new IORedis(url, buildOptions(url));
  connection.on("error", (e) => {
    log.error({ err: String(e) }, "[redis] connection error");
  });
  connection.on("connect", () => {
    if (!connectionLogged) {
      log.info("[redis] connected");
      connectionLogged = true;
    }
  });
  connection.on("end", () => {
    log.warn("[redis] connection ended");
    connectionLogged = false;
  });
  return connection;
}

export function isRedisConfigured(): boolean {
  return !!process.env.REDIS_URL;
}
