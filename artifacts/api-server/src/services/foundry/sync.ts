/**
 * Postgres → Foundry sync, callable in-process from api-server.
 *
 * Two callers in the runtime:
 *   1. End of every successful runEnrichmentGraph — keeps Foundry seconds-fresh
 *      after each agent run.
 *   2. Hourly setInterval in src/index.ts — catches non-agent writes (manual
 *      reviewer edits, assessment writes through Express routes that don't
 *      invoke the agent).
 *
 * Both call sites use fire-and-forget — the sync never throws into its caller.
 * Errors are logged at warn level and the next tick (or next agent run)
 * retries. SNAPSHOT transactions = idempotent full-replace so retries are
 * safe.
 *
 * The same logic lives in scripts/src/foundry/sync.ts as a CLI for ad-hoc
 * runs. Kept duplicated rather than introducing a shared package — the
 * config.ts + client.ts pair is small and has no external deps.
 */

import {
  db,
  industriesTable,
  capabilitiesTable,
  capabilityEconomicsTable,
  capabilityQuadrantsTable,
  valueChainStagesTable,
  companyCapabilityProfilesTable,
  capabilityDependenciesTable,
} from "@workspace/db";
import { logger } from "../../lib/logger";
import { DATASETS } from "./config";
import { replaceDatasetCsv, toCsv } from "./client";

let syncInFlight = false;

interface SyncResult {
  ok: boolean;
  durationMs: number;
  rowsByDataset: Record<string, number>;
  error?: string;
}

async function syncOne<T extends Record<string, unknown>>(
  label: string,
  datasetRid: string,
  rows: T[],
  columns: (keyof T & string)[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const csv = toCsv(rows as Array<Record<string, unknown>>, columns as string[]);
  await replaceDatasetCsv(datasetRid, csv, `${label}.csv`);
  return rows.length;
}

/**
 * Snapshot every CE table to its corresponding Foundry Dataset. Throws on
 * any individual upload failure — the wrapping callers swallow it.
 */
export async function runFoundrySyncOnce(): Promise<SyncResult> {
  const start = Date.now();
  const rowsByDataset: Record<string, number> = {};
  try {
    const [industries, capabilities, quadrants, economics, valueChain, companies, dependencies] = await Promise.all([
      db.select().from(industriesTable),
      db.select().from(capabilitiesTable),
      db.select().from(capabilityQuadrantsTable),
      db.select().from(capabilityEconomicsTable),
      db.select().from(valueChainStagesTable),
      db.select().from(companyCapabilityProfilesTable),
      db.select().from(capabilityDependenciesTable),
    ]);

    rowsByDataset.ce_industries = await syncOne("ce_industries", DATASETS.industries, industries, [
      "id", "name", "slug", "description", "createdAt",
    ]);
    rowsByDataset.ce_capabilities = await syncOne("ce_capabilities", DATASETS.capabilities, capabilities, [
      "id", "industryId", "parentCapabilityId", "name", "slug", "description",
      "traditionalView", "economicView", "benchmarkScore", "reviewStatus",
      "submittedBy", "enrichmentStatus", "enrichmentStage", "enrichmentError",
      "enrichmentUpdatedAt", "createdAt",
    ]);
    rowsByDataset.ce_quadrants = await syncOne("ce_quadrants", DATASETS.quadrants, quadrants, [
      "id", "capabilityId", "industryId", "runId", "quadrant",
      "economicImpactScore", "adoptionMomentumScore", "disruptionIntensity",
      "rationale", "perplexitySources", "generatedAt",
    ]);
    rowsByDataset.ce_economics = await syncOne("ce_economics", DATASETS.economics, economics, [
      "id", "capabilityId", "industryId", "tamUsdMm", "samUsdMm",
      "marginStructurePct", "halfLifeMonths", "commoditizationVelocity",
      "revenueExposureMm", "consensusQuadrant", "consensusConfidence",
      "consensusSummary", "consensusSources", "rationale",
      "summaryNarrative", "traditionalNarrative", "economicNarrative",
      "aiNarrative", "aiExposureScore", "aiTimeToDisplacementMonths",
      "aiSubstitutes", "metricInterpretations", "dependencyRationales",
      "roleConsequences", "playbook", "benchmarkInterpretation", "generatedAt",
    ]);
    rowsByDataset.ce_value_chain_stages = await syncOne("ce_value_chain_stages", DATASETS.valueChain, valueChain, [
      "id", "industryId", "stageName", "stageOrder", "numSectors", "hhiScore",
      "patentCount", "patentTrendPct", "startupCount", "startupTrendPct",
      "capitalFlowMm", "capitalTrendPct", "disruptionSummary", "shifts", "risks",
      "keyCapabilities", "keyCompanies", "perplexitySources", "generatedAt",
    ]);
    rowsByDataset.ce_companies = await syncOne("ce_companies", DATASETS.companies, companies, [
      "id", "name", "country", "naicsCode", "naicsSector", "industryId",
      "feviScore", "cdiScore", "quadrant", "fundingStage", "description",
      "generatedAt",
    ]);
    rowsByDataset.ce_capability_dependencies = await syncOne("ce_capability_dependencies", DATASETS.dependencies, dependencies, [
      "id", "capabilityId", "dependsOnId", "strength",
    ]);

    const durationMs = Date.now() - start;
    logger.info({ durationMs, rowsByDataset }, "[foundry-sync] complete");
    return { ok: true, durationMs, rowsByDataset };
  } catch (err) {
    const durationMs = Date.now() - start;
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ durationMs, error, rowsByDataset }, "[foundry-sync] failed");
    return { ok: false, durationMs, rowsByDataset, error };
  }
}

/**
 * Fire-and-forget sync. Concurrency-guarded so back-to-back calls coalesce
 * (a sync is already in flight → next caller exits immediately, the in-flight
 * sync will pick up its DB writes anyway since it reads at start).
 *
 * Use from end-of-agent-run hooks or anywhere you want to nudge Foundry to
 * catch up without awaiting the result.
 */
export function fireFoundrySync(reason: string): void {
  if (syncInFlight) {
    logger.debug({ reason }, "[foundry-sync] skip — already in flight");
    return;
  }
  // Skip silently if Foundry isn't configured (env vars missing) — this is
  // expected in dev/prod tenants that haven't been wired to Foundry yet.
  if (!process.env.FOUNDRY_BASE_URL && !process.env.PALANTIR_URL && !process.env.FOUNDRY_URL && !process.env.PALANTIR_BASE_URL) {
    logger.debug({ reason }, "[foundry-sync] skip — Foundry env not configured");
    return;
  }
  syncInFlight = true;
  void (async () => {
    try {
      logger.info({ reason }, "[foundry-sync] starting");
      await runFoundrySyncOnce();
    } catch (err) {
      logger.warn({ err, reason }, "[foundry-sync] threw past runFoundrySyncOnce");
    } finally {
      syncInFlight = false;
    }
  })();
}

/**
 * Hourly catch-up sync — call once at api-server boot to register the
 * setInterval. Safe to call when Foundry env isn't configured (each tick
 * just no-ops via fireFoundrySync's env check).
 */
const HOURLY_MS = 60 * 60 * 1000;
let hourlyTimer: ReturnType<typeof setInterval> | null = null;
export function startFoundryHourlySync(): void {
  if (hourlyTimer) return;
  hourlyTimer = setInterval(() => fireFoundrySync("hourly tick"), HOURLY_MS);
  logger.info({ intervalMinutes: HOURLY_MS / 60000 }, "[foundry-sync] hourly catch-up registered");
}
