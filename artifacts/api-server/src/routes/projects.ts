import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  technologyProjectsTable,
  projectCapabilityImpactsTable,
  projectExecutiveInsightsTable,
  projectRisksTable,
  capabilitiesTable,
  industriesTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { ListProjectsQueryParams, GetProjectParams, GetProjectQueryParams } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAdmin";
import { researchProjectsForCategories } from "../services/projects-research";
import { z } from "zod";

const router: IRouter = Router();

const ResearchBody = z.object({
  categories: z.array(z.string().min(2).max(80)).min(1).max(12),
});

router.post("/projects/research", requireAdmin, async (req, res) => {
  const parsed = ResearchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  try {
    const results = await researchProjectsForCategories(parsed.data.categories);
    res.json({
      results,
      totalIngested: results.reduce((n, r) => n + r.projectsIngested, 0),
    });
  } catch (err) {
    console.error("projects research failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});

router.get("/projects", async (req, res) => {
  const parsed = ListProjectsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { category } = parsed.data;

  const projects = await db
    .select({
      id: technologyProjectsTable.id,
      slug: technologyProjectsTable.slug,
      name: technologyProjectsTable.name,
      category: technologyProjectsTable.category,
      description: technologyProjectsTable.description,
      businessCase: technologyProjectsTable.businessCase,
      typicalTimeline: technologyProjectsTable.typicalTimeline,
      investmentRange: technologyProjectsTable.investmentRange,
      complexityLevel: technologyProjectsTable.complexityLevel,
      icon: technologyProjectsTable.icon,
      impactedCapabilityCount: sql<number>`cast(count(${projectCapabilityImpactsTable.id}) as int)`,
    })
    .from(technologyProjectsTable)
    .leftJoin(projectCapabilityImpactsTable, eq(projectCapabilityImpactsTable.projectId, technologyProjectsTable.id))
    .groupBy(technologyProjectsTable.id)
    .orderBy(technologyProjectsTable.category, technologyProjectsTable.name);

  const filtered = category
    ? projects.filter(p => p.category === category)
    : projects;

  res.json(filtered);
});

router.get("/projects/:projectId", async (req, res) => {
  const paramsParsed = GetProjectParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid project ID" });
    return;
  }

  const queryParsed = GetProjectQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { projectId } = paramsParsed.data;
  const { industryId } = queryParsed.data;

  const [project] = await db
    .select()
    .from(technologyProjectsTable)
    .where(eq(technologyProjectsTable.id, projectId));

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const impacts = await db
    .select({
      id: projectCapabilityImpactsTable.id,
      capabilityId: projectCapabilityImpactsTable.capabilityId,
      capabilityName: capabilitiesTable.name,
      capabilitySlug: capabilitiesTable.slug,
      industryName: industriesTable.name,
      currentBenchmark: capabilitiesTable.benchmarkScore,
      maturityUplift: projectCapabilityImpactsTable.maturityUplift,
      timeToImpactMonths: projectCapabilityImpactsTable.timeToImpactMonths,
      impactDescription: projectCapabilityImpactsTable.impactDescription,
    })
    .from(projectCapabilityImpactsTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, projectCapabilityImpactsTable.capabilityId))
    .innerJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId))
    .where(eq(projectCapabilityImpactsTable.projectId, projectId));

  let filteredImpacts = impacts;
  if (industryId !== undefined) {
    const industryCaps = await db
      .select({ id: capabilitiesTable.id })
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.industryId, industryId));
    const capIds = new Set(industryCaps.map(c => c.id));
    filteredImpacts = impacts.filter(i => capIds.has(i.capabilityId));
  }

  const finalImpacts = filteredImpacts.map(i => ({
    ...i,
    projectedScore: Math.min(100, i.currentBenchmark + i.maturityUplift),
  }));

  const insights = await db
    .select()
    .from(projectExecutiveInsightsTable)
    .where(eq(projectExecutiveInsightsTable.projectId, projectId));

  const risks = await db
    .select()
    .from(projectRisksTable)
    .where(eq(projectRisksTable.projectId, projectId));

  const impactCount = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(projectCapabilityImpactsTable)
    .where(eq(projectCapabilityImpactsTable.projectId, projectId));

  res.json({
    project: {
      ...project,
      impactedCapabilityCount: impactCount[0].count,
    },
    capabilityImpacts: finalImpacts,
    executiveInsights: insights.map(i => ({
      id: i.id,
      role: i.role,
      agendaTitle: i.agendaTitle,
      agendaDescription: i.agendaDescription,
      keyMetrics: i.keyMetrics,
      decisionFramework: i.decisionFramework,
    })),
    risks: risks.map(r => ({
      id: r.id,
      riskCategory: r.riskCategory,
      severity: r.severity,
      description: r.description,
      consequence: r.consequence,
      mitigationPath: r.mitigationPath,
    })),
  });
});

export default router;
