/**
 * useAgentRealtime — browser subscription to the Inngest Realtime
 * `agent-events` channel.
 *
 * Replaces the legacy SSE consumer (`useEventStream(`/api/agent/events/stream`)`)
 * after the server-side bus + bridge were deleted in favor of going through
 * Inngest Realtime end-to-end. The api-server's `emitAgentEvent` now publishes
 * exclusively to this channel; browser clients open a WebSocket via the
 * inngest SDK's `useRealtime` hook after fetching a short-lived subscription
 * token from `POST /api/agent/realtime-token`.
 *
 * The hook intentionally mirrors `useEventStream`'s `{ events, status }`
 * return shape — call sites only had to swap the import.
 */
import { useMemo } from "react";
import { useRealtime } from "inngest/react";
import { channel, staticSchema } from "inngest/realtime";

type AgentEvent = {
  type: string;
  timestamp?: string;
  [k: string]: unknown;
};

// Channel definition matches services/agent/events-realtime.ts on the server.
// Names + topics MUST stay aligned or the gateway will reject the subscription.
const agentEventsChannel = channel({
  name: "agent-events",
  topics: {
    events: { schema: staticSchema<AgentEvent>() },
  },
});

export type AgentRealtimeStatus = "connecting" | "open" | "closed";

export interface UseAgentRealtimeOptions<T> {
  /** Drop events that don't match this predicate. */
  filter?: (event: T) => boolean;
  /** Maximum events kept in the returned list. Default 100. */
  maxBuffered?: number;
}

export interface UseAgentRealtimeResult<T> {
  events: T[];
  status: AgentRealtimeStatus;
}

async function fetchSubscriptionToken(apiBase = "/api"): Promise<unknown> {
  const resp = await fetch(`${apiBase}/agent/realtime-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`realtime-token fetch failed: ${resp.status}`);
  }
  const body = (await resp.json()) as { token: unknown };
  return body.token;
}

/**
 * Subscribe to the agent-events Realtime channel. Pass `T` to type the
 * event payload (mirrors how `useEventStream<T>` is used today).
 */
export function useAgentRealtime<T extends { type: string } = AgentEvent>(
  options: UseAgentRealtimeOptions<T> = {},
): UseAgentRealtimeResult<T> {
  const { filter, maxBuffered = 100 } = options;

  const { messages, connectionStatus } = useRealtime({
    channel: agentEventsChannel,
    topics: ["events"],
    // The SDK accepts an async factory that returns the token shape returned
    // by `getSubscriptionToken` on the server. Calling it inside a memo means
    // we don't refetch on every render.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    token: useMemo(() => () => fetchSubscriptionToken() as Promise<any>, []),
    historyLimit: maxBuffered,
  });

  const events = useMemo<T[]>(() => {
    const buffered = messages.all
      .map((m) => m.data as T)
      .filter((e): e is T => Boolean(e && typeof (e as { type?: unknown }).type === "string"));
    const filtered = filter ? buffered.filter(filter) : buffered;
    // Newest-first to match the old SSE buffer ordering.
    return filtered.slice(-maxBuffered).reverse();
  }, [messages.all, filter, maxBuffered]);

  const status: AgentRealtimeStatus =
    connectionStatus === "open"
      ? "open"
      : connectionStatus === "connecting" || connectionStatus === "paused"
        ? "connecting"
        : "closed";

  return { events, status };
}
