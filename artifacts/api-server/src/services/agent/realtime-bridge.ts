/**
 * Realtime → SSE bridge.
 *
 * This is the receive-side of Phase 3. On boot we open ONE long-lived
 * subscription to the `agent-events` Inngest Realtime channel. Every message
 * that arrives is fanned out to every SSE client connected to THIS api-server
 * replica via `broadcastToLocalClients`.
 *
 * Why dual-emit + bridge instead of one-or-the-other:
 *   - Replica A publishes locally + to Realtime. Local clients on A see the
 *     event immediately (no round-trip).
 *   - Replica B receives the event via its bridge subscription and fans out to
 *     its local clients.
 *   - Replica A also receives its own message back through the bridge. To
 *     avoid double-delivery on the originating replica we tag every message
 *     with a process-unique `__originId` and drop messages whose origin matches
 *     ours.
 *
 * Graceful degrade: if INNGEST_REALTIME / INNGEST_* env vars aren't set, this
 * module never opens a subscription and the legacy in-process EventEmitter
 * path remains the only transport. Single-replica deploys continue to work
 * exactly as before.
 */
import { subscribe } from "inngest/realtime";

import { inngest } from "../../inngest/client";
import { broadcastToLocalClients } from "./events";
import { PROCESS_ORIGIN, agentEventsChannel, isRealtimeEnabled } from "./events-realtime";

export function getProcessOrigin(): string {
  return PROCESS_ORIGIN;
}

type BridgeState = {
  started: boolean;
  subscription: { close: (reason?: string) => void } | null;
};

const state: BridgeState = {
  started: false,
  subscription: null,
};

/**
 * Start the Realtime → SSE bridge. Idempotent + safe to call when Realtime
 * is disabled (it returns immediately). The subscription stays open for the
 * lifetime of the process; `stopRealtimeBridge()` is exposed mainly for tests.
 */
export async function startRealtimeBridge(): Promise<void> {
  if (state.started) return;
  if (!isRealtimeEnabled()) {
    // eslint-disable-next-line no-console
    console.info("[agent-events] realtime bridge disabled (INNGEST_REALTIME=0 or Inngest env unset) — using in-process SSE only");
    return;
  }

  state.started = true;
  try {
    const sub = await subscribe({
      app: inngest,
      channel: agentEventsChannel,
      topics: ["events"],
    }, (message) => {
      // The published payload lives in message.data. Drop messages that came
      // from us — local broadcast already fired synchronously in emitAgentEvent.
      const data = (message as { data?: Record<string, unknown> }).data;
      if (!data || typeof data !== "object") return;
      if (typeof data["__originId"] === "string" && data["__originId"] === PROCESS_ORIGIN) {
        return;
      }
      // Strip the routing tag before forwarding to browsers.
      const { __originId: _drop, ...payload } = data as { __originId?: unknown; type?: string };
      if (typeof payload.type !== "string") return;
      broadcastToLocalClients(payload as Record<string, unknown> & { type: string });
    });
    state.subscription = sub as unknown as { close: (reason?: string) => void };
    // eslint-disable-next-line no-console
    console.info("[agent-events] realtime bridge active — channel=agent-events topic=events origin=", PROCESS_ORIGIN);
  } catch (err) {
    state.started = false;
    // eslint-disable-next-line no-console
    console.warn("[agent-events] realtime bridge failed to start; falling back to in-process SSE:", err instanceof Error ? err.message : err);
  }
}

export function stopRealtimeBridge(): void {
  if (state.subscription) {
    try { state.subscription.close("api-server shutdown"); } catch { /* ignore */ }
  }
  state.subscription = null;
  state.started = false;
}
