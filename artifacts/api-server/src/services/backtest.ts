import { db } from "@workspace/db";
import {
  historicalEventsTable,
  industriesTable,
  capabilitiesTable,
  ceiComponentsTable,
  type HistoricalEvent,
} from "@workspace/db";
import { asc, desc } from "drizzle-orm";

/**
 * CEI backtesting harness — replays curated historical events against the
 * live capability state and reports directional accuracy. Pure function:
 * never writes to ceiSnapshots / ceiComponents / macroEvents. The whole
 * point is to *audit* the model, not to mutate live state.
 *
 * Per-cap math mirrors the engine's macro-shock formula in cei-engine.ts:
 *   shock = severity × sign(sentimentDirection) × decayFactor
 * with decayFactor pinned to 1.0 — we measure peak impact at T+1, not the
 * decayed residual months later, so the test is comparable across events.
 */

const SHOCK_EPSILON = 0.5; // |delta| under this counts as "no movement"
const DECAY_AT_PEAK = 1.0;

function dirSign(d: string): number {
  if (d === "positive") return 1;
  if (d === "negative") return -1;
  return 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface CapResult {
  capabilityId: number | null;
  capabilityName: string;
  industryName: string;
  baseline: number | null;       // T-1 score (null if cap not in DB)
  predicted: number | null;      // T+1 score
  predictedDelta: number;        // signed
  predictedDirection: "positive" | "negative" | "neutral";
  expectedDirection: "positive" | "negative" | "neutral";
  match: boolean;                // counted in accuracy?
  excluded: "not_found" | "below_epsilon" | null; // why excluded if so
}

export interface EventResult {
  eventId: number;
  title: string;
  eventDate: string;
  eventType: string;
  severity: number;
  description: string;
  citations: string[];
  capResults: CapResult[];
  matched: number;
  scored: number;     // capResults that contributed to accuracy
  notFound: number;   // affected caps that don't exist in this DB
  accuracy: number;   // matched / scored, 0..1; -1 if scored=0
}

export interface BacktestSummary {
  events: EventResult[];
  aggregateMatched: number;
  aggregateScored: number;
  aggregateAccuracy: number; // 0..1, or 0 if nothing scored
  ranAt: string;
}

/**
 * Resolve seed event capability names into live (industryName, capabilityName, capId)
 * triples. We match by case-insensitive cap name within any of the named
 * industries, so seed naming variations don't silently drop predictions.
 */
async function resolveAffectedCaps(
  event: HistoricalEvent,
): Promise<Array<{ capId: number | null; capabilityName: string; industryName: string }>> {
  const industryNames = (event.affectedIndustryNames ?? []) as string[];
  const capabilityNames = (event.affectedCapabilityNames ?? []) as string[];
  if (capabilityNames.length === 0) return [];

  const industries = await db.select().from(industriesTable);
  const targetIndustryIds = new Set(
    industries
      .filter((i) => industryNames.some((n) => n.toLowerCase() === i.name.toLowerCase()))
      .map((i) => i.id),
  );

  const caps = await db.select().from(capabilitiesTable);
  const out: Array<{ capId: number | null; capabilityName: string; industryName: string }> = [];

  for (const wantedName of capabilityNames) {
    const wantedLower = wantedName.toLowerCase();
    const matches = caps.filter(
      (c) =>
        c.isLeaf &&
        c.name.toLowerCase() === wantedLower &&
        (targetIndustryIds.size === 0 || targetIndustryIds.has(c.industryId)),
    );
    if (matches.length === 0) {
      out.push({ capId: null, capabilityName: wantedName, industryName: industryNames[0] ?? "" });
      continue;
    }
    for (const m of matches) {
      const ind = industries.find((i) => i.id === m.industryId);
      out.push({ capId: m.id, capabilityName: m.name, industryName: ind?.name ?? "" });
    }
  }
  return out;
}

/** Replay a single event and produce per-cap + aggregate stats. */
export async function replayEvent(event: HistoricalEvent): Promise<EventResult> {
  const resolved = await resolveAffectedCaps(event);
  const componentRows = await db.select().from(ceiComponentsTable);
  const baselineByCap = new Map<number, number>();
  for (const c of componentRows) baselineByCap.set(c.capabilityId, c.consensusScore);

  const sign = dirSign(event.sentimentDirection);
  const expected = event.expectedDirection as "positive" | "negative" | "neutral";

  let matched = 0;
  let scored = 0;
  let notFound = 0;
  const capResults: CapResult[] = [];

  for (const r of resolved) {
    if (r.capId == null) {
      notFound += 1;
      capResults.push({
        capabilityId: null,
        capabilityName: r.capabilityName,
        industryName: r.industryName,
        baseline: null,
        predicted: null,
        predictedDelta: 0,
        predictedDirection: "neutral",
        expectedDirection: expected,
        match: false,
        excluded: "not_found",
      });
      continue;
    }

    const baseline =
      baselineByCap.get(r.capId) ??
      // Fall back to the capability's seeded benchmarkScore so brand-new DBs
      // (no CEI snapshot computed yet) still produce a meaningful baseline.
      (await db.select().from(capabilitiesTable))
        .find((c) => c.id === r.capId)?.benchmarkScore ?? 50;

    const predictedDelta = event.severity * sign * DECAY_AT_PEAK;
    const predicted = clamp(baseline + predictedDelta, 0, 100);
    const predictedDir: "positive" | "negative" | "neutral" =
      predictedDelta > SHOCK_EPSILON ? "positive" : predictedDelta < -SHOCK_EPSILON ? "negative" : "neutral";

    let excluded: CapResult["excluded"] = null;
    let match = false;
    if (Math.abs(predictedDelta) < SHOCK_EPSILON) {
      // Below epsilon: model declines to predict, so exclude from accuracy.
      excluded = "below_epsilon";
    } else {
      scored += 1;
      match = predictedDir === expected;
      if (match) matched += 1;
    }

    capResults.push({
      capabilityId: r.capId,
      capabilityName: r.capabilityName,
      industryName: r.industryName,
      baseline: Math.round(baseline * 10) / 10,
      predicted: Math.round(predicted * 10) / 10,
      predictedDelta: Math.round(predictedDelta * 10) / 10,
      predictedDirection: predictedDir,
      expectedDirection: expected,
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
    description: event.description,
    citations: (event.citations ?? []) as string[],
    capResults,
    matched,
    scored,
    notFound,
    accuracy: scored > 0 ? matched / scored : -1,
  };
}

/** Replay every seeded historical event and aggregate the hit rate. */
export async function runBacktest(): Promise<BacktestSummary> {
  const events = await db
    .select()
    .from(historicalEventsTable)
    .orderBy(asc(historicalEventsTable.eventDate));

  const results: EventResult[] = [];
  let aggMatched = 0;
  let aggScored = 0;
  for (const e of events) {
    const r = await replayEvent(e);
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
  };
}

export async function listBacktestEvents(): Promise<HistoricalEvent[]> {
  return db
    .select()
    .from(historicalEventsTable)
    .orderBy(desc(historicalEventsTable.eventDate));
}
