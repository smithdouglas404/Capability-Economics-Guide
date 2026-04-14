import Anthropic from "@anthropic-ai/sdk";

const hasReplitProxy =
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL &&
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

const hasDirectKey = !!process.env.ANTHROPIC_API_KEY;
const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;

if (!hasReplitProxy && !hasDirectKey && !hasOpenRouter) {
  throw new Error(
    "No LLM credentials found. Set one of: AI_INTEGRATIONS_ANTHROPIC_BASE_URL + AI_INTEGRATIONS_ANTHROPIC_API_KEY (Replit), ANTHROPIC_API_KEY (direct), or OPENROUTER_API_KEY (OpenRouter).",
  );
}

function buildClient(): Anthropic {
  if (hasReplitProxy) {
    return new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY!,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL!,
    });
  }
  if (hasDirectKey) {
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return new Anthropic({
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://capabilityeconomics.com",
      "X-Title": "Capability Economics",
    },
  });
}

export const anthropic = buildClient();

export function resolveModel(shortName: string): string {
  if (hasReplitProxy || hasDirectKey) return shortName;
  return shortName.startsWith("anthropic/") ? shortName : `anthropic/${shortName}`;
}
