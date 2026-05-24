import { db } from "@workspace/db";
import {
  marketplaceListingsTable,
  researchArtifactsTable,
  capabilityAssessmentsTable,
  caseStudiesTable,
  capabilitiesTable,
  capabilityAlphaTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { appendAgentArchive } from "../../services/agent/store";
import { sonnet, generateObject } from "../../services/workflows/models";
import pino from "pino";
import { inngest } from "../client";
import {
  runOnboardingConcierge,
  runTierSelector,
  runMarketplaceSearchV2,
  runListingModeration,
  runKycFailureCounselor,
  runPaymentRecovery,
  runCapabilityReviewAssist,
  runResearchPipeline,
  runSynthesisBriefComposer,
  runAssessmentAnalyzer,
  runIndustryBootstrap,
  runCaseStudyGenerator,
  runCapabilityEnrichmentRetry,
  runAdminConfigProposer,
} from "../../services/workflows";

const logger = pino({ name: "inngest-workflows" });

// Phase 4 — Inngest function wrappers around the 14 one-shot workflows.
//
// Each workflow stays callable directly via its existing `run*()` export
// (synchronous code path unchanged). The Inngest function adds a second
// invocation path via `event: "workflow/<name>"`, giving callers durability,
// retries, and visibility in the Inngest dashboard.
//
// Caller migration is opt-in:
//   - Existing: `const r = await runOnboardingConcierge(input)`
//   - Inngest:  `await inngest.send({ name: "workflow/onboarding-concierge", data: input })`
//                ← fire-and-forget, or use step.invoke from another function
//                  to await the result.
//
// All workflows return `... | null` on failure today; that behavior is
// preserved. Inngest's retry policy is set to 2 — after that the function
// completes with `null` (matching legacy callers' fallback expectations).

const cfg = (id: string) => ({ id, retries: 2 } as const);

// Flow-control rationale (see CLAUDE.md + commit message):
// - Per-key concurrency replaces the old `concurrency: { limit: 1 }` global
//   cap that was letting one user/listing/capability starve every other
//   tenant's workflow queue. Each workflow picks a key that scopes the cap
//   to a tenant boundary (userId, sessionId, listingId, etc.).
// - Where no caller-side identity exists yet (marketplace-search-v2 +
//   synthesis-brief-composer are no-op stubs; admin-config-proposer is
//   admin-only) we keep the global limit=1 — fine because volume is zero.

export const onboardingConciergeFn = inngest.createFunction(
  {
    ...cfg("workflow-onboarding-concierge"),
    triggers: [{ event: "workflow/onboarding-concierge" }],
    concurrency: { limit: 1, key: "event.data.clerkUserId" },
    // Abuse cap — 60 concierge calls per user per hour is plenty for the
    // 2-3 turn flow even with retries; anything beyond that is a runaway
    // client or scripted abuse.
    rateLimit: { limit: 60, period: "1h", key: "event.data.clerkUserId" },
    // Chat-shaped: collapse keystroke bursts to a single run per session.
    // The route fans the freeFormDescription field through signals — debouncing
    // on sessionToken would be ideal but the event today carries clerkUserId
    // + the concierge state in signals; clerkUserId is the most stable key
    // available so each user gets at most one in-flight concierge per 3s
    // window. Forward-looking: if a route adds sessionToken to the event
    // payload, switch the key here without changing call sites.
    debounce: { period: "3s", key: "event.data.clerkUserId" },
    // Tier-aware priority. event.data.tier is forward-looking — callers
    // don't pass it today, so the expression resolves to 0 for everyone
    // until tier starts flowing through. Once it does, enterprise jumps
    // the line during a backlog without code changes.
    priority: { run: "event.data.tier == 'enterprise' ? 100 : event.data.tier == 'pro' ? 50 : 0" },
  },
  async ({ event, step }) =>
    step.run("run", () => runOnboardingConcierge(event.data as Parameters<typeof runOnboardingConcierge>[0])),
);

export const tierSelectorFn = inngest.createFunction(
  {
    ...cfg("workflow-tier-selector"),
    triggers: [{ event: "workflow/tier-selector" }],
    concurrency: { limit: 1, key: "event.data.userId" },
    rateLimit: { limit: 60, period: "1h", key: "event.data.userId" },
  },
  async ({ event, step }) =>
    step.run("run", () => runTierSelector(event.data as Parameters<typeof runTierSelector>[0])),
);

export const marketplaceSearchV2Fn = inngest.createFunction(
  {
    ...cfg("workflow-marketplace-search-v2"),
    triggers: [{ event: "workflow/marketplace-search-v2" }],
    concurrency: { limit: 1 },
  },
  async ({ event, step }) =>
    step.run("run", () => runMarketplaceSearchV2(event.data as Parameters<typeof runMarketplaceSearchV2>[0])),
);

export const listingModerationFn = inngest.createFunction(
  {
    ...cfg("workflow-listing-moderation"),
    triggers: [{ event: "workflow/listing-moderation" }],
    concurrency: { limit: 1, key: "event.data.listingId" },
  },
  async ({ event, step }) => {
    const input = event.data as Parameters<typeof runListingModeration>[0];
    const result = await step.run("run", () => runListingModeration(input));
    if (result) {
      await step.run("persist-moderation-hints", async () => {
        await db.update(marketplaceListingsTable).set({
          moderationHints: {
            verdict: result.verdict,
            riskFlags: result.riskFlags,
            confidence: result.confidence,
            rationale: result.rationale,
            decidedAt: new Date().toISOString(),
          },
          updatedAt: new Date(),
        }).where(eq(marketplaceListingsTable.id, input.listingId));
      });
      logger.info({ listingId: input.listingId, verdict: result.verdict, confidence: result.confidence }, "[inngest] listing-moderation verdict persisted");
    }
    return result;
  },
);

export const kycFailureCounselorFn = inngest.createFunction(
  {
    ...cfg("workflow-kyc-failure-counselor"),
    triggers: [{ event: "workflow/kyc-failure-counselor" }],
    concurrency: { limit: 1, key: "event.data.verificationId" },
    // Brief specced userId for these; event only carries verificationId so
    // we key the rate limit + debounce on it. One verification = one user
    // by construction (FK relationship), so the effect matches the intent.
    rateLimit: { limit: 60, period: "1h", key: "event.data.verificationId" },
    debounce: { period: "3s", key: "event.data.verificationId" },
  },
  async ({ event, step }) =>
    step.run("run", () => runKycFailureCounselor(event.data as Parameters<typeof runKycFailureCounselor>[0])),
);

export const paymentRecoveryFn = inngest.createFunction(
  {
    ...cfg("workflow-payment-recovery"),
    triggers: [{ event: "workflow/payment-recovery" }],
    concurrency: { limit: 1, key: "event.data.userId" },
    rateLimit: { limit: 60, period: "1h", key: "event.data.userId" },
    priority: { run: "event.data.tier == 'enterprise' ? 100 : event.data.tier == 'pro' ? 50 : 0" },
  },
  async ({ event, step }) =>
    step.run("run", () => runPaymentRecovery(event.data as Parameters<typeof runPaymentRecovery>[0])),
);

export const capabilityReviewAssistFn = inngest.createFunction(
  {
    ...cfg("workflow-capability-review-assist"),
    triggers: [{ event: "workflow/capability-review-assist" }],
    concurrency: { limit: 1, key: "event.data.capabilityId" },
    priority: { run: "event.data.tier == 'enterprise' ? 100 : event.data.tier == 'pro' ? 50 : 0" },
  },
  async ({ event, step }) => {
    const input = event.data as Parameters<typeof runCapabilityReviewAssist>[0];
    const result = await step.run("run", () => runCapabilityReviewAssist(input));
    if (result?.payload) {
      await step.run("persist-revision-prompts", async () => {
        await db.insert(researchArtifactsTable).values({
          capabilityId: input.capabilityId,
          kind: "revision_prompts",
          payload: result.payload as Record<string, unknown>,
        });
      });
      logger.info({ capabilityId: input.capabilityId, confidence: result.payload.confidence }, "[inngest] review-assist revision prompts persisted");
    }
    return result;
  },
);

export const researchPipelineFn = inngest.createFunction(
  {
    ...cfg("workflow-research-pipeline"),
    triggers: [{ event: "workflow/research-pipeline" }],
    // capabilityId is optional on the event; fall back to a "global" bucket
    // so generic prompts (kind: "generic") still share a single slot rather
    // than running fully unbounded.
    concurrency: { limit: 1, key: "event.data.capabilityId ?? 'global'" },
    // Perplexity sonar-pro is ~60/min; we cap at 30/min globally to leave
    // headroom for the CVI agent (also throttled separately) + the other
    // perplexity-bound workflows below that share this budget.
    throttle: { limit: 30, period: "1m", key: "global" },
  },
  async ({ event, step }) => {
    const input = event.data as Parameters<typeof runResearchPipeline>[0];
    const result = await step.run("run", () => runResearchPipeline(input));
    if (result?.status === "ok" && input.capabilityId) {
      await step.run("persist-research-artifact", async () => {
        await db.insert(researchArtifactsTable).values({
          capabilityId: input.capabilityId ?? null,
          kind: input.kind,
          payload: result.payload as Record<string, unknown>,
        });
      });
    }
    return result;
  },
);

export const synthesisBriefComposerFn = inngest.createFunction(
  {
    ...cfg("workflow-synthesis-brief-composer"),
    triggers: [{ event: "workflow/synthesis-brief-composer" }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => step.run("run", () => runSynthesisBriefComposer()),
);

export const assessmentAnalyzerFn = inngest.createFunction(
  {
    ...cfg("workflow-assessment-analyzer"),
    triggers: [{ event: "workflow/assessment-analyzer" }],
    concurrency: { limit: 1, key: "event.data.sessionId" },
    priority: { run: "event.data.tier == 'enterprise' ? 100 : event.data.tier == 'pro' ? 50 : 0" },
  },
  async ({ event, step }) => {
    const input = event.data as Parameters<typeof runAssessmentAnalyzer>[0];
    const result = await step.run("run", () => runAssessmentAnalyzer(input));
    if (!result?.payload) return result;

    // Phase "start" persists clarifyingQuestions; phase "analyze" persists
    // the full analysis blob + roadmap + confidenceScore + status, and also
    // appends an archive entry for downstream agents. Each write goes
    // through step.run so Inngest retries replay them idempotently.
    if (input.phase === "start") {
      const payload = result.payload as { capabilities?: Array<{ definition: string }> };
      if (Array.isArray(payload.capabilities)) {
        const qs = payload.capabilities.slice(0, 3).map((c) => c.definition);
        await step.run("persist-assessment-start", async () => {
          await db.update(capabilityAssessmentsTable)
            .set({ clarifyingQuestions: qs })
            .where(eq(capabilityAssessmentsTable.sessionId, input.sessionId));
        });
      }
    } else {
      const payload = result.payload as Record<string, unknown>;
      const confidenceScore = (payload.confidenceScore as number) || 0;
      const roadmap = (payload.roadmap as Record<string, unknown> | null) ?? null;
      await step.run("persist-assessment-analyze", async () => {
        await db.update(capabilityAssessmentsTable)
          .set({ analysisResult: payload, roadmap, confidenceScore, status: "complete" })
          .where(eq(capabilityAssessmentsTable.sessionId, input.sessionId));
      });
      await step.run("append-archive", async () => {
        try {
          const ctx = input.orgContext ?? {};
          const memoryText = [
            `Company: ${(ctx.companyName as string) || "Unknown"} | Industry: ${input.industryName || "Unknown"}`,
            `Executive Summary: ${(payload.executiveSummary as string) || ""}`,
            `Confidence: ${confidenceScore}/100`,
            `Top gaps: ${((payload.gaps as Array<{ capability: string }>) || []).slice(0, 3).map((g) => g.capability).join(", ")}`,
            `Top recommendations: ${((payload.topRecommendations as Array<{ title: string }>) || []).slice(0, 3).map((r) => r.title).join(", ")}`,
          ].join("\n");
          await appendAgentArchive(
            memoryText,
            { kind: "assessment_complete", sessionId: input.sessionId, confidenceScore },
            "assessment-agent",
          );
        } catch (e) {
          logger.warn({ err: e instanceof Error ? e.message : String(e) }, "[inngest] assessment-analyzer archive append failed");
        }
      });
    }
    return result;
  },
);

// Sonnet bridge schema: converts the bootstrap workflow's generic capability
// payload into the strict shape the /admin/industries route inserts into the
// capabilities table. Lives here (next to the function) so retries replay
// the bridge step alongside the perplexity/sonnet call atomically.
const IndustryBridgeCapabilitySchema = z.object({
  name: z.string().min(2).max(40),
  slug: z.string().min(2).max(60),
  description: z.string(),
  traditionalView: z.string(),
  economicView: z.string(),
  benchmarkScore: z.number().int().min(30).max(85),
  greenMin: z.number().int().min(0).max(100),
  yellowMin: z.number().int().min(0).max(100),
  redMax: z.number().int().min(0).max(100),
});
const IndustryBridgeSchema = z.object({
  capabilities: z.array(IndustryBridgeCapabilitySchema).min(6).max(8),
});

export const industryBootstrapFn = inngest.createFunction(
  {
    ...cfg("workflow-industry-bootstrap"),
    triggers: [{ event: "workflow/industry-bootstrap" }],
    // Industry slug not present on the input today — industryName is the
    // canonical handle. Same effect (one in-flight per industry) so admin
    // double-clicks don't kick off parallel Perplexity bursts on one slug.
    concurrency: { limit: 1, key: "event.data.industryName" },
    throttle: { limit: 30, period: "1m", key: "global" },
  },
  async ({ event, step }) => {
    const input = event.data as Parameters<typeof runIndustryBootstrap>[0];
    const bootstrap = await step.run("bootstrap", () => runIndustryBootstrap(input));
    if (!bootstrap?.payload) return bootstrap;

    const payload = bootstrap.payload as {
      capabilities?: Array<Record<string, unknown>>;
      citations?: Array<{ url: string; title?: string }>;
    };
    if (!Array.isArray(payload.capabilities)) return bootstrap;

    // Sonnet bridge — convert the workflow's capabilities into the
    // CapabilitiesSchema shape the admin route uses to populate the DB.
    const research = {
      content: JSON.stringify(payload.capabilities),
      citations: (payload.citations ?? []).map((c) => c.url).filter(Boolean),
    };
    const bridged = await step.run("sonnet-bridge", async () => {
      try {
        const { object } = await generateObject({
          model: sonnet,
          schema: IndustryBridgeSchema,
          system: `You design industry-specific capability sets. Each capability has a benchmarkScore (30-85). greenMin typically benchmarkScore + 10; yellowMin benchmarkScore - 5; redMax yellowMin - 1. Slugs are kebab-case.`,
          prompt: `Industry: ${input.industryName}\n\nResearch:\n${research.content}\n\nProduce 6-8 capabilities for this industry.`,
          temperature: 0.2,
          maxTokens: 6000,
        });
        return object;
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[inngest] industry-bootstrap sonnet bridge failed");
        return null;
      }
    });

    return {
      status: bootstrap.status,
      payload: {
        ...payload,
        bridged: bridged
          ? { capabilities: bridged.capabilities, citations: research.citations }
          : null,
      },
    };
  },
);

export const caseStudyGeneratorFn = inngest.createFunction(
  {
    ...cfg("workflow-case-study-generator"),
    triggers: [{ event: "workflow/case-study-generator" }],
    // Brief specced industrySlug as the key but the input only carries
    // industryName + caseStudyId. caseStudyId is the more useful tenant
    // boundary anyway (each case study is a distinct admin action).
    concurrency: { limit: 1, key: "event.data.caseStudyId" },
    throttle: { limit: 30, period: "1m", key: "global" },
  },
  async ({ event, step }) => {
    const input = event.data as Parameters<typeof runCaseStudyGenerator>[0];
    const result = await step.run("run", () => runCaseStudyGenerator(input));
    if (result?.payload && Object.keys(result.payload).length > 0) {
      await step.run("persist-economics-breakdown", async () => {
        await db.update(caseStudiesTable)
          .set({ economicsBreakdown: result.payload as unknown as typeof caseStudiesTable.$inferInsert["economicsBreakdown"] })
          .where(eq(caseStudiesTable.id, input.caseStudyId));
      });
    }
    return result;
  },
);

export const capabilityEnrichmentRetryFn = inngest.createFunction(
  {
    ...cfg("workflow-capability-enrichment-retry"),
    triggers: [{ event: "workflow/capability-enrichment-retry" }],
    concurrency: { limit: 1, key: "event.data.capabilityId" },
    throttle: { limit: 30, period: "1m", key: "global" },
  },
  async ({ event, step }) => {
    const input = event.data as Parameters<typeof runCapabilityEnrichmentRetry>[0];
    const result = await step.run("run", () => runCapabilityEnrichmentRetry(input));
    const persisted = { capabilities: false, capability_alpha: false };
    if (result?.status === "ok") {
      const p = result.payload as {
        narratives?: { traditional?: string; economic?: string; ai?: string };
        moatTier?: string;
        tamUsd?: number | null;
        evarBp?: number | null;
        citations?: Array<{ url: string; title: string }>;
      };

      // Update capabilities.traditional_view / economic_view if the LLM gave
      // us new ones (better than what's there). enrichmentError is cleared
      // on a successful retry — the row is no longer "failed".
      await step.run("persist-capabilities", async () => {
        const capUpdates: Record<string, string | null> = { enrichmentError: null };
        if (p.narratives?.traditional && p.narratives.traditional.length > 20) {
          capUpdates.traditionalView = p.narratives.traditional;
        }
        if (p.narratives?.economic && p.narratives.economic.length > 20) {
          capUpdates.economicView = p.narratives.economic;
        }
        if (Object.keys(capUpdates).length > 0) {
          await db.update(capabilitiesTable).set(capUpdates).where(eq(capabilitiesTable.id, input.capabilityId));
          persisted.capabilities = true;
        }
      });

      // Upsert into capability_alpha — the table that holds TAM/EVaR/moat
      // tier + narratives. We update the most-recent row for this capability
      // (the wrapper doesn't know the run id, so just patch latest).
      await step.run("persist-capability-alpha", async () => {
        const [latestAlpha] = await db
          .select({ id: capabilityAlphaTable.id })
          .from(capabilityAlphaTable)
          .where(eq(capabilityAlphaTable.capabilityId, input.capabilityId))
          .orderBy(desc(capabilityAlphaTable.generatedAt))
          .limit(1);
        if (latestAlpha) {
          const alphaUpdates: Record<string, unknown> = {};
          if (typeof p.tamUsd === "number") alphaUpdates.tamUsdMm = p.tamUsd / 1_000_000;
          if (p.narratives?.traditional) alphaUpdates.traditionalNarrative = p.narratives.traditional;
          if (p.narratives?.economic) alphaUpdates.alphaNarrative = p.narratives.economic;
          if (p.narratives?.ai) alphaUpdates.aiNarrative = p.narratives.ai;
          if (Object.keys(alphaUpdates).length > 0) {
            await db.update(capabilityAlphaTable).set(alphaUpdates).where(eq(capabilityAlphaTable.id, latestAlpha.id));
            persisted.capability_alpha = true;
          }
        }
      });
      logger.info({ capabilityId: input.capabilityId, persisted }, "[inngest] capability-enrichment-retry payload persisted");
    }
    return result ? { status: result.status, payload: result.payload, persisted } : null;
  },
);

export const adminConfigProposerFn = inngest.createFunction(
  {
    ...cfg("workflow-admin-config-proposer"),
    triggers: [{ event: "workflow/admin-config-proposer" }],
    concurrency: { limit: 1 },
  },
  async ({ event, step }) =>
    step.run("run", () => runAdminConfigProposer(event.data as Parameters<typeof runAdminConfigProposer>[0])),
);

export const workflowFunctions = [
  onboardingConciergeFn,
  tierSelectorFn,
  marketplaceSearchV2Fn,
  listingModerationFn,
  kycFailureCounselorFn,
  paymentRecoveryFn,
  capabilityReviewAssistFn,
  researchPipelineFn,
  synthesisBriefComposerFn,
  assessmentAnalyzerFn,
  industryBootstrapFn,
  caseStudyGeneratorFn,
  capabilityEnrichmentRetryFn,
  adminConfigProposerFn,
];
