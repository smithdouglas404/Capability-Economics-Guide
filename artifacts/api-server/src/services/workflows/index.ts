/**
 * In-process AI workflows — 14 typed wrappers that fan out to Anthropic
 * (via OpenRouter) + Perplexity inline. Route handlers import these and
 * call them directly; no external service in the loop.
 *
 * Contract: every `run*()` returns its typed output on success, or `null`
 * on transport / parse / config failure. Callers fall back to their legacy
 * code path when null is returned — graceful-degrade is mandatory; never
 * 5xx out of one of these because a single LLM call hiccuped.
 *
 * Implementation: Vercel AI SDK `generateObject({ schema })` — pass a Zod
 * schema, get a typed parsed object back. The SDK auto-retries once with
 * a corrective re-prompt when the model emits output that fails schema
 * validation, eliminating ~half the "flakiness" the manual coerceJSON
 * regex pattern produced.
 */

import { randomUUID } from "node:crypto";
// AI SDK v4 is typed against Zod v3 classic — don't switch to "zod/v4" here
// or `generateObject({ schema })` falls back to the no-schema overload.
import { z } from "zod";
import pino from "pino";
// `generateObject` is the LangSmith-wrapped version re-exported from `./models`
// — importing from "ai" directly bypasses tracing.
import { sonnet, haiku, generateObject, NoObjectGeneratedError } from "./models";
import { retry } from "../../lib/llm-retry";
import { logLlmCall } from "../llm-usage";
import { maybeStepAiWrap } from "../../inngest/step-context";

const logger = pino({ name: "workflows" });

// ── Helpers ───────────────────────────────────────────────────────────────

interface PerplexityResult {
  content: string;
  citations: string[];
}

/**
 * Direct Perplexity API call with retry+backoff. Returns null on missing
 * key or non-transient failure so callers can degrade gracefully.
 */
async function perplexity(query: string, model = "sonar-pro"): Promise<PerplexityResult | null> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return null;
  try {
    return await retry(async () => {
      const startedAt = Date.now();
      const resp = await maybeStepAiWrap(`perplexity:workflows:${model}`, () =>
        fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            max_tokens: 4096,
            messages: [
              { role: "system", content: "You are a research analyst. Cite sources inline." },
              { role: "user", content: query },
            ],
          }),
        }),
      );
      if (!resp.ok) {
        logLlmCall({ provider: "perplexity", model, endpoint: "workflows", startedAt, httpStatus: resp.status, errorMessage: `HTTP ${resp.status}` });
        throw new Error(`Perplexity ${resp.status}`);
      }
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        citations?: string[];
        search_results?: Array<{ url?: string }>;
      };
      logLlmCall({ provider: "perplexity", model, endpoint: "workflows", startedAt, httpStatus: resp.status, responseJson: data });
      const content = data.choices?.[0]?.message?.content ?? "";
      const citations = data.citations ?? (data.search_results ?? []).map((s) => s.url ?? "").filter(Boolean);
      return { content, citations };
    }, { label: "workflows.perplexity" });
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[workflows] perplexity call failed");
    return null;
  }
}

/**
 * Thin wrapper around `generateObject` that returns null on any failure
 * (transport, schema-validation-after-retry, etc.) so workflows can
 * graceful-degrade in one line. Logs the underlying error so we can
 * still debug.
 */
async function genObject<S extends z.ZodTypeAny>(
  model: typeof sonnet,
  schema: S,
  system: string,
  prompt: string,
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<z.infer<S> | null> {
  try {
    const { object } = await generateObject({
      model,
      schema,
      system,
      prompt,
      temperature: opts.temperature ?? 0.2,
      maxTokens: opts.maxTokens ?? 4000,
    });
    return object;
  } catch (err) {
    if (err instanceof NoObjectGeneratedError) {
      logger.warn({ err: err.message, text: err.text?.slice(0, 400) }, "[workflows] schema mismatch after retry");
    } else {
      logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[workflows] generateObject failed");
    }
    return null;
  }
}

function newConversationId(): string {
  return randomUUID();
}

export interface GenericWorkflowOutput<T = Record<string, unknown>> {
  status: "ok" | "degraded";
  payload: T;
}

// ──────────────────────────────────────────────────────────────────────────
// 1. ONBOARDING CONCIERGE
// ──────────────────────────────────────────────────────────────────────────

export interface OnboardingConciergeInput {
  clerkUserId: string;
  clerkOrgId?: string | null;
  selectedIndustry?: string;
  signals?: Record<string, unknown>;
}

export interface OnboardingConciergeOutput {
  boardSeed?: {
    boardName: string;
    description?: string;
    cards: Array<{ capabilityId: number; lane?: string; notes?: string }>;
  };
  answer: string;
  conversationId: string;
}

const OnboardingSchema = z.object({
  readyToSeed: z.boolean(),
  nextQuestion: z.string().nullable().optional(),
  boardSeed: z.object({
    boardName: z.string(),
    description: z.string().optional(),
    cards: z.array(z.object({
      capabilityName: z.string(),
      lane: z.enum(["now", "next", "later"]).optional(),
      notes: z.string().optional(),
    })),
  }).nullable().optional(),
  answer: z.string().describe("The reply text to show the user — what you'd say without the structured JSON block."),
});

export async function runOnboardingConcierge(
  input: OnboardingConciergeInput,
): Promise<OnboardingConciergeOutput | null> {
  const system = `You are the inflexcvi Onboarding Concierge. Gather enough signal in 2-3 turns to recommend 3-5 capabilities the user should start tracking. Be specific to the industry the user mentions; never invent KPIs. Set readyToSeed=true with a boardSeed only when you have a clear pick of 3-5 cards; otherwise set readyToSeed=false and ask the nextQuestion.`;
  const prompt = `Industry hint: ${input.selectedIndustry ?? "(none)"}\n\nSignals so far: ${JSON.stringify(input.signals ?? {})}`;
  const parsed = await genObject(sonnet, OnboardingSchema, system, prompt, { temperature: 0.3, maxTokens: 1500 });
  if (!parsed) return null;
  // capabilityName → capabilityId resolution happens in the route handler
  // since it needs DB access; for now we hand back the raw seed.
  const boardSeed = parsed.readyToSeed && parsed.boardSeed
    ? { boardName: parsed.boardSeed.boardName, description: parsed.boardSeed.description, cards: parsed.boardSeed.cards.map((c) => ({ capabilityId: 0, lane: c.lane, notes: `${c.capabilityName}${c.notes ? ` — ${c.notes}` : ""}` })) }
    : undefined;
  return { answer: parsed.answer, conversationId: newConversationId(), boardSeed };
}

// ──────────────────────────────────────────────────────────────────────────
// 2. TIER SELECTOR
// ──────────────────────────────────────────────────────────────────────────

export interface TierSelectorInput {
  userId: string;
  currentTier?: string | null;
  query: string;
  conversationId?: string;
}

export interface TierSelectorOutput {
  answer: string;
  conversationId: string;
  recommendedTier?: "discovery" | "briefing" | "console" | "platform";
  rationale?: string;
}

const TierSchema = z.object({
  readyToRecommend: z.boolean(),
  tier: z.enum(["discovery", "briefing", "console", "platform"]).nullable().optional(),
  rationale: z.string().nullable().optional(),
  nextQuestion: z.string().nullable().optional(),
  answer: z.string(),
});

export async function runTierSelector(input: TierSelectorInput): Promise<TierSelectorOutput | null> {
  const system = `Recommend one of 4 inflexcvi tiers: discovery (free, one industry/qtr), briefing (weekly briefs, 3 industries), console (full CVI cockpit + alerts), platform (API + embed + SLA). Ask up to 3 follow-ups before recommending. Be honest — recommend discovery when it's enough; never upsell.`;
  const prompt = `Current tier: ${input.currentTier ?? "(none)"}\n\nUser: ${input.query}`;
  const parsed = await genObject(sonnet, TierSchema, system, prompt, { temperature: 0.2, maxTokens: 1200 });
  if (!parsed) return null;
  const ready = parsed.readyToRecommend && parsed.tier;
  return {
    answer: parsed.answer,
    conversationId: input.conversationId ?? newConversationId(),
    recommendedTier: ready ? parsed.tier! : undefined,
    rationale: ready ? parsed.rationale ?? undefined : undefined,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 3. MARKETPLACE SEARCH V2 (no-op stub — see CLAUDE.md)
// ──────────────────────────────────────────────────────────────────────────

export interface MarketplaceSearchV2Input {
  query: string;
  userTier?: string;
  filters?: Record<string, unknown>;
  user: string;
  conversationId?: string;
}

export interface MarketplaceSearchV2Output {
  rankedListingIds: string[];
  summary: string;
  conversationId: string;
}

export async function runMarketplaceSearchV2(_input: MarketplaceSearchV2Input): Promise<MarketplaceSearchV2Output | null> {
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// 4. LISTING MODERATION
// ──────────────────────────────────────────────────────────────────────────

export interface ListingModerationInput {
  listingId: number;
  title: string;
  description: string;
  sellerHistory?: { listingCount: number; flaggedCount: number; firstListedAt?: string };
  pdfText?: string;
}

export interface ListingModerationOutput {
  verdict: "auto_approve" | "send_to_moderator" | "auto_reject";
  riskFlags: string[];
  confidence: number;
  rationale: string;
}

const ListingModerationSchema = z.object({
  verdict: z.enum(["auto_approve", "send_to_moderator", "auto_reject"]),
  riskFlags: z.array(z.enum(["unclear_category", "pricing_anomaly", "compliance_risk", "seller_velocity", "pdf_unreadable", "language", "duplicate"])).default([]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(400),
});

export async function runListingModeration(input: ListingModerationInput): Promise<ListingModerationOutput | null> {
  const system = `You moderate inflexcvi marketplace listings.

Defaults:
- auto_approve only when listing is clearly legitimate (clear category, plausible pricing, no compliance flags) AND confidence >= 0.85.
- auto_reject only for explicit policy violations (regulated rails, deceptive claims, obvious spam).
- Anything else → send_to_moderator.

Risk flags vocabulary (use only these): unclear_category, pricing_anomaly, compliance_risk, seller_velocity, pdf_unreadable, language, duplicate.`;
  const prompt = [
    `listingId: ${input.listingId}`,
    `title: ${input.title}`,
    `description:\n${input.description}`,
    `sellerHistory: ${JSON.stringify(input.sellerHistory ?? null)}`,
    `pdfText: ${input.pdfText?.slice(0, 8000) ?? ""}`,
  ].join("\n\n");
  return await genObject(haiku, ListingModerationSchema, system, prompt, { temperature: 0.0, maxTokens: 800 });
}

// ──────────────────────────────────────────────────────────────────────────
// 5. KYC FAILURE COUNSELOR
// ──────────────────────────────────────────────────────────────────────────

export interface KycFailureCounselorInput {
  verificationId: string;
  declineReason: string;
  kycLevel?: string;
  query: string;
  conversationId?: string;
}

export interface KycFailureCounselorOutput {
  answer: string;
  conversationId: string;
  appealSubmitted?: boolean;
}

const KycCounselorSchema = z.object({
  readyToSubmit: z.boolean(),
  structuredAppeal: z.object({
    reasonCategory: z.enum(["data_mismatch", "liveness_quality", "document_quality", "identity_change", "other"]),
    userExplanation: z.string(),
    evidenceOffered: z.array(z.string()),
  }).nullable().optional(),
  nextQuestion: z.string().nullable().optional(),
  answer: z.string(),
});

export async function runKycFailureCounselor(input: KycFailureCounselorInput): Promise<KycFailureCounselorOutput | null> {
  const system = `You are the KYC Counselor. Gather a structured appeal so a human compliance reviewer can decide whether to re-run verification.

Hard rules — NEVER violate:
- You DO NOT override the decline. Say so plainly.
- You DO NOT promise approval, fast-track, or refund.
- You DO NOT advise re-submitting with different data; only capture the appeal as-is.
- If the user describes potential fraud or coercion, end the conversation and tell them to email security@inflexcvi.com.

Otherwise ask up to 3 short questions to capture the structured appeal. Set readyToSubmit=true only when you have all three appeal fields.`;
  const prompt = `Decline reason: ${input.declineReason}\nKYC level: ${input.kycLevel ?? "(unknown)"}\n\nUser: ${input.query}`;
  const parsed = await genObject(sonnet, KycCounselorSchema, system, prompt, { temperature: 0.3, maxTokens: 1500 });
  if (!parsed) return null;
  return {
    answer: parsed.answer,
    conversationId: input.conversationId ?? newConversationId(),
    appealSubmitted: parsed.readyToSubmit,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 6. PAYMENT RECOVERY
// ──────────────────────────────────────────────────────────────────────────

export interface PaymentRecoveryInput {
  userId: string;
  subscriptionId: string;
  failureCode?: string;
  query: string;
  conversationId?: string;
}

export interface PaymentRecoveryOutput {
  answer: string;
  conversationId: string;
  chosenAction?: "update_card" | "switch_method" | "downgrade" | "pause_1m" | "escalate";
}

const PaymentRecoverySchema = z.object({
  readyToSubmit: z.boolean(),
  action: z.enum(["update_card", "switch_method", "downgrade", "pause_1m", "escalate"]).nullable().optional(),
  userMessage: z.string().nullable().optional(),
  nextQuestion: z.string().nullable().optional(),
  answer: z.string(),
});

export async function runPaymentRecovery(input: PaymentRecoveryInput): Promise<PaymentRecoveryOutput | null> {
  const system = `You help a user pick a payment-recovery action.

Hard rules:
- You DO NOT touch Stripe directly. inflexcvi will execute the action you log.
- If the user is angry or describes financial hardship, default to escalate.
- If failure code suggests a card issue (lost_card, stolen_card, expired_card), steer toward update_card.
- Never offer a discount or refund.

Ask up to 2 short follow-up questions, then set readyToSubmit=true with one valid action.`;
  const prompt = `Failure code: ${input.failureCode ?? "(unknown)"}\n\nUser: ${input.query}`;
  const parsed = await genObject(haiku, PaymentRecoverySchema, system, prompt, { temperature: 0.2, maxTokens: 1000 });
  if (!parsed) return null;
  const action = parsed.readyToSubmit ? parsed.action ?? undefined : undefined;
  return {
    answer: parsed.answer,
    conversationId: input.conversationId ?? newConversationId(),
    chosenAction: action ?? undefined,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// 7. CAPABILITY REVIEW ASSIST
// ──────────────────────────────────────────────────────────────────────────

export interface CapabilityReviewAssistInput {
  capabilityId: number;
  reviewerComment: string;
  currentDraft: string;
}

const ReviewAssistSchema = z.object({
  summary: z.string().describe("1-sentence diagnosis of what the reviewer is asking to change"),
  prompts: z.object({
    perplexityFollowup: z.string().nullable(),
    narrativeRevisions: z.array(z.string()),
    metricRevisions: z.array(z.string()),
  }),
  confidence: z.number().min(0).max(1),
});

export type CapabilityReviewAssistPayload = z.infer<typeof ReviewAssistSchema>;

export async function runCapabilityReviewAssist(input: CapabilityReviewAssistInput): Promise<GenericWorkflowOutput<CapabilityReviewAssistPayload> | null> {
  const system = `A reviewer rejected a capability draft. Read the reviewer's comment and the current draft, then produce structured revision prompts the next enrichment pass will use. If the reviewer's comment doesn't actually require a revision (e.g. just a question), return confidence: 0 and explain in summary.`;
  const prompt = `Capability ID: ${input.capabilityId}\n\nReviewer comment:\n${input.reviewerComment}\n\nCurrent draft (truncated):\n${input.currentDraft.slice(0, 8000)}`;
  const payload = await genObject(sonnet, ReviewAssistSchema, system, prompt, { temperature: 0.2, maxTokens: 2000 });
  if (!payload) return null;
  return { status: "ok", payload };
}

// ──────────────────────────────────────────────────────────────────────────
// 8. RESEARCH PIPELINE  (Perplexity → Sonnet)
// ──────────────────────────────────────────────────────────────────────────

export interface ResearchPipelineInput {
  capabilityId?: number;
  kind: "quadrant" | "alpha" | "value_chain" | "generic";
  prompt: string;
}

const ResearchPipelineSchema = z.union([
  z.object({
    kind: z.literal("quadrant"),
    quadrant: z.string(),
    justification: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal("alpha"),
    tamUsd: z.number().nullable(),
    evarBp: z.number().nullable(),
    moatTier: z.string(),
    narratives: z.object({ traditional: z.string(), economic: z.string(), ai: z.string() }),
    citations: z.array(z.object({ url: z.string(), title: z.string() })),
  }),
  z.object({
    kind: z.literal("value_chain"),
    stages: z.array(z.object({ name: z.string(), description: z.string(), players: z.array(z.string()) })),
  }),
  z.object({
    kind: z.literal("generic"),
    summary: z.string(),
    bullets: z.array(z.string()),
  }),
]);

export async function runResearchPipeline(input: ResearchPipelineInput): Promise<GenericWorkflowOutput | null> {
  const research = await perplexity(input.prompt);
  if (!research) return { status: "degraded", payload: {} };
  const system = `Synthesize the research into a payload tagged with kind="${input.kind}". Preserve citations verbatim. Use null for any number you can't ground in a citation.`;
  const prompt = `kind: ${input.kind}\ncapabilityId: ${input.capabilityId ?? "(none)"}\n\nResearch:\n${research.content}\n\nCitations:\n${research.citations.join("\n")}`;
  const payload = await genObject(sonnet, ResearchPipelineSchema, system, prompt, { temperature: 0.2, maxTokens: 4000 });
  if (!payload) return { status: "degraded", payload: {} };
  return { status: "ok", payload: payload as unknown as Record<string, unknown> };
}

// ──────────────────────────────────────────────────────────────────────────
// 9. SYNTHESIS BRIEF COMPOSER (no-op — see CLAUDE.md)
// ──────────────────────────────────────────────────────────────────────────

export async function runSynthesisBriefComposer(): Promise<GenericWorkflowOutput | null> {
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// 10. ASSESSMENT ANALYZER
// ──────────────────────────────────────────────────────────────────────────

export interface AssessmentAnalyzerInput {
  sessionId: string;
  phase: "start" | "analyze";
  industryName: string;
  orgContext?: Record<string, unknown>;
  responses?: Record<string, unknown>;
}

const AssessmentStartSchema = z.object({
  phase: z.literal("start"),
  intro: z.string(),
  capabilities: z.array(z.object({
    id: z.number().int(),
    name: z.string(),
    definition: z.string(),
  })),
});

const AssessmentAnalyzeSchema = z.object({
  phase: z.literal("analyze"),
  overallScore: z.number().min(0).max(100),
  perCapability: z.array(z.object({
    capabilityId: z.number().int(),
    score: z.number().min(0).max(100),
    rationale: z.string(),
  })),
  narrative: z.string(),
  topRisks: z.array(z.string()),
  topOpportunities: z.array(z.string()),
});

export async function runAssessmentAnalyzer(input: AssessmentAnalyzerInput): Promise<GenericWorkflowOutput | null> {
  const isStart = input.phase === "start";
  const schema = isStart ? AssessmentStartSchema : AssessmentAnalyzeSchema;
  const system = isStart
    ? `Generate intro framing for a CVI capability self-assessment in the ${input.industryName} industry. List 6-10 capabilities with one-sentence definitions tailored to the industry.`
    : `Analyze a CVI capability self-assessment in the ${input.industryName} industry. Score each capability 0-100, narrate at most 6 paragraphs, list top risks and opportunities.`;
  const prompt = `phase: ${input.phase}\nindustry: ${input.industryName}\norgContext: ${JSON.stringify(input.orgContext ?? {})}\nresponses: ${JSON.stringify(input.responses ?? {})}`;
  const payload = await genObject(sonnet, schema as z.ZodType<unknown>, system, prompt, { temperature: 0.2, maxTokens: 6000 });
  if (!payload) return null;
  return { status: "ok", payload: payload as Record<string, unknown> };
}

// ──────────────────────────────────────────────────────────────────────────
// 11. INDUSTRY BOOTSTRAP (Perplexity + Sonnet)
// ──────────────────────────────────────────────────────────────────────────

export interface IndustryBootstrapInput {
  industryName: string;
  seedPrompt?: string;
}

const IndustryBootstrapSchema = z.object({
  industry: z.object({ name: z.string(), description: z.string().max(280) }),
  capabilities: z.array(z.object({
    name: z.string(),
    description: z.string(),
    quadrant: z.enum(["core", "differentiator", "qualifier", "peripheral"]),
  })).min(8).max(12),
  valueChain: z.array(z.object({
    name: z.string(),
    description: z.string(),
    order: z.number().int().min(1),
  })).min(4).max(6),
  companies: z.array(z.object({
    name: z.string(),
    headquarters: z.string(),
    employeeCount: z.number().int().nullable(),
    revenue2024Usd: z.number().nullable(),
  })).min(10).max(20),
  citations: z.array(z.object({ url: z.string(), title: z.string() })),
});

export async function runIndustryBootstrap(input: IndustryBootstrapInput): Promise<GenericWorkflowOutput | null> {
  const researchQuery = `Research the ${input.industryName} industry. Identify (a) 8-12 core capabilities that drive competitive position, (b) the 4-6 value chain stages, (c) 10-20 major companies with headquarters + employee count + 2024 revenue if disclosed. ${input.seedPrompt ?? ""}`;
  const research = await perplexity(researchQuery);
  if (!research) return null;
  const system = `Convert industry research into a strict JSON shape. Use null for numeric fields you can't source — never fabricate. Default quadrant to "qualifier" when unclear. Preserve every research citation verbatim.`;
  const prompt = `industryName: ${input.industryName}\n\nResearch:\n${research.content}\n\nRaw citations:\n${research.citations.join("\n")}`;
  const payload = await genObject(sonnet, IndustryBootstrapSchema, system, prompt, { temperature: 0.1, maxTokens: 8000 });
  if (!payload) return { status: "degraded", payload: { error: "parse_failed" } };
  return { status: "ok", payload: payload as unknown as Record<string, unknown> };
}

// ──────────────────────────────────────────────────────────────────────────
// 12. CASE STUDY GENERATOR (admin regenerate economics breakdown)
// ──────────────────────────────────────────────────────────────────────────

export interface CaseStudyGeneratorInput {
  caseStudyId: number;
  industryName: string;
  currentText: string;
}

const CaseStudySchema = z.object({
  summary: z.string(),
  unitEconomics: z.array(z.object({
    metric: z.string(),
    valueUsd: z.number().nullable(),
    rationale: z.string(),
  })),
  tamReachable: z.object({
    valueUsd: z.number().nullable(),
    notes: z.string(),
  }),
  marginProfile: z.string(),
  sensitivityFactors: z.array(z.string()),
});

export async function runCaseStudyGenerator(input: CaseStudyGeneratorInput): Promise<GenericWorkflowOutput | null> {
  const system = `Produce an economics breakdown for a case study. All claims must be grounded in the provided text — no outside knowledge, no fabricated dollar figures. Use null for numbers you can't source.`;
  const prompt = `Case study ID: ${input.caseStudyId}\nIndustry: ${input.industryName}\n\nCase study text:\n${input.currentText.slice(0, 12000)}`;
  const payload = await genObject(sonnet, CaseStudySchema, system, prompt, { temperature: 0.2, maxTokens: 4000 });
  if (!payload) return { status: "degraded", payload: { error: "parse_failed" } };
  return { status: "ok", payload: payload as unknown as Record<string, unknown> };
}

// ──────────────────────────────────────────────────────────────────────────
// 13. CAPABILITY ENRICHMENT RETRY
// ──────────────────────────────────────────────────────────────────────────

export interface CapabilityEnrichmentRetryInput {
  capabilityId: number;
  currentDraft: string;
  lastError?: string;
  attempt?: number;
}

const EnrichmentRetrySchema = z.object({
  capabilityId: z.number().int(),
  tamUsd: z.number().nullable(),
  evarBp: z.number().nullable(),
  moatTier: z.string(),
  narratives: z.object({
    traditional: z.string(),
    economic: z.string(),
    ai: z.string(),
  }),
  citations: z.array(z.object({ url: z.string(), title: z.string() })),
});

export async function runCapabilityEnrichmentRetry(input: CapabilityEnrichmentRetryInput): Promise<GenericWorkflowOutput | null> {
  const researchPrompt = `Re-research the capability draft to fix what previously failed.\n\nPrevious error: ${input.lastError ?? "(none)"}\n\nCurrent draft (truncated):\n${input.currentDraft.slice(0, 6000)}\n\nProduce: (a) updated TAM and EVaR with citations, (b) revised moat tier rationale, (c) cleaner narrative paragraphs. Always cite sources.`;
  const research = await perplexity(researchPrompt);
  const system = `Re-emit the capability draft as a clean JSON object. Preserve unrelated fields verbatim. Every dollar/bp figure must trace to a citation — otherwise return null for that field. If you can't improve a field, copy it verbatim. Reject any speculation — be conservative.`;
  const prompt = `capabilityId: ${input.capabilityId}\ncurrentDraft: ${input.currentDraft.slice(0, 6000)}\n\nNEW RESEARCH:\n${research?.content ?? "(perplexity unavailable)"}\ncitations: ${(research?.citations ?? []).join("\n")}`;
  const payload = await genObject(sonnet, EnrichmentRetrySchema, system, prompt, { temperature: 0.2, maxTokens: 6000 });
  if (!payload) return { status: "degraded", payload: { error: "parse_failed" } };
  return { status: "ok", payload: payload as unknown as Record<string, unknown> };
}

// ──────────────────────────────────────────────────────────────────────────
// 14. ADMIN CONFIG PROPOSER
// ──────────────────────────────────────────────────────────────────────────

export interface AdminConfigProposerInput {
  configArea: "economic_rules" | "agent_tuning" | "enrichment_config" | "source_quality" | "bot_config";
  currentValues: Record<string, unknown>;
  recentOutcomes: Record<string, unknown>;
  targetKey?: string;
  triggeredBy: string;
}

const AdminProposerSchema = z.object({
  configArea: z.string(),
  proposals: z.array(z.object({
    key: z.string(),
    currentValue: z.unknown(),
    proposedValue: z.unknown(),
    delta: z.string(),
    rationale: z.string(),
    confidence: z.number().min(0).max(1),
  })).max(5),
  abstentions: z.array(z.object({
    key: z.string(),
    reason: z.string(),
  })),
});

export async function runAdminConfigProposer(input: AdminConfigProposerInput): Promise<GenericWorkflowOutput | null> {
  const system = `You propose tweaked values for admin-tunable settings. A human will approve or reject every proposal — make conservative recommendations with clear rationale grounded in recent outcomes data.

Hard rules:
- Max 5 proposals per call — surgical wins over sweeping.
- Numeric thresholds: max 25% delta in one step.
- Model selections: switch only between sonnet-4.6, haiku-4.5, gemini-2.0-flash-001, deepseek-chat-v3.
- Abstain when outcomes data is inconclusive — abstaining is fine.`;
  const prompt = `configArea: ${input.configArea}\ntargetKey hint: ${input.targetKey ?? "(none)"}\ntriggeredBy: ${input.triggeredBy}\n\nCURRENT VALUES:\n${JSON.stringify(input.currentValues, null, 2)}\n\nRECENT OUTCOMES (last 30 days):\n${JSON.stringify(input.recentOutcomes, null, 2)}`;
  const payload = await genObject(sonnet, AdminProposerSchema, system, prompt, { temperature: 0.2, maxTokens: 3000 });
  if (!payload) return { status: "degraded", payload: { proposals: [], abstentions: [] } };
  return { status: "ok", payload: payload as unknown as Record<string, unknown> };
}
