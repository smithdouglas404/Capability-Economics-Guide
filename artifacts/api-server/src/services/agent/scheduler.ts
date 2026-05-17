import { runAgent } from "./graph";
import { emitAgentEvent } from "./events";
import { startConsolidator, stopConsolidator } from "./consolidator";
import { syncEconomicRulesToLetta } from "./economic-rules-sync";
import { syncMarketContextToLetta } from "./market-context-sync";
import { mem0Prune } from "./memory";
import { ensureSharedStoreReady } from "./store";
import { runMacroEventAgent } from "../macro-event-agent";
import { runDisruptionAgent } from "../disruption-agent";
import { runPeerCoopAgent } from "../peer-coop-agent";
import { runStackOptimizerAgent } from "../stack-optimizer-agent";
import { runOntologyAgent } from "../ontology-agent";
import { rotateTriangulations } from "../triangulation";
import { computeCVI } from "../cvi-engine";
import { computeDVX } from "../dvx-engine";
import { runWorldScanAllIndustries } from "../macro-events";
import { startMarketplaceAutoArchive, stopMarketplaceAutoArchive } from "../marketplace-auto-archive";
import { runDigestSweep } from "../digest";
import { runDetailEnrichment } from "../alpha/enrich";
import { getTuning } from "../agent-tuning";
import { runAllBotsTick } from "../bots/loop";
import { runCreditExpirySweep } from "../credit-expiry";
import { rebuildPeerBenchmarks } from "../peer-benchmarks/aggregator";
import { runEdgarRssTick } from "../edgar/rss-watcher";
import { detectCviSignalEvents } from "../cvi-signals/detector";
import { attributeSignalOutcomes } from "../cvi-signals/attribution";
import { db } from "@workspace/db";
import { cviComponentsTable, cviSnapshotsTable } from "@workspace/db";
import { desc } from "drizzle-orm";

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
const ROTATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ROTATION_BATCH_SIZE = 10;
const URGENCY_BURST_SIZE = 3;
const WORLD_SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Digest sweep ticks every 6 hours; the sweep itself filters to subscriptions
// whose lastSentAt is past their frequency cutoff (weekly/daily). Six hours
// keeps daily-frequency subscribers within their 24h window even when the
// scheduler restarts overnight.
const DIGEST_TICK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const URGENCY_CONFIDENCE_THRESHOLD = 0.35;
const URGENCY_STALE_DAYS = 10;

let routineTimer: ReturnType<typeof setInterval> | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let rotationTimer: ReturnType<typeof setInterval> | null = null;
let worldScanTimer: ReturnType<typeof setInterval> | null = null;
let digestTimer: ReturnType<typeof setInterval> | null = null;
let botLoopTimer: ReturnType<typeof setInterval> | null = null;
let creditExpiryTimer: ReturnType<typeof setInterval> | null = null;
let peerBenchmarksTimer: ReturnType<typeof setInterval> | null = null;
let edgarRssTimer: ReturnType<typeof setInterval> | null = null;
let ceiSignalsTimer: ReturnType<typeof setInterval> | null = null;
let mem0PruneTimer: ReturnType<typeof setInterval> | null = null;
let macroEventAgentTimer: ReturnType<typeof setInterval> | null = null;
let disruptionAgentTimer: ReturnType<typeof setInterval> | null = null;
let peerCoopAgentTimer: ReturnType<typeof setInterval> | null = null;
let stackOptimizerAgentTimer: ReturnType<typeof setInterval> | null = null;
let ontologyAgentTimer: ReturnType<typeof setInterval> | null = null;
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
      emitAgentEvent({ type: "cei_updated", overallIndex: cei.overallIndex, message: `CVI recomputed after world scan: ${cei.overallIndex}` });
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
      emitAgentEvent({ type: "cei_updated", overallIndex: cei.overallIndex, message: `CVI recomputed after rotation: ${cei.overallIndex}` });
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
async function ceiSignalsTick(): Promise<void> {
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
    console.warn("[CeiSignals] detection / attribution failed:", err);
  } finally {
    isDetectingSignals = false;
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

export function startScheduler(): void {
  if (routineTimer) {
    console.log("[Agent] Autonomous monitoring already active");
    return;
  }

  const checkMinutes = ROUTINE_CHECK_INTERVAL_MS / (60 * 1000);
  const watchdogMinutes = WATCHDOG_INTERVAL_MS / (60 * 1000);
  console.log(`[Agent] Autonomous monitoring started — routine cadence read from agent_tuning every ${checkMinutes}min, urgency watchdog every ${watchdogMinutes}min`);

  routineTimer = setInterval(() => routineCheck(), ROUTINE_CHECK_INTERVAL_MS);
  watchdogTimer = setInterval(() => watchdogCheck(), WATCHDOG_INTERVAL_MS);
  rotationTimer = setInterval(() => executeRotation("daily"), ROTATION_INTERVAL_MS);
  worldScanTimer = setInterval(() => executeWorldScan("daily"), WORLD_SCAN_INTERVAL_MS);
  digestTimer = setInterval(() => executeDigestSweep("routine"), DIGEST_TICK_INTERVAL_MS);
  botLoopTimer = setInterval(() => botLoopTick(), BOT_LOOP_INTERVAL_MS);
  creditExpiryTimer = setInterval(() => creditExpiryTick(), CREDIT_EXPIRY_INTERVAL_MS);
  peerBenchmarksTimer = setInterval(() => peerBenchmarksTick(), PEER_BENCHMARKS_INTERVAL_MS);
  edgarRssTimer = setInterval(() => edgarRssTick(), EDGAR_RSS_INTERVAL_MS);
  ceiSignalsTimer = setInterval(() => ceiSignalsTick(), CVI_SIGNALS_INTERVAL_MS);
  mem0PruneTimer = setInterval(() => {
    mem0Prune().catch(err => console.warn("[Agent] mem0Prune failed:", err instanceof Error ? err.message : err));
  }, MEM0_PRUNE_INTERVAL_MS);
  // (Weekly prompt optimizer removed — was the LangMem-equivalent learning
  // code the user explicitly rejected when Letta was restored. Letta's own
  // sleeptime + core_memory_replace pattern handles learning autonomously.)
  macroEventAgentTimer = setInterval(() => {
    runMacroEventAgent()
      .then(r => console.log(`[Agent] Macro-event agent: tools=${r.toolCallCount} duration=${r.durationMs}ms`))
      .catch(err => console.warn("[Agent] Macro-event agent failed:", err instanceof Error ? err.message : err));
  }, MACRO_EVENT_AGENT_INTERVAL_MS);
  disruptionAgentTimer = setInterval(() => {
    runDisruptionAgent()
      .then(r => console.log(`[Agent] Disruption agent: tools=${r.toolCallCount} duration=${r.durationMs}ms`))
      .catch(err => console.warn("[Agent] Disruption agent failed:", err instanceof Error ? err.message : err));
  }, DISRUPTION_AGENT_INTERVAL_MS);
  peerCoopAgentTimer = setInterval(() => {
    runPeerCoopAgent()
      .then(r => console.log(`[Agent] Peer-coop agent: tools=${r.toolCallCount} duration=${r.durationMs}ms`))
      .catch(err => console.warn("[Agent] Peer-coop agent failed:", err instanceof Error ? err.message : err));
  }, PEER_COOP_AGENT_INTERVAL_MS);
  stackOptimizerAgentTimer = setInterval(() => {
    runStackOptimizerAgent()
      .then(r => console.log(`[Agent] Stack-optimizer agent: tools=${r.toolCallCount} duration=${r.durationMs}ms`))
      .catch(err => console.warn("[Agent] Stack-optimizer agent failed:", err instanceof Error ? err.message : err));
  }, STACK_OPTIMIZER_AGENT_INTERVAL_MS);
  ontologyAgentTimer = setInterval(() => {
    runOntologyAgent()
      .then(r => console.log(`[Agent] Ontology agent: tools=${r.toolCallCount} duration=${r.durationMs}ms`))
      .catch(err => console.warn("[Agent] Ontology agent failed:", err instanceof Error ? err.message : err));
  }, ONTOLOGY_AGENT_INTERVAL_MS);

  emitAgentEvent({ type: "scheduler_started", intervalMinutes: ROUTINE_CHECK_INTERVAL_MS / 60000 });

  startConsolidator();
  startMarketplaceAutoArchive();

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

  executeRun("startup");

  setTimeout(() => executeRotation("startup"), 30_000);
  // Run the digest sweep once at startup but staggered so we don't pile up
  // outbound mail in the first minute after deploy.
  setTimeout(() => executeDigestSweep("startup"), 90_000);
  // Fire one bot tick shortly after boot so a freshly-provisioned bot
  // doesn't have to wait an hour to take its first action.
  setTimeout(() => botLoopTick(), 45_000);
  // Run credit expiry once at startup (staggered) so post-deploy any newly-
  // arrived expirations get processed without waiting 24h.
  setTimeout(() => creditExpiryTick(), 120_000);
  // Same for peer-benchmarks aggregator — staggered 3 min post-boot so it
  // doesn't compete with the bot tick and credit expiry for resources.
  setTimeout(() => peerBenchmarksTick(), 180_000);
  // EDGAR RSS first fire staggered 4 min so it doesn't pile on top of the
  // other startup tasks; subsequent runs hit the 15-min interval.
  setTimeout(() => edgarRssTick(), 240_000);
  // CVI signals detector — 5 min stagger, then daily.
  setTimeout(() => ceiSignalsTick(), 300_000);
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
  if (ceiSignalsTimer) { clearInterval(ceiSignalsTimer); ceiSignalsTimer = null; }
  if (mem0PruneTimer) { clearInterval(mem0PruneTimer); mem0PruneTimer = null; }
  // optimizerTimer removed with the optimizer module
  if (macroEventAgentTimer) { clearInterval(macroEventAgentTimer); macroEventAgentTimer = null; }
  if (disruptionAgentTimer) { clearInterval(disruptionAgentTimer); disruptionAgentTimer = null; }
  if (peerCoopAgentTimer) { clearInterval(peerCoopAgentTimer); peerCoopAgentTimer = null; }
  if (stackOptimizerAgentTimer) { clearInterval(stackOptimizerAgentTimer); stackOptimizerAgentTimer = null; }
  if (ontologyAgentTimer) { clearInterval(ontologyAgentTimer); ontologyAgentTimer = null; }
  stopConsolidator();
  stopMarketplaceAutoArchive();
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
