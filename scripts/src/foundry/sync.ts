/**
 * Postgres → Foundry one-shot sync. Reads each CE table, builds a CSV, replaces
 * the corresponding Dataset's contents via a SNAPSHOT transaction. Idempotent
 * — re-runs publish a fresh snapshot.
 *
 * Run: pnpm --filter @workspace/scripts run sync:foundry
 *      (env requires DATABASE_URL, FOUNDRY_BASE_URL, FOUNDRY_TOKEN)
 */

import {
  db,
  industriesTable,
  capabilitiesTable,
  capabilityAlphaTable,
  capabilityQuadrantsTable,
  valueChainStagesTable,
  companyCapabilityProfilesTable,
  capabilityDependenciesTable,
} from "@workspace/db";
import { DATASETS } from "./config";
import { replaceDatasetCsv, toCsv } from "./client";

const log = (...args: unknown[]) => console.error(`[${new Date().toISOString().slice(11,19)}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`);

async function syncOne<T extends Record<string, unknown>>(
  label: string,
  datasetRid: string,
  rows: T[],
  columns: (keyof T & string)[],
): Promise<void> {
  log(`  ${label}: ${rows.length} rows → CSV → upload`);
  if (rows.length === 0) {
    log(`    (skip — no rows)`);
    return;
  }
  const csv = toCsv(rows as Array<Record<string, unknown>>, columns as string[]);
  log(`    csv size: ${(csv.length / 1024).toFixed(1)} KB`);
  const t = Date.now();
  await replaceDatasetCsv(datasetRid, csv, `${label}.csv`);
  log(`    ✓ uploaded in ${Math.round((Date.now()-t)/1000)}s`);
}

async function main() {
  log("Starting Postgres → Foundry sync");

  const industries = await db.select().from(industriesTable);
  await syncOne("ce_industries", DATASETS.industries, industries, [
    "id", "name", "slug", "description", "createdAt",
  ]);

  const capabilities = await db.select().from(capabilitiesTable);
  await syncOne("ce_capabilities", DATASETS.capabilities, capabilities, [
    "id", "industryId", "parentCapabilityId", "name", "slug", "description",
    "traditionalView", "economicView", "benchmarkScore", "reviewStatus",
    "submittedBy", "enrichmentStatus", "enrichmentStage", "enrichmentError",
    "enrichmentUpdatedAt", "createdAt",
  ]);

  const quadrants = await db.select().from(capabilityQuadrantsTable);
  await syncOne("ce_quadrants", DATASETS.quadrants, quadrants, [
    "id", "capabilityId", "industryId", "runId", "quadrant",
    "economicImpactScore", "adoptionMomentumScore", "disruptionIntensity",
    "rationale", "perplexitySources", "generatedAt",
  ]);

  const economics = await db.select().from(capabilityAlphaTable);
  await syncOne("ce_economics", DATASETS.economics, economics, [
    "id", "capabilityId", "industryId", "tamUsdMm", "samUsdMm",
    "marginStructurePct", "halfLifeMonths", "commoditizationVelocity",
    "revenueExposureMm", "consensusQuadrant", "consensusConfidence",
    "consensusSummary", "consensusSources", "rationale",
    "summaryNarrative", "traditionalNarrative", "alphaNarrative",
    "aiNarrative", "aiExposureScore", "aiTimeToDisplacementMonths",
    "aiSubstitutes", "metricInterpretations", "dependencyRationales",
    "roleConsequences", "playbook", "benchmarkInterpretation", "generatedAt",
  ]);

  const valueChain = await db.select().from(valueChainStagesTable);
  await syncOne("ce_value_chain_stages", DATASETS.valueChain, valueChain, [
    "id", "industryId", "stageName", "stageOrder", "numSectors", "hhiScore",
    "patentCount", "patentTrendPct", "startupCount", "startupTrendPct",
    "capitalFlowMm", "capitalTrendPct", "disruptionSummary", "shifts", "risks",
    "keyCapabilities", "keyCompanies", "perplexitySources", "generatedAt",
  ]);

  const companies = await db.select().from(companyCapabilityProfilesTable);
  await syncOne("ce_companies", DATASETS.companies, companies, [
    "id", "name", "country", "naicsCode", "naicsSector", "industryId",
    "feviScore", "cdiScore", "quadrant", "fundingStage", "description",
    "generatedAt",
  ]);

  const dependencies = await db.select().from(capabilityDependenciesTable);
  await syncOne("ce_capability_dependencies", DATASETS.dependencies, dependencies, [
    "id", "capabilityId", "dependsOnId", "strength",
  ]);

  log("Sync complete");
}

main().catch(e => {
  console.error("FAIL:", e);
  process.exit(1);
});
