import { Router } from "express";
import { db } from "@workspace/db";
import {
  companiesTable,
  companyScoresTable,
  companyCapabilityFingerprintTable,
  capabilitiesTable,
  capabilityEconomicsTable,
  ceiComponentsTable,
  industriesTable,
  organizationsTable,
  organizationCapabilitiesTable,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";

const router = Router();

const REGIONS: Record<string, string[]> = {
  "NA": ["US", "CA", "MX"],
  "EU": ["DE", "FR", "GB", "NL", "SE", "CH", "IT", "ES", "IE", "FI", "NO", "DK", "AT", "BE", "PL"],
  "Asia": ["CN", "JP", "KR", "IN", "SG", "HK", "TW", "ID", "TH", "MY", "PH", "VN"],
  "LATAM": ["BR", "AR", "CO", "CL", "PE"],
  "ANZ": ["AU", "NZ"],
};

// Step 1: Get filterable company list for benchmarking
router.get("/benchmarking/companies", async (req, res) => {
  try {
    const industryId = Number(req.query.industryId) || undefined;
    const region = typeof req.query.region === "string" ? req.query.region : undefined;
    const ownership = typeof req.query.ownership === "string" ? req.query.ownership : undefined;
    const capabilityIds = typeof req.query.capabilityIds === "string"
      ? req.query.capabilityIds.split(",").map(Number).filter(Boolean)
      : [];

    const conditions = [];
    if (industryId) conditions.push(eq(companiesTable.industryId, industryId));
    if (region && REGIONS[region]) {
      conditions.push(sql`${companiesTable.country} IN (${sql.join(REGIONS[region].map(c => sql`${c}`), sql`, `)})`);
    }
    if (ownership) conditions.push(eq(companiesTable.ownership, ownership));

    // Get companies matching filters
    let companies = await db.select({
      company: companiesTable,
      scores: companyScoresTable,
      industryName: industriesTable.name,
    })
      .from(companiesTable)
      .leftJoin(companyScoresTable, eq(companiesTable.id, companyScoresTable.companyId))
      .leftJoin(industriesTable, eq(companiesTable.industryId, industriesTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(sql`${companyScoresTable.composite} desc nulls last`);

    // If capability filter is set, only include companies that have fingerprint entries for those capabilities
    if (capabilityIds.length > 0) {
      const fingerprints = await db.select({
        companyId: companyCapabilityFingerprintTable.companyId,
      })
        .from(companyCapabilityFingerprintTable)
        .where(inArray(companyCapabilityFingerprintTable.capabilityId, capabilityIds));

      const companyIdsWithCaps = new Set(fingerprints.map((f) => f.companyId));
      companies = companies.filter((c) => companyIdsWithCaps.has(c.company.id));
    }

    const result = companies.map((c) => ({
      id: c.company.id,
      name: c.company.name,
      industry: c.industryName,
      industryId: c.company.industryId,
      country: c.company.country,
      hqCity: c.company.hqCity,
      ownership: c.company.ownership,
      employeeCount: c.company.employeeCount,
      revenueUsd: c.company.revenueUsd,
      composite: c.scores?.composite ?? null,
      moatScore: c.scores?.moatScore ?? null,
      aiDisruptability: c.scores?.aiDisruptability ?? null,
      ceiWeighted: c.scores?.ceiWeighted ?? null,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get available filter options
router.get("/benchmarking/filters", async (req, res) => {
  try {
    const industries = await db.select({ id: industriesTable.id, name: industriesTable.name }).from(industriesTable);

    const countries = await db.selectDistinct({ country: companiesTable.country })
      .from(companiesTable)
      .where(sql`${companiesTable.country} IS NOT NULL`);

    const ownerships = await db.selectDistinct({ ownership: companiesTable.ownership })
      .from(companiesTable)
      .where(sql`${companiesTable.ownership} IS NOT NULL`);

    res.json({
      industries,
      regions: Object.keys(REGIONS),
      countries: countries.map((c) => c.country).filter(Boolean),
      ownerships: ownerships.map((o) => o.ownership).filter(Boolean),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Step 2: Run benchmark — compare your org against selected companies on selected capabilities
router.post("/benchmarking/run", async (req, res) => {
  try {
    const { sessionToken, companyIds, capabilityIds } = req.body as {
      sessionToken?: string;
      companyIds: number[];
      capabilityIds?: number[];
    };

    if (!companyIds?.length) { res.status(400).json({ error: "Select at least one company" }); return; }

    // Get your org's scores
    let myScores = new Map<number, number>();
    let myOrgName = "Your Organization";
    if (sessionToken) {
      const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, sessionToken));
      if (org) {
        myOrgName = org.name;
        const caps = await db.select().from(organizationCapabilitiesTable)
          .where(eq(organizationCapabilitiesTable.organizationId, org.id));
        myScores = new Map(caps.map((c) => [c.capabilityId, c.maturityScore]));
      }
    }

    // Get selected companies
    const companies = await db.select({
      company: companiesTable,
      scores: companyScoresTable,
    })
      .from(companiesTable)
      .leftJoin(companyScoresTable, eq(companiesTable.id, companyScoresTable.companyId))
      .where(inArray(companiesTable.id, companyIds));

    // Get capability fingerprints for selected companies
    const fingerprints = await db.select({
      fp: companyCapabilityFingerprintTable,
      capName: capabilitiesTable.name,
      capBenchmark: capabilitiesTable.benchmarkScore,
    })
      .from(companyCapabilityFingerprintTable)
      .leftJoin(capabilitiesTable, eq(companyCapabilityFingerprintTable.capabilityId, capabilitiesTable.id))
      .where(inArray(companyCapabilityFingerprintTable.companyId, companyIds));

    // Get economics data for richer comparison
    const allCapIds = [...new Set(fingerprints.map((f) => f.fp.capabilityId))];
    const relevantCapIds = capabilityIds?.length ? allCapIds.filter((id) => capabilityIds.includes(id)) : allCapIds;

    const economics = relevantCapIds.length
      ? await db.select().from(capabilityEconomicsTable).where(inArray(capabilityEconomicsTable.capabilityId, relevantCapIds))
      : [];
    const econMap = new Map(economics.map((e) => [e.capabilityId, e]));

    const components = relevantCapIds.length
      ? await db.select().from(ceiComponentsTable).where(inArray(ceiComponentsTable.capabilityId, relevantCapIds))
      : [];
    const compMap = new Map(components.map((c) => [c.capabilityId, c]));

    // Build per-capability comparison
    type CapRow = {
      capabilityId: number;
      capabilityName: string;
      benchmark: number | null;
      myScore: number | null;
      companyStrengths: Array<{ companyId: number; companyName: string; weight: number }>;
      avgCompanyWeight: number;
      ceiScore: number | null;
      aiExposure: number | null;
      moatHalfLife: number | null;
    };

    const capRows = new Map<number, CapRow>();

    for (const f of fingerprints) {
      if (capabilityIds?.length && !capabilityIds.includes(f.fp.capabilityId)) continue;

      if (!capRows.has(f.fp.capabilityId)) {
        const econ = econMap.get(f.fp.capabilityId);
        const comp = compMap.get(f.fp.capabilityId);
        capRows.set(f.fp.capabilityId, {
          capabilityId: f.fp.capabilityId,
          capabilityName: f.capName ?? `Capability ${f.fp.capabilityId}`,
          benchmark: f.capBenchmark,
          myScore: myScores.get(f.fp.capabilityId) ?? null,
          companyStrengths: [],
          avgCompanyWeight: 0,
          ceiScore: comp?.consensusScore ?? null,
          aiExposure: econ?.aiExposureScore ?? null,
          moatHalfLife: econ?.halfLifeMonths ?? null,
        });
      }

      const company = companies.find((c) => c.company.id === f.fp.companyId);
      capRows.get(f.fp.capabilityId)!.companyStrengths.push({
        companyId: f.fp.companyId,
        companyName: company?.company.name ?? `Company ${f.fp.companyId}`,
        weight: f.fp.weight,
      });
    }

    // Compute averages
    for (const row of capRows.values()) {
      if (row.companyStrengths.length > 0) {
        row.avgCompanyWeight = row.companyStrengths.reduce((s, c) => s + c.weight, 0) / row.companyStrengths.length;
      }
    }

    // Company summaries
    const companySummaries = companies.map((c) => {
      const companyFps = fingerprints.filter((f) => f.fp.companyId === c.company.id);
      return {
        id: c.company.id,
        name: c.company.name,
        country: c.company.country,
        ownership: c.company.ownership,
        composite: c.scores?.composite ?? null,
        moatScore: c.scores?.moatScore ?? null,
        aiDisruptability: c.scores?.aiDisruptability ?? null,
        capabilityCoverage: c.scores?.capabilityCoverage ?? null,
        capabilityCount: companyFps.length,
        avgWeight: companyFps.length ? companyFps.reduce((s, f) => s + f.fp.weight, 0) / companyFps.length : 0,
      };
    });

    res.json({
      myOrgName,
      companies: companySummaries,
      capabilities: [...capRows.values()].sort((a, b) => (b.avgCompanyWeight - a.avgCompanyWeight)),
      totalCapabilities: capRows.size,
      totalCompanies: companyIds.length,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
