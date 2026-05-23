import { runAgent } from "./graph";
import { ensureKillSwitchTable, isSchedulerDisabledRuntime } from "../scheduler-kill-switch";
import { emitAgentEvent } from "./events";
import { startConsolidator, stopConsolidator } from "./consolidator";
import { detectTemporalShifts, writeMemoryRelationSnapshots } from "./temporal-shift-detector";
import { syncEconomicRulesToLetta } from "./economic-rules-sync";
import { syncMarketContextToLetta } from "./market-context-sync";
import { mem0Prune, configureMem0CustomCategories } from "./memory";
import { ensureSharedStoreReady } from "./store";
import { runMacroEventAgent } from "../macro-event-agent";
import { runDisruptionAgent } from "../disruption-agent";
import { runPeerCoopAgent } from "../peer-coop-agent";
import { runStackOptimizerAgent } from "../stack-optimizer-agent";
import { runOntologyAgent } from "../ontology-agent";
import { runSynthesisAgent } from "../synthesis-agent";
import { runSynthesisBriefComposer } from "../workflows";
import { rotateTriangulations } from "../triangulation";
import { computeCVI } from "../cvi-engine";
import { computeDVX } from "../dvx-engine";
import { runWorldScanAllIndustries } from "../macro-events";
import { startMarketplaceAutoArchive, stopMarketplaceAutoArchive } from "../marketplace-auto-archive";
import { featuredCaseStudyTick } from "../featured-case-study-rotation";
import { runDigestSweep } from "../digest";
import { runDetailEnrichment } from "../alpha/enrich";
import { getTuning } from "../agent-tuning";
import { runAllBotsTick } from "../bots/loop";
import { runCreditExpirySweep } from "../credit-expiry";
import { runRegulationsWatchNotifier } from "../regulations-watch-notifier";
import { runWatchlistEvaluator } from "../watchlist-evaluator";
import { rebuildPeerBenchmarks } from "../peer-benchmarks/aggregator";
import { runEdgarRssTick } from "../edgar/rss-watcher";
import { detectCviSignalEvents } from "../cvi-signals/detector";
import { attributeSignalOutcomes } from "../cvi-signals/attribution";
import { runEnrichmentGraph } from "../enrichment/graph";
import { ingestExternalSignalsForIndustry } from "../external-signals";
import { db } from "@workspace/db";
import { cviComponentsTable, cviSnapshotsTable, enrichmentConfigTable, capabilitiesTable, capabilityAlphaTable, industriesTable } from "@workspace/db";
import { desc, eq, or, isNull, lt } from "drizzle-orm";

// Routine cadence is read from agent_tuning each tick — the only fixed
// constant here is how often we *check* whether it's time to run.
const ROUTINE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const WATCHDOG_INTERVAL_MS = 5 * 60 * 1000;
// Bot loop tick: every hour we wake all active bots and check whether each
// has actions due per its persona cadence. The runBotTick function is
// internally idempotent — running it more often than actions are due is a
// no-op. Hourly gives quick response after a new bot is spawned without
// over-polling.
const BOT_LOOP_INTERVAL_MS = 60 * 60 * 1000;
// Credit expiry sweep runs daily. Pulls every credit_purchases row whose
// expires_at <= NOW and debits the unused portion of the batch.
const CREDIT_EXPIRY_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Peer benchmarks rebuild runs daily. Reaggregates percentile distributions
// over organization_capabilities for every (industry, capability) cell with
// at least 5 contributing organizations.
const PEER_BENCHMARKS_INTERVAL_MS = 24 * 60 * 60 * 1000;
// EDGAR RSS watcher polls the SEC current-filings atom feed every 15 minutes.
// SEC's feed updates throughout the day; this cadence catches new filings
// while staying well under EDGAR's per-IP rate limits.
const EDGAR_RSS_INTERVAL_MS = 15 * 60 * 1000;
// CVI signal detector runs daily — sweeps the per-cap history table for
// moves >= threshold within the configured window. Cheap (in-memory pair
// comparison after one DB pull).
const CVI_SIGNALS_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Auto-enrich tick: hourly check that reads enrichment_config and, if enabled,
// finds capabilities with missing or stale economics rows and pushes them
// through the LangGraph enrichment pipeline one at a time. Replaces the dead
// BullMQ-based auto-enrich tick that was removed in Task #22 but whose UI
// surface (enrichment_config.lastRunAt/lastRunEnqueued) was left in place.
const AUTO_ENRICH_INTERVAL_MS = 60 * 60 * 1000;
// External signals (patent_count_5y, vc_capital_usd_5y, startup_count_5y) are
// scraped per capability from Perplexity and rolled up by the value-chain
// stage profile view. The underlying writer (`ingestExternalSignalsForIndustry`)
// already enforces a 30-day staleness window per capability — meaning a weekly
// tick is mostly a no-op once a freshness pass has run, and never spams
// Perplexity. Weekly cadence chosen because patent / VC / startup signals
// change on monthly-to-quarterly timescales, not daily.
const EXTERNAL_SIGNALS_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
// Mem0 staleness sweep: deletes memories whose metadata.expiresAt has
// passed. Without this, pgvector grows unbounded and stale observations
// pollute semantic search. Runs daily.
const MEM0_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Macro Event Agent: polls EDGAR, summarizes active macro events,
// publishes a digest to NS.macroEvents() for downstream agents.
// 30-minute cadence aligns with the EDGAR RSS polling interval the
// scheduler already runs (15min) so the agent always sees fresh data.
const MACRO_EVENT_AGENT_INTERVAL_MS = 30 * 60 * 1000;
// Disruption Agent: depends on macro-event digest; runs slightly less
// often so it gets a fresh upstream digest each cycle. 60min cadence.
const DISRUPTION_AGENT_INTERVAL_MS = 60 * 60 * 1000;
// Peer Co-op Agent: cohort benchmarks change slowly; 6h is plenty.
const PEER_COOP_AGENT_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Stack Optimizer Agent: depends on disruption + peer-coop digests;
// daily cadence keeps cost down while still reacting to new context.
const STACK_OPTIMIZER_AGENT_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Ontology Agent: reads all other agents' digests for entity
// extraction; runs last in the chain after others have published.
// 4h matches the natural rollup horizon.
const ONTOLOGY_AGENT_INTERVAL_MS = 4 * 60 * 60 * 1000;
// Synthesis Agent: cross-agent intelligence layer. Runs once daily after
// all specialized agents have completed their cycles. Uses Claude Sonnet
// to synthesize a unified strategic brief from all five agent digests,
// graph correlations, Mem0 patterns, and temporal shifts.
const SYNTHESIS_AGENT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ROTATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ROTATION_BATCH_SIZE = 10;
const URGENCY_BURST_SIZE = 3;
const WORLD_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Digest sweep ticks every 6 hours; the sweep itself filters to subscriptions
// whose lastSentAt is past their frequency cutoff (weekly/daily). Six hours
// keeps daily-frequency subscribers within their 24h window even when the
// scheduler restarts overnight.
const DIGEST_TICK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Regulations-watch notifier: walks regulation_watches and writes inbox
// notifications when watched regulations pass their effective date with
// compliance < 100, or when compliance drops by ≥ 5 points. Throttled to
// 1 alert per watch per 24h. Cheap — 1h cadence keeps the bell responsive
// after a fresh assessment while not over-polling.
const REGULATIONS_WATCH_INTERVAL_MS = 60 * 60 * 1000;
// Capability watchlist evaluator — walks watchlist_items + checks thresholds
// against live values, writing watchlist_alerts + member_notifications on
// fresh breach. 1h cadence matches the regulations notifier.
const WATCHLIST_EVAL_INTERVAL_MS = 60 * 60 * 1000;

const URGENCY_CONFIDENCE_THRESHOLD = 0.35;
const URGENCY_STALE_DAYS = 10;

let routineTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let rotationTimer: ReturnType<typeof setInterval> | null = null;
let worldScanTimer: ReturnType<typeof setInterval> | null = null;
let digestTimer: ReturnType<typeof setInterval> | null = null;
let botLoopTimer: ReturnType<typeof setInterval> | null = null;
let creditExpiryTimer: ReturnType<typeof setInterval> | null = null;
let regulationsWatchTimer: ReturnType<typeof setInterval> | null = null;
let watchlistEvalTimer: ReturnType<typeof setInterval> | null = null;
let peerBenchmarksTimer: ReturnType<typeof setInterval> | null = null;
let edgarRssTimer: ReturnType<typeof setInterval> | null = null;
let cviSignalsTimer: ReturnType<typeof setInterval> | null = null;
let autoEnrichTimer: ReturnType<typeof setInterval> | null = null;
let isAutoEnriching = false;
let externalSignalsTimer: ReturnType<typeof setInterval> | null = null;
let isIngestingExternalSignals = false;
let mem0PruneTimer: ReturnType<typeof setInterval> | null = null;
let macroEventAgentTimer: ReturnType<typeof setInterval> | null = null;
let disruptionAgentTimer: ReturnType<typeof setInterval> | null = null;
let peerCoopAgentTimer: ReturnType<typeof setInterval> | null = null;
let stackOptimizerAgentTimer: ReturnType<typeof setInterval> | null = null;
let ontologyAgentTimer: ReturnType<typeof setInterval> | null = null;
let synthesisAgentTimer: ReturnType<typeof setInterval> | null = null;
let temporalShiftTimer: ReturnType<typeof setInterval> | null = null;
let memoryRelationSnapshotTimer: ReturnType<typeof setInterval> | null = null;
let featuredCaseStudyTimer: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let isRotating = false;
let isScanning = false;
let isDigesting = false;
let isBotTicking = false;
let isExpiring = false;
let isAggregatingBenchmarks = false;
let isEdgarRssTicking = false;
let isDetectingSignals = false;
let lastRunAt: Date | null = null;
let lastRotationAt: Date | null = null;
let lastWorldScanAt: Date | null = null;
let lastDigestAt: Date | null = null;
let lastRotationResult: { attempted: number; succeeded: number; failed: number } | null = null;
let lastWorldScanResult: { totalInserted: number; industryCount: number } | null = null;
let lastDigestResult: { attempted: number; succeeded: number; failed: number } | null = null;
let lastRunResult: Awaited<ReturnType<typeof runAgent>> | null = null;

async function detectUrgentConditions(): Promise<{ urgent: boolean; reason: string }> {
  try {
    const components = await db.select().from(cviComponentsTable);
    const now = Date.now();

    const veryLowConfidence = components.filter(c => c.confidence < URGENCY_CONFIDENCE_THRESHOLD);
    if (veryLowConfidence.length > 0) {
      return { urgent: true, reason: `${veryLowConfidence.length} capabilities with critically low confidence (< ${URGENCY_CONFIDENCE_THRESHOLD})` };
    }

    const veryStale = components.filter(c => {
      const staleDays = (now - new Date(c.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
      return staleDays > URGENCY_STALE_DAYS;
    });
    if (veryStale.length >= 3) {
      return { urgent: true, reason: `${veryStale.length} capabilities stale beyond ${URGENCY_STALE_DAYS} days` };
    }

    const snapshots = await db.select().from(cviSnapshotsTable)
      .orderBy(desc(cviSnapshotsTable.snapshotAt)).limit(2);
    if (snapshots.length === 2) {
      const drop = snapshots[1].overallIndex - snapshots[0].overallIndex;
      if (drop > 5) {
        return { urgent: true, reason: `CVI index dropped ${drop.toFixed(1)} points since last snapshot` };
      }
    }

    return { urgent: false, reason: "" };
  } catch {
    return { urgent: false, reason: "" };
  }
}

async function executeRun(trigger: string): Promise<Awaited<ReturnType<typeof runAgent>> | null> {
  if (isRunning) {
    console.log("[Agent] Skipping run — previous cycle still in progress");
    return null;
  }
  isRunning = true;
  try {
    const result = await runAgent(trigger);
    lastRunAt = new Date();
    lastRunResult = result;

    // Deterministic CVI snapshot at the end of every routine cycle. The
    // agent may or may not have invoked the compute_cvi tool — we don't
    // trust Sonnet's tool-selection to bank the time-series moat. Banking
    // a snapshot per cycle is the cheapest, most defensible way to convert
    // system age into competitive history (Task #3 tactic 1).
    try {
      const cvi = await computeCVI();
      console.log(`[Agent] CVI snapshot persisted (${trigger}): overallIndex=${cvi.overallIndex}`);
    } catch (cviErr) {
      console.warn("[Agent] CVI snapshot failed (non-fatal):", cviErr);
    }

    // DVX parallel snapshot — computes disruption scores for every cap
    // with a CVI row. Pattern-match LLM calls are cached (only re-issued
    // when factor 1/2 score drifts > 5 pts or 7+ days stale), so the
    // marginal cost per cycle is modest after the first warm-up.
    try {
      const dvx = await computeDVX();
      console.log(`[Agent] DVX snapshot persisted (${trigger}): overallIndex=${dvx.overallIndex.toFixed(1)}, capsScored=${dvx.capabilitiesScored}, llmCalls=${dvx.llmCallsIssued}`);
    } catch (dvxErr) {
      console.warn("[Agent] DVX snapshot failed (non-fatal):", dvxErr);
    }

    // Deterministic null-detail backfill. The agent (Sonnet) freely skips
    // run_economic_detail when alpha succeeded and sibling caps already have
    // detail rows — same skip pattern documented in commit b261198 for the
    // per-cap rerun path. Without this sweep, capability_economics rows can
    // sit with null summaryNarrative / aiExposureScore indefinitely. Per-cap
    // cost ≈ $0.06 (1 Perplexity + 1 Sonnet). Limit is admin-tunable via
    // agent_tuning.detail_backfill_limit; if 0, the sweep is skipped entirely.
    try {
      const tuning = await getTuning();
      if (tuning.detailBackfillLimit > 0) {
        const detailRes = await runDetailEnrichment({ limit: tuning.detailBackfillLimit });
        if (detailRes.enriched > 0 || detailRes.errors.length > 0) {
          console.log(`[Agent] Detail backfill (${trigger}, limit=${tuning.detailBackfillLimit}): enriched=${detailRes.enriched} errors=${detailRes.errors.length} durationMs=${detailRes.durationMs}`);
        }
      }
    } catch (detailErr) {
      console.warn("[Agent] Detail backfill failed (non-fatal):", detailErr);
    }

    return result;
  } catch (err) {
    console.error("[Agent] Run failed:", err);
    return null;
  } finally {
    isRunning = false;
  }
}

async function watchdogCheck(): Promise<void> {
  if (isRunning) return;

  const minutesSinceLast = lastRunAt
    ? (Date.now() - lastRunAt.getTime()) / 60000
    : Infinity;

  if (minutesSinceLast < 10) return;

  const { urgent, reason } = await detectUrgentConditions();
  if (urgent) {
    console.log(`[Agent] Urgent condition detected — self-triggering: ${reason}`);
    emitAgentEvent({ type: "phase", phase: "self_triggered", message: `Auto-triggered: ${reason}` });

    if (!isRotating) {
      isRotating = true;
      try {
        const stale = await db.select().from(cviComponentsTable);
        const staleByIndustry = new Map<number, number>();
        for (const c of stale) {
          if (c.confidence < URGENCY_CONFIDENCE_THRESHOLD) {
            staleByIndustry.set(c.industryId, (staleByIndustry.get(c.industryId) || 0) + 1);
          }
        }
        const targetIndustry = [...staleByIndustry.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (targetIndustry) {
          emitAgentEvent({ type: "phase", phase: "urgency_burst", message: `Triangulation burst: ${URGENCY_BURST_SIZE} stale caps in industry ${targetIndustry}` });
          const burst = await rotateTriangulations(URGENCY_BURST_SIZE, targetIndustry);
          console.log(`[Agent] Urgency burst refreshed ${burst.succeeded}/${burst.attempted} caps`);
        }
      } catch (err) {
        console.warn("[Agent] Urgency burst failed:", err);
      } finally {
        isRotating = false;
      }
    }

    await executeRun("autonomous");
  }
}

async function executeWorldScan(trigger: string): Promise<void> {
  if (isScanning) {
    console.log("[World Scan] Skipping — previous scan in progress");
    return;
  }
  isScanning = true;
  emitAgentEvent({ type: "phase", phase: "world_scan_started", message: `World scan (${trigger}): scanning all industries` });
  try {
    const result = await runWorldScanAllIndustries();
    lastWorldScanAt = new Date();
    lastWorldScanResult = { totalInserted: result.totalInserted, industryCount: result.perIndustry.length };
    console.log(`[World Scan] Inserted ${result.totalInserted} events across ${result.perIndustry.length} industries`);
    emitAgentEvent({ type: "phase", phase: "world_scan_complete", message: `World scan: ${result.totalInserted} new events ingested` });

    // Urgency burst gate: only when an industry got at least one *severe* (>=7) event
    // from this scan. Cheaper events (sev 5-6) don't warrant blowing up the rotation queue.
    const burstTarget = result.perIndustry
      .filter(p => p.inserted > 0 && (p.maxSeverity ?? 0) >= 7)
      .sort((a, b) => (b.maxSeverity ?? 0) - (a.maxSeverity ?? 0))[0];
    if (burstTarget && !isRotating) {
      isRotating = true;
      try {
        emitAgentEvent({ type: "phase", phase: "scan_burst", message: `Macro event burst (sev ${burstTarget.maxSeverity}): ${URGENCY_BURST_SIZE} caps in ${burstTarget.industryName}` });
        await rotateTriangulations(URGENCY_BURST_SIZE, burstTarget.industryId);
      } finally {
        isRotating = false;
      }
    }

    if (result.totalInserted > 0) {
      const cei = await computeCVI();
      emitAgentEvent({ type: "cvi_updated", overallIndex: cei.overallIndex, message: `CVI recomputed after world scan: ${cei.overallIndex}` });
    }
  } catch (err) {
    console.error("[World Scan] failed:", err);
  } finally {
    isScanning = false;
  }
}

export async function triggerWorldScanNow(): Promise<{ totalInserted: number; industryCount: number }> {
  if (isScanning) throw new Error("World scan already in progress");
  isScanning = true;
  try {
    const result = await runWorldScanAllIndustries();
    lastWorldScanAt = new Date();
    lastWorldScanResult = { totalInserted: result.totalInserted, industryCount: result.perIndustry.length };
    if (result.totalInserted > 0) await computeCVI();
    return lastWorldScanResult;
  } finally {
    isScanning = false;
  }
}

async function executeRotation(trigger: string): Promise<void> {
  if (isRotating) {
    console.log("[Triangulation Rotation] Skipping — previous rotation in progress");
    return;
  }
  isRotating = true;
  emitAgentEvent({ type: "phase", phase: "rotation_started", message: `Triangulation rotation (${trigger}): refreshing ${ROTATION_BATCH_SIZE} oldest caps` });
  try {
    const result = await rotateTriangulations(ROTATION_BATCH_SIZE);
    lastRotationAt = new Date();
    lastRotationResult = { attempted: result.attempted, succeeded: result.succeeded, failed: result.failed };
    emitAgentEvent({
      type: "phase",
      phase: "rotation_complete",
      message: `Rotation complete: ${result.succeeded}/${result.attempted} succeeded`,
    });
    if (result.succeeded > 0) {
      const cei = await computeCVI();
      emitAgentEvent({ type: "cvi_updated", overallIndex: cei.overallIndex, message: `CVI recomputed after rotation: ${cei.overallIndex}` });
    }
  } catch (err) {
    console.error("[Triangulation Rotation] failed:", err);
  } finally {
    isRotating = false;
  }
}

/**
 * Daily credit expiry sweep. Pulls every completed credit_purchases row
 * whose expires_at <= NOW and debits the unused portion of the batch from
 * the user's balance. Idempotent (expired_processed flag prevents double-debit).
 */
async function creditExpiryTick(): Promise<void> {
  if (isExpiring) return;
  isExpiring = true;
  try {
    await runCreditExpirySweep();
  } catch (err) {
    console.warn("[CreditExpiry] sweep failed:", err);
  } finally {
    isExpiring = false;
  }
}

let isEvaluatingWatchlist = false;
/**
 * Hourly capability watchlist evaluator. Walks watchlist_items + writes
 * alerts + member_notifications on fresh threshold breach. Idempotent
 * via the `triggered` column.
 */
async function watchlistEvalTick(): Promise<void> {
  if (isEvaluatingWatchlist) return;
  isEvaluatingWatchlist = true;
  try {
    const stats = await runWatchlistEvaluator();
    if (stats.triggered > 0 || stats.cleared > 0 || stats.errors > 0) {
      console.log(`[WatchlistEval] walked=${stats.walked} triggered=${stats.triggered} cleared=${stats.cleared} errors=${stats.errors}`);
    }
  } catch (err) {
    console.warn("[WatchlistEval] failed:", err);
  } finally {
    isEvaluatingWatchlist = false;
  }
}

let isNotifyingRegulationsWatches = false;
/**
 * Hourly regulation-watch notifier tick. Walks regulation_watches and writes
 * member_notifications when a watched regulation passes its effective date
 * with compliance < 100, or when compliance drops ≥ 5 points. Throttled to
 * 1 alert per (user, regulation) per 24h via regulation_watches.last_alerted_at.
 */
async function regulationsWatchTick(): Promise<void> {
  if (isNotifyingRegulationsWatches) return;
  isNotifyingRegulationsWatches = true;
  try {
    const stats = await runRegulationsWatchNotifier();
    if (stats.notified > 0 || stats.errors > 0) {
      console.log(`[RegulationsWatch] walked=${stats.walked} notified=${stats.notified} skipped-recent=${stats.skippedRecent} skipped-no-org=${stats.skippedNoOrg} errors=${stats.errors}`);
    }
  } catch (err) {
    console.warn("[RegulationsWatch] notifier failed:", err);
  } finally {
    isNotifyingRegulationsWatches = false;
  }
}

/**
 * Daily peer-benchmarks aggregator. Recomputes percentile distributions
 * over organization_capabilities for every (industry, capability) cell.
 * Cells with <5 contributors are suppressed (privacy + statistical floor).
 */
async function peerBenchmarksTick(): Promise<void> {
  if (isAggregatingBenchmarks) return;
  isAggregatingBenchmarks = true;
  try {
    await rebuildPeerBenchmarks();
  } catch (err) {
    console.warn("[PeerBenchmarks] rebuild failed:", err);
  } finally {
    isAggregatingBenchmarks = false;
  }
}

/**
 * EDGAR RSS watcher: polls SEC's current-filings atom feed, scans each
 * entry's title against cached capability names, upserts hits.
 */
async function edgarRssTick(): Promise<void> {
  if (isEdgarRssTicking) return;
  isEdgarRssTicking = true;
  try {
    await runEdgarRssTick();
    // Refresh the Letta market_context block whenever new filings land
    // so the agent's next cycle decision sees them. Non-fatal.
    syncMarketContextToLetta().catch(() => {});
  } catch (err) {
    console.warn("[EdgarRSS] tick failed:", err);
  } finally {
    isEdgarRssTicking = false;
  }
}

/**
 * Daily CVI signal detector — finds capability moves >= 5pt within 30d
 * window and inserts them as cvi_signal_events for the predictive backtest
 * framework (Task #5).
 */
async function cviSignalsTick(): Promise<void> {
  if (isDetectingSignals) return;
  isDetectingSignals = true;
  try {
    await detectCviSignalEvents();
    // After detection, immediately try to attribute outcomes for any events
    // ready for measurement (windowEndAt at least 30d in the past). The
    // attribution job has its own outcome_attributed flag so this is
    // bounded — only sweeps unprocessed events.
    await attributeSignalOutcomes({ limit: 50 });
    // Refresh the Letta market_context block — large/extreme CVI moves
    // detected this tick should bias the next cycle's prioritization.
    syncMarketContextToLetta().catch(() => {});
  } catch (err) {
    console.warn("[CviSignals] detection / attribution failed:", err);
  } finally {
    isDetectingSignals = false;
  }
}

/**
 * Auto-enrich tick — fills missing capability_alpha rows and refreshes
 * stale ones using the LangGraph enrichment agent's per-cap rerun path
 * (deterministic 3-step sequence: run_economic_alpha → run_economic_detail
 * → finish). Honors the admin-tunable enrichment_config row: enabled flag
 * + refreshDays cadence. Updates lastRunAt + lastRunEnqueued on every tick
 * that finds work, so the admin UI's status panel reflects reality.
 *
 * Loops serially per cap (no concurrency) to stay polite to Perplexity +
 * OpenRouter quotas; with the typical 8 missing-cap backlog this completes
 * inside one tick. The function is guarded by isAutoEnriching against
 * tick overlap if a backlog takes longer than the 1h interval.
 */
async function autoEnrichTick(): Promise<void> {
  if (isAutoEnriching) {
    console.log("[AutoEnrich] tick skipped — previous tick still in progress");
    return;
  }
  if (await isSchedulerDisabledRuntime("autoEnrich")) {
    console.log("[AutoEnrich] tick skipped — disabled via scheduler_kill_switches");
    return;
  }
  isAutoEnriching = true;
  try {
    const [cfg] = await db.select().from(enrichmentConfigTable).limit(1);
    if (!cfg || !cfg.enabled) return;
    const refreshThreshold = new Date(Date.now() - cfg.refreshDays * 24 * 60 * 60 * 1000);
    const candidates = await db
      .select({
        capId: capabilitiesTable.id,
        industryId: capabilitiesTable.industryId,
        generatedAt: capabilityAlphaTable.generatedAt,
      })
      .from(capabilitiesTable)
      .leftJoin(capabilityAlphaTable, eq(capabilityAlphaTable.capabilityId, capabilitiesTable.id))
      .where(or(isNull(capabilityAlphaTable.id), lt(capabilityAlphaTable.generatedAt, refreshThreshold)));
    if (candidates.length === 0) return;
    await db.update(enrichmentConfigTable).set({
      lastRunAt: new Date(),
      lastRunEnqueued: candidates.length,
      updatedAt: new Date(),
    }).where(eq(enrichmentConfigTable.id, cfg.id));
    console.log(`[AutoEnrich] processing ${candidates.length} cap(s) needing economics`);
    let succeeded = 0;
    let failed = 0;
    for (const item of candidates) {
      try {
        await runEnrichmentGraph({
          trigger: "rerun",
          targetCapabilityIds: [item.capId],
          targetIndustryIds: [item.industryId],
        });
        succeeded++;
      } catch (err) {
        failed++;
        console.warn(`[AutoEnrich] cap ${item.capId} failed:`, err instanceof Error ? err.message : err);
      }
    }
    console.log(`[AutoEnrich] tick complete — succeeded=${succeeded} failed=${failed}`);
  } catch (err) {
    console.warn("[AutoEnrich] tick failed:", err);
  } finally {
    isAutoEnriching = false;
  }
}

/**
 * External-signals tick — for every industry, refresh per-capability
 * patent_count_5y / vc_capital_usd_5y / startup_count_5y via Perplexity.
 * `ingestExternalSignalsForIndustry` already filters to caps whose
 * externalSignalsUpdatedAt is missing or > 30 days stale, so once the
 * first pass completes a weekly tick is mostly idle. Each Perplexity call
 * is gated by PERPLEXITY_API_KEY; absent key → ingester reports the error
 * and we just log it without failing the tick.
 *
 * Guarded by isIngestingExternalSignals so a long-running pass (lots of
 * stale caps after a cold start) doesn't overlap with the next weekly fire.
 */
async function externalSignalsTick(): Promise<void> {
  if (isIngestingExternalSignals) {
    console.log("[ExternalSignals] tick skipped — previous tick still in progress");
    return;
  }
  if (await isSchedulerDisabledRuntime("externalSignals")) {
    console.log("[ExternalSignals] tick skipped — disabled via scheduler_kill_switches");
    return;
  }
  isIngestingExternalSignals = true;
  try {
    const industries = await db.select({ id: industriesTable.id, name: industriesTable.name }).from(industriesTable);
    let totalScanned = 0;
    let totalSucceeded = 0;
    let industriesWithErrors = 0;
    for (const ind of industries) {
      try {
        const r = await ingestExternalSignalsForIndustry(ind.id, { concurrency: 3, staleDays: 30 });
        totalScanned += r.scanned;
        totalSucceeded += r.succeeded;
        if (r.errors.length > 0) industriesWithErrors++;
        if (r.scanned > 0) {
          console.log(`[ExternalSignals] industry ${ind.name}: scanned=${r.scanned} succeeded=${r.succeeded} errors=${r.errors.length}`);
        }
      } catch (err) {
        industriesWithErrors++;
        console.warn(`[ExternalSignals] industry ${ind.name} failed:`, err instanceof Error ? err.message : err);
      }
    }
    console.log(`[ExternalSignals] tick complete — industries=${industries.length} scanned=${totalScanned} succeeded=${totalSucceeded} industriesWithErrors=${industriesWithErrors}`);
  } catch (err) {
    console.warn("[ExternalSignals] tick failed:", err);
  } finally {
    isIngestingExternalSignals = false;
  }
}

/**
 * Bot loop tick: wake all active bots, run any actions due per persona
 * cadence, enforce budget caps. Guarded by isBotTicking so a slow tick
 * doesn't overlap with the next hourly fire.
 */
async function botLoopTick(): Promise<void> {
  if (isBotTicking) {
    console.log("[Bots] Skipping tick — previous tick still in progress");
    return;
  }
  isBotTicking = true;
  try {
    const results = await runAllBotsTick();
    const totalActions = results.reduce((a, r) => a + r.actionsRun, 0);
    const totalSkipped = results.reduce((a, r) => a + r.actionsSkippedBudget, 0);
    const totalCostCents = results.reduce((a, r) => a + r.totalCostCents, 0);
    if (totalActions > 0 || totalSkipped > 0) {
      console.log(`[Bots] Hourly tick: ${results.length} active bot(s), ${totalActions} actions, ${totalSkipped} budget-skips, $${(totalCostCents / 100).toFixed(2)} this tick`);
    }

    // If any bot action mutated assessment state (assessments specifically —
    // browses don't change inflexcvi rollup), bank a CVI snapshot so
    // the time-series records the moment. Cheap when bots are idle (no
    // assessments → no snapshot triggered).
    const assessmentRan = results.some(r => r.actionsRun > 0);
    if (assessmentRan) {
      try {
        await computeCVI();
      } catch (err) {
        console.warn("[Bots] post-tick CVI snapshot failed:", err);
      }
    }
  } catch (err) {
    console.warn("[Bots] tick failed:", err);
  } finally {
    isBotTicking = false;
  }
}

/**
 * Routine cycle check: read the admin-tunable routine interval and run
 * executeRun("routine") if enough time has elapsed since lastRunAt. Called
 * every ROUTINE_CHECK_INTERVAL_MS — moving away from a fixed setInterval
 * means admins can change the cadence without a deploy and the new value
 * takes effect on the next check tick.
 */
async function routineCheck(): Promise<void> {
  if (isRunning) return;
  try {
    const tuning = await getTuning();
    const intervalMs = tuning.routineIntervalHours * 60 * 60 * 1000;
    const elapsed = lastRunAt ? Date.now() - lastRunAt.getTime() : Infinity;
    if (elapsed >= intervalMs) {
      await executeRun("routine");
    }
  } catch (err) {
    console.warn("[Agent] routineCheck failed (will retry next tick):", err);
  }
}

/**
 * Kill switch — read SCHEDULERS_DISABLED env var at startup.
 *
 * Format:
 *   SCHEDULERS_DISABLED=all       — disable every cron + every startup fire
 *   SCHEDULERS_DISABLED=macroEvent,autoEnrich,featuredCaseStudy
 *                                 — disable a comma-separated subset
 *   SCHEDULERS_DISABLED unset / "" — normal behavior (everything runs)
 *
 * Names (case-sensitive):
 *   routine, watchdog, rotation, worldScan, digest, botLoop,
 *   creditExpiry, peerBenchmarks, edgarRss, cviSignals, autoEnrich,
 *   mem0Prune, macroEvent, disruption, peerCoop, stackOptimizer,
 *   ontology, synthesis, temporalShift, memoryRelationSnapshot,
 *   featuredCaseStudy
 *
 * Applies to BOTH the setInterval cron AND the setTimeout startup fire.
 * No redeploy needed to toggle — update the Railway env var and the
 * service auto-redeploys; new boot picks up the change.
 */
function getDisabledSchedulers(): Set<string> {
  const raw = process.env.SCHEDULERS_DISABLED;
  if (!raw) return new Set<string>();
  if (raw.trim().toLowerCase() === "all") return new Set<string>(["__all__"]);
  return new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
}

function isSchedulerEnabled(name: string, disabled: Set<string>): boolean {
  if (disabled.has("__all__")) return false;
  return !disabled.has(name);
}

// Runtime gate — checks the DB-backed scheduler_kill_switches table.
// Wraps a tick callback so a cron can be toggled off from the admin UI
// without waiting for the next deploy. Failing open: if the DB lookup
// errors we let the tick run (the env var hammer is still in effect at
// boot if you need it off completely).
function withRuntimeGate(name: string, fn: () => Promise<void> | void): () => Promise<void> {
  return async () => {
    if (await isSchedulerDisabledRuntime(name)) return;
    await fn();
  };
}

export function startScheduler(): void {
  if (routineTimer) {
    console.log("[Agent] Autonomous monitoring already active");
    return;
  }

  const disabled = getDisabledSchedulers();
  if (disabled.size > 0) {
    const label = disabled.has("__all__") ? "all" : [...disabled].join(",");
    console.log(`[Agent] ⚠ SCHEDULERS_DISABLED=${label} — listed crons + startup fires will be SKIPPED`);
  }
  const sched = (name: string, start: () => void): void => {
    if (!isSchedulerEnabled(name, disabled)) {
      console.log(`[Agent] cron '${name}' DISABLED`);
      return;
    }
    start();
  };

  const checkMinutes = ROUTINE_CHECK_INTERVAL_MS / (60 * 1000);
  const watchdogMinutes = WATCHDOG_INTERVAL_MS / (60 * 1000);
  console.log(`[Agent] Autonomous monitoring started — routine cadence read from agent_tuning every ${checkMinutes}min, urgency watchdog every ${watchdogMinutes}min`);

  sched("routine",          () => { routineTimer        = setInterval(() => routineCheck(),                  ROUTINE_CHECK_INTERVAL_MS); });
  sched("watchdog",         () => { watchdogTimer       = setInterval(() => watchdogCheck(),                 WATCHDOG_INTERVAL_MS); });
  sched("rotation",         () => { rotationTimer       = setInterval(() => executeRotation("daily"),        ROTATION_INTERVAL_MS); });
  sched("worldScan",        () => { worldScanTimer      = setInterval(() => executeWorldScan("daily"),       WORLD_SCAN_INTERVAL_MS); });
  sched("digest",           () => { digestTimer         = setInterval(() => executeDigestSweep("routine"),   DIGEST_TICK_INTERVAL_MS); });
  sched("botLoop",          () => { botLoopTimer        = setInterval(() => botLoopTick(),                   BOT_LOOP_INTERVAL_MS); });
  sched("creditExpiry",     () => { creditExpiryTimer   = setInterval(() => creditExpiryTick(),              CREDIT_EXPIRY_INTERVAL_MS); });
  sched("regulationsWatch", () => { regulationsWatchTimer = setInterval(() => regulationsWatchTick(),        REGULATIONS_WATCH_INTERVAL_MS); });
  // Kick once 90s after boot so any freshly-deployed instance catches up
  // without waiting an hour. Background — does NOT block startup.
  sched("regulationsWatch", () => { setTimeout(() => regulationsWatchTick(), 90_000); });
  sched("watchlistEval",    () => { watchlistEvalTimer    = setInterval(() => watchlistEvalTick(),           WATCHLIST_EVAL_INTERVAL_MS); });
  sched("watchlistEval",    () => { setTimeout(() => watchlistEvalTick(), 120_000); });
  sched("peerBenchmarks",   () => { peerBenchmarksTimer = setInterval(() => peerBenchmarksTick(),            PEER_BENCHMARKS_INTERVAL_MS); });
  sched("edgarRss",         () => { edgarRssTimer       = setInterval(() => edgarRssTick(),                  EDGAR_RSS_INTERVAL_MS); });
  sched("cviSignals",       () => { cviSignalsTimer     = setInterval(() => cviSignalsTick(),                CVI_SIGNALS_INTERVAL_MS); });
  sched("autoEnrich",       () => { autoEnrichTimer     = setInterval(() => autoEnrichTick(),                AUTO_ENRICH_INTERVAL_MS); });
  // Kick once on boot so a recently-deployed instance picks up any backlog
  // without waiting an hour. Runs in the background — does NOT block startup.
  sched("autoEnrich",       () => { setTimeout(() => autoEnrichTick(), 60_000); });
  sched("externalSignals",  () => { externalSignalsTimer = setInterval(() => externalSignalsTick(),          EXTERNAL_SIGNALS_INTERVAL_MS); });
  // Boot kickoff: 8 min after start (after autoEnrich at 60s and others have
  // settled). Big upfront workload (one Perplexity call per stale cap × N
  // industries) but the ingester runs ≤3 concurrent and skips fresh caps,
  // so even a cold start finishes in minutes. Subsequent weekly fires are
  // mostly no-ops thanks to the 30-day staleness filter.
  sched("externalSignals",  () => { setTimeout(() => externalSignalsTick(), 8 * 60 * 1000); });
  sched("mem0Prune", () => {
    mem0PruneTimer = setInterval(() => {
      mem0Prune().catch(err => console.warn("[Agent] mem0Prune failed:", err instanceof Error ? err.message : err));
    }, MEM0_PRUNE_INTERVAL_MS);
  });
  // One-time best-effort: configure Mem0 Cloud with our custom_categories so
  // server-side fact extraction tags memories with our 11-string MemoryCategory
  // union instead of Mem0's defaults. Non-fatal if endpoint shape differs.
  configureMem0CustomCategories().catch(err =>
    console.warn("[Agent] Mem0 custom_categories config failed (non-fatal):", err instanceof Error ? err.message : err),
  );
  // (Weekly prompt optimizer removed — was the LangMem-equivalent learning
  // code the user explicitly rejected when Letta was restored. Letta's own
  // sleeptime + core_memory_replace pattern handles learning autonomously.)
  sched("macroEvent", () => {
    macroEventAgentTimer = setInterval(withRuntimeGate("macroEvent", () => {
      return runMacroEventAgent()
        .then(r => console.log(`[Agent] Macro-event agent: tools=${r.toolCallCount} duration=${r.durationMs}ms`))
        .catch(err => console.warn("[Agent] Macro-event agent failed:", err instanceof Error ? err.message : err));
    }), MACRO_EVENT_AGENT_INTERVAL_MS);
  });
  sched("disruption", () => {
    disruptionAgentTimer = setInterval(withRuntimeGate("disruption", () => {
      return runDisruptionAgent()
        .then(r => console.log(`[Agent] Disruption agent: tools=${r.toolCallCount} duration=${r.durationMs}ms`))
        .catch(err => console.warn("[Agent] Disruption agent failed:", err instanceof Error ? err.message : err));
    }), DISRUPTION_AGENT_INTERVAL_MS);
  });
  sched("peerCoop", () => {
    peerCoopAgentTimer = setInterval(withRuntimeGate("peerCoop", () => {
      return runPeerCoopAgent()
        .then(r => console.log(`[Agent] Peer-coop agent: tools=${r.toolCallCount} duration=${r.durationMs}ms`))
        .catch(err => console.warn("[Agent] Peer-coop agent failed:", err instanceof Error ? err.message : err));
    }), PEER_COOP_AGENT_INTERVAL_MS);
  });
  sched("stackOptimizer", () => {
    stackOptimizerAgentTimer = setInterval(withRuntimeGate("stackOptimizer", () => {
      return runStackOptimizerAgent()
        .then(r => console.log(`[Agent] Stack-optimizer agent: tools=${r.toolCallCount} duration=${r.durationMs}ms`))
        .catch(err => console.warn("[Agent] Stack-optimizer agent failed:", err instanceof Error ? err.message : err));
    }), STACK_OPTIMIZER_AGENT_INTERVAL_MS);
  });
  sched("ontology", () => {
    ontologyAgentTimer = setInterval(withRuntimeGate("ontology", () => {
      return runOntologyAgent()
        .then(r => console.log(`[Agent] Ontology agent: tools=${r.toolCallCount} duration=${r.durationMs}ms`))
        .catch(err => console.warn("[Agent] Ontology agent failed:", err instanceof Error ? err.message : err));
    }), ONTOLOGY_AGENT_INTERVAL_MS);
  });
  // Synthesis Agent — daily, staggered 5 minutes after startup so all
  // other agents have had a chance to publish their first digests.
  //
  // If , the daily run delegates to
  // the in-process synthesis-brief-composer wrapper whose payload publishes
  // the brief through the same NS.sharedKnowledge("synthesis_brief") path
  // that runSynthesisAgent uses. On null/error, falls back to the in-process
  // agent so the daily brief never goes missing.
  const runSynthesis = async (): Promise<{ source: "workflow" | "in-process"; duration: number; toolCallCount: number }> => {
    const start = Date.now();
    const workflowResult = await runSynthesisBriefComposer().catch(() => null);
    if (workflowResult && workflowResult.status !== "degraded") {
      return { source: "workflow", duration: Date.now() - start, toolCallCount: 0 };
    }
    const r = await runSynthesisAgent();
    return { source: "in-process", duration: r.durationMs, toolCallCount: r.toolCallCount };
  };
  sched("synthesis", () => {
    setTimeout(() => {
      runSynthesis()
        .then(r => console.log(`[Agent] Synthesis agent (startup, source=${r.source}): tools=${r.toolCallCount} duration=${r.duration}ms`))
        .catch(err => console.warn("[Agent] Synthesis agent failed:", err instanceof Error ? err.message : err));
    }, 300_000);
    synthesisAgentTimer = setInterval(() => {
      runSynthesis()
        .then(r => console.log(`[Agent] Synthesis agent (source=${r.source}): tools=${r.toolCallCount} duration=${r.duration}ms`))
        .catch(err => console.warn("[Agent] Synthesis agent failed:", err instanceof Error ? err.message : err));
    }, SYNTHESIS_AGENT_INTERVAL_MS);
  });
  emitAgentEvent({ type: "scheduler_started", intervalMinutes: ROUTINE_CHECK_INTERVAL_MS / 60000 });

  startConsolidator();
  startMarketplaceAutoArchive();

  // Featured-case-study scheduling + auto-rotation. 10-minute cadence is
  // fine — scheduled changes are minute-precision in the UI and rotation
  // intervals are measured in days. Cheap: one indexed SELECT per tick
  // unless work is actually due.
  sched("featuredCaseStudy", () => {
    featuredCaseStudyTimer = setInterval(withRuntimeGate("featuredCaseStudy", () => {
      return featuredCaseStudyTick()
        .then(r => {
          if (r.schedulesExecuted > 0 || r.schedulesFailed > 0 || r.rotated) {
            console.log(`[FeaturedCaseStudy] tick: executed=${r.schedulesExecuted} failed=${r.schedulesFailed} rotated=${r.rotated}`);
          }
        })
        .catch(err => console.warn("[FeaturedCaseStudy] tick failed:", err instanceof Error ? err.message : err));
    }), 10 * 60 * 1000);
  });
  // Make sure the kill-switch table exists so the admin UI can read/write
  // it on first deploy without 404'ing or empty-state. Idempotent.
  ensureKillSwitchTable().catch(err => console.warn("[Agent] ensureKillSwitchTable failed:", err instanceof Error ? err.message : err));

  // Push the latest economic_rules table content into the Letta block.
  // Slight delay so Letta init (in letta.ts module load) has time to
  // settle. Non-fatal on failure — rules remain authoritative in
  // Postgres regardless.
  setTimeout(() => {
    syncEconomicRulesToLetta()
      .then(ok => console.log(`[Agent] Economic rules → Letta block sync: ${ok ? "ok" : "skipped/failed"}`))
      .catch(err => console.warn("[Agent] economic-rules sync error:", err instanceof Error ? err.message : err));
    syncMarketContextToLetta()
      .then(ok => console.log(`[Agent] Market context → Letta block sync: ${ok ? "ok" : "skipped/failed"}`))
      .catch(err => console.warn("[Agent] market-context sync error:", err instanceof Error ? err.message : err));
    // Create the underlying LangMem-equivalent store tables if missing.
    // Idempotent — no-op when already set up. Non-fatal on failure: the
    // optimizer cron will simply throw on next fire if the store is down.
    ensureSharedStoreReady()
      .then(() => console.log("[Agent] Shared agent store (PostgresStore) ready"))
      .catch(err => console.warn("[Agent] Shared store setup failed (optimizer will be disabled):", err instanceof Error ? err.message : err));
  }, 15_000);

  sched("routine",        () => { executeRun("startup"); });
  sched("rotation",       () => { setTimeout(() => executeRotation("startup"), 30_000); });
  sched("digest",         () => { setTimeout(() => executeDigestSweep("startup"), 90_000); });
  sched("botLoop",        () => { setTimeout(() => botLoopTick(), 45_000); });
  sched("creditExpiry",   () => { setTimeout(() => creditExpiryTick(), 120_000); });
  sched("peerBenchmarks", () => { setTimeout(() => peerBenchmarksTick(), 180_000); });
  sched("edgarRss",       () => { setTimeout(() => edgarRssTick(), 240_000); });
  sched("cviSignals",     () => { setTimeout(() => cviSignalsTick(), 300_000); });
  // Foundry token expiry check: scheduler hook reserved. The
  // `foundryTokenExpiryCheck` helper that this block tried to call was never
  // implemented or imported — wiring it would require building the helper
  // against `system_secrets` + `ADMIN_NOTIFY_EMAIL` per CLAUDE.md's Foundry
  // token rotation contract. Removed so the api-server typechecks; re-add the
  // setInterval when the helper exists.
  // Temporal shift detection — every 6 hours.
  // Detects accelerating/reversing capability relationships by comparing
  // current graph weights against 30-day baselines. High-signal shifts are
  // written to Mem0 so all agents recall them in future cycles.
  const TEMPORAL_SHIFT_INTERVAL_MS = 6 * 60 * 60 * 1000;
  sched("temporalShift", () => {
    setTimeout(() => {
      detectTemporalShifts()
        .then(r => console.log(`[Agent] Temporal shifts: ${r.totalRelationsAnalyzed} analyzed, ${r.accelerating.length} accelerating, ${r.reversing.length} reversing`))
        .catch(err => console.warn("[Agent] Temporal shift detector failed:", err instanceof Error ? err.message : err));
    }, 120_000);
    temporalShiftTimer = setInterval(() => {
      detectTemporalShifts()
        .then(r => console.log(`[Agent] Temporal shifts: ${r.totalRelationsAnalyzed} analyzed, ${r.accelerating.length} accelerating, ${r.reversing.length} reversing`))
        .catch(err => console.warn("[Agent] Temporal shift detector failed:", err instanceof Error ? err.message : err));
    }, TEMPORAL_SHIFT_INTERVAL_MS);
  });
  // Memory-relation snapshot — daily. Idempotent per (relation_id, day).
  // Once 30+ days of history accumulate, the temporal-shift detector uses
  // these snapshots instead of the legacy fictional 0.1 baseline.
  const MEMORY_REL_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;
  sched("memoryRelationSnapshot", () => {
    setTimeout(() => {
      writeMemoryRelationSnapshots()
        .then(r => console.log(`[Agent] Memory-relation snapshots: ${r.written} written, ${r.skipped} skipped`))
        .catch(err => console.warn("[Agent] Memory-relation snapshot writer failed:", err instanceof Error ? err.message : err));
    }, 180_000);
    memoryRelationSnapshotTimer = setInterval(() => {
      writeMemoryRelationSnapshots()
        .then(r => console.log(`[Agent] Memory-relation snapshots: ${r.written} written, ${r.skipped} skipped`))
        .catch(err => console.warn("[Agent] Memory-relation snapshot writer failed:", err instanceof Error ? err.message : err));
    }, MEMORY_REL_SNAPSHOT_INTERVAL_MS);
  });
}

/**
 * Admin-triggered manual bot tick. Returns a summary so the admin UI can
 * show "fired tick: 2 actions, $0.04 spent" immediately rather than waiting
 * for the next hourly fire.
 */
export async function triggerBotTickNow(): Promise<{ ok: boolean; reason?: string }> {
  if (isBotTicking) return { ok: false, reason: "bot tick already in progress" };
  await botLoopTick();
  return { ok: true };
}

export function stopScheduler(): void {
  if (routineTimer) { clearInterval(routineTimer); routineTimer = null; }
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  if (rotationTimer) { clearInterval(rotationTimer); rotationTimer = null; }
  if (worldScanTimer) { clearInterval(worldScanTimer); worldScanTimer = null; }
  if (digestTimer) { clearInterval(digestTimer); digestTimer = null; }
  if (botLoopTimer) { clearInterval(botLoopTimer); botLoopTimer = null; }
  if (creditExpiryTimer) { clearInterval(creditExpiryTimer); creditExpiryTimer = null; }
  if (peerBenchmarksTimer) { clearInterval(peerBenchmarksTimer); peerBenchmarksTimer = null; }
  if (edgarRssTimer) { clearInterval(edgarRssTimer); edgarRssTimer = null; }
  if (cviSignalsTimer) { clearInterval(cviSignalsTimer); cviSignalsTimer = null; }
  if (autoEnrichTimer) { clearInterval(autoEnrichTimer); autoEnrichTimer = null; }
  if (externalSignalsTimer) { clearInterval(externalSignalsTimer); externalSignalsTimer = null; }
  if (mem0PruneTimer) { clearInterval(mem0PruneTimer); mem0PruneTimer = null; }
  // optimizerTimer removed with the optimizer module
  if (macroEventAgentTimer) { clearInterval(macroEventAgentTimer); macroEventAgentTimer = null; }
  if (disruptionAgentTimer) { clearInterval(disruptionAgentTimer); disruptionAgentTimer = null; }
  if (peerCoopAgentTimer) { clearInterval(peerCoopAgentTimer); peerCoopAgentTimer = null; }
  if (stackOptimizerAgentTimer) { clearInterval(stackOptimizerAgentTimer); stackOptimizerAgentTimer = null; }
  if (ontologyAgentTimer) { clearInterval(ontologyAgentTimer); ontologyAgentTimer = null; }
  if (synthesisAgentTimer) { clearInterval(synthesisAgentTimer); synthesisAgentTimer = null; }
  if (temporalShiftTimer) { clearInterval(temporalShiftTimer); temporalShiftTimer = null; }
  if (memoryRelationSnapshotTimer) { clearInterval(memoryRelationSnapshotTimer); memoryRelationSnapshotTimer = null; }
  stopConsolidator();
  stopMarketplaceAutoArchive();
  if (featuredCaseStudyTimer) { clearInterval(featuredCaseStudyTimer); featuredCaseStudyTimer = null; }
  console.log("[Agent] Autonomous monitoring stopped");
  emitAgentEvent({ type: "scheduler_stopped" });
}

/**
 * Sweep the digest_subscriptions table and send digests to anyone whose
 * lastSentAt is past their per-row frequency cutoff. The sweep is internally
 * idempotent — each row is filtered by its own frequency, so calling this
 * every 6h does not double-send. Guarded by isDigesting so a slow sweep
 * doesn't overlap with the next tick.
 */
async function executeDigestSweep(trigger: string): Promise<void> {
  if (isDigesting) {
    console.log("[Digest] Sweep already in progress, skipping tick");
    return;
  }
  isDigesting = true;
  try {
    const result = await runDigestSweep();
    lastDigestAt = new Date();
    lastDigestResult = { attempted: result.attempted, succeeded: result.succeeded, failed: result.failed };
    if (result.attempted > 0) {
      console.log(`[Digest] ${trigger} sweep: attempted=${result.attempted} succeeded=${result.succeeded} failed=${result.failed}`);
    }
  } catch (err) {
    console.error("[Digest] Sweep failed:", err);
  } finally {
    isDigesting = false;
  }
}

export async function triggerRotationNow(limit?: number, industryId?: number): Promise<{ attempted: number; succeeded: number; failed: number; capabilities: string[] }> {
  if (isRotating) throw new Error("Rotation already in progress");
  isRotating = true;
  try {
    const result = await rotateTriangulations(limit ?? ROTATION_BATCH_SIZE, industryId);
    lastRotationAt = new Date();
    lastRotationResult = { attempted: result.attempted, succeeded: result.succeeded, failed: result.failed };
    if (result.succeeded > 0) await computeCVI();
    return result;
  } finally {
    isRotating = false;
  }
}

export function getSchedulerStatus(): {
  active: boolean;
  isRunning: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  lastRunResult: Awaited<ReturnType<typeof runAgent>> | null;
  rotation: {
    isRotating: boolean;
    intervalHours: number;
    batchSize: number;
    lastRotationAt: string | null;
    lastRotationResult: { attempted: number; succeeded: number; failed: number } | null;
  };
  worldScan: {
    isScanning: boolean;
    intervalHours: number;
    lastScanAt: string | null;
    lastScanResult: { totalInserted: number; industryCount: number } | null;
  };
  digest: {
    isDigesting: boolean;
    intervalHours: number;
    lastDigestAt: string | null;
    lastDigestResult: { attempted: number; succeeded: number; failed: number } | null;
  };
} {
  return {
    active: routineTimer !== null,
    isRunning,
    // intervalMinutes here reports the check-tick frequency. The actual
    // routine cadence (what admins set in agent_tuning) is exposed via the
    // /admin/agent-tuning endpoint, not the status payload.
    intervalMinutes: ROUTINE_CHECK_INTERVAL_MS / 60000,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    lastRunResult,
    worldScan: {
      isScanning,
      intervalHours: WORLD_SCAN_INTERVAL_MS / (60 * 60 * 1000),
      lastScanAt: lastWorldScanAt?.toISOString() ?? null,
      lastScanResult: lastWorldScanResult,
    },
    rotation: {
      isRotating,
      intervalHours: ROTATION_INTERVAL_MS / (60 * 60 * 1000),
      batchSize: ROTATION_BATCH_SIZE,
      lastRotationAt: lastRotationAt?.toISOString() ?? null,
      lastRotationResult,
    },
    digest: {
      isDigesting,
      intervalHours: DIGEST_TICK_INTERVAL_MS / (60 * 60 * 1000),
      lastDigestAt: lastDigestAt?.toISOString() ?? null,
      lastDigestResult,
    },
  };
}

export async function executeScheduledRun(): Promise<Awaited<ReturnType<typeof runAgent>> | null> {
  return executeRun("routine");
}
