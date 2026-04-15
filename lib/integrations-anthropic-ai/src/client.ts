import Anthropic from "@anthropic-ai/sdk";

const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
const hasReplitProxy =
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL &&
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
const hasDirectKey = !!process.env.ANTHROPIC_API_KEY;

if (!hasOpenRouter && !hasReplitProxy && !hasDirectKey) {
  throw new Error(
    "No LLM credentials found. Set OPENROUTER_API_KEY (preferred), or AI_INTEGRATIONS_ANTHROPIC_BASE_URL + AI_INTEGRATIONS_ANTHROPIC_API_KEY, or ANTHROPIC_API_KEY.",
  );
}

const OPENROUTER_MODEL_MAP: Record<string, string> = {
  "claude-haiku-4-5":   "anthropic/claude-haiku-4.5",
  "claude-sonnet-4-5":  "anthropic/claude-sonnet-4.5",
  "claude-opus-4-5":    "anthropic/claude-opus-4.5",
  "claude-haiku-3-5":   "anthropic/claude-3.5-haiku",
  "claude-sonnet-3-5":  "anthropic/claude-3.7-sonnet",
  "claude-3-haiku":     "anthropic/claude-3-haiku",
};

function buildClient(): Anthropic {
  if (hasOpenRouter) {
    return new Anthropic({
      apiKey: process.env.OPENROUTER_API_KEY!,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://capabilityeconomics.com",
        "X-Title": "Capability Economics",
      },
    });
  }
  if (hasReplitProxy) {
    return new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY!,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL!,
    });
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

export const anthropic = buildClient();

export function resolveModel(shortName: string): string {
  if (hasOpenRouter) {
    if (OPENROUTER_MODEL_MAP[shortName]) return OPENROUTER_MODEL_MAP[shortName];
    if (shortName.startsWith("anthropic/") || shortName.startsWith("deepseek/")) return shortName;
    return `anthropic/${shortName}`;
  }
  return shortName;
}
