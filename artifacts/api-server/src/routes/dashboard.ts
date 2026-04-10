import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  organizationsTable,
  organizationCapabilitiesTable,
  capabilitiesTable,
  industriesTable,
  capabilityRoleMappingsTable,
  cSuiteRolesTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { GetDashboardParams, GetDashboardQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/organizations/:sessionToken/dashboard", async (req, res) => {
  const paramsParsed = GetDashboardParams.safeParse(req.params);
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid session token" });
    return;
  }

  const queryParsed = GetDashboardQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: "Invalid query parameters: roleSlug must be a string" });
    return;
  }

  const { sessionToken } = paramsParsed.data;
  const { roleSlug } = queryParsed.data;

  const [org] = await db
    .select({
      id: organizationsTable.id,
      name: organizationsTable.name,
      industryId: organizationsTable.industryId,
      industryName: industriesTable.name,
      size: organizationsTable.size,
      sessionToken: organizationsTable.sessionToken,
      createdAt: organizationsTable.createdAt,
    })
    .from(organizationsTable)
    .innerJoin(industriesTable, eq(industriesTable.id, organizationsTable.industryId))
    .where(eq(organizationsTable.sessionToken, sessionToken));

  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  let capQuery = db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, org.industryId));

  let filteredCapIds: number[] | null = null;
  if (roleSlug) {
    const [role] = await db.select().from(cSuiteRolesTable).where(eq(cSuiteRolesTable.slug, roleSlug));
    if (!role) {
      res.status(400).json({ error: `Unknown role: ${roleSlug}` });
      return;
    }
    const mappings = await db
      .select({ capabilityId: capabilityRoleMappingsTable.capabilityId })
      .from(capabilityRoleMappingsTable)
      .where(eq(capabilityRoleMappingsTable.roleId, role.id));
    filteredCapIds = mappings.map(m => m.capabilityId);
  }

  const allCaps = await capQuery;
  const relevantCaps = filteredCapIds
    ? allCaps.filter(c => filteredCapIds!.includes(c.id))
    : allCaps;

  const assessments = await db
    .select({
      id: organizationCapabilitiesTable.id,
      organizationId: organizationCapabilitiesTable.organizationId,
      capabilityId: organizationCapabilitiesTable.capabilityId,
      capabilityName: capabilitiesTable.name,
      capabilitySlug: capabilitiesTable.slug,
      maturityScore: organizationCapabilitiesTable.maturityScore,
      investmentLevel: organizationCapabilitiesTable.investmentLevel,
      strategicImportance: organizationCapabilitiesTable.strategicImportance,
      notes: organizationCapabilitiesTable.notes,
      benchmarkScore: capabilitiesTable.benchmarkScore,
      assessedAt: organizationCapabilitiesTable.assessedAt,
    })
    .from(organizationCapabilitiesTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, organizationCapabilitiesTable.capabilityId))
    .where(eq(organizationCapabilitiesTable.organizationId, org.id));

  const relevantAssessments = filteredCapIds
    ? assessments.filter(a => filteredCapIds!.includes(a.capabilityId))
    : assessments;

  const avgMaturity = relevantAssessments.length > 0
    ? relevantAssessments.reduce((sum, a) => sum + a.maturityScore, 0) / relevantAssessments.length
    : 0;

  const avgBenchmark = relevantCaps.length > 0
    ? relevantCaps.reduce((sum, c) => sum + c.benchmarkScore, 0) / relevantCaps.length
    : 0;

  const gapData = relevantAssessments.map(a => {
    const cap = relevantCaps.find(c => c.id === a.capabilityId);
    return {
      capabilityName: a.capabilityName,
      maturityScore: a.maturityScore,
      benchmarkScore: cap?.benchmarkScore || 0,
      gap: (cap?.benchmarkScore || 0) - a.maturityScore,
    };
  });

  const topGaps = [...gapData].sort((a, b) => b.gap - a.gap).slice(0, 5);
  const topStrengths = [...gapData].sort((a, b) => a.gap - b.gap).slice(0, 5);

  const radarData = relevantCaps.map(c => {
    const assessment = relevantAssessments.find(a => a.capabilityId === c.id);
    return {
      capability: c.name,
      maturity: assessment?.maturityScore || 0,
      benchmark: c.benchmarkScore,
    };
  });

  const [countResult] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(organizationCapabilitiesTable)
    .where(eq(organizationCapabilitiesTable.organizationId, org.id));

  res.json({
    organization: {
      ...org,
      assessmentCount: countResult.count,
      createdAt: org.createdAt.toISOString(),
    },
    summary: {
      totalCapabilities: relevantCaps.length,
      assessedCapabilities: relevantAssessments.length,
      averageMaturity: Math.round(avgMaturity * 10) / 10,
      averageBenchmark: Math.round(avgBenchmark * 10) / 10,
      topGaps,
      topStrengths,
    },
    radarData,
    assessments: relevantAssessments.map(a => ({ ...a, assessedAt: a.assessedAt.toISOString() })),
  });
});

export default router;
