/**
 * invokeWorkflowAndWait - synchronous bridge to Inngest.
 *
 * Sends an Inngest event and polls the REST `/v1/events/{eventId}/runs`
 * endpoint until the run is COMPLETED / FAILED / CANCELLED or the deadline
 * passes. Returns the run's output (or `null` for terminal-failure cases).
 *
 * Used by route handlers that previously called `runX()` synchronously: the
 * HTTP request/response contract stays sync, but execution underneath is
 * durable + observable in the Inngest dashboard.
 *
 * Per-route bypass: set env var `USE_INNGEST_INVOKE_<EVENT_NAME>=0` (event
 * name uppercased, non-alphanumerics -> `_`) and the helper throws an
 * `InngestInvokeBypassError`. Callers catch this and fall back to the
 * legacy in-process `runX()` wrapper.
 */
import { createHash } from "node:crypto";
import { inngest } from "./client";

/**
 * Build a deterministic idempotency key for `invokeWorkflowAndWait`. Pass
 * the eventName and an array of meaningful input fields; identical inputs
 * always hash to the same key, so a user double-tap or a route retry
 * within Inngest's dedup window (~24h by default) won't spawn a parallel
 * workflow run.
 *
 * Coerces undefined/null to the string "null" so two calls that differ
 * only in optional fields still collide deterministically when those
 * fields are absent on both sides.
 */
export function buildIdempotencyKey(eventName: string, parts: ReadonlyArray<unknown>): string {
  const h = createHash("sha256");
  h.update(eventName);
  for (const p of parts) {
    h.update(" ");
    h.update(p == null ? "null" : typeof p === "string" ? p : JSON.stringify(p));
  }
  return `${eventName}:${h.digest("hex").slice(0, 24)}`;
}

export interface InvokeOpts {
  /** Total wait budget in ms before throwing a timeout error. Default 60_000. */
  timeoutMs?: number;
  /** Poll interval in ms between run-status checks. Default 500. */
  pollIntervalMs?: number;
  /**
   * Deterministic event id used by Inngest as an idempotency key. When two
   * inngest.send calls share an `id`, Inngest deduplicates and the second
   * one does NOT trigger a fresh run. Use a stable hash of the meaningful
   * inputs (e.g. `onboarding-${sessionToken}-${messageHash}`) so a user
   * double-tap or a route retry doesn't spawn parallel workflows.
   */
  idempotencyKey?: string;
}

interface RunStatus<T> {
  status?: string;
  run_id?: string;
  output?: T;
  error?: { name?: string; message?: string };
}

/**
 * Sentinel thrown when the per-route bypass flag is set so callers can
 * `catch (e) { if (e instanceof InngestInvokeBypassError) { legacy() } }`.
 */
export class InngestInvokeBypassError extends Error {
  constructor(public readonly eventName: string) {
    super(`Inngest invoke bypassed for event "${eventName}" (USE_INNGEST_INVOKE_* flag)`);
    this.name = "InngestInvokeBypassError";
  }
}

function bypassEnvKey(eventName: string): string {
  return `USE_INNGEST_INVOKE_${eventName.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/**
 * Send an Inngest event and wait for its associated run to terminate.
 *
 * Returns the run output on COMPLETED, `null` on FAILED / CANCELLED, throws
 * on timeout or on configuration failure (no INNGEST_BASE_URL / signing key).
 */
export async function invokeWorkflowAndWait<T = unknown>(
  eventName: string,
  data: unknown,
  opts: InvokeOpts = {},
): Promise<T | null> {
  if (process.env[bypassEnvKey(eventName)] === "0") {
    throw new InngestInvokeBypassError(eventName);
  }

  const baseUrl = process.env["INNGEST_BASE_URL"];
  const signingKey = process.env["INNGEST_SIGNING_KEY"];
  if (!baseUrl || !signingKey) {
    throw new Error(
      `invokeWorkflowAndWait: INNGEST_BASE_URL / INNGEST_SIGNING_KEY not set (event=${eventName})`,
    );
  }

  const sendResult = await inngest.send({
    name: eventName,
    data: data as Record<string, unknown>,
    ...(opts.idempotencyKey ? { id: opts.idempotencyKey } : {}),
  });
  const eventId = sendResult.ids[0];
  if (!eventId) {
    return null;
  }

  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pollMs = opts.pollIntervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;

  // The Inngest REST runs API returns `data: [run, ...]` once a run has been
  // created for the event. We poll until the run reports a terminal status.
  while (Date.now() < deadline) {
    const resp = await fetch(`${baseUrl}/v1/events/${eventId}/runs`, {
      headers: { Authorization: `Bearer ${signingKey}` },
    });
    if (resp.ok) {
      const body = (await resp.json()) as { data?: RunStatus<T>[] };
      const run = body.data?.[0];
      const status = run?.status?.toUpperCase();
      if (status === "COMPLETED") {
        return (run?.output ?? null) as T | null;
      }
      if (status === "FAILED" || status === "CANCELLED") {
        return null;
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(`invokeWorkflowAndWait timeout after ${timeoutMs}ms for ${eventName}`);
}
