/**
 * Forward-looking capability disruption probability.
 *
 * Rules-based scorer combining six signals into a 0–1 probability that the
 * capability will be materially disrupted in the next 12–24 months. The model
 * is intentionally simple and explainable — every factor's contribution is
 * surfaced in the response so an analyst can argue with each weight.
 *
 * Signals:
 *  - lifecycle stage         (emerging/decaying = high risk; mature/adopted = low)
 *  - velocity magnitude      (fast change in either direction = volatility risk)
 *  - confidence              (low Bayesian confidence = scoring uncertainty)
 *  - macro event exposure    (recent events touching this cap or its deps)
 *  - source freshness        (stale evidence = blind spot risk)
 *  - innovation pressure     (VC capital + startup count = incumbent threat)
 *
 * Each factor returns a [0, 1] sub-score; final probability is the weighted
 * average. Weights live in WEIGHTS and are designed to sum to 1.
 */
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  ceiComponentsTable,
  sourceTriangulationsTable,
  capabilityDependenciesTable,
  macroEventsTable,
} from "@workspace/db";
import { eq, inArray, gte, sql } from "drizzle-orm";
import { deriveLifecycleStage } from "./lifecycle";

export interface DisruptionFactor {
  name: string;
  value: number;          // raw signal value
  subScore: number;       // normalized 0–1
  weight: number;
  rationale: string;
}

export interface DisruptionRisk {
  capabilityId: number;
  capabilityName: string;
  probability: number;       // 0–1
  band: "low" | "moderate" | "high" | "critical";
  lifecycleStage: string;
  factors: DisruptionFactor[];
  topDrivers: string[];      // human-readable top 2 drivers
  computedAt: string;
}

const WEIGHTS = {
  lifecycle: 0.22,
  velocity: 0.18,
  confidence: 0.12,
  macro: 0.20,
  freshness: 0.10,
  innovation: 0.18,
};

const LIFECYCLE_SCORE: Record<string, number> = {
  emerging: 0.85,
  decaying: 0.85,
  obsolete: 0.95,
  adopted: 0.40,
  mature: 0.30,
};

function band(p: number): DisruptionRisk["band"] {
  if (p >= 0.75) return "critical";
  if (p >= 0.55) return "high";
  if (p >= 0.35) return "moderate";
  return "low";
}

interface ComputeArgs {
  capability: typeof capabilitiesTable.$inferSelect;
  comp: typeof ceiComponentsTable.$inferSelect | undefined;
  latestSourceQueriedAt: Date | null;
  macroEventCount: number;
  macroSeveritySum: number;
}

function computeFactors(args: ComputeArgs): DisruptionFactor[] {
  const { capability, comp, latestSourceQueriedAt, macroEventCount, macroSeveritySum } = args;

  const lifecycleStage = deriveLifecycleStage({
    consensusScore: comp?.consensusScore ?? null,
    velocity: comp?.velocity ?? null,
    benchmarkScore: capability.benchmarkScore,
  });

  const velocity = comp?.velocity ?? 0;
  const velocityMagnitude = Math.min(1, Math.abs(velocity) / 5); // 5 pts/window = saturated

  const confidence = comp?.confidence ?? 0.5;
  const lowConfidenceRisk = 1 - Math.max(0, Math.min(1, confidence));

  const macroExposure = Math.min(1, (macroEventCount * 0.15) + (macroSeveritySum / 30));

  let freshnessRisk = 0.5;
  if (latestSourceQueriedAt) {
    const ageDays = (Date.now() - latestSourceQueriedAt.getTime()) / (24 * 60 * 60 * 1000);
    freshnessRisk = Math.min(1, ageDays / 180); // stale at 6mo, half-stale at 3mo
  } else {
    freshnessRisk = 0.7; // no evidence at all is treated as elevated risk
  }

  // Innovation pressure: high VC + many startups in this cap = market is
  // pouring effort into displacing incumbents. Saturates so a huge number
  // doesn't dominate.
  const vcBillions = (capability.vcCapitalUsd ?? 0) / 1e9;
  const innovationSignal = Math.min(1, (vcBillions / 20) + (capability.startupCount / 50));

  return [
    {
      name: "Lifecycle stage",
      value: LIFECYCLE_SCORE[lifecycleStage] ?? 0.5,
      subScore: LIFECYCLE_SCORE[lifecycleStage] ?? 0.5,
      weight: WEIGHTS.lifecycle,
      rationale: `${lifecycleStage}: ${lifecycleStage === "emerging" || lifecycleStage === "decaying" || lifecycleStage === "obsolete" ? "elevated structural risk" : "stable phase"}`,
    },
    {
      name: "Velocity magnitude",
      value: Math.abs(velocity),
      subScore: velocityMagnitude,
      weight: WEIGHTS.velocity,
      rationale: `|velocity| = ${Math.abs(velocity).toFixed(2)} pts/window`,
    },
    {
      name: "Score uncertainty",
      value: confidence,
      subScore: lowConfidenceRisk,
      weight: WEIGHTS.confidence,
      rationale: `confidence = ${confidence.toFixed(2)} (lower = more disruption uncertainty)`,
    },
    {
      name: "Macro event exposure",
      value: macroEventCount,
      subScore: macroExposure,
      weight: WEIGHTS.macro,
      rationale: `${macroEventCount} active events, severity sum ${macroSeveritySum.toFixed(1)}`,
    },
    {
      name: "Evidence freshness",
      value: latestSourceQueriedAt ? (Date.now() - latestSourceQueriedAt.getTime()) / (24 * 60 * 60 * 1000) : -1,
      subScore: freshnessRisk,
      weight: WEIGHTS.freshness,
      rationale: latestSourceQueriedAt
        ? `last triangulated ${Math.round((Date.now() - latestSourceQueriedAt.getTime()) / (24 * 60 * 60 * 1000))}d ago`
        : "no triangulations on file",
    },
    {
      name: "Innovation pressure",
      value: vcBillions,
      subScore: innovationSignal,
      weight: WEIGHTS.innovation,
      rationale: `$${vcBillions.toFixed(1)}B VC, ${capability.startupCount} startups`,
    },
  ];
}

function rollUpProbability(factors: DisruptionFactor[]): number {
  let weighted = 0;
  let weightSum = 0;
  for (const f of factors) {
    weighted += f.subScore * f.weight;
    weightSum += f.weight;
  }
  return weightSum > 0 ? Math.round((weighted / weightSum) * 10000) / 10000 : 0;
}

export async function computeDisruptionRisk(capabilityId: number): Promise<DisruptionRisk | null> {
  const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, capabilityId));
  if (!cap) return null;
  const [comp] = await db.select().from(ceiComponentsTable).where(eq(ceiComponentsTable.capabilityId, capabilityId));

  const triRows = await db
    .select({ queriedAt: sourceTriangulationsTable.queriedAt })
    .from(sourceTriangulationsTable)
    .where(eq(sourceTriangulationsTable.capabilityId, capabilityId));
  const latestSourceQueriedAt = triRows.length > 0
    ? triRows.reduce((a, b) => a.queriedAt > b.queriedAt ? a : b).queriedAt
    : null;

  // Macro events affecting this cap or any dependency, started in last 90 days.
  const deps = await db
    .select({ id: capabilityDependenciesTable.dependsOnId })
    .from(capabilityDependenciesTable)
    .where(eq(capabilityDependenciesTable.capabilityId, capabilityId));
  const interestingIds = [capabilityId, ...deps.map(d => d.id)];
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const macroRows = await db
    .select({ severity: macroEventsTable.severity, affected: macroEventsTable.affectedCapabilityIds })
    .from(macroEventsTable)
    .where(gte(macroEventsTable.startedAt, since));
  const macroAffecting = macroRows.filter(m => {
    const aff = (m.affected ?? []) as number[];
    return interestingIds.some(id => aff.includes(id));
  });

  const factors = computeFactors({
    capability: cap,
    comp,
    latestSourceQueriedAt,
    macroEventCount: macroAffecting.length,
    macroSeveritySum: macroAffecting.reduce((s, m) => s + m.severity, 0),
  });

  const probability = rollUpProbability(factors);
  const topDrivers = [...factors]
    .sort((a, b) => (b.subScore * b.weight) - (a.subScore * a.weight))
    .slice(0, 2)
    .map(f => f.name);

  const lifecycleStage = deriveLifecycleStage({
    consensusScore: comp?.consensusScore ?? null,
    velocity: comp?.velocity ?? null,
    benchmarkScore: cap.benchmarkScore,
  });

  return {
    capabilityId,
    capabilityName: cap.name,
    probability,
    band: band(probability),
    lifecycleStage,
    factors,
    topDrivers,
    computedAt: new Date().toISOString(),
  };
}

export interface DisruptionRanking {
  generatedAt: string;
  ttlSeconds: number;
  rows: Array<{
    capabilityId: number;
    capabilityName: string;
    industryId: number;
    industryName: string;
    probability: number;
    band: DisruptionRisk["band"];
    topDrivers: string[];
    lifecycleStage: string;
  }>;
}

const RANKING_TTL_MS = 10 * 60 * 1000;
let rankingCache: { at: number; value: DisruptionRanking } | null = null;
let rankingInFlight: Promise<DisruptionRanking> | null = null;

async function computeRanking(): Promise<DisruptionRanking> {
  const caps = await db.select().from(capabilitiesTable);
  const components = await db.select().from(ceiComponentsTable);
  const compByCap = new Map(components.map(c => [c.capabilityId, c]));

  // Pull all triangulations once, build latest-per-cap map.
  const triRows = await db.select({
    capabilityId: sourceTriangulationsTable.capabilityId,
    queriedAt: sourceTriangulationsTable.queriedAt,
  }).from(sourceTriangulationsTable);
  const latestByCap = new Map<number, Date>();
  for (const t of triRows) {
    const prev = latestByCap.get(t.capabilityId);
    if (!prev || t.queriedAt > prev) latestByCap.set(t.capabilityId, t.queriedAt);
  }

  // All deps in one shot.
  const allDeps = await db.select().from(capabilityDependenciesTable);
  const depsByCap = new Map<number, number[]>();
  for (const d of allDeps) {
    const arr = depsByCap.get(d.capabilityId) ?? [];
    arr.push(d.dependsOnId);
    depsByCap.set(d.capabilityId, arr);
  }

  // Recent macro events.
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const macroRows = await db
    .select({ severity: macroEventsTable.severity, affected: macroEventsTable.affectedCapabilityIds })
    .from(macroEventsTable)
    .where(gte(macroEventsTable.startedAt, since));

  // Pull industry names in one batch.
  const indNameQuery = caps.length > 0 ? await db
    .select()
    .from(macroEventsTable) // dummy join via SQL.join would be heavier — just hit industries directly:
    .where(sql`false`) // ignore
    : [];
  // Simpler: query industries table.
  const { industriesTable: indTable } = await import("@workspace/db");
  const industries = await db.select().from(indTable);
  const indNameById = new Map(industries.map(i => [i.id, i.name]));
  void indNameQuery; // silence linter

  const rows: DisruptionRanking["rows"] = [];
  for (const cap of caps) {
    const comp = compByCap.get(cap.id);
    const latest = latestByCap.get(cap.id) ?? null;
    const interestingIds = [cap.id, ...(depsByCap.get(cap.id) ?? [])];
    const interestingSet = new Set(interestingIds);
    let macroEventCount = 0;
    let macroSeveritySum = 0;
    for (const m of macroRows) {
      const aff = (m.affected ?? []) as number[];
      if (aff.some(id => interestingSet.has(id))) {
        macroEventCount += 1;
        macroSeveritySum += m.severity;
      }
    }
    const factors = computeFactors({
      capability: cap,
      comp,
      latestSourceQueriedAt: latest,
      macroEventCount,
      macroSeveritySum,
    });
    const probability = rollUpProbability(factors);
    const topDrivers = [...factors]
      .sort((a, b) => (b.subScore * b.weight) - (a.subScore * a.weight))
      .slice(0, 2)
      .map(f => f.name);
    rows.push({
      capabilityId: cap.id,
      capabilityName: cap.name,
      industryId: cap.industryId,
      industryName: indNameById.get(cap.industryId) ?? "Unknown",
      probability,
      band: band(probability),
      topDrivers,
      lifecycleStage: deriveLifecycleStage({
        consensusScore: comp?.consensusScore ?? null,
        velocity: comp?.velocity ?? null,
        benchmarkScore: cap.benchmarkScore,
      }),
    });
  }
  rows.sort((a, b) => b.probability - a.probability);

  return {
    generatedAt: new Date().toISOString(),
    ttlSeconds: RANKING_TTL_MS / 1000,
    rows,
  };
}

export async function getDisruptionRanking(force = false): Promise<DisruptionRanking> {
  if (!force && rankingCache && Date.now() - rankingCache.at < RANKING_TTL_MS) return rankingCache.value;
  if (rankingInFlight) return rankingInFlight;
  rankingInFlight = computeRanking()
    .then(value => {
      rankingCache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      rankingInFlight = null;
    });
  return rankingInFlight;
}

export function _resetDisruptionCacheForTest(): void {
  rankingCache = null;
  rankingInFlight = null;
}

// ─── Disruption Watch — filtered feed of capabilities CURRENTLY disrupting ───
//
// Surfaces caps where: probability band ≥ "high", velocity > +1.5 (rising
// fast), macro events touching the cap, and cap age < AGE_LIMIT_MONTHS.
// This is what gets pinned to the home page + dedicated /disruption surface.

export interface DisruptionWatchEntry {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  probability: number;
  band: DisruptionRisk["band"];
  velocity: number | null;
  consensusScore: number | null;
  lifecycleStage: string;
  topDrivers: string[];
  ageMonths: number;
  macroEventCount: number;
  vcCapitalUsd: number;
  startupCount: number;
}

export interface DisruptionWatchResult {
  generatedAt: string;
  ttlSeconds: number;
  rows: DisruptionWatchEntry[];
  filters: {
    minBand: DisruptionRisk["band"];
    minVelocity: number;
    requireMacroEvent: boolean;
    maxAgeMonths: number;
  };
}

const WATCH_CACHE_TTL_MS = 10 * 60 * 1000;
let watchCache: { at: number; value: DisruptionWatchResult } | null = null;

export async function getDisruptionWatch(opts?: {
  minBand?: DisruptionRisk["band"];
  minVelocity?: number;
  requireMacroEvent?: boolean;
  maxAgeMonths?: number;
  limit?: number;
}): Promise<DisruptionWatchResult> {
  const minBand: DisruptionRisk["band"] = opts?.minBand ?? "high";
  const minVelocity = opts?.minVelocity ?? 1.5;
  const requireMacroEvent = opts?.requireMacroEvent ?? true;
  const maxAgeMonths = opts?.maxAgeMonths ?? 36;
  const limit = opts?.limit ?? 25;

  if (
    !opts &&
    watchCache &&
    Date.now() - watchCache.at < WATCH_CACHE_TTL_MS
  ) {
    return watchCache.value;
  }

  // Reuse ranking (cached); rebuild hydrated rows with velocity + age + macro count.
  const ranking = await getDisruptionRanking();
  const bandRank: Record<DisruptionRisk["band"], number> = { low: 0, moderate: 1, high: 2, critical: 3 };
  const minBandRank = bandRank[minBand];

  // Hydrate with capability data + cei components + macro counts.
  const candidateIds = ranking.rows.filter(r => bandRank[r.band] >= minBandRank).map(r => r.capabilityId);
  if (candidateIds.length === 0) {
    const empty: DisruptionWatchResult = {
      generatedAt: new Date().toISOString(),
      ttlSeconds: WATCH_CACHE_TTL_MS / 1000,
      rows: [],
      filters: { minBand, minVelocity, requireMacroEvent, maxAgeMonths },
    };
    return empty;
  }
  const [caps, comps] = await Promise.all([
    db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, candidateIds)),
    db.select().from(ceiComponentsTable).where(inArray(ceiComponentsTable.capabilityId, candidateIds)),
  ]);
  const capById = new Map(caps.map(c => [c.id, c]));
  const compById = new Map(comps.map(c => [c.capabilityId, c]));

  // Per-cap macro event count over the last 90d (touching the cap directly).
  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const macroRows = await db
    .select({ affected: macroEventsTable.affectedCapabilityIds })
    .from(macroEventsTable)
    .where(gte(macroEventsTable.startedAt, since90));
  const macroCountByCap = new Map<number, number>();
  for (const m of macroRows) {
    const aff = (m.affected ?? []) as number[];
    for (const id of aff) macroCountByCap.set(id, (macroCountByCap.get(id) ?? 0) + 1);
  }

  const now = Date.now();
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

  const rows: DisruptionWatchEntry[] = ranking.rows
    .filter(r => bandRank[r.band] >= minBandRank)
    .map(r => {
      const cap = capById.get(r.capabilityId);
      const comp = compById.get(r.capabilityId);
      const ageMonths = cap ? (now - cap.createdAt.getTime()) / MONTH_MS : 0;
      return {
        capabilityId: r.capabilityId,
        capabilityName: r.capabilityName,
        industryId: r.industryId,
        industryName: r.industryName,
        probability: r.probability,
        band: r.band,
        velocity: comp?.velocity ?? null,
        consensusScore: comp?.consensusScore ?? null,
        lifecycleStage: r.lifecycleStage,
        topDrivers: r.topDrivers,
        ageMonths: Math.round(ageMonths * 10) / 10,
        macroEventCount: macroCountByCap.get(r.capabilityId) ?? 0,
        vcCapitalUsd: cap?.vcCapitalUsd ?? 0,
        startupCount: cap?.startupCount ?? 0,
      };
    })
    .filter(r => (r.velocity ?? 0) >= minVelocity)
    .filter(r => !requireMacroEvent || r.macroEventCount > 0)
    .filter(r => r.ageMonths <= maxAgeMonths)
    .slice(0, limit);

  const result: DisruptionWatchResult = {
    generatedAt: new Date().toISOString(),
    ttlSeconds: WATCH_CACHE_TTL_MS / 1000,
    rows,
    filters: { minBand, minVelocity, requireMacroEvent, maxAgeMonths },
  };
  if (!opts) watchCache = { at: Date.now(), value: result };
  return result;
}

// satisfy unused-import linter
void inArray;
