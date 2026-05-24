import { inngest } from "../../inngest/client";
import { agentEventsChannel, isRealtimeEnabled, type AgentRealtimeEvent } from "./events-realtime";

type AgentEvent = Record<string, unknown> & { type: string };

/**
 * Publish an agent lifecycle event to the Inngest Realtime `agent-events`
 * channel. Browser clients subscribe via the `inngest/react` `useRealtime`
 * hook (with a subscription token minted by `POST /api/agent/realtime-token`).
 *
 * The legacy in-process SSE bus + bridge were deleted after every
 * `INNGEST_OWNS_*` flag flipped to "1" in prod — Realtime is now the only
 * transport. Graceful-degrade: if Inngest env vars aren't set, the publish
 * is a silent no-op so callers never see errors from a transport hiccup.
 */
export function emitAgentEvent(event: AgentEvent): void {
  if (!isRealtimeEnabled()) return;

  const stamped: AgentRealtimeEvent = {
    ...event,
    timestamp: typeof event["timestamp"] === "string" ? (event["timestamp"] as string) : new Date().toISOString(),
  };

  void inngest.realtime
    .publish(agentEventsChannel.events, stamped)
    .catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn("[agent-events] realtime publish failed:", err instanceof Error ? err.message : err);
    });
}
