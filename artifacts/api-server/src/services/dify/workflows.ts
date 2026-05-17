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
};

export function isWorkflowEnabled(slug: string): boolean {
  const d = WORKFLOWS[slug];
  if (!d) return false;
  return process.env[d.enabledFlagEnvVar] === "1";
}

function getApiKey(slug: string): string | null {
  const d = WORKFLOWS[slug];
  if (!d) return null;
  return process.env[d.apiKeyEnvVar] || null;
}

/**
 * Look up the Dify app id for a slug. Populated by the one-shot import
 * script. Returns null if the slug hasn't been imported yet — the wrapper
 * treats that as "Dify not ready, fall back to legacy."
 */
export async function resolveAppId(slug: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ id: difyWorkflowRegistry.difyAppId })
      .from(difyWorkflowRegistry)
      .where(eq(difyWorkflowRegistry.slug, slug))
      .limit(1);
    return row?.id ?? null;
  } catch {
    return null;
  }
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
  if (!isWorkflowEnabled(slug)) return null;
  const key = getApiKey(slug);
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
  if (!isWorkflowEnabled(slug)) return null;
  const key = getApiKey(slug);
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
