import { db } from "@workspace/db";
import {
  marketplaceListingsTable,
  researchArtifactsTable,
  capabilityAssessmentsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { appendAgentArchive } from "../../services/agent/store";
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

export const onboardingConciergeFn = inngest.createFunction(
  { ...cfg("workflow-onboarding-concierge"), triggers: [{ event: "workflow/onboarding-concierge" }] },
  async ({ event, step }) =>
    step.run("run", () => runOnboardingConcierge(event.data as Parameters<typeof runOnboardingConcierge>[0])),
);

export const tierSelectorFn = inngest.createFunction(
  { ...cfg("workflow-tier-selector"), triggers: [{ event: "workflow/tier-selector" }] },
  async ({ event, step }) =>
    step.run("run", () => runTierSelector(event.data as Parameters<typeof runTierSelector>[0])),
);

export const marketplaceSearchV2Fn = inngest.createFunction(
  { ...cfg("workflow-marketplace-search-v2"), triggers: [{ event: "workflow/marketplace-search-v2" }] },
  async ({ event, step }) =>
    step.run("run", () => runMarketplaceSearchV2(event.data as Parameters<typeof runMarketplaceSearchV2>[0])),
);

export const listingModerationFn = inngest.createFunction(
  { ...cfg("workflow-listing-moderation"), triggers: [{ event: "workflow/listing-moderation" }] },
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
  { ...cfg("workflow-kyc-failure-counselor"), triggers: [{ event: "workflow/kyc-failure-counselor" }] },
  async ({ event, step }) =>
    step.run("run", () => runKycFailureCounselor(event.data as Parameters<typeof runKycFailureCounselor>[0])),
);

export const paymentRecoveryFn = inngest.createFunction(
  { ...cfg("workflow-payment-recovery"), triggers: [{ event: "workflow/payment-recovery" }] },
  async ({ event, step }) =>
    step.run("run", () => runPaymentRecovery(event.data as Parameters<typeof runPaymentRecovery>[0])),
);

export const capabilityReviewAssistFn = inngest.createFunction(
  { ...cfg("workflow-capability-review-assist"), triggers: [{ event: "workflow/capability-review-assist" }] },
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
  { ...cfg("workflow-research-pipeline"), triggers: [{ event: "workflow/research-pipeline" }] },
  async ({ event, step }) =>
    step.run("run", () => runResearchPipeline(event.data as Parameters<typeof runResearchPipeline>[0])),
);

export const synthesisBriefComposerFn = inngest.createFunction(
  { ...cfg("workflow-synthesis-brief-composer"), triggers: [{ event: "workflow/synthesis-brief-composer" }] },
  async ({ step }) => step.run("run", () => runSynthesisBriefComposer()),
);

export const assessmentAnalyzerFn = inngest.createFunction(
  { ...cfg("workflow-assessment-analyzer"), triggers: [{ event: "workflow/assessment-analyzer" }] },
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

export const industryBootstrapFn = inngest.createFunction(
  { ...cfg("workflow-industry-bootstrap"), triggers: [{ event: "workflow/industry-bootstrap" }] },
  async ({ event, step }) =>
    step.run("run", () => runIndustryBootstrap(event.data as Parameters<typeof runIndustryBootstrap>[0])),
);

export const caseStudyGeneratorFn = inngest.createFunction(
  { ...cfg("workflow-case-study-generator"), triggers: [{ event: "workflow/case-study-generator" }] },
  async ({ event, step }) =>
    step.run("run", () => runCaseStudyGenerator(event.data as Parameters<typeof runCaseStudyGenerator>[0])),
);

export const capabilityEnrichmentRetryFn = inngest.createFunction(
  { ...cfg("workflow-capability-enrichment-retry"), triggers: [{ event: "workflow/capability-enrichment-retry" }] },
  async ({ event, step }) =>
    step.run("run", () => runCapabilityEnrichmentRetry(event.data as Parameters<typeof runCapabilityEnrichmentRetry>[0])),
);

export const adminConfigProposerFn = inngest.createFunction(
  { ...cfg("workflow-admin-config-proposer"), triggers: [{ event: "workflow/admin-config-proposer" }] },
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
