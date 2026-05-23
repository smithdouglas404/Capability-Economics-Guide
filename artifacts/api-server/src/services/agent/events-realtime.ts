/**
 * Inngest Realtime channel definition for agent lifecycle events.
 *
 * Phase 3 (2026-05-23): Replaces the in-process EventEmitter pub/sub with a
 * cross-instance bus. Each api-server replica publishes lifecycle events
 * (run_started, tool_call, phase, run_completed, etc.) to this channel; SSE
 * endpoints subscribe to it and fan messages out to their connected browser
 * clients. This means a frontend connected to replica A still receives events
 * emitted by replica B.
 *
 * Graceful degrade: if INNGEST_BASE_URL / INNGEST_EVENT_KEY are unset OR the
 * INNGEST_REALTIME=1 flag is off, the publish-side is a no-op and the legacy
 * in-process EventEmitter path (events.ts) is the only transport. See
 * `realtime-bridge.ts` for the subscribe-side bootstrap.
 */
import { channel, staticSchema } from "inngest/realtime";

export type AgentRealtimeEvent = Record<string, unknown> & {
  type: string;
  timestamp?: string;
};

// One channel, one topic — keep the surface small. Every emitAgentEvent call
// ends up on `agent-events.events`. Using `staticSchema` avoids any runtime
// Zod validation cost; the event shape is enforced by emitAgentEvent itself.
export const agentEventsChannel = channel({
  name: "agent-events",
  topics: {
    events: { schema: staticSchema<AgentRealtimeEvent>() },
  },
});

/**
 * Process-unique tag stamped on every published Realtime event so the
 * subscribe-side bridge can drop messages that originated from this same
 * replica (which already delivered them via the synchronous local broadcast).
 *
 * Module-scope so events.ts and realtime-bridge.ts agree on the value without
 * either importing the other (avoids a circular import).
 */
export const PROCESS_ORIGIN = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Whether the Realtime transport is enabled for this process. Both flags are
 * checked so an operator can quickly disable the new path without unsetting
 * Inngest itself.
 *
 * Returns true only when:
 * - INNGEST_REALTIME is unset (default ON) OR set to a truthy value
 * - AND both INNGEST_BASE_URL and INNGEST_EVENT_KEY are configured
 *
 * The default-ON behavior matches the rest of the Inngest wiring — once Phase 0
 * is wired (env vars present on Railway), Realtime fan-out is automatic.
 * Set `INNGEST_REALTIME=0` to force the old in-process EventEmitter path.
 */
export function isRealtimeEnabled(): boolean {
  const flag = process.env["INNGEST_REALTIME"];
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return Boolean(process.env["INNGEST_BASE_URL"] && process.env["INNGEST_EVENT_KEY"]);
}
