import Anthropic from "@anthropic-ai/sdk";

const hasReplitProxy =
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL &&
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;

const hasDirectKey = !!process.env.ANTHROPIC_API_KEY;

if (!hasReplitProxy && !hasDirectKey) {
  throw new Error(
    "Anthropic credentials required: set AI_INTEGRATIONS_ANTHROPIC_BASE_URL + AI_INTEGRATIONS_ANTHROPIC_API_KEY (Replit proxy), or ANTHROPIC_API_KEY (direct Anthropic key).",
  );
}

export const anthropic = hasReplitProxy
  ? new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY!,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL!,
    })
  : new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY!,
    });
