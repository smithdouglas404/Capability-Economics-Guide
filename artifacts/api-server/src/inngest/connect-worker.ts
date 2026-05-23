import { connect } from "inngest/connect";
import type { WorkerConnection } from "inngest/connect";

import { logger } from "../lib/logger";
import { inngest } from "./client";
import { functions } from "./functions";

/**
 * Inngest Connect — WebSocket worker (Phase 7).
 *
 * Connect replaces the inbound HTTP webhook (`/api/inngest`) with a
 * persistent outbound WebSocket: the api-server dials Inngest, registers its
 * functions, and receives step invocations over the same socket. The HTTP
 * webhook stays mounted in `app.ts` so we can flip back instantly by
 * unsetting the flag — this worker is purely additive.
 *
 * Gated on `INNGEST_CONNECT=1`. Default off. Connect is a beta-track SDK API
 * (inngest@4.4.0) and requires server-side support on the self-hosted
 * Inngest binary (verified 2026-05-23: `/api/v1/connect` returns 200,
 * `/v0/connect` returns 401 — endpoint exists, auth-gated).
 *
 * The SDK's `connect()` reads `INNGEST_CONNECT_GATEWAY_URL` and
 * `INNGEST_CONNECT_ISOLATE_EXECUTION` from env automatically; no extra
 * wiring needed here.
 */
let activeConnection: WorkerConnection | null = null;

export async function startInngestConnectWorker(): Promise<WorkerConnection | null> {
  if (process.env["INNGEST_CONNECT"] !== "1") {
    logger.info("[inngest-connect] disabled (INNGEST_CONNECT != 1) — using HTTP webhook at /api/inngest");
    return null;
  }

  logger.info(
    {
      gatewayUrlOverride: process.env["INNGEST_CONNECT_GATEWAY_URL"] ?? "(default — resolved via Inngest API)",
      instanceId: process.env["INNGEST_INSTANCE_ID"] ?? "(hostname default)",
      functionCount: functions.length,
    },
    "[inngest-connect] starting WebSocket worker",
  );

  try {
    const conn = await connect({
      apps: [{ client: inngest, functions }],
      ...(process.env["INNGEST_INSTANCE_ID"]
        ? { instanceId: process.env["INNGEST_INSTANCE_ID"] }
        : {}),
    });

    activeConnection = conn;

    logger.info(
      { connectionId: conn.connectionId, state: conn.state },
      "[inngest-connect] connected",
    );

    // Surface async termination so operators see it in Railway logs without
    // having to query /api/health.
    conn.closed
      .then(() => {
        logger.warn(
          { connectionId: conn.connectionId },
          "[inngest-connect] connection closed",
        );
      })
      .catch((err: unknown) => {
        logger.error({ err }, "[inngest-connect] connection terminated with error");
      });

    return conn;
  } catch (err) {
    logger.error({ err }, "[inngest-connect] failed to start worker");
    return null;
  }
}

/**
 * Best-effort graceful close. The SDK already wires SIGINT/SIGTERM listeners
 * by default (see DEFAULT_SHUTDOWN_SIGNALS), so this is here as an explicit
 * escape hatch for callers that want to drain Connect ahead of the rest of
 * the shutdown sequence (e.g., before closing the HTTP listener).
 */
export async function stopInngestConnectWorker(): Promise<void> {
  if (!activeConnection) return;
  try {
    await activeConnection.close();
    logger.info("[inngest-connect] worker closed");
  } catch (err) {
    logger.error({ err }, "[inngest-connect] error during close");
  } finally {
    activeConnection = null;
  }
}
