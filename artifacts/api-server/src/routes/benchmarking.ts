import { Router } from "express";
import { db } from "@workspace/db";
import { deductCredits } from "../middlewares/deductCredits";
import {
  companiesTable,
  companyScoresTable,
  companyCapabilityFingerprintTable,
  capabilitiesTable,
  capabilityAlphaTable,
  cviComponentsTable,
  industriesTable,
  organizationsTable,
  organizationCapabilitiesTable,
  benchmarkSessionsTable,
} from "@workspace/db";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import { ingestCompaniesForIndustry, computeCompanyScores } from "../services/companies";
import { logLlmCall } from "../services/llm-usage";
import { forSession, forSessionRow } from "../lib/tenant-scope";

const router = Router();

const REGIONS: Record<string, string[]> = {
  "NA": ["US", "CA", "MX"],
  "EU": ["DE", "FR", "GB", "NL", "SE", "CH", "IT", "ES", "IE", "FI", "NO", "DK", "AT", "BE", "PL"],
  "Asia": ["CN", "JP", "KR", "IN", "SG", "HK", "TW", "ID", "TH", "MY", "PH", "VN"],
  "LATAM": ["BR", "AR", "CO", "CL", "PE"],
  "ANZ": ["AU", "NZ"],
};

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

// Step 1: Search for companies matching filters — pulls from DB first, discovers via Perplexity if needed
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

    // If capability filter set, only companies with fingerprints for those capabilities
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
      cviWeighted: c.scores?.cviWeighted ?? null,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Discover new companies via Perplexity when existing pool is insufficient
router.post("/benchmarking/discover", deductCredits(4), async (req, res) => {
  try {
    const { industryId, region, capabilityIds, capabilityNames } = req.body as {
      industryId: number;
      region?: string;
      capabilityIds?: number[];
      capabilityNames?: string[];
    };

    if (!industryId) { res.status(400).json({ error: "industryId required" }); return; }

    const apiKey = process.env.PERPLEXITY_API_KEY;
    if (!apiKey) { res.status(503).json({ error: "PERPLEXITY_API_KEY not configured — cannot discover companies" }); return; }

    // Get industry and capability info
    const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId));
    if (!industry) { res.status(404).json({ error: "Industry not found" }); return; }

    const caps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId));
    const capByLower = new Map(caps.map(c => [c.name.toLowerCase(), c]));

    // Build targeted capability list
    let targetCapNames: string[];
    if (capabilityNames?.length) {
      targetCapNames = capabilityNames;
    } else if (capabilityIds?.length) {
      targetCapNames = caps.filter(c => capabilityIds.includes(c.id)).map(c => c.name);
    } else {
      targetCapNames = caps.slice(0, 10).map(c => c.name);
    }

    const regionClause = region && REGIONS[region]
      ? `Focus on companies headquartered in: ${REGIONS[region].join(", ")}.`
      : "Include companies globally.";

    const capMenu = caps.map(c => `- ${c.name}`).join("\n");

    const sysPrompt = "You are a deal-sourcing analyst. Return ONLY a JSON array — no prose, no code fences. Cite real firms with verifiable web footprint.";
    const userPrompt = `Find 15 companies in the ${industry.name} industry that are strong in these specific capabilities:
${targetCapNames.map(c => `- ${c}`).join("\n")}

${regionClause}

For each company return:
{
  "name": "<legal company name>",
  "description": "<one sentence>",
  "country": "<ISO 2-letter>",
  "hq_city": "<city>",
  "founded_year": <year or null>,
  "employee_count": <integer or null>,
  "revenue_usd": <annual revenue in USD or null>,
  "funding_usd": <total funding in USD or null>,
  "public_ticker": "<ticker or null>",
  "ownership": "public|private|pe-backed|vc-backed",
  "website_url": "<https URL>",
  "capabilities": [{"name":"<EXACT name from menu>","weight":<0..1>,"evidence":"<1-line why>"}]
}

Capability menu (use EXACT names):
${capMenu}

Tag 2-6 capabilities per company. Skip companies you can't tag. Return a JSON array.`;

    const startedAt = Date.now();
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      logLlmCall({ provider: "perplexity", model: "sonar", endpoint: "benchmarking", startedAt, httpStatus: resp.status, errorMessage: `HTTP ${resp.status}` });
      res.status(502).json({ error: `Perplexity returned ${resp.status}` }); return;
    }

    const data = await resp.json() as { choices: Array<{ message: { content: string } }>; citations?: string[] };
    logLlmCall({ provider: "perplexity", model: "sonar", endpoint: "benchmarking", startedAt, httpStatus: resp.status, responseJson: data });
    const content = data.choices[0]?.message?.content ?? "";
    const citations = data.citations ?? [];
    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end === -1) { res.status(500).json({ error: "No parseable response from Perplexity" }); return; }

    let parsed: any[];
    try {
      parsed = JSON.parse(cleaned.substring(start, end + 1));
    } catch (e) {
      res.status(500).json({ error: `JSON parse failed: ${e instanceof Error ? e.message : String(e)}` }); return;
    }

    // Ingest discovered companies
    let inserted = 0;
    let updated = 0;
    const discoveredIds: number[] = [];

    for (const co of parsed) {
      if (!co?.name || !Array.isArray(co.capabilities) || !co.capabilities.length) continue;

      const slug = co.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 80);
      const fpRows = co.capabilities
        .map((fp: any) => ({ cap: capByLower.get((fp.name || "").toLowerCase()), weight: typeof fp.weight === "number" ? Math.max(0, Math.min(1, fp.weight)) : 0.3, evidence: fp.evidence }))
        .filter((r: any) => r.cap);
      if (!fpRows.length) continue;

      try {
        const existing = await db.select().from(companiesTable)
          .where(and(eq(companiesTable.industryId, industryId), eq(companiesTable.slug, slug))).limit(1);

        let companyId: number;
        if (existing.length) {
          companyId = existing[0].id;
          await db.update(companiesTable).set({
            description: co.description ?? existing[0].description,
            country: co.country ?? existing[0].country,
            hqCity: co.hq_city ?? existing[0].hqCity,
            foundedYear: typeof co.founded_year === "number" ? co.founded_year : existing[0].foundedYear,
            employeeCount: typeof co.employee_count === "number" ? co.employee_count : existing[0].employeeCount,
            revenueUsd: typeof co.revenue_usd === "number" ? co.revenue_usd : existing[0].revenueUsd,
            fundingUsd: typeof co.funding_usd === "number" ? co.funding_usd : existing[0].fundingUsd,
            publicTicker: co.public_ticker ?? existing[0].publicTicker,
            ownership: co.ownership ?? existing[0].ownership,
            websiteUrl: co.website_url ?? existing[0].websiteUrl,
            sourceUrls: citations.slice(0, 10),
            citationsCount: citations.length,
            updatedAt: new Date(),
          }).where(eq(companiesTable.id, companyId));
          updated++;
        } else {
          const [row] = await db.insert(companiesTable).values({
            industryId,
            slug,
            name: co.name,
            description: co.description ?? "",
            country: co.country ?? null,
            hqCity: co.hq_city ?? null,
            foundedYear: typeof co.founded_year === "number" ? co.founded_year : null,
            employeeCount: typeof co.employee_count === "number" ? co.employee_count : null,
            revenueUsd: typeof co.revenue_usd === "number" ? co.revenue_usd : null,
            fundingUsd: typeof co.funding_usd === "number" ? co.funding_usd : null,
            publicTicker: co.public_ticker ?? null,
            ownership: co.ownership ?? null,
            websiteUrl: co.website_url ?? null,
            source: "perplexity",
            sourceUrls: citations.slice(0, 10),
            citationsCount: citations.length,
          }).returning({ id: companiesTable.id });
          companyId = row.id;
          inserted++;
        }

        discoveredIds.push(companyId);

        // Upsert fingerprints
        await db.delete(companyCapabilityFingerprintTable).where(eq(companyCapabilityFingerprintTable.companyId, companyId));
        for (const fp of fpRows) {
          await db.insert(companyCapabilityFingerprintTable).values({
            companyId,
            capabilityId: fp.cap!.id,
            weight: fp.weight,
            evidenceUrl: null,
            evidenceNote: fp.evidence ?? null,
          }).onConflictDoNothing();
        }

        // Compute scores
        await computeCompanyScores(companyId);
      } catch (e) {
        // skip individual company errors
      }
    }

    // Return the newly discovered companies
    const newCompanies = discoveredIds.length
      ? await db.select({
          company: companiesTable,
          scores: companyScoresTable,
          industryName: industriesTable.name,
        })
        .from(companiesTable)
        .leftJoin(companyScoresTable, eq(companiesTable.id, companyScoresTable.companyId))
        .leftJoin(industriesTable, eq(companiesTable.industryId, industriesTable.id))
        .where(inArray(companiesTable.id, discoveredIds))
        .orderBy(sql`${companyScoresTable.composite} desc nulls last`)
      : [];

    res.json({
      discovered: discoveredIds.length,
      inserted,
      updated,
      companies: newCompanies.map((c) => ({
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
        cviWeighted: c.scores?.cviWeighted ?? null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Run benchmark and save the session
router.post("/benchmarking/run", async (req, res) => {
  try {
    const { sessionToken, companyIds, capabilityIds, name, industryId, region, ownership } = req.body as {
      sessionToken?: string;
      companyIds: number[];
      capabilityIds?: number[];
      name?: string;
      industryId?: number;
      region?: string;
      ownership?: string;
    };

    if (!companyIds?.length) { res.status(400).json({ error: "Select at least one company" }); return; }

    // Get your org's scores
    let myScores = new Map<number, number>();
    let myOrgName: string | null = null;
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

    // Get economics for richer comparison
    const allCapIds = [...new Set(fingerprints.map((f) => f.fp.capabilityId))];
    const relevantCapIds = capabilityIds?.length ? allCapIds.filter((id) => capabilityIds.includes(id)) : allCapIds;

    const economics = relevantCapIds.length
      ? await db.select().from(capabilityAlphaTable).where(inArray(capabilityAlphaTable.capabilityId, relevantCapIds))
      : [];
    const econMap = new Map(economics.map((e) => [e.capabilityId, e]));

    const components = relevantCapIds.length
      ? await db.select().from(cviComponentsTable).where(inArray(cviComponentsTable.capabilityId, relevantCapIds))
      : [];
    const compMap = new Map(components.map((c) => [c.capabilityId, c]));

    // Build per-capability comparison
    type CapRow = {
      capabilityId: number;
      capabilityName: string;
      benchmark: number | null;
      myScore: number | null;
      companyStrengths: Array<{ companyId: number; companyName: string; weight: number; evidence: string | null }>;
      avgCompanyWeight: number;
      cviScore: number | null;
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
          cviScore: comp?.consensusScore ?? null,
          aiExposure: econ?.aiExposureScore ?? null,
          moatHalfLife: econ?.halfLifeMonths ?? null,
        });
      }

      const company = companies.find((c) => c.company.id === f.fp.companyId);
      capRows.get(f.fp.capabilityId)!.companyStrengths.push({
        companyId: f.fp.companyId,
        companyName: company?.company.name ?? `Company ${f.fp.companyId}`,
        weight: f.fp.weight,
        evidence: f.fp.evidenceNote,
      });
    }

    for (const row of capRows.values()) {
      if (row.companyStrengths.length > 0) {
        row.avgCompanyWeight = row.companyStrengths.reduce((s, c) => s + c.weight, 0) / row.companyStrengths.length;
      }
    }

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

    // Save session for future review
    const [session] = await db.insert(benchmarkSessionsTable).values({
      sessionToken: sessionToken || null,
      name: name || `Benchmark — ${companies.map(c => c.company.name).slice(0, 3).join(", ")}${companies.length > 3 ? ` +${companies.length - 3}` : ""}`,
      industryId: industryId ?? null,
      region: region ?? null,
      ownership: ownership ?? null,
      selectedCapabilityIds: capabilityIds ?? [],
      selectedCompanyIds: companyIds,
    }).returning();

    res.json({
      sessionId: session.id,
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

// List past benchmark sessions for review — must be scoped to caller's session.
// Pre-fix returned every tenant's last 50 sessions.
router.get("/benchmarking/sessions", async (req, res) => {
  try {
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
    if (!token) { res.json([]); return; }
    const rows = await db.select().from(benchmarkSessionsTable)
      .where(forSession("benchmark_sessions", token))
      .orderBy(desc(benchmarkSessionsTable.createdAt))
      .limit(50);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get a specific past session — must belong to the caller's session token.
// Pre-fix accepted any id and returned any tenant's row.
router.get("/benchmarking/sessions/:id", async (req, res) => {
  try {
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
    if (!token) { res.status(401).json({ error: "sessionToken required" }); return; }
    const [session] = await db.select().from(benchmarkSessionsTable)
      .where(forSessionRow("benchmark_sessions", token, Number(req.params.id)));
    if (!session) { res.status(404).json({ error: "Not found" }); return; }
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
