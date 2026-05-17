/**
 * Per-workflow wrappers + feature-flag helpers for the Dify orchestration
 * layer. Plan reference: `~/.claude/plans/steady-drifting-wilkes.md` Phase D.
 *
 * Each wrapper:
 *  1. Returns null when its feature flag is off (or Dify isn't configured).
 *  2. Resolves the workflow's Dify app id from `dify_workflow_registry`.
 *  3. Resolves the per-workflow Service API key from env (per-workflow keys
 *     keep auth scoped — losing one key doesn't expose the others).
 *  4. Triggers the workflow and returns the structured payload OR null on
 *     failure. Callers MUST fall back to the legacy handler on null.
 *
 * Adding a new workflow:
 *   1. Add an entry to `WORKFLOWS` below (slug → kind + env-var name).
 *   2. Author the DSL in `dify-workflows/<slug>.yml`.
 *   3. Run `pnpm tsx scripts/src/dify-workflow-import.ts` to push it to Dify
 *      and write the registry row.
 *   4. Set `DIFY_APIKEY_<UPPER_SLUG>` on the api-server with the workflow's
 *      Service API key from Dify UI.
 *   5. Add `DIFY_<UPPER_SLUG>_ENABLED=1` to flip the wrapper on in prod.
 */

import { db, difyWorkflowRegistry } from "@workspace/db";
import { eq } from "drizzle-orm";
import { triggerChatflow, triggerWorkflow } from "./client";
import type { ChatflowResult, WorkflowRunResult } from "./client";

export type WorkflowKind = "workflow" | "chatflow";

export interface WorkflowDescriptor {
  slug: string;
  kind: WorkflowKind;
  /** Env var holding this workflow's Service API key (Bearer token). */
  apiKeyEnvVar: string;
  /** Env var that flips this wrapper on. Off by default. */
  enabledFlagEnvVar: string;
}

const slugToEnvKey = (slug: string): string =>
  slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

const descriptor = (slug: string, kind: WorkflowKind): WorkflowDescriptor => ({
  slug,
  kind,
  apiKeyEnvVar: `DIFY_APIKEY_${slugToEnvKey(slug)}`,
  enabledFlagEnvVar: `DIFY_${slugToEnvKey(slug)}_ENABLED`,
});

export const WORKFLOWS: Record<string, WorkflowDescriptor> = {
  "onboarding-concierge": descriptor("onboarding-concierge", "chatflow"),
  "tier-selector": descriptor("tier-selector", "chatflow"),
  "marketplace-search-v2": descriptor("marketplace-search-v2", "chatflow"),
  "listing-moderation": descriptor("listing-moderation", "workflow"),
  "kyc-failure-counselor": descriptor("kyc-failure-counselor", "chatflow"),
  "payment-recovery": descriptor("payment-recovery", "chatflow"),
  "capability-review-assist": descriptor("capability-review-assist", "workflow"),
  "research-pipeline": descriptor("research-pipeline", "workflow"),
  "synthesis-brief-composer": descriptor("synthesis-brief-composer", "workflow"),
  "assessment-analyzer": descriptor("assessment-analyzer", "workflow"),
  "industry-bootstrap": descriptor("industry-bootstrap", "workflow"),
  "case-study-generator": descriptor("case-study-generator", "workflow"),
  "capability-enrichment-retry": descriptor("capability-enrichment-retry", "workflow"),
  "admin-config-proposer": descriptor("admin-config-proposer", "workflow"),
};

/**
 * Cached registry lookup. The dify_workflow_registry table is the source of
 * truth for `dify_app_id`, `api_key`, and `enabled` per slug. We cache rows
 * for 30s to avoid one DB hit per workflow invocation. Cache is process-
 * local; multi-instance Railway deployments may see up to 30s of staleness
 * after a registry update — acceptable for feature-flag flips.
 */
interface RegistryEntry {
  difyAppId: string;
  apiKey: string | null;
  enabled: boolean;
}
const registryCache = new Map<string, { entry: RegistryEntry | null; expiresAt: number }>();
const REGISTRY_CACHE_TTL_MS = 30_000;

async function getRegistryEntry(slug: string): Promise<RegistryEntry | null> {
  const now = Date.now();
  const cached = registryCache.get(slug);
  if (cached && cached.expiresAt > now) return cached.entry;
  let entry: RegistryEntry | null = null;
  try {
    const [row] = await db
      .select({
        difyAppId: difyWorkflowRegistry.difyAppId,
        apiKey: difyWorkflowRegistry.apiKey,
        enabled: difyWorkflowRegistry.enabled,
      })
      .from(difyWorkflowRegistry)
      .where(eq(difyWorkflowRegistry.slug, slug))
      .limit(1);
    if (row) entry = { difyAppId: row.difyAppId, apiKey: row.apiKey ?? null, enabled: row.enabled };
  } catch {
    // DB unreachable — leave entry null and fall back to env vars below.
  }
  registryCache.set(slug, { entry, expiresAt: now + REGISTRY_CACHE_TTL_MS });
  return entry;
}

/**
 * Invalidate the cached registry entry for a slug. Call after an admin
 * action that flips `enabled` or rotates `api_key` so the change takes
 * effect immediately instead of waiting up to 30s.
 */
export function invalidateRegistryCache(slug?: string): void {
  if (slug) registryCache.delete(slug);
  else registryCache.clear();
}

/**
 * Is the workflow allowed to run? Reads `enabled` from the registry row;
 * falls back to the env-var flag (`DIFY_<SLUG>_ENABLED=1`) when the row
 * has no value yet. The fallback exists so the originally-pasted Railway
 * env vars keep working during the migration to DB-driven flags.
 */
export async function isWorkflowEnabled(slug: string): Promise<boolean> {
  const d = WORKFLOWS[slug];
  if (!d) return false;
  const entry = await getRegistryEntry(slug);
  if (entry?.enabled) return true;
  return process.env[d.enabledFlagEnvVar] === "1";
}

/**
 * Resolve the Service API bearer key for a workflow. Reads `api_key` from
 * the registry first; falls back to `DIFY_APIKEY_<SLUG>` env var when the
 * row hasn't been backfilled yet.
 */
async function getApiKey(slug: string): Promise<string | null> {
  const d = WORKFLOWS[slug];
  if (!d) return null;
  const entry = await getRegistryEntry(slug);
  if (entry?.apiKey) return entry.apiKey;
  return process.env[d.apiKeyEnvVar] || null;
}

/**
 * Look up the Dify app id for a slug. Populated by the one-shot import
 * script. Returns null if the slug hasn't been imported yet — the wrapper
 * treats that as "Dify not ready, fall back to legacy."
 */
export async function resolveAppId(slug: string): Promise<string | null> {
  const entry = await getRegistryEntry(slug);
  return entry?.difyAppId ?? null;
}

interface RunOptions {
  /** Stable user identifier passed to Dify's `user` field. */
  user: string;
  /** For chatflows, the conversation id to thread into. */
  conversationId?: string;
}

/**
 * Generic chatflow runner. Returns null on any "fall back to legacy"
 * condition (flag off, key missing, app not registered, transport error).
 */
export async function runChatflow(
  slug: string,
  query: string,
  inputs: Record<string, unknown>,
  opts: RunOptions,
): Promise<ChatflowResult | null> {
  if (!(await isWorkflowEnabled(slug))) return null;
  const key = await getApiKey(slug);
  if (!key) return null;
  // Service API uses the app key directly — no app-id lookup needed for
  // chat-messages. resolveAppId is still useful for admin/health checks.
  return await triggerChatflow(key, query, opts.user, inputs, {
    conversationId: opts.conversationId,
  });
}

/**
 * Generic workflow runner. Same null-on-failure contract as runChatflow.
 */
export async function runWorkflow(
  slug: string,
  inputs: Record<string, unknown>,
  opts: RunOptions,
): Promise<WorkflowRunResult | null> {
  if (!(await isWorkflowEnabled(slug))) return null;
  const key = await getApiKey(slug);
  if (!key) return null;
  return await triggerWorkflow(key, inputs, opts.user);
}

// ── Per-workflow typed wrappers ──────────────────────────────────────────
// These exist so route handlers don't pass raw slugs around — the type
// system enforces the contract at each call site.

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

/**
 * Runs the onboarding concierge chatflow. Wired into routes/onboarding.ts
 * behind DIFY_ONBOARDING_CONCIERGE_ENABLED=1. The chatflow asks 2-3
 * qualifying questions and, when it has enough signal, calls back to
 * /api/dify/callback/seed-board to create a starter workbench. The first
 * synchronous answer (returned here) is what we show the user immediately
 * while the seed-board callback runs in the background.
 */
export async function runOnboardingConcierge(
  input: OnboardingConciergeInput,
): Promise<OnboardingConciergeOutput | null> {
  const slug = "onboarding-concierge";
  const greeting = input.selectedIndustry
    ? `New user in ${input.selectedIndustry}. Help them pick 3-5 starting capabilities.`
    : "New user, no industry selected yet. Ask what industry they want to focus on.";
  const result = await runChatflow(
    slug,
    greeting,
    {
      clerkUserId: input.clerkUserId,
      clerkOrgId: input.clerkOrgId ?? null,
      selectedIndustry: input.selectedIndustry ?? null,
      signals: input.signals ?? {},
    },
    { user: input.clerkUserId },
  );
  if (!result) return null;
  // The chatflow may surface a structured boardSeed in `metadata` when it
  // has enough signal to seed a board. Absence is fine — the conversation
  // can continue and the seed-board callback may arrive later.
  const boardSeed = (result.metadata as { boardSeed?: OnboardingConciergeOutput["boardSeed"] } | undefined)?.boardSeed;
  return {
    answer: result.answer,
    conversationId: result.conversation_id,
    boardSeed,
  };
}

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

export async function runListingModeration(
  input: ListingModerationInput,
): Promise<ListingModerationOutput | null> {
  const result = await runWorkflow("listing-moderation", input as unknown as Record<string, unknown>, {
    user: `listing-${input.listingId}`,
  });
  if (!result || result.data.status !== "succeeded" || !result.data.outputs) return null;
  const o = result.data.outputs as Partial<ListingModerationOutput>;
  if (!o.verdict) return null;
  return {
    verdict: o.verdict,
    riskFlags: o.riskFlags ?? [],
    confidence: typeof o.confidence === "number" ? o.confidence : 0,
    rationale: o.rationale ?? "",
  };
}

// ── Tier Selector ────────────────────────────────────────────────────────

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

export async function runTierSelector(input: TierSelectorInput): Promise<TierSelectorOutput | null> {
  const result = await runChatflow(
    "tier-selector",
    input.query,
    { userId: input.userId, currentTier: input.currentTier ?? null },
    { user: input.userId, conversationId: input.conversationId },
  );
  if (!result) return null;
  const meta = (result.metadata ?? {}) as { tier?: TierSelectorOutput["recommendedTier"]; rationale?: string };
  return { answer: result.answer, conversationId: result.conversation_id, recommendedTier: meta.tier, rationale: meta.rationale };
}

// ── Marketplace Search v2 ────────────────────────────────────────────────

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

export async function runMarketplaceSearchV2(input: MarketplaceSearchV2Input): Promise<MarketplaceSearchV2Output | null> {
  const result = await runChatflow(
    "marketplace-search-v2",
    input.query,
    { query: input.query, userTier: input.userTier ?? null, filters: input.filters ?? {} },
    { user: input.user, conversationId: input.conversationId },
  );
  if (!result) return null;
  // The chatflow's final answer node emits a JSON block — parse it tolerantly.
  let rankedListingIds: string[] = [];
  let summary = result.answer;
  try {
    const m = result.answer.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]) as { rankedListingIds?: string[]; summary?: string };
      if (Array.isArray(parsed.rankedListingIds)) rankedListingIds = parsed.rankedListingIds.map(String);
      if (typeof parsed.summary === "string") summary = parsed.summary;
    }
  } catch {
    // Keep defaults — caller falls back to legacy retrieve() when ids are empty.
  }
  return { rankedListingIds, summary, conversationId: result.conversation_id };
}

// ── KYC Failure Counselor ────────────────────────────────────────────────

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

export async function runKycFailureCounselor(input: KycFailureCounselorInput): Promise<KycFailureCounselorOutput | null> {
  const result = await runChatflow(
    "kyc-failure-counselor",
    input.query,
    { verificationId: input.verificationId, declineReason: input.declineReason, kycLevel: input.kycLevel ?? null },
    { user: `kyc-${input.verificationId}`, conversationId: input.conversationId },
  );
  if (!result) return null;
  const meta = (result.metadata ?? {}) as { appealSubmitted?: boolean };
  return { answer: result.answer, conversationId: result.conversation_id, appealSubmitted: meta.appealSubmitted };
}

// ── Payment Recovery ─────────────────────────────────────────────────────

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

export async function runPaymentRecovery(input: PaymentRecoveryInput): Promise<PaymentRecoveryOutput | null> {
  const result = await runChatflow(
    "payment-recovery",
    input.query,
    { userId: input.userId, subscriptionId: input.subscriptionId, failureCode: input.failureCode ?? null },
    { user: input.userId, conversationId: input.conversationId },
  );
  if (!result) return null;
  const meta = (result.metadata ?? {}) as { chosenAction?: PaymentRecoveryOutput["chosenAction"] };
  return { answer: result.answer, conversationId: result.conversation_id, chosenAction: meta.chosenAction };
}

// ── Generic workflow wrappers ────────────────────────────────────────────
// The remaining workflows are non-chat and emit a single `payload` object
// that the route handler just relays. One generic helper keeps the per-
// workflow wrappers tight.

interface GenericWorkflowOutput<T = Record<string, unknown>> {
  status: "ok" | "degraded" | "succeeded" | "failed";
  payload: T;
  raw: unknown;
}

async function runGenericWorkflow<T = Record<string, unknown>>(
  slug: string,
  inputs: Record<string, unknown>,
  user: string,
): Promise<GenericWorkflowOutput<T> | null> {
  const result = await runWorkflow(slug, inputs, { user });
  if (!result) return null;
  if (result.data.status !== "succeeded" || !result.data.outputs) return null;
  const out = result.data.outputs as { payload?: T; status?: GenericWorkflowOutput["status"] };
  return {
    status: out.status ?? "succeeded",
    payload: (out.payload ?? {}) as T,
    raw: result.data.outputs,
  };
}

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

export async function runCapabilityReviewAssist(input: CapabilityReviewAssistInput): Promise<GenericWorkflowOutput<CapabilityReviewAssistPayload> | null> {
  return runGenericWorkflow<CapabilityReviewAssistPayload>("capability-review-assist", input as unknown as Record<string, unknown>, `cap-${input.capabilityId}`);
}

export interface ResearchPipelineInput {
  capabilityId?: number;
  kind: "quadrant" | "alpha" | "value_chain" | "generic";
  prompt: string;
}

export async function runResearchPipeline(input: ResearchPipelineInput): Promise<GenericWorkflowOutput | null> {
  return runGenericWorkflow(
    "research-pipeline",
    input as unknown as Record<string, unknown>,
    input.capabilityId != null ? `cap-${input.capabilityId}` : "research",
  );
}

export async function runSynthesisBriefComposer(): Promise<GenericWorkflowOutput | null> {
  return runGenericWorkflow("synthesis-brief-composer", {}, "synthesis-cron");
}

export interface AssessmentAnalyzerInput {
  sessionId: string;
  phase: "start" | "analyze";
  industryName: string;
  orgContext?: Record<string, unknown>;
  responses?: Record<string, unknown>;
}

export async function runAssessmentAnalyzer(input: AssessmentAnalyzerInput): Promise<GenericWorkflowOutput | null> {
  return runGenericWorkflow(
    "assessment-analyzer",
    {
      sessionId: input.sessionId,
      phase: input.phase,
      industryName: input.industryName,
      orgContext: JSON.stringify(input.orgContext ?? {}),
      responses: JSON.stringify(input.responses ?? {}),
    },
    `assess-${input.sessionId}`,
  );
}

export interface IndustryBootstrapInput {
  industryName: string;
  seedPrompt?: string;
}

export async function runIndustryBootstrap(input: IndustryBootstrapInput): Promise<GenericWorkflowOutput | null> {
  return runGenericWorkflow(
    "industry-bootstrap",
    { industryName: input.industryName, seedPrompt: input.seedPrompt ?? "" },
    `industry-bootstrap-${input.industryName}`,
  );
}

export interface CaseStudyGeneratorInput {
  caseStudyId: number;
  industryName: string;
  currentText: string;
}

export async function runCaseStudyGenerator(input: CaseStudyGeneratorInput): Promise<GenericWorkflowOutput | null> {
  return runGenericWorkflow(
    "case-study-generator",
    input as unknown as Record<string, unknown>,
    `case-study-${input.caseStudyId}`,
  );
}

export interface CapabilityEnrichmentRetryInput {
  capabilityId: number;
  currentDraft: string;
  lastError?: string;
  attempt?: number;
}

export async function runCapabilityEnrichmentRetry(input: CapabilityEnrichmentRetryInput): Promise<GenericWorkflowOutput | null> {
  return runGenericWorkflow(
    "capability-enrichment-retry",
    {
      capabilityId: input.capabilityId,
      currentDraft: input.currentDraft,
      lastError: input.lastError ?? "",
      attempt: input.attempt ?? 1,
    },
    `cap-${input.capabilityId}-retry`,
  );
}

export interface AdminConfigProposerInput {
  configArea: "economic_rules" | "agent_tuning" | "enrichment_config" | "source_quality" | "bot_config";
  currentValues: Record<string, unknown>;
  recentOutcomes: Record<string, unknown>;
  targetKey?: string;
  triggeredBy: string;
}

export async function runAdminConfigProposer(input: AdminConfigProposerInput): Promise<GenericWorkflowOutput | null> {
  return runGenericWorkflow(
    "admin-config-proposer",
    {
      configArea: input.configArea,
      currentValues: JSON.stringify(input.currentValues),
      recentOutcomes: JSON.stringify(input.recentOutcomes),
      targetKey: input.targetKey ?? "",
      triggeredBy: input.triggeredBy,
    },
    `admin-${input.triggeredBy}`,
  );
}
