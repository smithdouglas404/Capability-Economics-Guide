import { tool } from "@langchain/core/tools";
import { z } from "zod";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";

async function glmCallOnce(prompt: string, opts: { maxTokens: number; timeoutMs: number; jsonMode: boolean; model: string }): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [{ role: "user", content: prompt }],
    };
    if (opts.jsonMode) {
      body.response_format = { type: "json_object" };
      // Disable reasoning emission in JSON mode so reasoning tokens don't consume max_tokens
      // and truncate the JSON output. GLM 5.1 otherwise emits large reasoning blocks.
      body.reasoning = { enabled: false, exclude: true };
    }
    const resp = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`OpenRouter ${resp.status} (model=${opts.model}): ${(await resp.text()).slice(0, 400)}`);
    const data = await resp.json() as { choices: Array<{ message: { content: string; reasoning?: string } }> };
    const msg = data.choices[0]?.message;
    return (msg?.content && msg.content.trim().length > 0) ? msg.content : (msg?.reasoning ?? "");
  } finally { clearTimeout(timer); }
}

async function glmCall(prompt: string, maxTokens = 4096, timeoutMs = 180_000, jsonMode = false): Promise<string> {
  // VCR synthesis runs on Claude Sonnet 4.6 — comparable JSON reliability,
  // ~2.5x faster than GLM 5.1, and noticeably richer narrative content (named
  // vendors, specific $ figures, multi-thread synthesis). Function name kept
  // as `glmCall` to avoid sweeping renames; body is model-agnostic.
  // Override via LLM_MODEL env var to swap models without redeploy.
  const models = [process.env.LLM_MODEL || "anthropic/claude-sonnet-4.6"];
  let lastErr: unknown = null;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await glmCallOnce(prompt, { maxTokens, timeoutMs, jsonMode, model });
        if (out && out.trim().length > 0) return out;
        lastErr = new Error(`empty content from ${model}`);
      } catch (e) {
        lastErr = e;
        console.warn(`[glmCall] ${model} attempt ${attempt + 1} failed:`, e instanceof Error ? e.message : e);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("GLM all retries failed");
}

export function extractJSON<T>(raw: string): T | null {
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : raw;
  const start = candidate.indexOf("{");
  const startA = candidate.indexOf("[");
  let s = -1;
  if (start === -1) s = startA;
  else if (startA === -1) s = start;
  else s = Math.min(start, startA);
  if (s === -1) return null;
  const open = candidate[s];
  const close = open === "{" ? "}" : "]";
  const end = candidate.lastIndexOf(close);
  if (end === -1 || end < s) return null;
  try { return JSON.parse(candidate.slice(s, end + 1)) as T; } catch { return null; }
}

// Salvage retry: when an LLM returns text we can't parse as JSON, ask the
// model once to repair it. Caps at one retry to bound cost. Returns null only
// after both the direct parse AND the repair attempt fail — callers can then
// fall back to a stub or surface an error to the user instead of silently
// dropping the work.
export async function parseJsonWithRepair<T>(raw: string, opts?: { schemaHint?: string; label?: string }): Promise<T | null> {
  const direct = extractJSON<T>(raw);
  if (direct !== null) return direct;
  if (!raw || raw.trim().length < 2) return null;
  const label = opts?.label ?? "json";
  const fixPrompt = `Your previous output was supposed to be a valid JSON value${opts?.schemaHint ? ` matching this exact shape:\n${opts.schemaHint}\n` : ""} but it failed to parse. Repair it and return ONLY the corrected JSON value (object or array — match the shape above exactly) — no prose, no markdown fences, no commentary. Preserve every fact and number from the original; only fix structural issues (missing braces or brackets, trailing commas, unterminated strings, mixed quotes, leaked reasoning, etc.).

Original output:
"""
${raw.slice(0, 12000)}
"""`;
  try {
    const fixed = await glmCall(fixPrompt, 3000, 90_000, true);
    const repaired = extractJSON<T>(fixed);
    if (repaired === null) console.warn(`[parseJsonWithRepair:${label}] repair attempt also unparseable`);
    return repaired;
  } catch (e) {
    console.warn(`[parseJsonWithRepair:${label}] repair call threw:`, e instanceof Error ? e.message : e);
    return null;
  }
}

export const glmReasonTool = tool(
  async ({ prompt, maxTokens, jsonMode }: { prompt: string; maxTokens?: number; jsonMode?: boolean }) => {
    return await glmCall(prompt, maxTokens ?? 4096, 180_000, jsonMode ?? false);
  },
  {
    name: "glm_reason",
    description: "Run a GLM 5.1 reasoning prompt. Use for planning, decomposition, critique and synthesis. Set jsonMode=true when expecting strict JSON output.",
    schema: z.object({ prompt: z.string(), maxTokens: z.number().optional(), jsonMode: z.boolean().optional() }),
  },
);

// Perplexity research — tier-selectable for cost control.
// - tier "deep":  sonar-deep-research  (~$5/1k + reasoning tokens). Use sparingly (cycle 1, or when breadth is critical).
// - tier "pro":   sonar-pro            (~5-10x cheaper than deep). Use for refinement cycles.
// - tier "basic": sonar                (cheapest, single-pass). Final fallback on error.
async function runPerplexity(model: string, sysPrompt: string, query: string, apiKey: string, timeoutMs: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(PERPLEXITY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({ model, messages: [{ role: "system", content: sysPrompt }, { role: "user", content: query }] }),
    });
    return resp;
  } finally { clearTimeout(timer); }
}

export const perplexityDeepResearchTool = tool(
  async ({ query, recencyHint, tier }: { query: string; recencyHint?: string; tier?: "deep" | "pro" | "basic" }) => {
    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) return JSON.stringify({ success: false, error: "PERPLEXITY_API_KEY missing" });
    try {
      const sysPrompt = `You are a PhD-level management consulting research analyst. Provide rigorous, citation-rich research with: (1) specific numbers and percentages from primary sources, (2) named real-world examples and case studies, (3) explicit dates from 2023-2026, (4) directly contradicting evidence where it exists, (5) structural causal mechanisms (not just correlations). Cite every numeric claim. ${recencyHint ?? ""}`;
      // Cost-ordered chain starting from the requested tier; fall back downward on failure.
      const chain = tier === "pro"
        ? ["sonar-pro", "sonar"]
        : tier === "basic"
        ? ["sonar"]
        : ["sonar-deep-research", "sonar-pro", "sonar"];
      let lastErr = "";
      for (const model of chain) {
        try {
          const timeoutMs = model === "sonar-deep-research" ? 240_000 : 120_000;
          const resp = await runPerplexity(model, sysPrompt, query, apiKey, timeoutMs);
          if (!resp.ok) { lastErr = `Perplexity ${model} ${resp.status}`; continue; }
          const data = await resp.json() as { choices: Array<{ message: { content: string } }>; search_results?: Array<{ url: string; title?: string }>; citations?: string[] };
          const content = data.choices[0]?.message?.content ?? "";
          if (!content.trim()) { lastErr = `Perplexity ${model} empty content`; continue; }
          const sources = (data.search_results ?? []).map(s => ({ url: s.url, title: s.title ?? s.url }));
          if (sources.length === 0 && data.citations) {
            sources.push(...data.citations.slice(0, 12).map(u => ({ url: u, title: u })));
          }
          return JSON.stringify({ success: true, model, content, sources });
        } catch (e) {
          lastErr = e instanceof Error ? e.message : "fail";
        }
      }
      return JSON.stringify({ success: false, error: lastErr || "all Perplexity tiers failed" });
    } catch (e) {
      return JSON.stringify({ success: false, error: e instanceof Error ? e.message : "research failed" });
    }
  },
  {
    name: "perplexity_deep_research",
    description: "Run citation-rich web research using Perplexity. Pass tier='deep' for first-cycle breadth (sonar-deep-research), tier='pro' for refinement cycles (sonar-pro, cheaper), or tier='basic' for cheapest single-pass.",
    schema: z.object({
      query: z.string().describe("Specific research question. Be precise; reference time period, geography, and metric you want."),
      recencyHint: z.string().optional().describe("Optional recency directive, e.g. 'Prioritize 2025-2026 data'."),
      tier: z.enum(["deep", "pro", "basic"]).optional().describe("Cost tier. Default 'deep'."),
    }),
  },
);

export const crossValidateTool = tool(
  async ({ claim, sources }: { claim: string; sources: string }) => {
    const prompt = `Audit the following claim against the cited research. Identify (a) sources that directly support it with primary-source numbers, (b) sources that contradict or qualify it, (c) any unsupported leaps. Be skeptical and precise. Output ONLY JSON: { "supported": boolean, "supportingEvidence": ["..."], "contradictions": ["..."], "unsupportedLeaps": ["..."], "evidenceCount": number, "crossValidated": boolean, "confidence": 0.0-1.0 }

Claim: """${claim}"""

Cited research: """${sources.slice(0, 8000)}"""`;
    const out = await glmCall(prompt, 900, 180_000, true);
    const parsed = await parseJsonWithRepair<{ supported: boolean; supportingEvidence: string[]; contradictions: string[]; unsupportedLeaps: string[]; evidenceCount: number; crossValidated: boolean; confidence: number }>(out, {
      label: "cross_validate",
      schemaHint: `{ "supported": boolean, "supportingEvidence": string[], "contradictions": string[], "unsupportedLeaps": string[], "evidenceCount": number, "crossValidated": boolean, "confidence": number }`,
    });
    return JSON.stringify(parsed ?? { supported: false, supportingEvidence: [], contradictions: ["parse failure (after repair retry)"], unsupportedLeaps: [], evidenceCount: 0, crossValidated: false, confidence: 0.4 });
  },
  {
    name: "cross_validate",
    description: "Audit a synthesized claim against the underlying research to detect unsupported leaps, contradictions, and evidence gaps.",
    schema: z.object({ claim: z.string(), sources: z.string() }),
  },
);

export const synthesizeFindingTool = tool(
  async ({ kind, title, clientContext, research, prior }: { kind: string; title: string; clientContext: string; research: string; prior?: string }) => {
    const prompt = `You are a senior partner at a Inflexcvi advisory firm. Synthesize the research below into a single executive-grade finding for the client. Specifics required: real numbers, named companies/benchmarks, explicit time horizons, and explicit implications for THIS client.

Client context: ${clientContext}
Finding kind: ${kind}
Working title: ${title}
${prior ? `Prior cycle context (do NOT repeat what's already covered):\n${prior}\n` : ""}
Research evidence:
"""
${research.slice(0, 7000)}
"""

Return ONLY JSON:
{
  "title": "refined title",
  "summary": "1-2 sentence executive takeaway",
  "body": "4-6 paragraphs: (1) what the evidence shows with numbers, (2) why this matters for the client specifically, (3) the structural mechanism, (4) precedents and benchmarks, (5) recommended next move",
  "confidence": 0.5-0.95
}`;
    const out = await glmCall(prompt, 1800, 180_000, true);
    const parsed = await parseJsonWithRepair<{ title: string; summary: string; body: string; confidence: number }>(out, {
      label: "synthesize_finding",
      schemaHint: `{ "title": string, "summary": string, "body": string, "confidence": number }`,
    });
    return JSON.stringify(parsed ?? { title, summary: "Synthesis failed (parse + repair both failed) — raw model output preserved below.", body: out.slice(0, 4000), confidence: 0.4 });
  },
  {
    name: "synthesize_finding",
    description: "Convert raw research into a publishable executive finding (summary + multi-paragraph body + refined confidence).",
    schema: z.object({
      kind: z.string(),
      title: z.string(),
      clientContext: z.string(),
      research: z.string(),
      prior: z.string().optional(),
    }),
  },
);

export const proposeFollowupQuestionTool = tool(
  async ({ basedOn, clientContext, alreadyAsked }: { basedOn: string; clientContext: string; alreadyAsked: string }) => {
    const prompt = `You are interviewing the client across multiple days. Based on what we just learned, propose 1-3 follow-up questions that ONLY the client can answer (their internal data, strategy, constraints, willingness, capacity). Do NOT ask things we can research ourselves. Do NOT repeat anything in 'alreadyAsked'.

Client context: ${clientContext}
What we just learned / where we are stuck:
"""${basedOn}"""

Already asked questions (do not repeat or paraphrase):
"""${alreadyAsked}"""

Return ONLY JSON: { "questions": [ { "question": "...", "rationale": "why we need it", "priority": 1-5 } ] }`;
    const out = await glmCall(prompt, 1200, 180_000, true);
    const parsed = await parseJsonWithRepair<{ questions: { question: string; rationale: string; priority: number }[] }>(out, {
      label: "propose_followup_question",
      schemaHint: `{ "questions": [ { "question": string, "rationale": string, "priority": number } ] }`,
    });
    return JSON.stringify(parsed?.questions ?? []);
  },
  {
    name: "propose_followup_question",
    description: "Propose follow-up questions for the client based on what the agent just learned. Only client-knowable questions.",
    schema: z.object({
      basedOn: z.string(),
      clientContext: z.string(),
      alreadyAsked: z.string(),
    }),
  },
);
