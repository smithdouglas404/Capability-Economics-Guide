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
 * Errors are logged at warn level, classified, and persisted to
 * `foundry_sync_log` so the admin dashboard can surface health. Two
 * back-to-back http_401 outcomes raise a token-rotation alert (banner +
 * console warn + audit log entry) — the admin panel reads the alert state via
 * /api/admin/foundry/health and offers a "I rotated the token" recheck button
 * that fires a fresh sync and clears the alert if the new token works.
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
  foundrySyncLogTable,
  adminAuditLogTable,
} from "@workspace/db";
import { desc } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { DATASETS } from "./config";
import { replaceDatasetCsv, toCsv } from "./client";

let syncInFlight = false;

export type FoundrySyncStatus = "ok" | "http_401" | "http_5xx" | "network" | "other";

export interface SyncResult {
  ok: boolean;
  status: FoundrySyncStatus;
  httpStatus: number | null;
  durationMs: number;
  rowsByDataset: Record<string, number>;
  error?: string;
}

/**
 * In-memory alert state. Set when ≥2 consecutive http_401 outcomes are
 * detected after persisting a sync row. Read by the admin /health endpoint
 * to drive the banner. Cleared on the next successful sync (or on explicit
 * /recheck POST that succeeds).
 */
interface FoundryAlertState {
  active: boolean;
  consecutive401: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
}
const alertState: FoundryAlertState = {
  active: false,
  consecutive401: 0,
  firstFailureAt: null,
  lastFailureAt: null,
  lastError: null,
};

export function getFoundryAlertState(): Readonly<FoundryAlertState> {
  return { ...alertState };
}

/**
 * Boot-time rebuild of alertState from the persisted log tail. Without this,
 * a process restart would silently clear the banner even when recent history
 * shows ≥2 consecutive 401s — admins would lose visibility until the next
 * hourly tick re-confirmed the failure. Called once from src/index.ts.
 */
export async function rehydrateFoundryAlertState(): Promise<void> {
  try {
    const recent = await db
      .select({ status: foundrySyncLogTable.status, completedAt: foundrySyncLogTable.completedAt, errorMessage: foundrySyncLogTable.errorMessage })
      .from(foundrySyncLogTable)
      .orderBy(desc(foundrySyncLogTable.id))
      .limit(5);
    if (recent.length === 0) return;
    let streak = 0;
    for (const row of recent) {
      if (row.status === "http_401") streak += 1;
      else break;
    }
    if (streak === 0) return;
    alertState.consecutive401 = streak;
    alertState.lastFailureAt = recent[0]?.completedAt?.toISOString() ?? null;
    alertState.lastError = recent[0]?.errorMessage ?? null;
    if (streak >= 2) {
      alertState.active = true;
      alertState.firstFailureAt = recent[Math.min(streak - 1, recent.length - 1)]?.completedAt?.toISOString() ?? alertState.lastFailureAt;
      logger.warn({ consecutive401: streak }, "[foundry-sync] alert state rehydrated from DB at boot — token still appears to need rotation");
    }
  } catch (e) {
    logger.error({ err: e }, "[foundry-sync] rehydrateFoundryAlertState failed");
  }
}

/**
 * Classify a thrown error into a status enum + extracted HTTP code. The
 * Foundry client throws `Error("Foundry GET /path 401: …")` or
 * `Error("upload rid/file 503: …")`, so we regex-extract the status.
 * Anything that doesn't match a Foundry HTTP error is treated as a
 * network-layer failure (fetch threw before getting a Response).
 */
function classifyError(err: unknown): { status: FoundrySyncStatus; httpStatus: number | null; message: string } {
  const message = err instanceof Error ? err.message : String(err);
  // Match the trailing "<digits>:" status code embedded by foundry/client.ts.
  const m = message.match(/\b(\d{3}):/);
  if (m) {
    const code = Number(m[1]);
    if (code === 401 || code === 403) return { status: "http_401", httpStatus: code, message };
    if (code >= 500 && code < 600) return { status: "http_5xx", httpStatus: code, message };
    return { status: "other", httpStatus: code, message };
  }
  // Node fetch network failures surface as TypeError("fetch failed") with a
  // cause; treat any non-HTTP error as network-layer.
  if (err instanceof TypeError || /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(message)) {
    return { status: "network", httpStatus: null, message };
  }
  return { status: "other", httpStatus: null, message };
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
 * Snapshot every CE table to its corresponding Foundry Dataset. Each call
 * persists exactly one row to foundry_sync_log with the classified outcome.
 * After persisting, checks the previous row — if both are http_401, raises
 * the alert (banner + warn + audit log entry).
 */
export async function runFoundrySyncOnce(reason = "ad-hoc"): Promise<SyncResult> {
  const start = Date.now();
  const startedAt = new Date(start);
  const rowsByDataset: Record<string, number> = {};
  let result: SyncResult;
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
    logger.info({ durationMs, rowsByDataset, reason }, "[foundry-sync] complete");
    result = { ok: true, status: "ok", httpStatus: null, durationMs, rowsByDataset };
  } catch (err) {
    const durationMs = Date.now() - start;
    const classified = classifyError(err);
    logger.warn({ durationMs, status: classified.status, httpStatus: classified.httpStatus, error: classified.message, rowsByDataset, reason }, "[foundry-sync] failed");
    result = { ok: false, status: classified.status, httpStatus: classified.httpStatus, durationMs, rowsByDataset, error: classified.message };
  }

  // Persist outcome (best-effort — never throw past this).
  try {
    await db.insert(foundrySyncLogTable).values({
      startedAt,
      completedAt: new Date(),
      status: result.status,
      httpStatus: result.httpStatus ?? null,
      durationMs: result.durationMs,
      rowsByDataset: result.rowsByDataset,
      errorMessage: result.error ?? null,
      reason,
    });
  } catch (e) {
    logger.error({ err: e }, "[foundry-sync] failed to persist sync log row");
  }

  await updateAlertStateAfterSync(result, reason);
  return result;
}

/**
 * After persisting a row, look at the last 2 sync log rows. If both are
 * http_401 and the alert isn't already active, raise it: warn-level log,
 * append an admin_audit_log entry, and flip the in-memory flag. A successful
 * sync always clears the alert.
 */
async function updateAlertStateAfterSync(result: SyncResult, reason: string): Promise<void> {
  if (result.status === "ok") {
    if (alertState.active || alertState.consecutive401 > 0) {
      logger.info({ reason }, "[foundry-sync] token alert cleared after successful sync");
    }
    alertState.active = false;
    alertState.consecutive401 = 0;
    alertState.firstFailureAt = null;
    alertState.lastFailureAt = null;
    alertState.lastError = null;
    return;
  }

  if (result.status !== "http_401") {
    // Non-401 failures don't escalate the rotation alert (could be 5xx /
    // network — caller should investigate but rotating the token won't help).
    return;
  }

  // Count consecutive http_401s by reading the tail of the log. Cheap — we
  // just persisted the latest row, so check it + the immediately previous.
  try {
    const recent = await db
      .select({ status: foundrySyncLogTable.status, completedAt: foundrySyncLogTable.completedAt, errorMessage: foundrySyncLogTable.errorMessage })
      .from(foundrySyncLogTable)
      .orderBy(desc(foundrySyncLogTable.id))
      .limit(5);
    let streak = 0;
    for (const row of recent) {
      if (row.status === "http_401") streak += 1;
      else break;
    }
    alertState.consecutive401 = streak;
    alertState.lastFailureAt = new Date().toISOString();
    alertState.lastError = result.error ?? "Foundry returned 401";
    if (streak >= 2 && !alertState.active) {
      alertState.active = true;
      alertState.firstFailureAt = recent[Math.min(streak - 1, recent.length - 1)]?.completedAt?.toISOString() ?? alertState.lastFailureAt;
      logger.warn({ consecutive401: streak, reason, lastError: alertState.lastError }, "[foundry-sync] ALERT — 2+ consecutive 401s, rotate FOUNDRY_TOKEN");
      try {
        await db.insert(adminAuditLogTable).values({
          actorUserId: "system",
          actorEmail: null,
          action: "foundry.token_alert",
          targetType: "foundry",
          targetId: "sync",
          details: {
            consecutive401: streak,
            reason,
            lastError: alertState.lastError,
            firstFailureAt: alertState.firstFailureAt,
          },
        });
      } catch (e) {
        logger.error({ err: e }, "[foundry-sync] failed to write audit log entry for token alert");
      }
    }
  } catch (e) {
    logger.error({ err: e }, "[foundry-sync] failed to read sync log for alert evaluation");
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
      await runFoundrySyncOnce(reason);
    } catch (err) {
      logger.warn({ err, reason }, "[foundry-sync] threw past runFoundrySyncOnce");
    } finally {
      syncInFlight = false;
    }
  })();
}

/**
 * Awaitable variant for the admin "I rotated the token — recheck now" flow.
 * Returns the SyncResult so the API route can report success/failure inline
 * instead of forcing the UI to poll the log table.
 */
export async function runFoundrySyncAwait(reason: string): Promise<SyncResult> {
  if (!process.env.FOUNDRY_BASE_URL && !process.env.PALANTIR_URL && !process.env.FOUNDRY_URL && !process.env.PALANTIR_BASE_URL) {
    return {
      ok: false,
      status: "other",
      httpStatus: null,
      durationMs: 0,
      rowsByDataset: {},
      error: "Foundry env not configured (set FOUNDRY_BASE_URL or PALANTIR_URL)",
    };
  }
  if (syncInFlight) {
    // Wait briefly for the in-flight sync to finish so the recheck reflects
    // the latest token, then run a fresh one to be sure.
    await new Promise<void>((r) => {
      const start = Date.now();
      const tick = setInterval(() => {
        if (!syncInFlight || Date.now() - start > 30_000) {
          clearInterval(tick);
          r();
        }
      }, 250);
    });
  }
  syncInFlight = true;
  try {
    return await runFoundrySyncOnce(reason);
  } finally {
    syncInFlight = false;
  }
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
