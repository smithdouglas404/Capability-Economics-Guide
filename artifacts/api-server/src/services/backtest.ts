import { db } from "@workspace/db";
import {
  historicalEventsTable,
  industriesTable,
  capabilitiesTable,
  type HistoricalEvent,
  type MacroEvent,
} from "@workspace/db";
import { asc, desc } from "drizzle-orm";
import { computeCEI } from "./cei-engine";

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

type Direction = "positive" | "negative" | "neutral";

interface SeedCap { name: string; expectedDirection: Direction; rationale?: string; }

function dirOfDelta(delta: number): Direction {
  if (delta > SHOCK_EPSILON) return "positive";
  if (delta < -SHOCK_EPSILON) return "negative";
  return "neutral";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
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
  predictedDirection: Direction;
  match: boolean;
  excluded: "not_found" | "below_epsilon" | null;
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
}

export interface BacktestSummary {
  events: EventResult[];
  aggregateMatched: number;
  aggregateScored: number;
  aggregateAccuracy: number;
  ranAt: string;
  notes: {
    timeAnchorCaveat: string;
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
export async function replayEvent(
  event: HistoricalEvent,
  baselineCapScores: Map<number, number>,
): Promise<EventResult> {
  const { injection, resolvedCaps } = await buildInjection(event);

  // No resolvable caps in this DB → emit a "not found" record per seed cap
  // and short-circuit (engine call would be a no-op anyway).
  if (!injection) {
    const capResults: CapResult[] = resolvedCaps.map((r) => ({
      capabilityId: null,
      capabilityName: r.capabilityName,
      industryName: r.industryName,
      expectedDirection: r.expectedDirection,
      rationale: r.rationale,
      baseline: null,
      predicted: null,
      predictedDelta: 0,
      predictedDirection: "neutral",
      match: false,
      excluded: "not_found",
    }));
    return {
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
    };
  }

  // ── Engine call with the event injected (T+1, peak shock). ───────────────
  const predicted = await computeCEI({
    persist: false,
    capturePerCap: true,
    additionalEvents: [injection],
  });
  const predictedCapScores = predicted.capScores ?? new Map<number, number>();

  let matched = 0;
  let scored = 0;
  let notFound = 0;
  const capResults: CapResult[] = [];

  for (const r of resolvedCaps) {
    if (r.capId == null) {
      notFound += 1;
      capResults.push({
        capabilityId: null,
        capabilityName: r.capabilityName,
        industryName: r.industryName,
        expectedDirection: r.expectedDirection,
        rationale: r.rationale,
        baseline: null,
        predicted: null,
        predictedDelta: 0,
        predictedDirection: "neutral",
        match: false,
        excluded: "not_found",
      });
      continue;
    }

    const baseline = baselineCapScores.get(r.capId);
    const post = predictedCapScores.get(r.capId);
    if (baseline == null || post == null) {
      // Engine ran but didn't surface this cap (no leaf data, no triangulation).
      // Skip rather than invent.
      notFound += 1;
      capResults.push({
        capabilityId: r.capId,
        capabilityName: r.capabilityName,
        industryName: r.industryName,
        expectedDirection: r.expectedDirection,
        rationale: r.rationale,
        baseline: null,
        predicted: null,
        predictedDelta: 0,
        predictedDirection: "neutral",
        match: false,
        excluded: "not_found",
      });
      continue;
    }

    const delta = post - baseline;
    const predictedDir = dirOfDelta(delta);

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
      baseline: Math.round(baseline * 10) / 10,
      predicted: Math.round(clamp(post, 0, 100) * 10) / 10,
      predictedDelta: Math.round(delta * 10) / 10,
      predictedDirection: predictedDir,
      match,
      excluded,
    });
  }

  return {
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
  const baselineCapScores = baseline.capScores ?? new Map<number, number>();

  const results: EventResult[] = [];
  let aggMatched = 0;
  let aggScored = 0;
  for (const e of events) {
    const r = await replayEvent(e, baselineCapScores);
    results.push(r);
    aggMatched += r.matched;
    aggScored += r.scored;
  }

  return {
    events: results,
    aggregateMatched: aggMatched,
    aggregateScored: aggScored,
    aggregateAccuracy: aggScored > 0 ? aggMatched / aggScored : 0,
    ranAt: new Date().toISOString(),
    notes: {
      timeAnchorCaveat:
        "T-1 baseline is the engine's current state without the event; T+1 is the same state with the event injected at peak shock. Per-capability score history is not retained, so this measures model propagation quality, not historical reconstruction.",
    },
  };
}

export async function listBacktestEvents(): Promise<HistoricalEvent[]> {
  return db
    .select()
    .from(historicalEventsTable)
    .orderBy(desc(historicalEventsTable.eventDate));
}
