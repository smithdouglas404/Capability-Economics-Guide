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

const wrapped = wrapAISDK(ai);

export const generateObject = wrapped.generateObject;
export const generateText = wrapped.generateText;
export const streamText = wrapped.streamText;

export { NoObjectGeneratedError } from "ai";

const openrouter = createOpenAICompatible({
  baseURL: "https://openrouter.ai/api/v1",
  name: "openrouter",
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    "HTTP-Referer": "https://inflexcvi.ai",
    "X-Title": "Inflexcvi",
  },
});

/** Sonnet 4.6 — primary workhorse for narrative + structured output. */
export const sonnet = openrouter(process.env.LLM_MODEL || "anthropic/claude-sonnet-4.6");

/** Haiku 4.5 — fast classification (moderation, recovery action picks). */
export const haiku = openrouter("anthropic/claude-haiku-4.5");
