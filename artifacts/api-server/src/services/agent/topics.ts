/**
 * Topic inference for agent observations + memories.
 *
 * The consolidator groups by industry::capability::topic. Without an
 * explicit topic on every observation, everything collapses into
 * "general" and the consolidator's pattern synthesis loses specificity.
 * Lightweight keyword classifier — good enough; a future iteration can
 * swap to a Haiku call if precision matters more than latency.
 *
 * Per plan Phase 1.6.1.
 */

export type Topic =
  | "regulatory"
  | "m_and_a"
  | "talent"
  | "ai_adoption"
  | "infrastructure"
  | "financial"
  | "competitive_pressure"
  | "innovation"
  | "general";

const PATTERNS: ReadonlyArray<readonly [Topic, RegExp]> = [
  ["regulatory", /\b(regulat|compliance|policy|legislation|law|sec|gdpr|hipaa|dora|sox|antitrust)/i],
  ["m_and_a", /\b(acqui|merger|m&a|deal|buyout|ipo|divest|spin-?off)/i],
  ["talent", /\b(talent|hiring|workforce|headcount|layoff|attrition|skill gap|reskill)/i],
  ["ai_adoption", /\b(automat|ai adoption|llm|generative ai|copilot|agentic|foundation model|prompt eng)/i],
  ["infrastructure", /\b(cloud migration|platform|saas|paas|infra|kubernetes|data center|edge comput)/i],
  ["financial", /\b(revenue|earnings|margin|profit|cost structure|pricing|capex|opex|ebitda)/i],
  ["competitive_pressure", /\b(competitor|market share|disrupt|substitute|new entrant|incumbent)/i],
  ["innovation", /\b(patent|r&d|prototype|breakthrough|novel|first-?to-?market)/i],
];

export function inferTopic(content: string): Topic {
  if (!content) return "general";
  for (const [topic, re] of PATTERNS) {
    if (re.test(content)) return topic;
  }
  return "general";
}
