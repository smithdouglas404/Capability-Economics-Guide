import { logLlmCall } from "./llm-usage";

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
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
          resp = await fetch(PERPLEXITY_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model, messages: opts.messages }),
            signal: ac.signal,
          });
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
          throw new Error(`Perplexity HTTP ${status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ""}`);
        }

        const data = (await resp.json()) as PerplexityChatResponse;
        logLlmCall({ provider: "perplexity", model, endpoint: opts.endpoint, startedAt, httpStatus: resp.status, responseJson: data });
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
        throw err;
      }
    }
    throw lastErr ?? new Error(`Perplexity ${opts.endpoint} failed after ${maxRetries + 1} attempts`);
  } finally {
    release();
  }
}
