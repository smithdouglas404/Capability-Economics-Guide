import { logLlmCall } from "../llm-usage";
import { modelFor, generateText } from "../workflows/models";

/**
 * LLM helper for bot actions. Wraps the LangSmith-traced Vercel AI SDK
 * `generateText` with two bot-specific concerns:
 *   1. Returns the computed cost in cents alongside the response, so the
 *      caller can attribute it to a bot_actions row.
 *   2. Logs to llm_usage with an endpoint convention `bot:<persona>:<action>`
 *      so the existing admin LLM dashboard can break down spend per bot.
 *
 * Pricing for the supported bot models (matches services/llm-usage.ts):
 *   - anthropic/claude-haiku-4.5:  $1 / $5  per MTok
 *   - anthropic/claude-sonnet-4.6: $3 / $15 per MTok
 */
const PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "anthropic/claude-haiku-4.5": { input: 1, output: 5 },
  "anthropic/claude-sonnet-4.6": { input: 3, output: 15 },
};

export interface BotLlmCallOpts {
  model: "anthropic/claude-haiku-4.5" | "anthropic/claude-sonnet-4.6";
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  jsonMode?: boolean;
  personaKey: string;
  actionType: string;
}

export interface BotLlmResult {
  content: string;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export async function botLlmCall(opts: BotLlmCallOpts): Promise<BotLlmResult> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");
  const startedAt = Date.now();
  const endpoint = `bot:${opts.personaKey}:${opts.actionType}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  try {
    const { text, usage } = await generateText({
      model: modelFor(opts.model),
      system: opts.systemPrompt,
      prompt: opts.userPrompt,
      maxTokens: opts.maxTokens ?? 1024,
      abortSignal: controller.signal,
      // OpenRouter JSON mode is propagated via providerOptions when needed.
      ...(opts.jsonMode ? { providerOptions: { openrouter: { response_format: { type: "json_object" } } } } : {}),
    });

    const inputTokens = usage?.promptTokens ?? 0;
    const outputTokens = usage?.completionTokens ?? 0;
    const price = PRICING_PER_MTOK[opts.model] ?? { input: 1, output: 3 };
    const costUsd = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
    const costCents = Math.ceil(costUsd * 100);

    // Shim a snake_case usage object so logLlmCall's existing reader keeps working.
    const responseJson = { usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens } };
    logLlmCall({ provider: "openrouter", model: opts.model, endpoint, responseJson, startedAt });

    return {
      content: text,
      costCents,
      inputTokens,
      outputTokens,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logLlmCall({ provider: "openrouter", model: opts.model, endpoint, startedAt, errorMessage });
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Strip code fences and parse JSON. Helper for actions that ask the model
 * for structured output. Throws if no parseable JSON object is found.
 */
export function extractJson<T = unknown>(text: string): T {
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]) as T; } catch { /* fall through */ }
  }
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]) as T; } catch { /* fall through */ }
  }
  throw new Error(`Bot LLM returned non-JSON content: ${cleaned.slice(0, 200)}`);
}
