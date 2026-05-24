/**
 * In-process World Bank GDP weights refresh — same logic as
 * scripts/src/seed-gdp-weights-from-worldbank.ts but importable into
 * Inngest functions so we can re-run on a schedule, not only at deploy.
 *
 * Why duplicate the logic instead of importing the script?
 *   - The scripts/ package isn't a runtime dep of api-server.
 *   - The script process.exits at the end (fine for one-shot, bad inside
 *     a long-running Inngest handler).
 *   - We want to return a structured result for telemetry, not console.log.
 *
 * Keep ALLOCATIONS in sync with the deploy-time seed script — they're the
 * authoritative within-sector multipliers.
 */

import { db, industriesTable, industryGdpWeightsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const WB_API_BASE = "https://api.worldbank.org/v2";
const AUTO_REFRESH_DRIFT_THRESHOLD = 0.10; // 10% relative

interface WorldBankObservation {
  date: string;
  value: number | null;
}

async function fetchWorldBankIndicator(
  indicatorCode: string,
): Promise<{ year: number; value: number; url: string }> {
  const url = `${WB_API_BASE}/country/WLD/indicator/${indicatorCode}?format=json&date=2018:2025&per_page=20`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`World Bank API ${indicatorCode}: HTTP ${resp.status}`);
  const data = (await resp.json()) as [unknown, WorldBankObservation[] | null];
  const observations = data[1] ?? [];
  for (const obs of observations) {
    if (typeof obs.value === "number" && Number.isFinite(obs.value)) {
      return {
        year: parseInt(obs.date, 10),
        value: obs.value,
        url: `${WB_API_BASE}/en/indicator/${indicatorCode}`,
      };
    }
  }
  throw new Error(`World Bank ${indicatorCode}: no non-null value in 2018-2025`);
}

interface Allocation {
  sector: "manufacturing" | "services" | "industry";
  shareWithinSector: number;
  rationale: string;
  citations: string[];
}

// MUST stay in sync with scripts/src/seed-gdp-weights-from-worldbank.ts
const ALLOCATIONS: Record<string, Allocation> = {
  manufacturing: {
    sector: "manufacturing",
    shareWithinSector: 1.0,
    rationale: "Direct map: World Bank Manufacturing VA / World GDP.",
    citations: ["https://data.worldbank.org/indicator/NV.IND.MANF.ZS"],
  },
  banking: {
    sector: "services",
    shareWithinSector: 0.085,
    rationale: "Banking subset of Finance & Insurance per BEA NIPA Table 6.1D.",
    citations: ["https://data.worldbank.org/indicator/NV.SRV.TOTL.ZS", "https://www.bea.gov/data/gdp/gdp-industry"],
  },
  insurance: {
    sector: "services",
    shareWithinSector: 0.045,
    rationale: "Insurance carriers per BEA NIPA Table 6.1D.",
    citations: ["https://data.worldbank.org/indicator/NV.SRV.TOTL.ZS", "https://www.bea.gov/data/gdp/gdp-industry"],
  },
  healthcare: {
    sector: "services",
    shareWithinSector: 0.11,
    rationale: "Health care + social assistance per BEA NIPA Table 6.1D.",
    citations: ["https://data.worldbank.org/indicator/NV.SRV.TOTL.ZS", "https://www.bea.gov/data/gdp/gdp-industry"],
  },
  retail: {
    sector: "services",
    shareWithinSector: 0.10,
    rationale: "Retail trade per BEA NIPA Table 6.1D.",
    citations: ["https://data.worldbank.org/indicator/NV.SRV.TOTL.ZS", "https://www.bea.gov/data/gdp/gdp-industry"],
  },
  technology: {
    sector: "services",
    shareWithinSector: 0.10,
    rationale: "Information industry + tech subset of Professional/Scientific/Technical Services per BEA NIPA Table 6.1D.",
    citations: ["https://data.worldbank.org/indicator/NV.SRV.TOTL.ZS", "https://www.bea.gov/data/gdp/gdp-industry"],
  },
  hospitality: {
    sector: "services",
    shareWithinSector: 0.0125,
    rationale: "Hotels, short-term rentals, lodging-side of accommodation per BEA NIPA Table 6.1D + WTTC global lodging share.",
    citations: ["https://data.worldbank.org/indicator/NV.SRV.TOTL.ZS", "https://www.bea.gov/data/gdp/gdp-industry", "https://wttc.org/research/economic-impact"],
  },
  transportation: {
    sector: "services",
    shareWithinSector: 0.0375,
    rationale: "Transportation & warehousing per BEA NIPA Table 6.1D + OECD ITF.",
    citations: ["https://data.worldbank.org/indicator/NV.SRV.TOTL.ZS", "https://www.bea.gov/data/gdp/gdp-industry", "https://stats.oecd.org/Index.aspx?DataSetCode=ITF_GOODS_TRANSPORT"],
  },
};

export interface GdpWeightsRefreshResult {
  inserted: number;
  updatedDrift: number;
  skippedFresh: number;
  skippedNoRule: number;
  failed: number;
  details: Array<{ slug: string; action: "insert" | "update-drift" | "skip-fresh" | "skip-no-rule" | "fail"; oldPct?: number; newPct?: number; driftRel?: number; reason?: string }>;
}

export async function runGdpWeightsRefresh(opts: { force?: boolean } = {}): Promise<GdpWeightsRefreshResult> {
  const force = opts.force ?? false;
  const result: GdpWeightsRefreshResult = { inserted: 0, updatedDrift: 0, skippedFresh: 0, skippedNoRule: 0, failed: 0, details: [] };

  const [mfg, services, industryAgg] = await Promise.all([
    fetchWorldBankIndicator("NV.IND.MANF.ZS"),
    fetchWorldBankIndicator("NV.SRV.TOTL.ZS"),
    fetchWorldBankIndicator("NV.IND.TOTL.ZS"),
  ]);

  const sectorPct: Record<string, { pct: number; year: number; url: string }> = {
    manufacturing: { pct: mfg.value / 100, year: mfg.year, url: mfg.url },
    services: { pct: services.value / 100, year: services.year, url: services.url },
    industry: { pct: industryAgg.value / 100, year: industryAgg.year, url: industryAgg.url },
  };

  const industries = await db.select().from(industriesTable);
  for (const ind of industries) {
    const allocation = ALLOCATIONS[ind.slug];
    if (!allocation) {
      result.skippedNoRule++;
      result.details.push({ slug: ind.slug, action: "skip-no-rule" });
      continue;
    }
    const sector = sectorPct[allocation.sector];
    const gdpShare = sector.pct * allocation.shareWithinSector;
    if (!Number.isFinite(gdpShare) || gdpShare <= 0 || gdpShare > 1) {
      result.failed++;
      result.details.push({ slug: ind.slug, action: "fail", reason: `invalid gdp_share=${gdpShare}` });
      continue;
    }

    const [existing] = await db.select().from(industryGdpWeightsTable).where(eq(industryGdpWeightsTable.industryId, ind.id));
    const driftRel = existing ? Math.abs(existing.gdpShare - gdpShare) / Math.max(existing.gdpShare, gdpShare) : 0;
    const driftedSignificantly = !!existing && driftRel > AUTO_REFRESH_DRIFT_THRESHOLD;

    if (existing && !force && !driftedSignificantly) {
      result.skippedFresh++;
      result.details.push({ slug: ind.slug, action: "skip-fresh", oldPct: existing.gdpShare });
      continue;
    }

    const rationale = `${(sector.pct * 100).toFixed(2)}% (World Bank ${allocation.sector} VA, ${sector.year}) × ${(allocation.shareWithinSector * 100).toFixed(1)}% within-sector = ${(gdpShare * 100).toFixed(3)}%. ${allocation.rationale}`;

    if (existing) {
      await db.update(industryGdpWeightsTable).set({
        gdpShare,
        sourceUrl: sector.url,
        sourceYear: sector.year,
        sourceCitations: allocation.citations,
        rationale,
        updatedAt: new Date(),
      }).where(eq(industryGdpWeightsTable.id, existing.id));
      result.updatedDrift++;
      result.details.push({ slug: ind.slug, action: "update-drift", oldPct: existing.gdpShare, newPct: gdpShare, driftRel });
    } else {
      await db.insert(industryGdpWeightsTable).values({
        industryId: ind.id,
        gdpShare,
        sourceUrl: sector.url,
        sourceYear: sector.year,
        sourceCitations: allocation.citations,
        rationale,
      });
      result.inserted++;
      result.details.push({ slug: ind.slug, action: "insert", newPct: gdpShare });
    }
  }

  logger.info(
    { inserted: result.inserted, updatedDrift: result.updatedDrift, skippedFresh: result.skippedFresh, failed: result.failed },
    "[gdp-weights-refresh] complete",
  );
  return result;
}
