import type { Response } from "express";

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

export function emitAgentEvent(event: AgentEvent): void {
  const data = JSON.stringify({ ...event, timestamp: new Date().toISOString() });
  const message = `data: ${data}\n\n`;

  for (const client of clients) {
    try {
      client.write(message);
    } catch {
      clients.delete(client);
    }
  }
}

export function getConnectedClients(): number {
  return clients.size;
}
