import { db } from "@workspace/db";
import {
  companiesTable,
  companyScoresTable,
  industriesTable,
} from "@workspace/db";
import { and, eq, gte, lte, desc, type SQL } from "drizzle-orm";

export type ScreenerFilters = {
  industryId?: number;
  scoreMin?: number;
  scoreMax?: number;
  moatMin?: number;
  moatMax?: number;
  aiDisruptabilityMax?: number;
  coverageMin?: number;
  ownership?: string;
  country?: string;
  limit?: number;
};

export type ScreenerRow = {
  companyId: number;
  name: string;
  industryId: number;
  industryName: string | null;
  country: string | null;
  ownership: string | null;
  composite: number;
  moatScore: number;
  aiDisruptability: number;
  capabilityCoverage: number;
  ceiWeighted: number;
  acquisitionProbability: number;
};

/**
 * Multi-parameter company screener. Joins companies + company_scores with
 * optional filters. Sorted by composite descending; limit defaults to 200.
 */
export async function runScreener(f: ScreenerFilters): Promise<ScreenerRow[]> {
  const conds: (SQL | undefined)[] = [];
  if (f.industryId !== undefined) conds.push(eq(companiesTable.industryId, f.industryId));
  if (f.ownership !== undefined) conds.push(eq(companiesTable.ownership, f.ownership));
  if (f.country !== undefined) conds.push(eq(companiesTable.country, f.country));
  if (f.scoreMin !== undefined) conds.push(gte(companyScoresTable.composite, f.scoreMin));
  if (f.scoreMax !== undefined) conds.push(lte(companyScoresTable.composite, f.scoreMax));
  if (f.moatMin !== undefined) conds.push(gte(companyScoresTable.moatScore, f.moatMin));
  if (f.moatMax !== undefined) conds.push(lte(companyScoresTable.moatScore, f.moatMax));
  if (f.aiDisruptabilityMax !== undefined) conds.push(lte(companyScoresTable.aiDisruptability, f.aiDisruptabilityMax));
  if (f.coverageMin !== undefined) conds.push(gte(companyScoresTable.capabilityCoverage, f.coverageMin));

  const rows = await db
    .select({
      companyId: companiesTable.id,
      name: companiesTable.name,
      industryId: companiesTable.industryId,
      industryName: industriesTable.name,
      country: companiesTable.country,
      ownership: companiesTable.ownership,
      composite: companyScoresTable.composite,
      moatScore: companyScoresTable.moatScore,
      aiDisruptability: companyScoresTable.aiDisruptability,
      capabilityCoverage: companyScoresTable.capabilityCoverage,
      ceiWeighted: companyScoresTable.ceiWeighted,
      acquisitionProbability: companyScoresTable.acquisitionProbability,
    })
    .from(companiesTable)
    .innerJoin(companyScoresTable, eq(companyScoresTable.companyId, companiesTable.id))
    .leftJoin(industriesTable, eq(industriesTable.id, companiesTable.industryId))
    .where(conds.filter(Boolean).length ? and(...conds.filter((c): c is SQL => !!c)) : undefined)
    .orderBy(desc(companyScoresTable.composite))
    .limit(f.limit ?? 200);

  return rows;
}
