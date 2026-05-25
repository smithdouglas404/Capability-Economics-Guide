import { logLlmCall } from "./llm-usage";
import { maybeStepAiWrap } from "../inngest/step-context";

export interface FallbackChatArgs {
  /** Ordered list of OpenRouter model slugs. First is primary; later entries are fallbacks. */
  models: string[];
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  maxTokens: number;
  /** Tag for llm_usage logging — e.g. "csuite_perspective:cto". */
  endpoint: string;
  /** Per-attempt timeout. Defaults to 60s. */
  timeoutMs?: number;
  /** Optional response_format for structured output. */
  responseFormat?: { type: "json_object" };
}

export interface FallbackChatResult {
  /** Raw assistant text. */
  text: string;
  /** Model slug that actually returned the response. */
  modelUsed: string;
  /** Number of fallback steps taken (0 = primary worked). */
  fallbackCount: number;
}

/**
 * Returns true if an OpenRouter error indicates the model can't be afforded,
 * so we should try the next model in the chain instead of failing the whole call.
 *
 * Covers GLM's "requires more credits, or fewer max_tokens" wording, generic
 * insufficient-credits/quota wording, and HTTP 402.
 */
function isBudgetError(httpStatus: number | undefined, message: string | undefined): boolean {
  if (httpStatus === 402) return true;
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("requires more credits") ||
    m.includes("insufficient credit") ||
    m.includes("insufficient_credits") ||
    m.includes("can afford") ||
    m.includes("quota exceeded") ||
    m.includes("payment required")
  );
}

/**
 * Chat completion with budget-aware model fallback.
 *
 * Tries each model in order. On budget/credit errors, advances to the next model
 * and logs the fallback. On non-budget errors (auth, malformed request, network),
 * fails fast — those won't be fixed by trying a cheaper model.
 *
 * Every attempt — successful or not — is logged via logLlmCall so the admin
 * dashboard can show per-endpoint success/failure rates.
 */
export async function chatWithFallback(args: FallbackChatArgs): Promise<FallbackChatResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");
  if (args.models.length === 0) throw new Error("chatWithFallback requires at least one model");

  const timeoutMs = args.timeoutMs ?? 60_000;
  let lastError: Error | null = null;

  for (let i = 0; i < args.models.length; i++) {
    const model = args.models[i];
    const startedAt = Date.now();
    let httpStatus: number | undefined;
    let responseJson: unknown;
    let errorMessage: string | undefined;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let resp: Response;
      try {
        resp = await maybeStepAiWrap(`openrouter:llm-fallback:${model}`, () =>
          fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://inflexcvi.ai",
              "X-Title": "Inflexcvi",
            },
            body: JSON.stringify({
              model,
              max_tokens: args.maxTokens,
              messages: args.messages,
              // Opt into OpenRouter's exact-cost reporting — adds `cost` to
              // the response `usage` object (USD billed for this call,
              // including provider markup + cache discounts). logLlmCall
              // prefers this over the local PRICING-table estimate.
              usage: { include: true },
              ...(args.responseFormat ? { response_format: args.responseFormat } : {}),
            }),
            signal: controller.signal,
          }),
        );
      } finally {
        clearTimeout(timer);
      }
      httpStatus = resp.status;
      responseJson = await resp.json();
      const data = responseJson as {
        choices?: Array<{ message: { content: string } }>;
        error?: { message?: string; code?: number | string };
      };

      if (data.error) {
        errorMessage = data.error.message ?? "OpenRouter error";
        throw new Error(errorMessage);
      }
      if (!resp.ok) {
        errorMessage = `HTTP ${resp.status}`;
        throw new Error(errorMessage);
      }
      const text = data.choices?.[0]?.message?.content ?? "";
      if (!text) {
        errorMessage = "Empty completion";
        throw new Error(errorMessage);
      }

      logLlmCall({ provider: "openrouter", model, endpoint: args.endpoint, responseJson, startedAt, httpStatus });
      if (i > 0) {
        console.log(`[llm-fallback] ${args.endpoint}: succeeded on fallback model ${model} (skipped ${i} primary/intermediate model${i === 1 ? "" : "s"})`);
      }
      return { text, modelUsed: model, fallbackCount: i };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorMessage = errorMessage ?? msg;
      lastError = err instanceof Error ? err : new Error(msg);
      logLlmCall({ provider: "openrouter", model, endpoint: args.endpoint, responseJson, startedAt, httpStatus, errorMessage });

      const budget = isBudgetError(httpStatus, errorMessage);
      const hasMoreModels = i < args.models.length - 1;
      if (budget && hasMoreModels) {
        console.warn(`[llm-fallback] ${args.endpoint}: ${model} hit budget limit ("${errorMessage.slice(0, 80)}"), trying ${args.models[i + 1]}`);
        continue;
      }
      // Non-budget error or out of fallbacks → bail.
      throw lastError;
    }
  }

  throw lastError ?? new Error("chatWithFallback exhausted all models");
}

/**
 * Default model chain for editorial JSON generation: Sonnet (best) → Haiku (cheap)
 * → GLM 5.1 (cheapest). Keep this short: each fallback adds latency and the
 * cheapest model still produces usable structured output for our schemas.
 */
export const EDITORIAL_FALLBACK_CHAIN = [
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-haiku-4.5",
  "z-ai/glm-5.1",
];
