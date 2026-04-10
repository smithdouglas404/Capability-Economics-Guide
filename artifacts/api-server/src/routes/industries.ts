import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { industriesTable, capabilitiesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/industries/compare", async (_req, res) => {
  const rows = await db
    .select({
      id: industriesTable.id,
      name: industriesTable.name,
      slug: industriesTable.slug,
      avgBenchmark: sql<number>`cast(round(avg(${capabilitiesTable.benchmarkScore})::numeric, 1) as float)`,
      capabilityCount: sql<number>`cast(count(${capabilitiesTable.id}) as int)`,
    })
    .from(industriesTable)
    .leftJoin(capabilitiesTable, eq(capabilitiesTable.industryId, industriesTable.id))
    .groupBy(industriesTable.id)
    .orderBy(desc(sql`avg(${capabilitiesTable.benchmarkScore})`));

  const result = [];
  for (const row of rows) {
    const [topCap] = await db
      .select({ name: capabilitiesTable.name })
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.industryId, row.id))
      .orderBy(desc(capabilitiesTable.benchmarkScore))
      .limit(1);

    result.push({
      ...row,
      topCapability: topCap?.name || "N/A",
    });
  }

  const allCaps = await db
    .select({
      id: capabilitiesTable.id,
      name: capabilitiesTable.name,
      slug: capabilitiesTable.slug,
      benchmarkScore: capabilitiesTable.benchmarkScore,
      industryId: capabilitiesTable.industryId,
      industryName: industriesTable.name,
    })
    .from(capabilitiesTable)
    .innerJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId));

  const themeKeywords: Record<string, string[]> = {
    "Data & Analytics": ["data", "analytics", "data-analytics", "customer-analytics", "product-analytics", "customer-data"],
    "Supply Chain": ["supply-chain", "inventory"],
    "Fraud & Risk Management": ["fraud", "risk-management", "aml"],
    "Customer Experience": ["customer-retention", "customer-loyalty", "customer-success", "patient-experience", "omnichannel"],
    "Digital Transformation": ["digital", "ecommerce", "platform-engineering", "smart-factory", "telehealth"],
    "Regulatory & Compliance": ["regulatory", "compliance", "quality-safety", "quality-management"],
    "Workforce & Talent": ["workforce", "agent-enablement", "developer-experience", "clinical-workforce"],
  };

  const sharedCapabilities: Array<{ name: string; industries: Array<{ industryId: number; industryName: string; capabilityId: number; benchmarkScore: number }> }> = [];

  for (const [theme, keywords] of Object.entries(themeKeywords)) {
    const matched = allCaps.filter(c => keywords.some(kw => c.slug.includes(kw)));
    const uniqueIndustries = new Set(matched.map(c => c.industryId));
    if (uniqueIndustries.size >= 2) {
      sharedCapabilities.push({
        name: theme,
        industries: matched.map(c => ({
          industryId: c.industryId,
          industryName: c.industryName,
          capabilityId: c.id,
          benchmarkScore: c.benchmarkScore,
        })),
      });
    }
  }

  sharedCapabilities.sort((a, b) => b.industries.length - a.industries.length);

  res.json({ industries: result, sharedCapabilities });
});

router.get("/industries", async (_req, res) => {
  const industries = await db
    .select({
      id: industriesTable.id,
      slug: industriesTable.slug,
      name: industriesTable.name,
      description: industriesTable.description,
      icon: industriesTable.icon,
      capabilityCount: sql<number>`cast(count(${capabilitiesTable.id}) as int)`,
    })
    .from(industriesTable)
    .leftJoin(capabilitiesTable, eq(capabilitiesTable.industryId, industriesTable.id))
    .groupBy(industriesTable.id)
    .orderBy(industriesTable.name);

  res.json(industries);
});

router.get("/industries/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid industry ID" });
    return;
  }

  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, id));
  if (!industry) {
    res.status(404).json({ error: "Industry not found" });
    return;
  }

  const capabilities = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, id));

  res.json({ ...industry, capabilities });
});

export default router;
