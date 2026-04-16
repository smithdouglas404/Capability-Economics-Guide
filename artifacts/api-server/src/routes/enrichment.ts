import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  capabilityQuadrantsTable,
  valueChainStagesTable,
  companyCapabilityProfilesTable,
  companyCapabilityMappingsTable,
  industriesTable,
  capabilitiesTable,
  capabilityDependenciesTable,
  ontologyRelationshipsTable,
  enrichmentRunsTable,
} from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { runEnrichment } from "../services/enrichment/index";

const router = Router();

router.post("/run", async (_req: Request, res: Response) => {
  try {
    const result = await runEnrichment();
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Enrichment failed";
    const status = msg.includes("already in progress") ? 409 : 500;
    res.status(status).json({ error: msg });
  }
});

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const [quadrants] = await db.select({ count: sql<number>`count(*)::int` }).from(capabilityQuadrantsTable);
    const [stages] = await db.select({ count: sql<number>`count(*)::int` }).from(valueChainStagesTable);
    const [companies] = await db.select({ count: sql<number>`count(*)::int` }).from(companyCapabilityProfilesTable);
    const [mappings] = await db.select({ count: sql<number>`count(*)::int` }).from(companyCapabilityMappingsTable);

    res.json({
      quadrants: quadrants?.count ?? 0,
      valueChainStages: stages?.count ?? 0,
      companies: companies?.count ?? 0,
      companyMappings: mappings?.count ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Status check failed" });
  }
});

router.get("/runs", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const runs = await db.select().from(enrichmentRunsTable).orderBy(desc(enrichmentRunsTable.startedAt)).limit(limit);
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Query failed" });
  }
});

router.get("/quadrants", async (req: Request, res: Response) => {
  try {
    const industryId = req.query.industryId ? parseInt(req.query.industryId as string) : undefined;
    const conditions = industryId ? eq(capabilityQuadrantsTable.industryId, industryId) : undefined;
    const rows = conditions
      ? await db.select().from(capabilityQuadrantsTable).where(conditions).orderBy(desc(capabilityQuadrantsTable.generatedAt))
      : await db.select().from(capabilityQuadrantsTable).orderBy(desc(capabilityQuadrantsTable.generatedAt));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Query failed" });
  }
});

router.get("/value-chain", async (req: Request, res: Response) => {
  try {
    const industryId = req.query.industryId ? parseInt(req.query.industryId as string) : undefined;
    const conditions = industryId ? eq(valueChainStagesTable.industryId, industryId) : undefined;
    const rows = conditions
      ? await db.select().from(valueChainStagesTable).where(conditions).orderBy(valueChainStagesTable.stageOrder)
      : await db.select().from(valueChainStagesTable).orderBy(valueChainStagesTable.stageOrder);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Query failed" });
  }
});

router.get("/companies", async (req: Request, res: Response) => {
  try {
    const industryId = req.query.industryId ? parseInt(req.query.industryId as string) : undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    const conditions = industryId && !isNaN(industryId) ? eq(companyCapabilityProfilesTable.industryId, industryId) : undefined;
    const query = db.select().from(companyCapabilityProfilesTable);
    const countQuery = db.select({ count: sql<number>`count(*)::int` }).from(companyCapabilityProfilesTable);

    const rows = conditions
      ? await query.where(conditions).orderBy(desc(companyCapabilityProfilesTable.feviScore)).limit(limit).offset(offset)
      : await query.orderBy(desc(companyCapabilityProfilesTable.feviScore)).limit(limit).offset(offset);
    const [total] = conditions
      ? await countQuery.where(conditions)
      : await countQuery;

    res.json({ data: rows, page, limit, total: total?.count ?? 0 });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Query failed" });
  }
});

router.get("/company-mappings", async (req: Request, res: Response) => {
  try {
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;
    const conditions = companyId ? eq(companyCapabilityMappingsTable.companyId, companyId) : undefined;
    const rows = conditions
      ? await db.select().from(companyCapabilityMappingsTable).where(conditions)
      : await db.select().from(companyCapabilityMappingsTable);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Query failed" });
  }
});

router.get("/graph", async (_req: Request, res: Response) => {
  try {
    const industries = await db.select().from(industriesTable);
    const capabilities = await db.select({
      id: capabilitiesTable.id,
      name: capabilitiesTable.name,
      industryId: capabilitiesTable.industryId,
      benchmarkScore: capabilitiesTable.benchmarkScore,
    }).from(capabilitiesTable);

    const quadrants = await db.select({
      capabilityId: capabilityQuadrantsTable.capabilityId,
      quadrant: capabilityQuadrantsTable.quadrant,
      economicImpactScore: capabilityQuadrantsTable.economicImpactScore,
      adoptionMomentumScore: capabilityQuadrantsTable.adoptionMomentumScore,
      disruptionIntensity: capabilityQuadrantsTable.disruptionIntensity,
    }).from(capabilityQuadrantsTable);

    const dependencies = await db.select().from(capabilityDependenciesTable);
    const ontologyRels = await db.select().from(ontologyRelationshipsTable);

    const companies = await db.select({
      id: companyCapabilityProfilesTable.id,
      name: companyCapabilityProfilesTable.name,
      country: companyCapabilityProfilesTable.country,
      industryId: companyCapabilityProfilesTable.industryId,
      feviScore: companyCapabilityProfilesTable.feviScore,
      cdiScore: companyCapabilityProfilesTable.cdiScore,
      quadrant: companyCapabilityProfilesTable.quadrant,
      fundingStage: companyCapabilityProfilesTable.fundingStage,
    }).from(companyCapabilityProfilesTable);

    const companyMappings = await db.select().from(companyCapabilityMappingsTable);

    const valueChainStages = await db.select().from(valueChainStagesTable);

    const quadrantMap = new Map(quadrants.map(q => [q.capabilityId, q]));
    const enrichedCapabilities = capabilities.map(c => ({
      ...c,
      quadrant: quadrantMap.get(c.id)?.quadrant ?? null,
      economicImpactScore: quadrantMap.get(c.id)?.economicImpactScore ?? null,
      adoptionMomentumScore: quadrantMap.get(c.id)?.adoptionMomentumScore ?? null,
      disruptionIntensity: quadrantMap.get(c.id)?.disruptionIntensity ?? null,
    }));

    res.json({
      industries,
      capabilities: enrichedCapabilities,
      quadrants,
      valueChainStages,
      dependencies,
      relationships: ontologyRels,
      companies,
      companyMappings,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Graph query failed" });
  }
});

export const enrichmentAliasRouter = Router();

enrichmentAliasRouter.get("/ontology/graph", (req: Request, res: Response, next) => {
  req.url = "/graph";
  router(req, res, next);
});

enrichmentAliasRouter.get("/ontology/quadrants", (req: Request, res: Response, next) => {
  req.url = "/quadrants";
  router(req, res, next);
});

enrichmentAliasRouter.get("/ontology/companies", (req: Request, res: Response, next) => {
  req.url = "/companies";
  router(req, res, next);
});

enrichmentAliasRouter.get("/ontology/value-chain", (req: Request, res: Response, next) => {
  req.url = "/value-chain";
  router(req, res, next);
});

enrichmentAliasRouter.get("/ontology/runs", (req: Request, res: Response, next) => {
  req.url = "/runs";
  router(req, res, next);
});

export default router;
