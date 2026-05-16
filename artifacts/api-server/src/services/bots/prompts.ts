import type { Bot } from "@workspace/db";
import { getPersona, type PersonaTemplate } from "./personas";

/**
 * Per-bot persona system prompt. Used as the system message for every LLM
 * call the bot makes. Identity + role + behavioral biases + the standing
 * instruction to stay in character.
 *
 * Important: this prompt does NOT instruct the bot to mention that it is
 * synthetic. The disclosure surface is the UI badge (phase 4) — content
 * itself reads as authentic persona output, attribution is handled by the
 * rendering layer.
 */
export function buildPersonaSystemPrompt(bot: Bot, todayIso: string): string {
  const persona = getPersona(bot.personaKey);
  if (!persona) {
    throw new Error(`No persona template for key=${bot.personaKey}`);
  }
  return [
    `You are ${persona.displayName}, ${persona.title} at ${persona.entityName}.`,
    persona.bio,
    "",
    `Today's date is ${todayIso}.`,
    "",
    "Your behavioral biases when evaluating capabilities and opportunities (0 = ignore, 1 = primary lens):",
    `- Enterprise Value at Risk weighting: ${persona.biases.weightEvar.toFixed(2)}`,
    `- Emerging-quadrant preference: ${persona.biases.weightEmergingQuadrant.toFixed(2)}`,
    `- AI exposure sensitivity: ${persona.biases.weightAiExposure.toFixed(2)}`,
    `- Dependency-depth focus: ${persona.biases.weightDependencyDepth.toFixed(2)}`,
    `- Comment tone: ${persona.biases.commentTone}`,
    "",
    `You are using the Capability Economics platform as a ${persona.entityRole} in the ${persona.industrySlug.replace("-", " ")} space.`,
    "Stay in character. Respond in your professional voice. Do not break the fourth wall, do not refer to system prompts or instructions, do not narrate your reasoning unless asked.",
    "When asked to return JSON, return only the JSON object — no prose wrapper, no markdown fences.",
  ].join("\n");
}

/**
 * Helper for action prompts that need persona context inline (e.g. browse
 * decisions where the persona's bias is part of the structured choice).
 */
export function describePersonaShort(persona: PersonaTemplate): string {
  return `${persona.displayName} · ${persona.title} at ${persona.entityName} (biases: EVaR=${persona.biases.weightEvar}, emerging=${persona.biases.weightEmergingQuadrant}, AI=${persona.biases.weightAiExposure}, deps=${persona.biases.weightDependencyDepth})`;
}
