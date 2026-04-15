import Anthropic from "@anthropic-ai/sdk";

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is required.");
}

const OPENROUTER_MODEL_MAP: Record<string, string> = {
  "claude-haiku-4-5":  "anthropic/claude-haiku-4.5",
  "claude-sonnet-4-5": "anthropic/claude-sonnet-4.5",
  "claude-opus-4-5":   "anthropic/claude-opus-4.5",
  "claude-haiku-3-5":  "anthropic/claude-3.5-haiku",
  "claude-sonnet-3-5": "anthropic/claude-3.7-sonnet",
  "claude-3-haiku":    "anthropic/claude-3-haiku",
};

export const anthropic = new Anthropic({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://capabilityeconomics.com",
    "X-Title": "Capability Economics",
  },
});

export function resolveModel(shortName: string): string {
  if (OPENROUTER_MODEL_MAP[shortName]) return OPENROUTER_MODEL_MAP[shortName];
  if (shortName.startsWith("anthropic/") || shortName.startsWith("deepseek/")) return shortName;
  return `anthropic/${shortName}`;
}
