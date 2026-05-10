import { useEffect, useRef, useState } from "react";
import { subscribeToEventStream, type ParsedSSEEvent } from "./sse";

export type EventStreamStatus = "connecting" | "open" | "closed";

export interface UseEventStreamOptions<T> {
  /**
   * Parse the raw `data:` string into the caller's event type. Defaults to
   * `JSON.parse`. Return `null` to drop the event (e.g. heartbeats).
   */
  parse?: (raw: ParsedSSEEvent) => T | null;
  /**
   * Filter events after parsing. Return `false` to drop. Defaults to
   * accepting everything.
   */
  filter?: (event: T) => boolean;
  /** Maximum events buffered in state. Older events are dropped. Default 100. */
  maxBuffered?: number;
  /** Initial reconnect delay in ms (will exponentially back off). Default 1000. */
  initialReconnectDelayMs?: number;
  /** Maximum reconnect delay in ms. Default 30_000. */
  maxReconnectDelayMs?: number;
  /**
   * If `false`, no reconnect is attempted after disconnect. Useful for tests.
   * Defaults to `true`.
   */
  reconnect?: boolean;
  /** Extra request headers (e.g. Authorization). */
  headers?: HeadersInit;
}

export interface UseEventStreamResult<T> {
  events: T[];
  status: EventStreamStatus;
  /** Last error from the underlying connection, if any. */
  error: Error | null;
  /** How many times the hook has reconnected since mount. */
  reconnectAttempts: number;
  /** Manually clear the buffered events. */
  clear: () => void;
}

/**
 * React hook that subscribes to a Server-Sent Events endpoint with
 * exponential-backoff reconnect. Events are JSON-parsed by default and kept
 * in a bounded LIFO buffer so components can render a live feed without
 * worrying about unbounded growth.
 *
 * Pass `null` as the URL to suspend the subscription (useful when waiting on
 * auth state or feature flags).
 */
export function useEventStream<T = unknown>(
  url: string | null,
  options: UseEventStreamOptions<T> = {},
): UseEventStreamResult<T> {
  const {
    parse,
    filter,
    maxBuffered = 100,
    initialReconnectDelayMs = 1000,
    maxReconnectDelayMs = 30_000,
    reconnect = true,
    headers,
  } = options;

  const [events, setEvents] = useState<T[]>([]);
  const [status, setStatus] = useState<EventStreamStatus>("connecting");
  const [error, setError] = useState<Error | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Refs let the long-lived subscriber loop see the latest callbacks/options
  // without resubscribing on every render.
  const parseRef = useRef(parse);
  const filterRef = useRef(filter);
  const headersRef = useRef(headers);
  parseRef.current = parse;
  filterRef.current = filter;
  headersRef.current = headers;

  useEffect(() => {
    if (!url) {
      setStatus("closed");
      return;
    }

    let cancelled = false;
    const abort = new AbortController();
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    // Persisted across reconnects so the server can resume a dropped stream
    // (we send `last-event-id` on each subscribe call).
    let cursor: string | null = null;

    // Gate every state update on the still-mounted flag so a late callback
    // from an in-flight fetch can't write to unmounted state.
    const safeSetStatus = (s: EventStreamStatus) => { if (!cancelled) setStatus(s); };
    const safeSetError = (e: Error | null) => { if (!cancelled) setError(e); };
    const safeAppend = (evt: T) => {
      if (cancelled) return;
      setEvents((prev) => {
        const next = [evt, ...prev];
        return next.length > maxBuffered ? next.slice(0, maxBuffered) : next;
      });
    };
    const safeBumpAttempts = (n: number) => { if (!cancelled) setReconnectAttempts(n); };

    const loop = async () => {
      while (!cancelled) {
        safeSetStatus("connecting");
        let serverRetryHint: number | null = null;

        await subscribeToEventStream(url, {
          signal: abort.signal,
          headers: headersRef.current,
          lastEventId: cursor,
          onOpen: () => {
            attempt = 0;
            safeSetStatus("open");
            safeSetError(null);
          },
          onEvent: (raw) => {
            if (raw.id) cursor = raw.id;
            const parser = parseRef.current ?? defaultJsonParser<T>;
            let parsed: T | null;
            try {
              parsed = parser(raw);
            } catch {
              return;
            }
            if (parsed == null) return;
            if (filterRef.current && !filterRef.current(parsed)) return;
            safeAppend(parsed);
          },
          onClose: ({ error: closeErr, retryHintMs, lastEventId }) => {
            serverRetryHint = retryHintMs;
            if (lastEventId) cursor = lastEventId;
            if (closeErr) safeSetError(closeErr);
          },
        });

        if (cancelled || !reconnect) {
          safeSetStatus("closed");
          return;
        }

        // Exponential backoff with jitter, capped. Honor the server's
        // `retry:` hint if it gave us one.
        attempt += 1;
        safeBumpAttempts(attempt);
        const base = serverRetryHint
          ?? Math.min(maxReconnectDelayMs, initialReconnectDelayMs * 2 ** (attempt - 1));
        const jitter = Math.random() * Math.min(base * 0.25, 1000);
        const delay = Math.min(maxReconnectDelayMs, base + jitter);
        safeSetStatus("closed");

        await new Promise<void>((resolve) => {
          reconnectTimer = setTimeout(resolve, delay);
        });
        reconnectTimer = null;
      }
    };

    void loop();

    return () => {
      cancelled = true;
      abort.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  // We intentionally exclude the callback refs and the tunable numbers so we
  // don't tear down the connection on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, reconnect]);

  return {
    events,
    status,
    error,
    reconnectAttempts,
    clear: () => setEvents([]),
  };
}

function defaultJsonParser<T>(raw: ParsedSSEEvent): T | null {
  if (raw.data === "") return null;
  return JSON.parse(raw.data) as T;
}
