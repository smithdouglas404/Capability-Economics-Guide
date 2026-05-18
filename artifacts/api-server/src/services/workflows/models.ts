/**
 * OpenRouter-backed model clients for the Vercel AI SDK.
 *
 * We point `@ai-sdk/openai-compatible` at https://openrouter.ai/api/v1
 * instead of going to Anthropic / OpenAI direct so we keep:
 *   - OpenRouter's prompt caching (substantial cost savings on long system prompts)
 *   - OpenRouter's per-account fallback chain
 *   - The existing OPENROUTER_API_KEY env var (no provider key rotation)
 *
 * Use `sonnet` for nuanced narrative + structured output; `haiku` for
 * fast classification (listing moderation, payment recovery). Both are
 * LanguageModelV1 objects compatible with `generateObject`, `generateText`,
 * `streamText` from the `ai` package.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

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
