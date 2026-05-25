import { logLlmCall } from "./llm-usage";
import { maybeStepAiWrap } from "../inngest/step-context";
import { hashRequest, lookupCache, writeCache } from "./perplexity-cache";

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_FALLBACK_MODEL = "google/gemini-2.5-flash:online";

/**
 * Fallback to Gemini 2.5 Flash via OpenRouter `:online` (Google Search
 * grounding built in). Triggered when Perplexity returns:
 *   - 401 (auth / quota exhausted — the most common failure mode in prod)
 *   - 429 after all retries exhausted
 *   - persistent network failure
 *
 * Returns the same PerplexityChatResponse shape so callers don't change.
 * OpenRouter's response is OpenAI-compatible; we lift `annotations` into
 * `citations` to match Perplexity's shape downstream.
 *
 * Gated: set PERPLEXITY_FALLBACK_DISABLED=1 to skip the fallback and
 * surface the original Perplexity error directly.
 */
async function geminiOnlineFallback(
  opts: PerplexityChatOptions,
  originalError: Error,
): Promise<PerplexityChatResponse> {
  if (process.env["PERPLEXITY_FALLBACK_DISABLED"] === "1") throw originalError;
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) {
    console.warn(
      `[Perplexity→Gemini fallback] OPENROUTER_API_KEY not set, surfacing original error`,
    );
    throw originalError;
  }

  const model = process.env["PERPLEXITY_FALLBACK_MODEL"] ?? DEFAULT_FALLBACK_MODEL;
  const startedAt = Date.now();
  const ctx = opts.context ? ` ctx=${JSON.stringify(opts.context)}` : "";

  console.warn(
    `[Perplexity→Gemini fallback] ${opts.endpoint} — Perplexity failed (${originalError.message.slice(0, 120)}),` +
      ` retrying via OpenRouter ${model}${ctx}`,
  );

  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onCancel = () => ac.abort();
    opts.signal?.addEventListener("abort", onCancel, { once: true });

    let resp: Response;
    try {
      // step.ai.wrap (via maybeStepAiWrap) makes this call a durable,
      // retriable, observable Inngest step when running inside an Inngest
      // function. Outside Inngest it's a no-op pass-through. Per-call
      // visibility was the missing-piece in the 2026-05-25 Gemini-fallback
      // cost incident: this exact branch silently fired against gemini-2.5-flash
      // every time Perplexity 401'd, with no traceable record.
      resp = await maybeStepAiWrap(`openrouter:perplexity-fallback:${model}`, () =>
        fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            // OpenRouter recommends these for proper attribution + rate-limit tracking
            "HTTP-Referer": process.env["INFLEXCVI_API_BASE"] ?? "https://capabilityeconomics.com",
            "X-Title": "Capability Economics (Perplexity fallback)",
          },
          body: JSON.stringify({ model, messages: opts.messages }),
          signal: ac.signal,
        }),
      );
    } finally {
      clearTimeout(timeout);
      opts.signal?.removeEventListener("abort", onCancel);
    }

    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => "");
      logLlmCall({
        provider: "openrouter",
        model,
        endpoint: `${opts.endpoint} (perplexity-fallback)`,
        startedAt,
        httpStatus: resp.status,
        errorMessage: `HTTP ${resp.status}`,
      });
      throw new Error(
        `Perplexity fallback also failed: OpenRouter HTTP ${resp.status}: ${bodyText.slice(0, 200)}`,
      );
    }

    type OpenRouterAnnotation = { type?: string; url_citation?: { url?: string }; url?: string };
    type OpenRouterChoice = {
      message?: { content?: string; annotations?: OpenRouterAnnotation[] };
    };
    type OpenRouterResponse = { choices?: OpenRouterChoice[]; citations?: string[] };

    const data = (await resp.json()) as OpenRouterResponse;
    const content = data.choices?.[0]?.message?.content ?? "";
    const annotations = data.choices?.[0]?.message?.annotations ?? [];
    // OpenRouter returns citations in two places depending on the model:
    //   - top-level data.citations (Perplexity-style)
    //   - choices[0].message.annotations[].url_citation.url (OpenAI-style)
    // Coalesce into the Perplexity-shaped citations array.
    const annotationUrls = annotations
      .map((a) => a.url_citation?.url ?? a.url)
      .filter((u): u is string => typeof u === "string" && u.length > 0);
    const citations = data.citations && data.citations.length > 0 ? data.citations : annotationUrls;

    logLlmCall({
      provider: "openrouter",
      model,
      endpoint: `${opts.endpoint} (perplexity-fallback)`,
      startedAt,
      httpStatus: resp.status,
      responseJson: data,
    });
    console.warn(
      `[Perplexity→Gemini fallback] ${opts.endpoint} succeeded (${citations.length} citations, ${content.length} chars)${ctx}`,
    );

    return {
      choices: [{ message: { content } }],
      citations,
    };
  } catch (err) {
    logLlmCall({
      provider: "openrouter",
      model,
      endpoint: `${opts.endpoint} (perplexity-fallback)`,
      startedAt,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Decides whether a Perplexity failure should trigger the Gemini fallback.
 * Triggers on auth/quota (401, "insufficient_quota") and on 429 after retries.
 * Does NOT trigger on caller-aborts (don't fall back when caller wanted out)
 * or on 4xx other than 401/429 (genuine request issues — fallback won't help).
 */
function shouldFallback(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "aborted") return false;
  if (/HTTP 401/i.test(msg)) return true;
  if (/insufficient_quota/i.test(msg)) return true;
  if (/HTTP 429/i.test(msg)) return true;
  if (/HTTP 5\d\d/i.test(msg)) return true;
  // Network failures (timeout, DNS, ECONNRESET) — Perplexity unreachable, try Gemini
  if (!msg.startsWith("Perplexity HTTP")) return true;
  return false;
}
function envInt(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, parsed);
}
const DEFAULT_MAX_CONCURRENCY = envInt("PERPLEXITY_MAX_CONCURRENCY", 2, 1);
const DEFAULT_MAX_RETRIES = envInt("PERPLEXITY_MAX_RETRIES", 3, 0);
const DEFAULT_BASE_BACKOFF_MS = 750;
const DEFAULT_TIMEOUT_MS = 120_000;

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PerplexityChatOptions {
  model?: string;
  messages: ChatMessage[];
  endpoint: string;
  context?: { capabilityId?: number; capabilityName?: string; perspective?: string; [k: string]: unknown };
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  /**
   * When false, skip the content-hash response cache entirely (both read
   * and write). Default true. Admin "force fresh" paths set this to false.
   */
  cache?: boolean;
}

export interface PerplexityChatResponse {
  choices: Array<{ message: { content: string } }>;
  citations?: string[];
}

class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }
  private release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const limiter = new Semaphore(DEFAULT_MAX_CONCURRENCY);

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function parseRetryAfterMs(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const asInt = parseInt(headerValue, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt * 1000;
  const asDate = Date.parse(headerValue);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return null;
}

function backoffDelay(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, 30_000);
  const base = DEFAULT_BASE_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = Math.random() * (base * 0.25);
  return Math.min(base + jitter, 30_000);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Process-wide throttled Perplexity chat call with exponential-backoff retry
 * on 429/5xx. All callers should funnel through this so the concurrency
 * limit is global. Failures after retries are logged with the supplied
 * context and rethrown — never silently swallowed.
 */
export async function perplexityChat(opts: PerplexityChatOptions): Promise<PerplexityChatResponse> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not set");

  const model = opts.model ?? "sonar";
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cacheEnabled = opts.cache !== false;

  // Content-hash cache lookup BEFORE the semaphore — a cache hit must not
  // wait for an in-flight Perplexity call to complete, otherwise the cache
  // provides no concurrency relief.
  const cacheKey = cacheEnabled ? hashRequest(model, opts.messages) : null;
  if (cacheKey) {
    const cached = await lookupCache(cacheKey);
    if (cached) {
      logLlmCall({
        provider: "perplexity",
        model,
        endpoint: `${opts.endpoint} (cache-hit)`,
        startedAt: Date.now(),
        httpStatus: 200,
      });
      return cached;
    }
  }

  const release = await limiter.acquire();

  try {
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const startedAt = Date.now();
      try {
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), timeoutMs);
        const onCancel = () => ac.abort();
        opts.signal?.addEventListener("abort", onCancel, { once: true });

        let resp: Response;
        try {
          // step.ai.wrap each Perplexity attempt so retries within this
          // for-loop and the surrounding Gemini fallback all appear as
          // distinct steps in the Inngest run record. Outside Inngest
          // this is a no-op pass-through (the retry loop still works).
          resp = await maybeStepAiWrap(`perplexity:chat:${model}:attempt-${attempt}`, () =>
            fetch(PERPLEXITY_URL, {
              method: "POST",
              headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model, messages: opts.messages }),
              signal: ac.signal,
            }),
          );
        } finally {
          clearTimeout(timeout);
          opts.signal?.removeEventListener("abort", onCancel);
        }

        if (!resp.ok) {
          const status = resp.status;
          const bodyText = await resp.text().catch(() => "");
          if (isRetryableStatus(status) && attempt < maxRetries) {
            const retryAfterMs = parseRetryAfterMs(resp.headers.get("retry-after"));
            const wait = backoffDelay(attempt, retryAfterMs);
            console.warn(
              `[Perplexity] ${opts.endpoint} HTTP ${status} (attempt ${attempt + 1}/${maxRetries + 1})` +
                ` — retrying in ${Math.round(wait)}ms${opts.context ? ` ctx=${JSON.stringify(opts.context)}` : ""}`,
            );
            logLlmCall({ provider: "perplexity", model, endpoint: opts.endpoint, startedAt, httpStatus: status, errorMessage: `HTTP ${status} (retry ${attempt + 1})` });
            await sleep(wait, opts.signal);
            lastErr = new Error(`Perplexity HTTP ${status}: ${bodyText.slice(0, 200)}`);
            continue;
          }
          logLlmCall({ provider: "perplexity", model, endpoint: opts.endpoint, startedAt, httpStatus: status, errorMessage: `HTTP ${status}` });
          const finalErr = new Error(`Perplexity HTTP ${status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`);
          if (shouldFallback(finalErr)) {
            try {
              const fb = await geminiOnlineFallback(opts, finalErr);
              if (cacheKey) void writeCache(cacheKey, model, fb, undefined, opts.endpoint);
              return fb;
            } catch {
              throw finalErr;
            }
          }
          throw finalErr;
        }

        const data = (await resp.json()) as PerplexityChatResponse;
        logLlmCall({ provider: "perplexity", model, endpoint: opts.endpoint, startedAt, httpStatus: resp.status, responseJson: data });
        if (cacheKey) void writeCache(cacheKey, model, data, undefined, opts.endpoint);
        return data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isAbort = msg === "aborted" || (err instanceof Error && err.name === "AbortError");
        if (isAbort && opts.signal?.aborted) throw err;
        const isNetwork = !msg.startsWith("Perplexity HTTP");
        if (isNetwork && attempt < maxRetries) {
          const wait = backoffDelay(attempt, null);
          console.warn(
            `[Perplexity] ${opts.endpoint} network error "${msg}" (attempt ${attempt + 1}/${maxRetries + 1})` +
              ` — retrying in ${Math.round(wait)}ms${opts.context ? ` ctx=${JSON.stringify(opts.context)}` : ""}`,
          );
          logLlmCall({ provider: "perplexity", model, endpoint: opts.endpoint, startedAt, errorMessage: `${msg} (retry ${attempt + 1})` });
          await sleep(wait, opts.signal);
          lastErr = err instanceof Error ? err : new Error(msg);
          continue;
        }
        if (!msg.startsWith("Perplexity HTTP")) {
          logLlmCall({ provider: "perplexity", model, endpoint: opts.endpoint, startedAt, errorMessage: msg });
        }
        const finalErr = err instanceof Error ? err : new Error(msg);
        if (shouldFallback(finalErr)) {
          try {
            const fb = await geminiOnlineFallback(opts, finalErr);
            if (cacheKey) void writeCache(cacheKey, model, fb, undefined, opts.endpoint);
            return fb;
          } catch {
            throw finalErr;
          }
        }
        throw finalErr;
      }
    }
    const exhausted = lastErr ?? new Error(`Perplexity ${opts.endpoint} failed after ${maxRetries + 1} attempts`);
    if (shouldFallback(exhausted)) {
      try {
        const fb = await geminiOnlineFallback(opts, exhausted);
        if (cacheKey) void writeCache(cacheKey, model, fb, undefined, opts.endpoint);
        return fb;
      } catch {
        throw exhausted;
      }
    }
    throw exhausted;
  } finally {
    release();
  }
}
