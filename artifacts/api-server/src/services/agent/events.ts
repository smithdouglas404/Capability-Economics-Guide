import type { Response } from "express";

import { inngest } from "../../inngest/client";
import { PROCESS_ORIGIN, agentEventsChannel, isRealtimeEnabled, type AgentRealtimeEvent } from "./events-realtime";

type AgentEvent = Record<string, unknown> & { type: string };

const clients: Set<Response> = new Set();

const HEARTBEAT_INTERVAL_MS = 30000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function ensureHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const client of clients) {
      try {
        client.write(": heartbeat\n\n");
      } catch {
        clients.delete(client);
      }
    }
    if (clients.size === 0 && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }, HEARTBEAT_INTERVAL_MS);
}

export function addSSEClient(res: Response): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("data: {\"type\":\"connected\"}\n\n");
  clients.add(res);
  ensureHeartbeat();

  res.on("close", () => {
    clients.delete(res);
  });
}

/**
 * Write an already-serialized SSE message to every locally-connected browser
 * client. This is the only thing the in-process EventEmitter ever did — it's
 * now also the destination for messages relayed in by the Realtime bridge
 * (see `realtime-bridge.ts`).
 */
export function broadcastToLocalClients(event: AgentEvent): void {
  const data = JSON.stringify(event);
  const message = `data: ${data}\n\n`;

  for (const client of clients) {
    try {
      client.write(message);
    } catch {
      clients.delete(client);
    }
  }
}

export function emitAgentEvent(event: AgentEvent): void {
  const stamped: AgentRealtimeEvent = {
    ...event,
    timestamp: typeof event["timestamp"] === "string" ? (event["timestamp"] as string) : new Date().toISOString(),
  };

  // Local fan-out — preserves same-instance delivery latency and is the only
  // path when Realtime is disabled / not configured.
  broadcastToLocalClients(stamped);

  // Cross-instance fan-out via Inngest Realtime. The publish is non-durable
  // (immediate, no run context), so a failure here is a transport issue and
  // must not break local delivery — swallow + log. We tag with PROCESS_ORIGIN
  // so this replica's own bridge subscription can drop the echo.
  if (isRealtimeEnabled()) {
    const tagged = { ...stamped, __originId: PROCESS_ORIGIN };
    void inngest.realtime
      .publish(agentEventsChannel.events, tagged)
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn("[agent-events] realtime publish failed:", err instanceof Error ? err.message : err);
      });
  }
}

export function getConnectedClients(): number {
  return clients.size;
}
