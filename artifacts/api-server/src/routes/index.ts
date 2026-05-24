import { Router, type IRouter } from "express";
import healthRouter from "./health";
import industriesRouter from "./industries";
import capabilitiesRouter from "./capabilities";
import organizationsRouter from "./organizations";
import dashboardRouter from "./dashboard";
import projectsRouter from "./projects";
import insightsRouter from "./insights";
import tourGuideRouter from "./tour-guide";
import uploadAnalysisRouter from "./upload-analysis";
import aiStreamRouter from "./ai-stream";
import membersRouter from "./members";
import memberNetworkRouter from "./member-network";
import networkExtrasRouter from "./network-extras";
import socialExtrasRouter from "./social-extras";
import adminSeedHistoricalEventsRouter from "./admin-seed-historical-events";
import adminMigrateScheduledExportsRouter from "./admin-migrate-scheduled-exports";
import adminEnrichmentRunsRouter from "./admin-enrichment-runs";
import adminSeedDisruptionRouter from "./admin-seed-disruption";
import forumsRouter from "./forums";
import cviRouter from "./cvi";
import dvxRouter from "./dvx";
import businessCasesRouter from "./business-cases";
import voiceRouter from "./voice";
import coverageRouter from "./coverage";
import sourceQualityRouter from "./source-quality";
import capabilityAnnotationsRouter from "./capability-annotations";
import explainabilityRouter from "./explainability";
import compareRouter from "./compare";
import whatifRouter from "./whatif";
import disruptionRouter from "./disruption";
import cascadeRouter from "./cascade";
import stackOptimizerRouter from "./stack-optimizer";
import peerCoopRouter from "./peer-coop";
import semanticSearchRouter from "./semantic-search";
import proofRouter from "./proof";
import ideationRouter from "./ideation";
import workbenchRouter from "./workbench";
import disruptionPatternsRouter from "./disruption-patterns";
import analoguesRouter from "./analogues";
import disruptionWatchRouter from "./disruption-watch";
import marketplaceWorkspaceRouter from "./marketplace-workspace";
import onboardingRouter from "./onboarding";
import digestsRouter from "./digests";
import embedRouter from "./embed";
import agentRouter from "./agent";
import contentRouter from "./content";
import assessRouter from "./assess";
import secRouter from "./sec";
import adminRouter from "./admin";
import enrichmentRouter from "./enrichment";
import { enrichmentAliasRouter } from "./enrichment";
import enrichmentConfigRouter from "./enrichment-config";
import educationalContentRouter from "./educational-content";
import caseStudiesRouter from "./case-studies";
import dynamicIndustriesRouter from "./dynamic-industries";
import vcrRouter from "./vcr";
import alphaRouter from "./alpha";
import reviewRouter from "./review";
import membershipRouter from "./membership";
import platformSignupRouter from "./platform-signup";
import synthesisRouter from "./synthesis";
import consensusRouter from "./consensus";
import backtestRollingRouter from "./backtest-rolling";
import macroEventsRouter from "./macro-events";
import companiesRouter from "./companies";
import usageRouter from "./usage";
import reviewQueueRouter from "./review-queue";
import portfolioRouter from "./portfolio";
import simulationRouter from "./simulation";
import warRoomRouter from "./war-room";
import tradeSignalsRouter from "./trade-signals";
import innovationPipelineRouter from "./innovation-pipeline";
import watchlistRouter from "./watchlist";
import benchmarkingRouter from "./benchmarking";
import roiRouter from "./roi";
import nlQueryRouter from "./nl-query";
import regulationsRouter from "./regulations";
import knowledgeGraphRouter from "./knowledge-graph";
import collaborationRouter from "./collaboration";
import creditsRouter from "./credits";
import kycRouter from "./kyc";
import auditLogRouter from "./audit-log";
import apiKeysRouter from "./api-keys";
import dashboardViewsRouter from "./dashboard-views";
import meRouter from "./me";
import learningRouter from "./learning";
import impersonateRouter from "./impersonate";
import invoicesRouter from "./invoices";
import billingOrgsRouter from "./billing-orgs";
import marketplaceSellersRouter from "./marketplace-sellers";
import marketplaceListingsRouter from "./marketplace-listings";
import marketplaceReviewsRouter from "./marketplace-reviews";
import marketplacePurchasesRouter from "./marketplace-purchases";
import featuredContentRouter from "./featured-content";
import foundryAdminRouter from "./foundry-admin";
import backtestRouter from "./backtest";
import productsRouter from "./products";
import subscriptionsRouter from "./subscriptions";
import exportsRouter from "./exports";
import scheduledExportsRouter from "./scheduled-exports";
import apiVolumeRouter from "./api-volume";
import metricsRouter from "./metrics";
import adminSecurityRouter from "./admin-security";
import { requireTier } from "../middlewares/requireTier";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dynamicIndustriesRouter);
router.use(industriesRouter);
router.use(enrichmentAliasRouter);
router.use(capabilitiesRouter);
router.use(organizationsRouter);
router.use(dashboardRouter);
router.use(projectsRouter);
router.use(insightsRouter);
router.use(tourGuideRouter);
router.use(uploadAnalysisRouter);
router.use(aiStreamRouter);
router.use(membersRouter);
router.use(memberNetworkRouter);
router.use(networkExtrasRouter);
router.use(socialExtrasRouter);
router.use(adminSeedHistoricalEventsRouter);
router.use(adminMigrateScheduledExportsRouter);
router.use(adminEnrichmentRunsRouter);
router.use(adminSeedDisruptionRouter);
router.use(forumsRouter);
router.use(cviRouter);
router.use(dvxRouter);
router.use(businessCasesRouter);
router.use(voiceRouter);
router.use(coverageRouter);
// sourceQualityRouter mounts BEFORE adminRouter so its /admin/source-quality
// route uses its own per-route requireAdmin middleware rather than the catch-all.
router.use(sourceQualityRouter);
router.use(capabilityAnnotationsRouter);
router.use(explainabilityRouter);
router.use(compareRouter);
router.use(whatifRouter);
router.use(disruptionRouter);
router.use(cascadeRouter);
router.use(stackOptimizerRouter);
router.use(peerCoopRouter);
router.use(semanticSearchRouter);
router.use(proofRouter);
router.use(ideationRouter);
router.use(workbenchRouter);
// disruptionPatternsRouter mounts BEFORE adminRouter so its /admin/patterns/*
// routes use their own per-route requireAdmin middleware rather than the catch-all.
router.use(disruptionPatternsRouter);
router.use(analoguesRouter);
router.use(disruptionWatchRouter);
router.use(marketplaceWorkspaceRouter);
router.use(onboardingRouter);
// digestsRouter mounts BEFORE adminRouter so its /admin/digest/run route uses
// its own per-route requireAdmin middleware rather than the catch-all.
router.use(digestsRouter);
router.use(embedRouter);
router.use(agentRouter);
router.use(contentRouter);
router.use(assessRouter);
router.use(secRouter);
// enrichmentConfigRouter must mount BEFORE adminRouter — adminRouter has a
// catch-all `router.use("/admin", requireAdmin)` that would otherwise block
// the public read-only GET /admin/enrichment/config the admin UI relies on.
router.use(enrichmentConfigRouter);
// productsRouter mounts BEFORE adminRouter for the same reason as
// enrichmentConfigRouter: adminRouter has a catch-all `router.use("/admin",
// requireAdmin)` that would block /admin/products routes which use their
// own per-route requireAdmin middleware.
router.use(productsRouter);
// subscriptionsRouter mounts BEFORE adminRouter so its /admin/notifications/run-digest
// route uses its own per-route requireAdmin middleware rather than the catch-all.
router.use(subscriptionsRouter);
router.use(exportsRouter);
router.use(scheduledExportsRouter);
// apiVolumeRouter mounts BEFORE adminRouter — uses its own per-route requireAdmin
// rather than the catch-all so the route key spelling stays consistent.
router.use(apiVolumeRouter);
// reviewQueueRouter mounts BEFORE adminRouter — uses its own per-route
// requireReviewer rather than the catch-all requireAdmin. Approve/reject
// of regulation + requirement proposals (the seed → review-queue cutover).
router.use(reviewQueueRouter);
router.use(portfolioRouter);
router.use(adminRouter);
router.use(foundryAdminRouter);
router.use(backtestRouter);
router.use(educationalContentRouter);
router.use(caseStudiesRouter);
router.use(vcrRouter);
router.use("/enrichment", enrichmentRouter);
router.use("/alpha", alphaRouter);
router.use(reviewRouter);
router.use(membershipRouter);
router.use(platformSignupRouter);
router.use(synthesisRouter);
router.use(consensusRouter);
router.use(backtestRollingRouter);
router.use(macroEventsRouter);
router.use(companiesRouter);
router.use(usageRouter);
router.use(creditsRouter);
router.use(kycRouter);
router.use(auditLogRouter);
router.use(apiKeysRouter);
router.use(dashboardViewsRouter);
router.use(meRouter);
router.use(learningRouter);
router.use(impersonateRouter);
router.use(invoicesRouter);
router.use(billingOrgsRouter);
router.use(marketplaceSellersRouter);
router.use(marketplaceListingsRouter);
router.use(marketplaceReviewsRouter);
router.use(marketplacePurchasesRouter);
router.use(featuredContentRouter);

// ── Tier-gated routes (The Console+) ──
const consoleGate = requireTier("console");
router.use("/simulation", consoleGate);
router.use("/war-room", consoleGate);
router.use("/trade-signals", consoleGate);
router.use("/innovation", consoleGate);
router.use("/benchmarking", consoleGate);
router.use("/roi", consoleGate);

router.use(simulationRouter);
router.use(warRoomRouter);
router.use(tradeSignalsRouter);
router.use(innovationPipelineRouter);
router.use(benchmarkingRouter);
router.use(roiRouter);
router.use(watchlistRouter);

// Open routes (all tiers)
router.use(nlQueryRouter);
router.use(regulationsRouter);
router.use(knowledgeGraphRouter);
router.use(collaborationRouter);
router.use(metricsRouter);
router.use(adminSecurityRouter);

export default router;
