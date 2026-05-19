/**
 * OpenRouter-backed model clients for the Vercel AI SDK, plus the
 * LangSmith-wrapped `generateObject` / `generateText` / `streamText`
 * entry points.
 *
 * `wrapAISDK(ai)` (from `langsmith/experimental/vercel`) wraps the entire
 * `ai` namespace so every call auto-traces to LangSmith when
 * `LANGCHAIN_TRACING_V2=true` + `LANGCHAIN_API_KEY` are set on the
 * api-server service. When those env vars are absent, wrapping is a
 * no-op — calls still execute, they just don't ship traces.
 *
 * Everywhere else in the codebase should import `generateObject` from
 * THIS module (not from `"ai"` directly), otherwise the call bypasses
 * tracing.
 *
 * We point `@ai-sdk/openai-compatible` at https://openrouter.ai/api/v1
 * instead of going to Anthropic / OpenAI direct so we keep:
 *   - OpenRouter's prompt caching (substantial cost savings on long system prompts)
 *   - OpenRouter's per-account fallback chain
 *   - The existing OPENROUTER_API_KEY env var (no provider key rotation)
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import * as ai from "ai";
import { wrapAISDK } from "langsmith/experimental/vercel";
import { logLlmCall } from "../llm-usage";

const wrapped = wrapAISDK(ai);

export const generateObject = wrapped.generateObject;
export const generateText = wrapped.generateText;
export const streamText = wrapped.streamText;

export { NoObjectGeneratedError } from "ai";

/**
 * Custom fetch that bridges Vercel AI SDK → our llm_usage table.
 *
 * Two jobs:
 *   1. Inject `usage: { include: true }` into the request body so
 *      OpenRouter populates the exact billed cost in the response.
 *      The AI SDK builds the body internally — this is the only hook
 *      where we can mutate it before send.
 *   2. After the response, mirror the response JSON into logLlmCall
 *      so workflows show up in the cost dashboard alongside the
 *      direct-fetch callers (consolidator, enrichment/graph, etc.).
 *
 * Non-streaming completions only — streamText returns SSE which we
 * don't try to mid-stream parse. Streaming workflows fall back to
 * the token-estimate path (no regression vs today, just not exact).
 */
async function openrouterFetchWithUsageTracking(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const startedAt = Date.now();
  let modelForLog = "unknown";

  // Mutate the request body to opt into exact-cost reporting.
  let body = init?.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body) as { model?: string; usage?: unknown; stream?: boolean };
      modelForLog = parsed.model ?? "unknown";
      parsed.usage = { ...(typeof parsed.usage === "object" && parsed.usage !== null ? parsed.usage : {}), include: true };
      body = JSON.stringify(parsed);
    } catch {
      // Body wasn't JSON — leave it alone, AI SDK will produce its
      // own error and our outer wrapper handles it.
    }
  }
  const mutatedInit: RequestInit = body !== undefined ? { ...init, body } : (init ?? {});

  const resp = await fetch(input, mutatedInit);

  // Mirror non-streaming responses into logLlmCall. We can't consume
  // the stream because the AI SDK is about to read it; clone first.
  const isStreaming = resp.headers.get("content-type")?.includes("text/event-stream");
  if (!isStreaming) {
    resp
      .clone()
      .json()
      .then((data: unknown) => {
        logLlmCall({
          provider: "openrouter",
          model: modelForLog,
          endpoint: "workflows",
          startedAt,
          httpStatus: resp.status,
          responseJson: data,
        });
      })
      .catch(() => {
        // Body wasn't JSON, or already consumed — fall back to a minimal log
        logLlmCall({
          provider: "openrouter",
          model: modelForLog,
          endpoint: "workflows",
          startedAt,
          httpStatus: resp.status,
          errorMessage: resp.ok ? undefined : `HTTP ${resp.status}`,
        });
      });
  }
  return resp;
}

const openrouter = createOpenAICompatible({
  baseURL: "https://openrouter.ai/api/v1",
  name: "openrouter",
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": "https://inflexcvi.ai",
    "X-Title": "Inflexcvi",
  },
  fetch: openrouterFetchWithUsageTracking,
});

/** Sonnet 4.6 — primary workhorse for narrative + structured output. */
export const sonnet = openrouter(process.env.LLM_MODEL || "anthropic/claude-sonnet-4.6");

/** Haiku 4.5 — fast classification (moderation, recovery action picks). */
export const haiku = openrouter("anthropic/claude-haiku-4.5");

/**
 * Escape hatch for the rare callsite that needs a model slug at runtime
 * (e.g. the admin model-comparison endpoint that runs Sonnet vs DeepSeek
 * side-by-side). Prefer `sonnet` / `haiku` exports for everything else.
 */
export function modelFor(slug: string) {
  return openrouter(slug);
}
