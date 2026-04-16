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

router.post("/run", async (req: Request, res: Response) => {
  const adminKey = req.headers["x-admin-key"];
  if (process.env.NODE_ENV === "production" && adminKey !== process.env.ADMIN_API_KEY) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
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

router.get("/runs", queryRuns);

router.get("/quadrants", queryQuadrants);
router.get("/value-chain", queryValueChainStages);
router.get("/companies", queryCompanies);

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

async function graphHandler(req: Request, res: Response) {
  try {
    const runId = parseRunId(req) ?? await getLatestRunId();
    const runFilter = runId ? eq(capabilityQuadrantsTable.runId, runId) : undefined;
    const vcRunFilter = runId ? eq(valueChainStagesTable.runId, runId) : undefined;
    const companyRunFilter = runId ? eq(companyCapabilityProfilesTable.runId, runId) : undefined;
    const mappingRunFilter = runId ? eq(companyCapabilityMappingsTable.runId, runId) : undefined;

    const industries = await db.select().from(industriesTable);
    const capabilities = await db.select({
      id: capabilitiesTable.id,
      name: capabilitiesTable.name,
      industryId: capabilitiesTable.industryId,
      benchmarkScore: capabilitiesTable.benchmarkScore,
    }).from(capabilitiesTable);

    const quadrantsQuery = db.select({
      capabilityId: capabilityQuadrantsTable.capabilityId,
      quadrant: capabilityQuadrantsTable.quadrant,
      economicImpactScore: capabilityQuadrantsTable.economicImpactScore,
      adoptionMomentumScore: capabilityQuadrantsTable.adoptionMomentumScore,
      disruptionIntensity: capabilityQuadrantsTable.disruptionIntensity,
    }).from(capabilityQuadrantsTable);
    const quadrants = runFilter ? await quadrantsQuery.where(runFilter) : await quadrantsQuery;

    const dependencies = await db.select().from(capabilityDependenciesTable);
    const ontologyRels = await db.select().from(ontologyRelationshipsTable);

    const companiesQuery = db.select({
      id: companyCapabilityProfilesTable.id,
      name: companyCapabilityProfilesTable.name,
      country: companyCapabilityProfilesTable.country,
      naicsSector: companyCapabilityProfilesTable.naicsSector,
      industryId: companyCapabilityProfilesTable.industryId,
      feviScore: companyCapabilityProfilesTable.feviScore,
      cdiScore: companyCapabilityProfilesTable.cdiScore,
      quadrant: companyCapabilityProfilesTable.quadrant,
      fundingStage: companyCapabilityProfilesTable.fundingStage,
    }).from(companyCapabilityProfilesTable);
    const companies = companyRunFilter ? await companiesQuery.where(companyRunFilter) : await companiesQuery;

    const mappingsQuery = db.select().from(companyCapabilityMappingsTable);
    const companyMappings = mappingRunFilter ? await mappingsQuery.where(mappingRunFilter) : await mappingsQuery;

    const vcQuery = db.select().from(valueChainStagesTable);
    const valueChainStages = vcRunFilter ? await vcQuery.where(vcRunFilter) : await vcQuery;

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
}

router.get("/graph", graphHandler);

async function getLatestRunId(): Promise<number | null> {
  const [latest] = await db.select({ id: enrichmentRunsTable.id })
    .from(enrichmentRunsTable)
    .where(sql`${enrichmentRunsTable.status} IN ('completed', 'completed_with_errors')`)
    .orderBy(desc(enrichmentRunsTable.startedAt))
    .limit(1);
  return latest?.id ?? null;
}

function parseRunId(req: Request): number | undefined {
  return req.query.runId ? parseInt(req.query.runId as string) : undefined;
}

async function queryQuadrants(req: Request, res: Response) {
  try {
    const industryId = req.query.industryId ? parseInt(req.query.industryId as string) : undefined;
    const runId = parseRunId(req) ?? await getLatestRunId();
    const conditions = [];
    if (industryId && !isNaN(industryId)) conditions.push(eq(capabilityQuadrantsTable.industryId, industryId));
    if (runId) conditions.push(eq(capabilityQuadrantsTable.runId, runId));
    const rows = conditions.length > 0
      ? await db.select().from(capabilityQuadrantsTable).where(sql`${sql.join(conditions, sql` AND `)}`).orderBy(desc(capabilityQuadrantsTable.generatedAt))
      : await db.select().from(capabilityQuadrantsTable).orderBy(desc(capabilityQuadrantsTable.generatedAt));
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Query failed" });
  }
}

async function queryValueChainStages(req: Request, res: Response) {
  try {
    const industryId = req.query.industryId ? parseInt(req.query.industryId as string) : undefined;
    const runId = parseRunId(req) ?? await getLatestRunId();
    const conditions = [];
    if (industryId && !isNaN(industryId)) conditions.push(eq(valueChainStagesTable.industryId, industryId));
    if (runId) conditions.push(eq(valueChainStagesTable.runId, runId));
    const rows = conditions.length > 0
      ? await db.select().from(valueChainStagesTable).where(sql`${sql.join(conditions, sql` AND `)}`).orderBy(valueChainStagesTable.stageOrder)
      : await db.select().from(valueChainStagesTable).orderBy(valueChainStagesTable.stageOrder);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Query failed" });
  }
}

async function queryCompanies(req: Request, res: Response) {
  try {
    const industryId = req.query.industryId ? parseInt(req.query.industryId as string) : undefined;
    const runId = parseRunId(req) ?? await getLatestRunId();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    const conditions = [];
    if (industryId && !isNaN(industryId)) conditions.push(eq(companyCapabilityProfilesTable.industryId, industryId));
    if (runId) conditions.push(eq(companyCapabilityProfilesTable.runId, runId));
    const whereClause = conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined;

    const query = db.select().from(companyCapabilityProfilesTable);
    const countQuery = db.select({ count: sql<number>`count(*)::int` }).from(companyCapabilityProfilesTable);

    const rows = whereClause
      ? await query.where(whereClause).orderBy(desc(companyCapabilityProfilesTable.feviScore)).limit(limit).offset(offset)
      : await query.orderBy(desc(companyCapabilityProfilesTable.feviScore)).limit(limit).offset(offset);
    const [total] = whereClause
      ? await countQuery.where(whereClause)
      : await countQuery;

    res.json({ data: rows, page, limit, total: total?.count ?? 0 });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Query failed" });
  }
}

async function queryRuns(_req: Request, res: Response) {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(_req.query.limit as string) || 20));
    const runs = await db.select().from(enrichmentRunsTable).orderBy(desc(enrichmentRunsTable.startedAt)).limit(limit);
    res.json(runs);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Query failed" });
  }
}

export const enrichmentAliasRouter = Router();

enrichmentAliasRouter.get("/ontology/graph", graphHandler);
enrichmentAliasRouter.get("/ontology/quadrants", queryQuadrants);
enrichmentAliasRouter.get("/ontology/companies", queryCompanies);
enrichmentAliasRouter.get("/ontology/value-chain", queryValueChainStages);
enrichmentAliasRouter.get("/ontology/runs", queryRuns);

enrichmentAliasRouter.get("/capabilities/quadrants", queryQuadrants);
enrichmentAliasRouter.get("/value-chain/stages", queryValueChainStages);
enrichmentAliasRouter.get("/companies", queryCompanies);

export default router;
