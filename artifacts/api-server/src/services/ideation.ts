/**
 * AI ideation sidekick.
 *
 * Shared Claude-powered prompts used across the workbench (B1), the analogue
 * finder (B2), and the disruption / new-capability surfaces. Each prompt kind
 * has a stable signature so outputs can be cached by (kind, inputHash) in the
 * workbench_card_insights table.
 *
 * Five kinds:
 *  - generate_applications: "give me 10 unexpected applications of this capability"
 *  - find_analogues:        "what's the cross-industry analogue of this capability in industry X"
 *  - critique_idea:         "critique this disruption idea on plausibility, defensibility, and moat"
 *  - what_to_invent:        "what capability would I need to invent to disrupt market X"
 *  - lifecycle_outlook:     "is this capability leading, peaking, or declining — and why"
 *
 * All five run through chatWithFallback (Sonnet → Haiku → GLM 5.1) so they
 * gracefully degrade under credit pressure.
 */
import { chatWithFallback, EDITORIAL_FALLBACK_CHAIN } from "./llm-fallback";

export type IdeationKind =
  | "generate_applications"
  | "find_analogues"
  | "critique_idea"
  | "what_to_invent"
  | "lifecycle_outlook";

export interface IdeationContext {
  capabilityName: string;
  capabilityDescription: string;
  industryName: string;
  lifecycleStage?: string;
  consensusScore?: number | null;
  velocity?: number | null;
  // Free-form analyst note that came from the workbench card. Lets the user
  // bias the AI: "give me applications outside the financial-services lens" etc.
  userPrompt?: string;
  // For find_analogues / what_to_invent — the target industry or market.
  targetIndustryName?: string;
  targetMarketDescription?: string;
}

export interface IdeationResult {
  kind: IdeationKind;
  text: string;
  modelUsed: string;
  fallbackCount: number;
  generatedAt: string;
  /** When the response is a structured list, the parsed lines for UI rendering.
   *  Empty array means the response was free-form prose. */
  bullets: string[];
}

const SYSTEM_PROMPT = `You are an applied-strategy analyst helping a senior operator (CSO, founder, or PE
partner) think about a business capability. You combine three habits of mind:

1. Cross-industry pattern matching — you see how a capability that's mature in
   one industry can be a white-space opportunity in another.
2. Schumpeterian disruption framing — you ask not "how do we do X better" but
   "what new capability would have to exist to make X irrelevant."
3. Brutally honest critique — when an idea is weak (defensibility, scale,
   moat), you say so plainly.

You write concisely. You use plain language. You avoid management-consulting
hedge words ("could potentially," "may possibly"). You make claims and let
the user push back. When you're uncertain, you mark the claim with
[uncertain: …] in-line.

Output format: a numbered list when the prompt asks for multiple items
(applications, analogues, critiques). A short prose paragraph when the prompt
asks for a single judgment. No preamble, no "I'll now…" framing — just the
content.`;

function fmtContext(ctx: IdeationContext): string {
  const lines = [
    `Capability: ${ctx.capabilityName}`,
    `Industry: ${ctx.industryName}`,
    `Description: ${ctx.capabilityDescription}`,
  ];
  if (ctx.lifecycleStage) lines.push(`Lifecycle stage: ${ctx.lifecycleStage}`);
  if (ctx.consensusScore !== undefined && ctx.consensusScore !== null) {
    lines.push(`Current CVI score (0-100): ${ctx.consensusScore.toFixed(1)}`);
  }
  if (ctx.velocity !== undefined && ctx.velocity !== null) {
    lines.push(`Velocity (pts/window, +ve = rising): ${ctx.velocity.toFixed(2)}`);
  }
  return lines.join("\n");
}

function buildUserPrompt(kind: IdeationKind, ctx: IdeationContext): string {
  const head = fmtContext(ctx);
  switch (kind) {
    case "generate_applications":
      return `${head}

Generate 10 unexpected applications of this capability. Mix obvious applications
with non-obvious cross-industry stretches. For each, give a one-line description
plus the industry it would land in. Number them 1–10.${ctx.userPrompt ? `\n\nUser bias: ${ctx.userPrompt}` : ""}`;
    case "find_analogues":
      return `${head}
Target industry: ${ctx.targetIndustryName ?? "(not specified)"}

Where does this capability already exist in the target industry, or where would
the *analogue* of this capability sit in that industry? Name the analogue, the
maturity level you'd estimate, the white-space gap if it doesn't exist yet, and
one concrete first move an operator could make to capture it.${ctx.userPrompt ? `\n\nUser bias: ${ctx.userPrompt}` : ""}`;
    case "critique_idea":
      return `${head}
The user's disruption idea: ${ctx.userPrompt ?? "(not provided)"}

Critique this idea across four dimensions: (1) is the capability actually
displaceable, or is the incumbent moat structural; (2) what is the defensibility
of the proposed approach — does it create a new capability or just a feature;
(3) what's the time-to-traction (months to a paying customer); (4) what's the
single biggest reason this fails. Be direct. End with a verdict: pursue / kill / reshape.`;
    case "what_to_invent":
      return `${head}
Target market to disrupt: ${ctx.targetMarketDescription ?? ctx.targetIndustryName ?? "(not specified)"}

What capability would have to be invented (not just adopted) to displace the
incumbents in this market? The Uber pattern: not "use GPS better," but combine
mobile-GPS + payments + ratings + supply-demand-matching into a *new* capability
called "ride-hailing platform." Give 3 candidate inventions. For each: name the
new capability, list the 3-5 existing capabilities it cross-pollinates, and
identify the moat it creates.${ctx.userPrompt ? `\n\nUser bias: ${ctx.userPrompt}` : ""}`;
    case "lifecycle_outlook":
      return `${head}

Is this capability leading, peaking, or declining? Give a one-paragraph
verdict that references the lifecycle stage and velocity numbers above, then
identifies the most likely 12-24 month trajectory (continue rising, plateau,
get displaced by a successor capability, etc.). If you think a successor is
emerging, name it.`;
  }
}

function parseBullets(text: string): string[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const numbered = lines.filter(l => /^\d+[.)]\s/.test(l));
  if (numbered.length >= 2) {
    return numbered.map(l => l.replace(/^\d+[.)]\s*/, ""));
  }
  const bulleted = lines.filter(l => /^[-*•]\s/.test(l));
  if (bulleted.length >= 2) {
    return bulleted.map(l => l.replace(/^[-*•]\s*/, ""));
  }
  return [];
}

const MAX_TOKENS_BY_KIND: Record<IdeationKind, number> = {
  generate_applications: 1500,
  find_analogues: 1200,
  critique_idea: 1500,
  what_to_invent: 1800,
  lifecycle_outlook: 800,
};

export async function runIdeation(kind: IdeationKind, ctx: IdeationContext): Promise<IdeationResult> {
  const userPrompt = buildUserPrompt(kind, ctx);
  const res = await chatWithFallback({
    models: EDITORIAL_FALLBACK_CHAIN,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    maxTokens: MAX_TOKENS_BY_KIND[kind],
    endpoint: `ideation:${kind}`,
  });
  return {
    kind,
    text: res.text.trim(),
    modelUsed: res.modelUsed,
    fallbackCount: res.fallbackCount,
    generatedAt: new Date().toISOString(),
    bullets: parseBullets(res.text),
  };
}

/** Stable, content-derived cache key. Caller persists the result keyed on this
 *  so refresh / re-render doesn't re-bill OpenRouter. */
export function ideationCacheKey(kind: IdeationKind, ctx: IdeationContext): string {
  const parts = [
    kind,
    ctx.capabilityName,
    ctx.industryName,
    ctx.userPrompt ?? "",
    ctx.targetIndustryName ?? "",
    ctx.targetMarketDescription ?? "",
  ];
  return parts.join("|").slice(0, 500);
}
