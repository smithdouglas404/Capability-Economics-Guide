/**
 * In-process AI workflows — 14 typed wrappers that fan out to Anthropic
 * (via OpenRouter) + Perplexity inline. Route handlers import these and
 * call them directly; no external service in the loop.
 *
 * Contract: every `run*()` returns its typed output on success, or `null`
 * on transport / parse / config failure. Callers fall back to their legacy
 * code path when null is returned — graceful-degrade is mandatory; never
 * 5xx out of one of these because a single LLM call hiccuped.
 */

import { randomUUID } from "node:crypto";
import { anthropic, resolveModel } from "@workspace/integrations-anthropic-ai";
import pino from "pino";

const logger = pino({ name: "workflows" });

// ── Helpers ───────────────────────────────────────────────────────────────

interface PerplexityResult {
  content: string;
  citations: string[];
}

/**
 * Direct Perplexity API call. Returns null on missing key or transport
 * failure so callers can degrade gracefully (most callers fall back to a
 * legacy code path).
 */
async function perplexity(query: string, model = "sonar-pro"): Promise<PerplexityResult | null> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return null;
  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
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
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      citations?: string[];
      search_results?: Array<{ url?: string }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const citations = data.citations ?? (data.search_results ?? []).map((s) => s.url ?? "").filter(Boolean);
    return { content, citations };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[workflows] perplexity call failed");
    return null;
  }
}

/**
 * One-shot Anthropic call via the OpenRouter-backed integration. Wraps
 * the existing `anthropic.messages.create` helper so wrappers below stay
 * compact. Returns the assistant text or throws — wrappers catch + return
 * null.
 */
async function callLLM(
  system: string,
  user: string,
  opts: { model?: string; temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const resp = await anthropic.messages.create({
    model: resolveModel(opts.model ?? "claude-sonnet-4-6"),
    max_tokens: opts.maxTokens ?? 4000,
    temperature: opts.temperature ?? 0.2,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
  return text ?? "";
}

/**
 * Tolerant JSON extraction: strips ```json fences, finds the first object
 * or array, parses. Returns null if nothing parses. Used by every wrapper
 * to coerce LLM output into a typed payload.
 */
function coerceJSON<T = Record<string, unknown>>(text: string): T | null {
  if (!text) return null;
  let s = text.trim();
  if (s.startsWith("```")) s = s.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  const m = s.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

function newConversationId(): string {
  return randomUUID();
}

// ── Generic workflow output shape ────────────────────────────────────────
// Used by the non-chat workflows (research-pipeline, synthesis-brief,
// capability-review-assist, etc.) where the route handler just relays the
// LLM's structured payload.

interface GenericWorkflowOutput<T = Record<string, unknown>> {
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

const ONBOARDING_SYSTEM = `You are the inflexcvi Onboarding Concierge. Your job: in 2-3 turns, gather enough
signal to recommend 3-5 capabilities the user should start tracking.

Always end your reply with a fenced JSON block of the shape:

\`\`\`json
{ "readyToSeed": false, "nextQuestion": "..." }
\`\`\`

or, once you have enough signal:

\`\`\`json
{
  "readyToSeed": true,
  "boardSeed": {
    "boardName": "string",
    "description": "string",
    "cards": [
      { "capabilityName": "string", "lane": "now|next|later", "notes": "string" }
    ]
  }
}
\`\`\`

Cards should reference real capability names where you have signal; otherwise leave the
array empty and let the legacy ideation flow fill them. Be specific to the industry the
user mentions. Never invent KPIs.`;

export async function runOnboardingConcierge(
  input: OnboardingConciergeInput,
): Promise<OnboardingConciergeOutput | null> {
  try {
    const userMsg = `Industry hint: ${input.selectedIndustry ?? "(none)"}\n\nSignals so far: ${JSON.stringify(input.signals ?? {})}`;
    const text = await callLLM(ONBOARDING_SYSTEM, userMsg, { temperature: 0.3, maxTokens: 1500 });
    const parsed = coerceJSON<{ readyToSeed?: boolean; nextQuestion?: string; boardSeed?: OnboardingConciergeOutput["boardSeed"] }>(text);
    const answer = parsed?.readyToSeed ? "Got it — seeding your starter board." : (parsed?.nextQuestion ?? text.split(/```/)[0].trim());
    return {
      answer,
      conversationId: newConversationId(),
      boardSeed: parsed?.readyToSeed ? parsed.boardSeed : undefined,
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), userId: input.clerkUserId }, "[workflows] onboarding-concierge failed");
    return null;
  }
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

const TIER_SELECTOR_SYSTEM = `You recommend one of 4 inflexcvi tiers: \`discovery\` (free, view one industry/qtr),
\`briefing\` (weekly briefs across 3 industries), \`console\` (full CVI cockpit + alerts),
\`platform\` (API + embed + SLA). Ask up to 3 follow-up questions; once you have a
clear read, end with a fenced JSON block:

\`\`\`json
{ "readyToRecommend": true, "tier": "console", "rationale": "..." }
\`\`\`

Otherwise:

\`\`\`json
{ "readyToRecommend": false, "nextQuestion": "..." }
\`\`\`

Be honest — if \`discovery\` is enough, recommend it. Never upsell.`;

export async function runTierSelector(input: TierSelectorInput): Promise<TierSelectorOutput | null> {
  try {
    const userMsg = `Current tier: ${input.currentTier ?? "(none)"}\n\nUser: ${input.query}`;
    const text = await callLLM(TIER_SELECTOR_SYSTEM, userMsg, { temperature: 0.2, maxTokens: 1200 });
    const parsed = coerceJSON<{ readyToRecommend?: boolean; tier?: TierSelectorOutput["recommendedTier"]; rationale?: string; nextQuestion?: string }>(text);
    const ready = !!parsed?.readyToRecommend && !!parsed.tier;
    const answer = ready
      ? `Recommended: ${parsed.tier}. ${parsed.rationale ?? ""}`
      : (parsed?.nextQuestion ?? text.split(/```/)[0].trim());
    return {
      answer,
      conversationId: input.conversationId ?? newConversationId(),
      recommendedTier: ready ? parsed.tier : undefined,
      rationale: ready ? parsed.rationale : undefined,
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), userId: input.userId }, "[workflows] tier-selector failed");
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 3. MARKETPLACE SEARCH V2
// ──────────────────────────────────────────────────────────────────────────
// No-op stub. The route handler in
// routes/marketplace-listings.ts falls through to Postgres ILIKE search
// when this returns null — which is correct for the current 22-listing
// dataset. Re-implement with pgvector when the listing count justifies it.

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
  // Intentional null — caller falls back to keyword search. Reintroduce when
  // we wire pgvector embeddings on marketplace listings.
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

const LISTING_MODERATION_SYSTEM = `You moderate inflexcvi marketplace listings. Output ONLY a JSON object — no prose:

{
  "verdict": "auto_approve" | "send_to_moderator" | "auto_reject",
  "riskFlags": ["array of short strings"],
  "confidence": 0.0,
  "rationale": "<= 2 sentences"
}

Defaults:
- \`auto_approve\` only when the listing is clearly legitimate (clear category, plausible
  pricing, no compliance flags) AND \`confidence >= 0.85\`.
- \`auto_reject\` only for explicit policy violations (regulated rails, deceptive claims,
  obvious spam).
- Anything else → \`send_to_moderator\` so a human reviews.

Risk flags vocabulary (use only these): \`unclear_category\`, \`pricing_anomaly\`,
\`compliance_risk\`, \`seller_velocity\`, \`pdf_unreadable\`, \`language\`, \`duplicate\`.`;

export async function runListingModeration(input: ListingModerationInput): Promise<ListingModerationOutput | null> {
  try {
    const userMsg = [
      `listingId: ${input.listingId}`,
      `title: ${input.title}`,
      `description:\n${input.description}`,
      `sellerHistory: ${JSON.stringify(input.sellerHistory ?? null)}`,
      `pdfText: ${input.pdfText?.slice(0, 8000) ?? ""}`,
    ].join("\n\n");
    const text = await callLLM(LISTING_MODERATION_SYSTEM, userMsg, { model: "claude-haiku-4-5", temperature: 0.0, maxTokens: 800 });
    const parsed = coerceJSON<Partial<ListingModerationOutput>>(text);
    if (!parsed?.verdict) return null;
    const allowed = new Set<ListingModerationOutput["verdict"]>(["auto_approve", "send_to_moderator", "auto_reject"]);
    return {
      verdict: allowed.has(parsed.verdict) ? parsed.verdict : "send_to_moderator",
      riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      rationale: parsed.rationale ?? "",
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), listingId: input.listingId }, "[workflows] listing-moderation failed");
    return null;
  }
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

const KYC_COUNSELOR_SYSTEM = `You are the KYC Counselor. Your job: gather a structured appeal so a human compliance
reviewer can decide whether to re-run verification.

Hard rules — NEVER violate:
- You DO NOT override the decline. Say so plainly.
- You DO NOT promise approval, fast-track, or refund.
- You DO NOT advise re-submitting with different data; only capture the appeal as-is.
- If the user describes potential fraud or coercion, end the conversation and tell them
  to email security@inflexcvi.com.

Otherwise, ask up to 3 short questions to capture:
  reasonCategory: "data_mismatch" | "liveness_quality" | "document_quality" | "identity_change" | "other"
  userExplanation: free text, paraphrased
  evidenceOffered: short list of what the user says they can provide

When you have enough, end with a fenced JSON block:

\`\`\`json
{ "readyToSubmit": true, "structuredAppeal": { "reasonCategory": "...", "userExplanation": "...", "evidenceOffered": ["..."] } }
\`\`\`

Otherwise:

\`\`\`json
{ "readyToSubmit": false, "nextQuestion": "..." }
\`\`\``;

export async function runKycFailureCounselor(input: KycFailureCounselorInput): Promise<KycFailureCounselorOutput | null> {
  try {
    const userMsg = `Decline reason: ${input.declineReason}\nKYC level: ${input.kycLevel ?? "(unknown)"}\n\nUser: ${input.query}`;
    const text = await callLLM(KYC_COUNSELOR_SYSTEM, userMsg, { temperature: 0.3, maxTokens: 1500 });
    const parsed = coerceJSON<{ readyToSubmit?: boolean; structuredAppeal?: Record<string, unknown>; nextQuestion?: string }>(text);
    const answer = parsed?.readyToSubmit
      ? "Thanks — appeal recorded. A human reviewer will get back to you within 1 business day."
      : (parsed?.nextQuestion ?? text.split(/```/)[0].trim());
    return {
      answer,
      conversationId: input.conversationId ?? newConversationId(),
      appealSubmitted: !!parsed?.readyToSubmit,
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), verificationId: input.verificationId }, "[workflows] kyc-counselor failed");
    return null;
  }
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

const PAYMENT_RECOVERY_SYSTEM = `You help a user pick a payment-recovery action. The valid actions are EXACTLY:

  update_card | switch_method | downgrade | pause_1m | escalate

Hard rules:
- You DO NOT touch Stripe directly. inflexcvi will execute the action you log.
- If the user is angry or describes financial hardship, default to \`escalate\`.
- If the failure code suggests a card issue (lost_card, stolen_card, expired_card),
  steer toward \`update_card\`.
- Never offer a discount or refund.

Ask up to 2 short follow-up questions, then end with a fenced JSON block:

\`\`\`json
{ "readyToSubmit": true, "action": "update_card", "userMessage": "..." }
\`\`\`

Or, to keep talking:

\`\`\`json
{ "readyToSubmit": false, "nextQuestion": "..." }
\`\`\``;

export async function runPaymentRecovery(input: PaymentRecoveryInput): Promise<PaymentRecoveryOutput | null> {
  try {
    const userMsg = `Failure code: ${input.failureCode ?? "(unknown)"}\n\nUser: ${input.query}`;
    const text = await callLLM(PAYMENT_RECOVERY_SYSTEM, userMsg, { model: "claude-haiku-4-5", temperature: 0.2, maxTokens: 1000 });
    const parsed = coerceJSON<{ readyToSubmit?: boolean; action?: PaymentRecoveryOutput["chosenAction"]; userMessage?: string; nextQuestion?: string }>(text);
    const allowed = new Set(["update_card", "switch_method", "downgrade", "pause_1m", "escalate"]);
    const action = parsed?.readyToSubmit && parsed.action && allowed.has(parsed.action) ? parsed.action : undefined;
    const answer = action ? (parsed?.userMessage ?? `Got it — logging ${action}.`) : (parsed?.nextQuestion ?? text.split(/```/)[0].trim());
    return {
      answer,
      conversationId: input.conversationId ?? newConversationId(),
      chosenAction: action,
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), userId: input.userId }, "[workflows] payment-recovery failed");
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 7. CAPABILITY REVIEW ASSIST
// ──────────────────────────────────────────────────────────────────────────

export interface CapabilityReviewAssistInput {
  capabilityId: number;
  reviewerComment: string;
  currentDraft: string;
}

export interface CapabilityReviewAssistPayload {
  summary?: string;
  prompts?: { perplexityFollowup?: string | null; narrativeRevisions?: string[]; metricRevisions?: string[] };
  confidence?: number;
}

const REVIEW_ASSIST_SYSTEM = `A reviewer rejected a capability draft. Read the reviewer's comment and the current
draft, then produce structured revision prompts the next enrichment pass will use.

Output ONLY a JSON object, no prose:

{
  "summary": "1-sentence diagnosis of what the reviewer is asking to change",
  "prompts": {
    "perplexityFollowup": "string — what to research next, OR null",
    "narrativeRevisions": ["bullet list of specific narrative changes"],
    "metricRevisions": ["bullet list of metric changes (TAM/EVaR/moat etc)"]
  },
  "confidence": 0.0
}

If the reviewer's comment doesn't actually require a revision (e.g. just a question),
return \`confidence: 0\` and explain in \`summary\`.`;

export async function runCapabilityReviewAssist(input: CapabilityReviewAssistInput): Promise<GenericWorkflowOutput<CapabilityReviewAssistPayload> | null> {
  try {
    const userMsg = `Capability ID: ${input.capabilityId}\n\nReviewer comment:\n${input.reviewerComment}\n\nCurrent draft (truncated):\n${input.currentDraft.slice(0, 8000)}`;
    const text = await callLLM(REVIEW_ASSIST_SYSTEM, userMsg, { temperature: 0.2, maxTokens: 2000 });
    const parsed = coerceJSON<CapabilityReviewAssistPayload>(text);
    if (!parsed) return { status: "degraded", payload: { summary: text.slice(0, 300) } };
    return { status: "ok", payload: parsed };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), capabilityId: input.capabilityId }, "[workflows] review-assist failed");
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 8. RESEARCH PIPELINE  (Perplexity → Sonnet)
// ──────────────────────────────────────────────────────────────────────────

export interface ResearchPipelineInput {
  capabilityId?: number;
  kind: "quadrant" | "alpha" | "value_chain" | "generic";
  prompt: string;
}

const RESEARCH_SYNTH_SYSTEM = `Synthesize the research below into a structured payload appropriate for \`kind\`.

For \`kind=quadrant\`: emit { quadrant: "...", justification: "...", confidence: 0.0 }.
For \`kind=alpha\`: emit { tamUsd: number|null, evarBp: number|null, moatTier: "...", narratives: {traditional, economic, ai}, citations: [...] }.
For \`kind=value_chain\`: emit { stages: [{name, description, players: [...]}] }.
For \`kind=generic\`: emit { summary: string, bullets: [...] }.

Output ONLY the JSON object — no prose, no fences. Preserve citations verbatim.`;

export async function runResearchPipeline(input: ResearchPipelineInput): Promise<GenericWorkflowOutput | null> {
  try {
    const research = await perplexity(input.prompt);
    if (!research) return { status: "degraded", payload: {} };
    const userMsg = `kind: ${input.kind}\ncapabilityId: ${input.capabilityId ?? "(none)"}\n\nResearch:\n${research.content}\n\nCitations:\n${research.citations.join("\n")}`;
    const text = await callLLM(RESEARCH_SYNTH_SYSTEM, userMsg, { temperature: 0.2, maxTokens: 4000 });
    const parsed = coerceJSON(text);
    if (!parsed) return { status: "degraded", payload: { summary: text.slice(0, 500) } };
    return { status: "ok", payload: parsed };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), capabilityId: input.capabilityId }, "[workflows] research-pipeline failed");
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 9. SYNTHESIS BRIEF COMPOSER (cross-agent daily brief)
// ──────────────────────────────────────────────────────────────────────────
// Stays as a stub here — the in-process services/synthesis-agent.ts handles
// the actual composition. This wrapper now no-ops; left as a future
// (now removed). The scheduler's runSynthesis() in services/agent/scheduler.ts
// already falls through to runSynthesisAgent() when this returns null.

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

const ASSESSMENT_SYSTEM = `You analyze a CVI capability self-assessment.

If \`phase=start\`: emit an intro framing for the user that lists the 6-10 capabilities
they're about to score, with one-sentence definitions tailored to their industry.

{
  "phase": "start",
  "intro": "string",
  "capabilities": [{"id": int, "name": "string", "definition": "string"}]
}

If \`phase=analyze\`: score each capability (0-100) and produce a narrative.

{
  "phase": "analyze",
  "overallScore": 0,
  "perCapability": [{"capabilityId": int, "score": 0, "rationale": "string"}],
  "narrative": "<= 6 paragraphs, plain prose",
  "topRisks": ["..."],
  "topOpportunities": ["..."]
}

Output ONLY the JSON, no fences or prose.`;

export async function runAssessmentAnalyzer(input: AssessmentAnalyzerInput): Promise<GenericWorkflowOutput | null> {
  try {
    const userMsg = `phase: ${input.phase}\nindustry: ${input.industryName}\norgContext: ${JSON.stringify(input.orgContext ?? {})}\nresponses: ${JSON.stringify(input.responses ?? {})}`;
    const text = await callLLM(ASSESSMENT_SYSTEM, userMsg, { temperature: 0.2, maxTokens: 6000 });
    const parsed = coerceJSON(text);
    if (!parsed) return { status: "degraded", payload: { raw: text.slice(0, 1000) } };
    return { status: "ok", payload: parsed };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), sessionId: input.sessionId }, "[workflows] assessment-analyzer failed");
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 11. INDUSTRY BOOTSTRAP (Perplexity + Sonnet — materialize a new industry)
// ──────────────────────────────────────────────────────────────────────────

export interface IndustryBootstrapInput {
  industryName: string;
  seedPrompt?: string;
}

const INDUSTRY_BOOTSTRAP_SYSTEM = `Convert the research into a strict JSON shape for industry-bootstrap. Output ONLY JSON.

{
  "industry": { "name": "string", "description": "<= 280 chars" },
  "capabilities": [
    { "name": "string", "description": "string", "quadrant": "core|differentiator|qualifier|peripheral" }
  ],
  "valueChain": [
    { "name": "string", "description": "string", "order": 1 }
  ],
  "companies": [
    { "name": "string", "headquarters": "string", "employeeCount": null, "revenue2024Usd": null }
  ],
  "citations": [{"url": "string", "title": "string"}]
}

Rules:
- 8-12 capabilities, 4-6 valueChain stages, 10-20 companies.
- \`quadrant\` is your best judgment; do not invent if unclear — use "qualifier" as the safe default.
- Use null for numeric fields you can't source. Never fabricate revenue or headcount.
- Preserve every research citation verbatim.`;

export async function runIndustryBootstrap(input: IndustryBootstrapInput): Promise<GenericWorkflowOutput | null> {
  try {
    const researchQuery = `Research the ${input.industryName} industry. Identify (a) 8-12 core capabilities that drive competitive position, (b) the 4-6 value chain stages, (c) 10-20 major companies with headquarters + employee count + 2024 revenue if disclosed. ${input.seedPrompt ?? ""}`;
    const research = await perplexity(researchQuery);
    if (!research) return null;
    const userMsg = `industryName: ${input.industryName}\n\nResearch:\n${research.content}\n\nRaw citations:\n${research.citations.join("\n")}`;
    const text = await callLLM(INDUSTRY_BOOTSTRAP_SYSTEM, userMsg, { temperature: 0.1, maxTokens: 8000 });
    const parsed = coerceJSON(text);
    if (!parsed) return { status: "degraded", payload: { error: "parse_failed", raw: text.slice(0, 1000) } };
    return { status: "ok", payload: parsed };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), industryName: input.industryName }, "[workflows] industry-bootstrap failed");
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 12. CASE STUDY GENERATOR (admin regenerate economics breakdown)
// ──────────────────────────────────────────────────────────────────────────

export interface CaseStudyGeneratorInput {
  caseStudyId: number;
  industryName: string;
  currentText: string;
}

const CASE_STUDY_SYSTEM = `Produce an economics breakdown for the given case study. Output ONLY JSON, no fences.

{
  "summary": "<= 2 paragraphs in plain prose",
  "unitEconomics": [
    {"metric": "string", "valueUsd": null, "rationale": "string"}
  ],
  "tamReachable": { "valueUsd": null, "notes": "string" },
  "marginProfile": "string — 1-2 sentences",
  "sensitivityFactors": ["bullet list"]
}

Rules:
- Use null for numbers you can't source from the case study text.
- Never fabricate dollar figures or growth rates.
- All claims must be grounded in \`currentText\`. No outside knowledge.`;

export async function runCaseStudyGenerator(input: CaseStudyGeneratorInput): Promise<GenericWorkflowOutput | null> {
  try {
    const userMsg = `Case study ID: ${input.caseStudyId}\nIndustry: ${input.industryName}\n\nCase study text:\n${input.currentText.slice(0, 12000)}`;
    const text = await callLLM(CASE_STUDY_SYSTEM, userMsg, { temperature: 0.2, maxTokens: 4000 });
    const parsed = coerceJSON(text);
    if (!parsed) return { status: "degraded", payload: { error: "parse_failed", raw: text.slice(0, 800) } };
    return { status: "ok", payload: parsed };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), caseStudyId: input.caseStudyId }, "[workflows] case-study-generator failed");
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 13. CAPABILITY ENRICHMENT RETRY (fragile draft enrichment with backoff)
// ──────────────────────────────────────────────────────────────────────────

export interface CapabilityEnrichmentRetryInput {
  capabilityId: number;
  currentDraft: string;
  lastError?: string;
  attempt?: number;
}

const ENRICHMENT_RETRY_SYSTEM = `Re-emit the capability draft as a clean JSON object. NEVER omit a field that exists in
the input draft — preserve unrelated fields verbatim. Output ONLY JSON, no fences.

Shape (extend with any input fields you don't touch):

{
  "capabilityId": int,
  "tamUsd": number | null,
  "evarBp": number | null,
  "moatTier": "string",
  "narratives": {"traditional": "string", "economic": "string", "ai": "string"},
  "citations": [{"url": "string", "title": "string"}]
}

Rules:
- Every dollar/bp figure must trace to a citation. Otherwise return null.
- If you cannot improve a field over the current draft, copy it verbatim.
- Reject any speculation — be conservative.`;

export async function runCapabilityEnrichmentRetry(input: CapabilityEnrichmentRetryInput): Promise<GenericWorkflowOutput | null> {
  try {
    const researchPrompt = `Re-research the capability draft below to fix what previously failed.\n\nPrevious error: ${input.lastError ?? "(none)"}\n\nCurrent draft (truncated):\n${input.currentDraft.slice(0, 6000)}\n\nProduce: (a) updated TAM and EVaR ranges with citations, (b) revised moat tier rationale, (c) cleaner narrative paragraphs. Always cite sources.`;
    const research = await perplexity(researchPrompt);
    const userMsg = `capabilityId: ${input.capabilityId}\ncurrentDraft: ${input.currentDraft.slice(0, 6000)}\n\nNEW RESEARCH:\n${research?.content ?? "(perplexity unavailable)"}\ncitations: ${(research?.citations ?? []).join("\n")}`;
    const text = await callLLM(ENRICHMENT_RETRY_SYSTEM, userMsg, { temperature: 0.2, maxTokens: 6000 });
    const parsed = coerceJSON<Record<string, unknown>>(text);
    if (!parsed) return { status: "degraded", payload: { raw: text.slice(0, 1000) } };
    const required = ["narratives", "moatTier"];
    const missing = required.filter((k) => !(k in parsed));
    if (missing.length > 0) return { status: "degraded", payload: { ...parsed, missing } };
    return { status: "ok", payload: parsed };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), capabilityId: input.capabilityId }, "[workflows] enrichment-retry failed");
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 14. ADMIN CONFIG PROPOSER (proposes tunable-setting changes; HITL-gated)
// ──────────────────────────────────────────────────────────────────────────

export interface AdminConfigProposerInput {
  configArea: "economic_rules" | "agent_tuning" | "enrichment_config" | "source_quality" | "bot_config";
  currentValues: Record<string, unknown>;
  recentOutcomes: Record<string, unknown>;
  targetKey?: string;
  triggeredBy: string;
}

const ADMIN_PROPOSER_SYSTEM = `You propose tweaked values for admin-tunable settings. A human will approve or reject
every proposal — your job is to make a well-reasoned, conservative recommendation
with clear rationale. NEVER propose a value you cannot defend with the recent
outcomes data.

Output ONLY a JSON object:

{
  "configArea": "string",
  "proposals": [
    {
      "key": "string",
      "currentValue": <any>,
      "proposedValue": <any>,
      "delta": "string",
      "rationale": "string — 1-2 sentences citing recent outcomes",
      "confidence": 0.0
    }
  ],
  "abstentions": [
    {"key": "string", "reason": "..."}
  ]
}

Hard rules:
- Never change more than 5 keys in one proposal — surgical wins over sweeping.
- For numeric thresholds: propose at most a 25% delta in one step.
- For model selections: switch only between known-supported options
  (sonnet-4.6, haiku-4.5, gemini-2.0-flash-001, deepseek-chat-v3).
- Abstain explicitly on keys where outcomes are inconclusive — abstaining is fine.`;

export async function runAdminConfigProposer(input: AdminConfigProposerInput): Promise<GenericWorkflowOutput | null> {
  try {
    const userMsg = `configArea: ${input.configArea}\ntargetKey hint: ${input.targetKey ?? "(none)"}\ntriggeredBy: ${input.triggeredBy}\n\nCURRENT VALUES:\n${JSON.stringify(input.currentValues, null, 2)}\n\nRECENT OUTCOMES (last 30 days):\n${JSON.stringify(input.recentOutcomes, null, 2)}`;
    const text = await callLLM(ADMIN_PROPOSER_SYSTEM, userMsg, { temperature: 0.2, maxTokens: 3000 });
    const parsed = coerceJSON<{ proposals?: unknown[]; abstentions?: unknown[] }>(text);
    if (!parsed) return { status: "degraded", payload: { proposals: [], abstentions: [], raw: text.slice(0, 600) } };
    return { status: "ok", payload: parsed };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), configArea: input.configArea }, "[workflows] admin-config-proposer failed");
    return null;
  }
}
