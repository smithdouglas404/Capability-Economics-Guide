import { Router, type IRouter } from "express";
import healthRouter from "./health";
import industriesRouter from "./industries";
import capabilitiesRouter from "./capabilities";
import organizationsRouter from "./organizations";
import dashboardRouter from "./dashboard";
import projectsRouter from "./projects";
import insightsRouter from "./insights";
import ceiRouter from "./cei";
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
import vceRouter from "./vce";
import alphaRouter from "./alpha";
import reviewRouter from "./review";
import membershipRouter from "./membership";
import macroEventsRouter from "./macro-events";
import companiesRouter from "./companies";
import usageRouter from "./usage";
import simulationRouter from "./simulation";
import warRoomRouter from "./war-room";
import tradeSignalsRouter from "./trade-signals";
import innovationPipelineRouter from "./innovation-pipeline";
import watchlistRouter from "./watchlist";
import benchmarkingRouter from "./benchmarking";
import roiRouter from "./roi";
import nlQueryRouter from "./nl-query";
import regulationsRouter from "./regulations";
import collaborationRouter from "./collaboration";
import creditsRouter from "./credits";
import kycRouter from "./kyc";
import auditLogRouter from "./audit-log";
import apiKeysRouter from "./api-keys";
import meRouter from "./me";
import impersonateRouter from "./impersonate";
import invoicesRouter from "./invoices";
import billingOrgsRouter from "./billing-orgs";
import marketplaceSellersRouter from "./marketplace-sellers";
import marketplaceListingsRouter from "./marketplace-listings";
import marketplacePurchasesRouter from "./marketplace-purchases";
import featuredContentRouter from "./featured-content";
import foundryAdminRouter from "./foundry-admin";
import backtestRouter from "./backtest";
import productsRouter from "./products";
import subscriptionsRouter from "./subscriptions";
import exportsRouter from "./exports";
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
router.use(ceiRouter);
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
router.use(adminRouter);
router.use(foundryAdminRouter);
router.use(backtestRouter);
router.use(educationalContentRouter);
router.use(caseStudiesRouter);
router.use(vceRouter);
router.use("/enrichment", enrichmentRouter);
router.use("/alpha", alphaRouter);
router.use(reviewRouter);
router.use(membershipRouter);
router.use(macroEventsRouter);
router.use(companiesRouter);
router.use(usageRouter);
router.use(creditsRouter);
router.use(kycRouter);
router.use(auditLogRouter);
router.use(apiKeysRouter);
router.use(meRouter);
router.use(impersonateRouter);
router.use(invoicesRouter);
router.use(billingOrgsRouter);
router.use(marketplaceSellersRouter);
router.use(marketplaceListingsRouter);
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

// Open routes (all tiers)
router.use(nlQueryRouter);
router.use(regulationsRouter);
router.use(collaborationRouter);

export default router;
