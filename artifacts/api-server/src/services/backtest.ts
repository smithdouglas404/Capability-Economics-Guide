import { db } from "@workspace/db";
import {
  historicalEventsTable,
  industriesTable,
  capabilitiesTable,
  backtestRunsTable,
  type HistoricalEvent,
  type MacroEvent,
  type BacktestRun,
} from "@workspace/db";
import { asc, desc } from "drizzle-orm";
import { computeCEI, type CapPosterior } from "./cei-engine";

/**
 * Methodology tag stamped onto every persisted backtest run. Bump when the
 * harness's scoring math changes (epsilon, σ floor, Brier formulation) so
 * the trend chart can warn that older points used a different ruler.
 */
export const BACKTEST_METHODOLOGY_VERSION = "1.1";

/**
 * If the latest run's log-loss is more than this many absolute units worse
 * than the rolling average of prior runs, the trend UI flags a regression.
 * Calibrated against typical run-to-run noise observed during development.
 */
const LOG_LOSS_REGRESSION_DELTA = 0.05;
const REGRESSION_WINDOW = 5;

/**
 * CEI backtesting harness — replays curated historical events through the
 * **actual** CEI engine in dry-run mode (no persistence) and reports the
 * directional accuracy of each event's effect on the affected capabilities.
 *
 * How non-tautology is achieved:
 *
 * 1. The engine is invoked TWICE per replay: once with no event injected
 *    (baseline) and once with the historical event injected as an extra
 *    active macro_event. The predicted delta for each capability is the
 *    *engine-output* score difference, NOT a hand-derived sign. This
 *    flows through the real bayesian posterior, parent/child rollup,
 *    velocity smoothing, and economic-multiplier code paths.
 *
 * 2. The expected direction for each capability is stored separately on
 *    the historical_events row and is allowed to disagree with the
 *    event's `sentimentDirection`. This is critical: events like COVID
 *    are globally NEGATIVE but POSITIVE for telehealth, EU AI Act is a
 *    cost burden (NEGATIVE) but POSITIVE for AI-governance tooling. A
 *    naive engine that infers cap direction from event sentiment alone
 *    will MISS these — the harness is designed to surface that gap.
 *
 * 3. Dry-run mode is achieved by passing `persist: false` to `computeCEI`,
 *    which skips all writes to ceiSnapshots / ceiComponents. Replay never
 *    pollutes live state, so admins can re-run as often as they like.
 *
 * Time anchoring caveat: per-capability score history is not retained
 * (cei_components stores only current state), so the T-1 baseline is
 * "the engine's current state without the event," and T+1 is "the engine's
 * current state with the event applied at peak shock." The harness measures
 * MODEL PROPAGATION quality, not historical reconstruction accuracy. This
 * limitation is documented on the /backtest page so users see what the
 * number does and does not prove.
 */

const SHOCK_EPSILON = 0.5;
// Floor on per-cap σ used for probabilistic forecasts. The engine's posterior
// variance can collapse to a few units when many high-weight triangulation
// sources agree; without a floor the Gaussian forecast becomes overconfident
// (≈0/1 probabilities) and a single miss tanks log-loss. 1.0 ≈ 2× the
// directional epsilon and matches the engine's score-rounding granularity.
const FORECAST_SIGMA_FLOOR = 1.0;
// Numerical clip for log-loss to avoid -Infinity on a wrong-with-certainty.
const PROB_CLIP = 1e-6;

type Direction = "positive" | "negative" | "neutral";
const DIRECTIONS: Direction[] = ["positive", "negative", "neutral"];

interface SeedCap { name: string; expectedDirection: Direction; rationale?: string; }

function dirOfDelta(delta: number): Direction {
  if (delta > SHOCK_EPSILON) return "positive";
  if (delta < -SHOCK_EPSILON) return "negative";
  return "neutral";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Abramowitz & Stegun 7.1.26 — max abs error ≈ 1.5e-7. Sufficient for the
// reliability/Brier accounting here; we don't ship erf in stdlib Node.
function erf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}
function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Convert a Gaussian-distributed delta into a probability over the three
 * directional outcomes the engine can declare (positive/negative/neutral).
 *
 * Forecast: delta ~ N(meanDelta, σ²) where σ is the engine's posterior std
 * for the predicted (post-event) score, floored at FORECAST_SIGMA_FLOOR.
 * Decision boundary: |delta| < SHOCK_EPSILON ⇒ neutral. Probabilities sum
 * to 1 by construction; tiny rounding leftovers are absorbed into neutral.
 */
function distributionFromGaussian(meanDelta: number, sigma: number): Record<Direction, number> {
  const s = Math.max(FORECAST_SIGMA_FLOOR, sigma);
  const pPos = 1 - normalCdf((SHOCK_EPSILON - meanDelta) / s);
  const pNeg = normalCdf((-SHOCK_EPSILON - meanDelta) / s);
  const pNeu = Math.max(0, 1 - pPos - pNeg);
  // Renormalize for any numerical drift (e.g. negative pNeu rounding).
  const total = pPos + pNeg + pNeu;
  return {
    positive: pPos / total,
    negative: pNeg / total,
    neutral: pNeu / total,
  };
}

/** Multiclass Brier (Brier 1950): Σ (qᵢ − yᵢ)² over outcome classes. */
function brierScore(dist: Record<Direction, number>, actual: Direction): number {
  let sum = 0;
  for (const d of DIRECTIONS) {
    const y = d === actual ? 1 : 0;
    sum += (dist[d] - y) ** 2;
  }
  return sum;
}

/** Negative log-likelihood of the actual outcome under the forecast. */
function logLoss(dist: Record<Direction, number>, actual: Direction): number {
  const p = clamp(dist[actual], PROB_CLIP, 1 - PROB_CLIP);
  return -Math.log(p);
}

export interface ForecastDistribution {
  positive: number;
  negative: number;
  neutral: number;
}

export interface CapResult {
  capabilityId: number | null;
  capabilityName: string;
  industryName: string;
  expectedDirection: Direction;
  rationale: string | null;
  baseline: number | null;
  predicted: number | null;
  predictedDelta: number;
  predictedSigma: number | null;
  predictedDirection: Direction;
  /**
   * Probabilistic forecast over outcome direction, derived from the engine's
   * Gaussian posterior on the predicted score (σ floored at 1.0). null when
   * the engine produced no posterior for this cap (excluded from Brier/log-loss).
   */
  forecast: ForecastDistribution | null;
  /** Multiclass Brier score for this cap (lower is better, 0–2 range). */
  brier: number | null;
  /** Negative log-likelihood of expectedDirection under `forecast`. */
  logLoss: number | null;
  match: boolean;
  excluded: "not_found" | "below_epsilon" | null;
}

export interface ReliabilityBin {
  binLow: number;
  binHigh: number;
  meanConfidence: number; // mean of max(forecast) within bin
  accuracy: number;       // share of caps in bin where argmax(forecast) == expectedDirection
  count: number;
}

export interface ProbabilisticMetrics {
  /** Caps contributing to the probabilistic metrics (anyone with a forecast). */
  count: number;
  /** Mean multiclass Brier across `count` caps. */
  brier: number | null;
  /** Mean log-loss across `count` caps. */
  logLoss: number | null;
  /**
   * 10-bin reliability diagram: bin = max-class probability ∈ [0, 1].
   * Empty bins are omitted. Plotting meanConfidence vs accuracy yields the
   * familiar reliability curve (perfect = y=x).
   */
  reliability: ReliabilityBin[];
}

export interface EventResult {
  eventId: number;
  title: string;
  eventDate: string;
  eventType: string;
  severity: number;
  sentimentDirection: Direction;
  description: string;
  citations: string[];
  capResults: CapResult[];
  matched: number;
  scored: number;
  notFound: number;
  accuracy: number; // -1 if scored=0
  probabilistic: ProbabilisticMetrics;
}

export interface BacktestSummary {
  events: EventResult[];
  aggregateMatched: number;
  aggregateScored: number;
  aggregateAccuracy: number;
  /** Aggregate Brier/log-loss/reliability pooled across every cap result. */
  probabilistic: ProbabilisticMetrics;
  ranAt: string;
  methodologyVersion: string;
  notes: {
    timeAnchorCaveat: string;
    probabilistic: string;
  };
  /** Trend points for the last N persisted runs (oldest → newest). */
  history: BacktestHistoryPoint[];
  regression: BacktestRegression | null;
}

export interface BacktestHistoryPoint {
  id: number;
  ranAt: string;
  methodologyVersion: string;
  eventCount: number;
  aggregateMatched: number;
  aggregateScored: number;
  aggregateAccuracy: number;
  brier: number | null;
  logLoss: number | null;
  probabilisticCount: number;
}

export interface BacktestRegression {
  /** True when the latest run's log-loss is meaningfully worse than baseline. */
  triggered: boolean;
  latestLogLoss: number;
  baselineLogLoss: number;
  delta: number;
  threshold: number;
  windowSize: number;
}

/** Aggregate per-cap forecast/expected pairs into Brier, log-loss, and reliability. */
function computeProbabilisticMetrics(
  pairs: Array<{ forecast: ForecastDistribution; actual: Direction }>,
): ProbabilisticMetrics {
  if (pairs.length === 0) {
    return { count: 0, brier: null, logLoss: null, reliability: [] };
  }
  let brierSum = 0;
  let llSum = 0;
  // 10 fixed-width bins over the [0, 1] confidence range. Argmax on a
  // 3-class distribution can dip as low as 1/3, so the bottom bins will
  // typically be empty; that's fine — empty bins are dropped on output.
  const bins = Array.from({ length: 10 }, (_, i) => ({
    binLow: i / 10,
    binHigh: (i + 1) / 10,
    confSum: 0,
    accSum: 0,
    count: 0,
  }));
  for (const { forecast, actual } of pairs) {
    brierSum += brierScore(forecast, actual);
    llSum += logLoss(forecast, actual);
    let argmax: Direction = "neutral";
    let maxP = -Infinity;
    for (const d of DIRECTIONS) {
      if (forecast[d] > maxP) { maxP = forecast[d]; argmax = d; }
    }
    const idx = Math.min(9, Math.floor(maxP * 10));
    bins[idx].confSum += maxP;
    bins[idx].accSum += argmax === actual ? 1 : 0;
    bins[idx].count += 1;
  }
  const reliability: ReliabilityBin[] = bins
    .filter((b) => b.count > 0)
    .map((b) => ({
      binLow: b.binLow,
      binHigh: b.binHigh,
      meanConfidence: b.confSum / b.count,
      accuracy: b.accSum / b.count,
      count: b.count,
    }));
  return {
    count: pairs.length,
    brier: brierSum / pairs.length,
    logLoss: llSum / pairs.length,
    reliability,
  };
}

/**
 * Build a synthetic in-memory MacroEvent for engine injection. Resolves seed
 * capability NAMES to live capabilityIds (case-insensitive, scoped to the
 * named industries) so the engine's `expandAffectedCapabilityIds` can do its
 * normal parent/child propagation. Returns the resolved cap-name → capId map
 * so the harness can diff per-cap engine output afterwards.
 */
async function buildInjection(event: HistoricalEvent): Promise<{
  injection: MacroEvent | null;
  resolvedCaps: Array<{ capId: number | null; expectedDirection: Direction; capabilityName: string; industryName: string; rationale: string | null }>;
}> {
  const seedCaps = (event.affectedCapabilities ?? []) as SeedCap[];
  const industryNames = (event.affectedIndustryNames ?? []) as string[];

  if (seedCaps.length === 0) {
    return { injection: null, resolvedCaps: [] };
  }

  const industries = await db.select().from(industriesTable);
  const targetIndustryIds = new Set(
    industries
      .filter((i) => industryNames.some((n) => n.toLowerCase() === i.name.toLowerCase()))
      .map((i) => i.id),
  );
  const caps = await db.select().from(capabilitiesTable);
  const industryNameById = new Map(industries.map((i) => [i.id, i.name]));

  const resolved: Array<{
    capId: number | null;
    expectedDirection: Direction;
    capabilityName: string;
    industryName: string;
    rationale: string | null;
  }> = [];
  const allResolvedIds: number[] = [];

  for (const sc of seedCaps) {
    const wantedLower = sc.name.toLowerCase();
    const matches = caps.filter(
      (c) =>
        c.isLeaf &&
        c.name.toLowerCase() === wantedLower &&
        (targetIndustryIds.size === 0 || targetIndustryIds.has(c.industryId)),
    );

    if (matches.length === 0) {
      resolved.push({
        capId: null,
        expectedDirection: sc.expectedDirection,
        capabilityName: sc.name,
        industryName: industryNames[0] ?? "",
        rationale: sc.rationale ?? null,
      });
    } else {
      for (const m of matches) {
        resolved.push({
          capId: m.id,
          expectedDirection: sc.expectedDirection,
          capabilityName: m.name,
          industryName: industryNameById.get(m.industryId) ?? "",
          rationale: sc.rationale ?? null,
        });
        allResolvedIds.push(m.id);
      }
    }
  }

  if (allResolvedIds.length === 0) {
    return { injection: null, resolvedCaps: resolved };
  }

  // Build a synthetic MacroEvent the engine will treat as currently active
  // (peak shock). Negative id keeps it disjoint from real macro_events rows.
  const injection: MacroEvent = {
    id: -1,
    eventType: event.eventType,
    severity: event.severity,
    title: `[backtest] ${event.title}`,
    description: event.description,
    affectedIndustryIds: [],
    affectedCapabilityIds: allResolvedIds,
    sentimentDirection: event.sentimentDirection,
    startedAt: new Date(),
    decayDays: Math.max(event.decayDays, 1),
    source: "admin",
    citations: [],
    createdBy: "backtest-harness",
    createdAt: new Date(),
  };

  return { injection, resolvedCaps: resolved };
}

/**
 * Replay a single event against a pre-computed baseline engine snapshot.
 *
 * `baselineCapScores` MUST come from a `computeCEI({ persist: false,
 * capturePerCap: true })` run with no `additionalEvents` so the diff truly
 * isolates the event's impact through the engine pipeline.
 */
/**
 * Internal replay return shape: the public `EventResult` (with display-rounded
 * forecasts) plus the *unrounded* per-cap (forecast, actual) pairs so the
 * caller can pool them into aggregate Brier/log-loss/reliability without
 * re-introducing display-rounding drift.
 */
interface ReplayOutput {
  result: EventResult;
  probPairs: Array<{ forecast: ForecastDistribution; actual: Direction }>;
}

export async function replayEvent(
  event: HistoricalEvent,
  baselineCapScores: Map<number, CapPosterior>,
): Promise<ReplayOutput> {
  const { injection, resolvedCaps } = await buildInjection(event);

  const emptyCap = (
    capId: number | null,
    r: typeof resolvedCaps[number],
  ): CapResult => ({
    capabilityId: capId,
    capabilityName: r.capabilityName,
    industryName: r.industryName,
    expectedDirection: r.expectedDirection,
    rationale: r.rationale,
    baseline: null,
    predicted: null,
    predictedDelta: 0,
    predictedSigma: null,
    predictedDirection: "neutral",
    forecast: null,
    brier: null,
    logLoss: null,
    match: false,
    excluded: "not_found",
  });

  // No resolvable caps in this DB → emit a "not found" record per seed cap
  // and short-circuit (engine call would be a no-op anyway).
  if (!injection) {
    const capResults: CapResult[] = resolvedCaps.map((r) => emptyCap(null, r));
    return {
      result: {
        eventId: event.id,
        title: event.title,
        eventDate: event.eventDate.toISOString(),
        eventType: event.eventType,
        severity: event.severity,
        sentimentDirection: event.sentimentDirection as Direction,
        description: event.description,
        citations: (event.citations ?? []) as string[],
        capResults,
        matched: 0,
        scored: 0,
        notFound: capResults.length,
        accuracy: -1,
        probabilistic: computeProbabilisticMetrics([]),
      },
      probPairs: [],
    };
  }

  // ── Engine call with the event injected (T+1, peak shock). ───────────────
  const predicted = await computeCEI({
    persist: false,
    capturePerCap: true,
    additionalEvents: [injection],
  });
  const predictedCapScores = predicted.capScores ?? new Map<number, CapPosterior>();

  let matched = 0;
  let scored = 0;
  let notFound = 0;
  const capResults: CapResult[] = [];
  const probPairs: Array<{ forecast: ForecastDistribution; actual: Direction }> = [];

  for (const r of resolvedCaps) {
    if (r.capId == null) {
      notFound += 1;
      capResults.push(emptyCap(null, r));
      continue;
    }

    const baseline = baselineCapScores.get(r.capId);
    const post = predictedCapScores.get(r.capId);
    if (!baseline || !post) {
      notFound += 1;
      capResults.push(emptyCap(r.capId, r));
      continue;
    }

    const delta = post.score - baseline.score;
    const sigma = Math.sqrt(post.variance);
    const predictedDir = dirOfDelta(delta);

    // Probabilistic forecast: same posterior σ used for the directional call.
    // The expected (ground-truth) direction is what we score against.
    const forecast = distributionFromGaussian(delta, sigma);
    const cellBrier = brierScore(forecast, r.expectedDirection);
    const cellLL = logLoss(forecast, r.expectedDirection);
    probPairs.push({ forecast, actual: r.expectedDirection });

    let excluded: CapResult["excluded"] = null;
    let match = false;
    if (Math.abs(delta) < SHOCK_EPSILON) {
      excluded = "below_epsilon";
    } else {
      scored += 1;
      match = predictedDir === r.expectedDirection;
      if (match) matched += 1;
    }

    capResults.push({
      capabilityId: r.capId,
      capabilityName: r.capabilityName,
      industryName: r.industryName,
      expectedDirection: r.expectedDirection,
      rationale: r.rationale,
      baseline: Math.round(baseline.score * 10) / 10,
      predicted: Math.round(clamp(post.score, 0, 100) * 10) / 10,
      predictedDelta: Math.round(delta * 10) / 10,
      predictedSigma: Math.round(sigma * 100) / 100,
      predictedDirection: predictedDir,
      forecast: {
        positive: Math.round(forecast.positive * 1000) / 1000,
        negative: Math.round(forecast.negative * 1000) / 1000,
        neutral: Math.round(forecast.neutral * 1000) / 1000,
      },
      brier: Math.round(cellBrier * 1000) / 1000,
      logLoss: Math.round(cellLL * 1000) / 1000,
      match,
      excluded,
    });
  }

  return {
    result: {
      eventId: event.id,
      title: event.title,
      eventDate: event.eventDate.toISOString(),
      eventType: event.eventType,
      severity: event.severity,
      sentimentDirection: event.sentimentDirection as Direction,
      description: event.description,
      citations: (event.citations ?? []) as string[],
      capResults,
      matched,
      scored,
      notFound,
      accuracy: scored > 0 ? matched / scored : -1,
      // Per-event metrics use the unrounded probPairs computed below; per-cap
      // capResults carry the display-rounded forecast for the UI only.
      probabilistic: computeProbabilisticMetrics(probPairs),
    },
    probPairs,
  };
}

/**
 * Replay every seeded historical event and aggregate the hit rate. The
 * baseline engine run is computed ONCE and reused across all events, so the
 * total dry-run cost is N+1 engine invocations for N seeded events.
 */
export async function runBacktest(): Promise<BacktestSummary> {
  const events = await db
    .select()
    .from(historicalEventsTable)
    .orderBy(asc(historicalEventsTable.eventDate));

  // Single baseline engine pass — all event diffs are taken against this.
  const baseline = await computeCEI({ persist: false, capturePerCap: true });
  const baselineCapScores = baseline.capScores ?? new Map<number, CapPosterior>();

  const results: EventResult[] = [];
  let aggMatched = 0;
  let aggScored = 0;
  // Pool every per-cap forecast across events so the aggregate Brier/log-loss
  // and reliability diagram are computed on the full sample (not an average
  // of per-event averages, which would bias toward small-sample events).
  // Pull from `probPairs` (full precision) rather than the display-rounded
  // capResults forecast field, so aggregate metrics match per-event metrics.
  const aggPairs: Array<{ forecast: ForecastDistribution; actual: Direction }> = [];
  for (const e of events) {
    const { result, probPairs } = await replayEvent(e, baselineCapScores);
    results.push(result);
    aggMatched += result.matched;
    aggScored += result.scored;
    aggPairs.push(...probPairs);
  }

  const aggregateAccuracy = aggScored > 0 ? aggMatched / aggScored : 0;
  const probabilistic = computeProbabilisticMetrics(aggPairs);
  const ranAt = new Date();

  // Persist a trend row before we compose the response so the new run shows
  // up immediately in the history sparkline. Failures here are non-fatal —
  // the harness must still return its results to the caller.
  let persistedId: number | null = null;
  try {
    const inserted = await db
      .insert(backtestRunsTable)
      .values({
        ranAt,
        methodologyVersion: BACKTEST_METHODOLOGY_VERSION,
        eventCount: results.length,
        aggregateMatched: aggMatched,
        aggregateScored: aggScored,
        aggregateAccuracy,
        brier: probabilistic.brier,
        logLoss: probabilistic.logLoss,
        probabilisticCount: probabilistic.count,
      })
      .returning({ id: backtestRunsTable.id });
    persistedId = inserted[0]?.id ?? null;
  } catch (err) {
    console.error("[backtest] failed to persist run history:", err);
  }

  // History/regression are presentation extras — never fail the run if the
  // trend table is unavailable (e.g. unmigrated environments). Fall back to
  // an empty history + null regression so callers always get the core summary.
  let history: BacktestHistoryPoint[] = [];
  let regression: BacktestRegression | null = null;
  try {
    history = await listBacktestHistory(20);
    regression = detectRegression(history, persistedId);
  } catch (err) {
    console.error("[backtest] failed to load run history:", err);
  }

  return {
    events: results,
    aggregateMatched: aggMatched,
    aggregateScored: aggScored,
    aggregateAccuracy,
    probabilistic,
    ranAt: ranAt.toISOString(),
    methodologyVersion: BACKTEST_METHODOLOGY_VERSION,
    notes: {
      timeAnchorCaveat:
        "T-1 baseline is the engine's current state without the event; T+1 is the same state with the event injected at peak shock. Per-capability score history is not retained, so this measures model propagation quality, not historical reconstruction.",
      probabilistic:
        "Forecast distribution is derived from the engine's Gaussian posterior on the predicted score (σ floored at 1.0 to avoid spurious overconfidence when many high-weight triangulation sources agree). Brier is the multiclass form (Σ(qᵢ−yᵢ)²) over {positive, negative, neutral}; log-loss is −log(q[expected]) clipped at 1e-6. Reliability bins by max-class probability — argmax accuracy vs mean confidence per bin should track the y=x diagonal under perfect calibration.",
    },
    history,
    regression,
  };
}

/**
 * Return the last `limit` persisted backtest runs, oldest → newest, so the
 * UI can plot left-to-right time series without reversing in the browser.
 */
export async function listBacktestHistory(limit = 20): Promise<BacktestHistoryPoint[]> {
  const rows: BacktestRun[] = await db
    .select()
    .from(backtestRunsTable)
    .orderBy(desc(backtestRunsTable.ranAt))
    .limit(limit);
  return rows
    .slice()
    .reverse()
    .map((r) => ({
      id: r.id,
      ranAt: r.ranAt.toISOString(),
      methodologyVersion: r.methodologyVersion,
      eventCount: r.eventCount,
      aggregateMatched: r.aggregateMatched,
      aggregateScored: r.aggregateScored,
      aggregateAccuracy: r.aggregateAccuracy,
      brier: r.brier,
      logLoss: r.logLoss,
      probabilisticCount: r.probabilisticCount,
    }));
}

/**
 * Flag a regression when the just-persisted run's log-loss is more than
 * `LOG_LOSS_REGRESSION_DELTA` worse than the rolling average of the prior
 * `REGRESSION_WINDOW` runs (matched on methodology version so a v-bump
 * doesn't trigger a false positive). Returns null when there isn't enough
 * comparable history to make a call.
 */
function detectRegression(
  history: BacktestHistoryPoint[],
  latestId: number | null,
): BacktestRegression | null {
  if (latestId == null || history.length < 2) return null;
  const latest = history[history.length - 1];
  if (latest.id !== latestId || latest.logLoss == null) return null;
  const prior = history
    .slice(0, -1)
    .filter((p) => p.logLoss != null && p.methodologyVersion === latest.methodologyVersion)
    .slice(-REGRESSION_WINDOW);
  if (prior.length === 0) return null;
  const baseline = prior.reduce((s, p) => s + (p.logLoss ?? 0), 0) / prior.length;
  const delta = latest.logLoss - baseline;
  return {
    triggered: delta > LOG_LOSS_REGRESSION_DELTA,
    latestLogLoss: latest.logLoss,
    baselineLogLoss: baseline,
    delta,
    threshold: LOG_LOSS_REGRESSION_DELTA,
    windowSize: prior.length,
  };
}

export async function listBacktestEvents(): Promise<HistoricalEvent[]> {
  return db
    .select()
    .from(historicalEventsTable)
    .orderBy(desc(historicalEventsTable.eventDate));
}
