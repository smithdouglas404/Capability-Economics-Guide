import { logLlmCall } from "../llm-usage";

/**
 * LLM helper for bot actions. Wraps the standard OpenRouter chat completion
 * with two bot-specific concerns:
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
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  const startedAt = Date.now();
  const endpoint = `bot:${opts.personaKey}:${opts.actionType}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  let resp: Response;
  let responseJson: unknown = null;
  let httpStatus: number | undefined;
  let errorMessage: string | undefined;

  try {
    resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://inflexcvi.ai",
        "X-Title": `Inflexcvi Bot · ${opts.personaKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 1024,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: opts.systemPrompt },
          { role: "user", content: opts.userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    httpStatus = resp.status;
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => "");
      errorMessage = `OpenRouter ${resp.status}: ${bodyText.slice(0, 200)}`;
      throw new Error(errorMessage);
    }
    responseJson = await resp.json();
  } catch (err) {
    errorMessage = errorMessage ?? (err instanceof Error ? err.message : String(err));
    logLlmCall({ provider: "openrouter", model: opts.model, endpoint, responseJson, startedAt, httpStatus, errorMessage });
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const r = responseJson as {
    choices?: Array<{ message: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };
  if (r.error) {
    logLlmCall({ provider: "openrouter", model: opts.model, endpoint, responseJson, startedAt, httpStatus, errorMessage: r.error.message });
    throw new Error(`OpenRouter error: ${r.error.message ?? "unknown"}`);
  }

  const content = r.choices?.[0]?.message?.content ?? "";
  const inputTokens = r.usage?.prompt_tokens ?? 0;
  const outputTokens = r.usage?.completion_tokens ?? 0;
  const price = PRICING_PER_MTOK[opts.model] ?? { input: 1, output: 3 };
  const costUsd = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
  const costCents = Math.ceil(costUsd * 100);

  // Mirror to llm_usage so the existing admin dashboard sees bot spend.
  logLlmCall({ provider: "openrouter", model: opts.model, endpoint, responseJson, startedAt, httpStatus });

  return {
    content,
    costCents,
    inputTokens,
    outputTokens,
    durationMs: Date.now() - startedAt,
  };
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
