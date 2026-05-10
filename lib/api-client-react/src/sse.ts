/**
 * Server-Sent Events client.
 *
 * Implements the EventStream wire format directly on top of `fetch` (we own
 * the parser so we work everywhere `fetch` does — including React Native,
 * which has no native `EventSource`). Each parsed event has the standard
 * `event`, `data`, `id`, and `retry` fields per the WHATWG spec:
 *   https://html.spec.whatwg.org/multipage/server-sent-events.html
 *
 * Caller is expected to JSON.parse `data` themselves; we keep the raw string
 * so non-JSON streams (e.g. log tails) still work.
 */

export interface ParsedSSEEvent {
  event: string;        // defaults to "message"
  data: string;         // joined "data:" lines
  id: string | null;    // last event id, if any
  retry: number | null; // server-suggested reconnect delay in ms
}

export interface SubscribeOptions {
  /** AbortSignal that cancels the subscription. */
  signal?: AbortSignal;
  /** Called for every parsed event. */
  onEvent: (event: ParsedSSEEvent) => void;
  /** Called once the stream opens (HTTP 200 + correct content-type). */
  onOpen?: () => void;
  /**
   * Called when the underlying fetch errors or the stream closes. Receives
   * the error (if any), a hint at how long the server asked us to wait
   * before reconnecting (the most recent `retry:` value, or null), and the
   * last event id observed on the stream so the caller can resume.
   */
  onClose?: (info: {
    error: Error | null;
    retryHintMs: number | null;
    lastEventId: string | null;
  }) => void;
  /** Extra request headers (e.g. Authorization). */
  headers?: HeadersInit;
  /**
   * Last-Event-ID to send on this connection. Used to resume after a
   * dropped connection. Callers driving reconnect loops should thread the
   * `lastEventId` returned by `onClose` back into this option.
   */
  lastEventId?: string | null;
}

const SSE_CONTENT_TYPE = "text/event-stream";

/**
 * Open an SSE subscription. Resolves once the connection terminates (either
 * by error or because the caller aborted via `signal`). The promise never
 * rejects — failures are surfaced through `onClose` so callers driving
 * reconnect loops have a single termination path.
 */
export async function subscribeToEventStream(
  url: string,
  opts: SubscribeOptions,
): Promise<void> {
  const { signal, onEvent, onOpen, onClose, headers } = opts;

  let retryHintMs: number | null = null;
  let lastEventId: string | null = opts.lastEventId ?? null;

  let response: Response;
  try {
    const reqHeaders = new Headers(headers);
    reqHeaders.set("accept", SSE_CONTENT_TYPE);
    if (lastEventId) reqHeaders.set("last-event-id", lastEventId);

    response = await fetch(url, {
      method: "GET",
      headers: reqHeaders,
      // Cookies for same-origin auth (web). React Native ignores this.
      credentials: "include",
      signal,
      cache: "no-store",
    });
  } catch (err) {
    onClose?.({ error: toError(err), retryHintMs: null, lastEventId });
    return;
  }

  if (!response.ok) {
    onClose?.({
      error: new Error(`SSE ${url} → HTTP ${response.status} ${response.statusText}`),
      retryHintMs: null,
      lastEventId,
    });
    return;
  }

  const ct = response.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes(SSE_CONTENT_TYPE)) {
    onClose?.({
      error: new Error(`SSE ${url} returned content-type "${ct}", expected "${SSE_CONTENT_TYPE}"`),
      retryHintMs: null,
      lastEventId,
    });
    return;
  }

  if (!response.body) {
    onClose?.({
      error: new Error(`SSE ${url} returned no readable body`),
      retryHintMs: null,
      lastEventId,
    });
    return;
  }

  onOpen?.();

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  // Per spec, events are separated by a blank line. A single "event" can
  // span multiple `data:` lines which are joined with "\n". We carry over
  // the trailing partial chunk between reads.
  const flushEvent = (rawEvent: string) => {
    if (!rawEvent) return;
    let event = "message";
    const dataLines: string[] = [];
    let id: string | null = lastEventId;
    let retry: number | null = null;

    for (const rawLine of rawEvent.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (line === "" || line.startsWith(":")) continue; // comment / empty
      const colonIdx = line.indexOf(":");
      const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
      let value = colonIdx === -1 ? "" : line.slice(colonIdx + 1);
      if (value.startsWith(" ")) value = value.slice(1);

      switch (field) {
        case "event": event = value; break;
        case "data": dataLines.push(value); break;
        case "id":
          // Per spec: if value contains NUL, ignore.
          if (!value.includes("\0")) {
            id = value;
            lastEventId = value;
          }
          break;
        case "retry": {
          const ms = Number.parseInt(value, 10);
          if (Number.isFinite(ms) && ms >= 0) {
            retry = ms;
            retryHintMs = ms;
          }
          break;
        }
        default: /* unknown field — ignore per spec */ break;
      }
    }

    // Per spec, events with no `data` field are not dispatched.
    if (dataLines.length === 0) return;

    onEvent({
      event,
      data: dataLines.join("\n"),
      id,
      retry,
    });
  };

  const drainBuffer = () => {
    let separatorIdx: number;
    while ((separatorIdx = findEventSeparator(buffer)) !== -1) {
      const rawEvent = buffer.slice(0, separatorIdx);
      buffer = buffer.slice(separatorIdx + (buffer[separatorIdx] === "\r" ? 4 : 2));
      flushEvent(rawEvent);
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      drainBuffer();
    }
    // Flush any bytes still held in the decoder, then dispatch any final
    // event that ended without a terminating blank line. Per spec, a
    // partial event at EOF without a trailing "\n\n" should still be
    // dispatched if it carries data.
    buffer += decoder.decode();
    drainBuffer();
    if (buffer.length > 0) {
      flushEvent(buffer);
      buffer = "";
    }
    onClose?.({ error: null, retryHintMs, lastEventId });
  } catch (err) {
    // AbortError is the caller cancelling; not really an error.
    if ((err as Error)?.name === "AbortError") {
      onClose?.({ error: null, retryHintMs, lastEventId });
      return;
    }
    onClose?.({ error: toError(err), retryHintMs, lastEventId });
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

function findEventSeparator(buf: string): number {
  // Returns the index of the first character of "\n\n" or "\r\n\r\n", or -1.
  // (Returns the index of the FIRST \n / \r so callers can compute the
  // number of separator chars to skip.)
  const lf = buf.indexOf("\n\n");
  const crlf = buf.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err));
}
