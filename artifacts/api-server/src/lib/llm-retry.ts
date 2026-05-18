/**
 * Generic retry helper for outbound LLM calls (Perplexity, OpenRouter,
 * Anthropic). Wraps any async function and retries on transient failures
 * with exponential backoff.
 *
 * Why: the bulk enrichment paths (`backfillAiNarratives`,
 * `runDetailEnrichment`) and `runCapabilityEnrichmentRetry` were all
 * single-attempt — a transient 429 or socket reset = permanent failure
 * for that capability until the next manual click. This burned about 80%
 * of "the enhance flow flakes" complaints to one-off rate limits that
 * would have succeeded on the next attempt.
 *
 * Usage:
 *   const data = await retry(() => fetch(...).then(r => r.json()), { attempts: 3 });
 */

import { logger } from "./logger";

export interface RetryOptions {
  /** Total attempts including the first try. Default 3. */
  attempts?: number;
  /** Backoff (ms) between attempts. Index N is the wait BEFORE attempt N+1.
   *  Default [1000, 4000, 16000] — exponential with jitter applied at runtime. */
  backoffMs?: number[];
  /** Override which errors count as transient. Default: 429, 5xx, network, timeout. */
  isTransient?: (err: unknown) => boolean;
  /** Free-text tag in log lines so multiple call sites stay distinguishable. */
  label?: string;
}

const DEFAULT_BACKOFF_MS = [1000, 4000, 16000];

function defaultIsTransient(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  // HTTP status patterns we put into Error messages ourselves
  if (/\b(429|500|502|503|504)\b/.test(msg)) return true;
  // Generic network / socket errors
  if (/ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed/i.test(msg)) return true;
  // AbortController-driven timeouts
  if (name === "AbortError" || /aborted|timeout/i.test(msg)) return true;
  // OpenRouter-specific rate limit phrasing
  if (/rate.?limit|too many requests|temporarily unavailable/i.test(msg)) return true;
  return false;
}

/**
 * Wrap an async fn with retry + exponential backoff. Throws the LAST
 * attempt's error if all attempts fail, so callers see the real failure
 * cause (not "retry exhausted").
 */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const isTransient = opts.isTransient ?? defaultIsTransient;
  const label = opts.label ?? "llm-retry";

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient = isTransient(err);
      const last = i === attempts - 1;
      if (last || !transient) {
        if (!transient) {
          logger.warn({ label, attempt: i + 1, err: err instanceof Error ? err.message : String(err) }, "[retry] non-transient error, not retrying");
        }
        throw err;
      }
      // +/- 20% jitter so concurrent failures don't sync up
      const base = backoff[Math.min(i, backoff.length - 1)] ?? backoff[backoff.length - 1];
      const jittered = base * (0.8 + Math.random() * 0.4);
      logger.info({ label, attempt: i + 1, retryInMs: Math.round(jittered) }, "[retry] transient error, backing off");
      await new Promise((resolve) => setTimeout(resolve, jittered));
    }
  }
  throw lastErr;
}
