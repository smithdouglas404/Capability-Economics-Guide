import { db } from "@workspace/db";
import {
  capabilitiesTable,
  cviComponentsTable,
  industriesTable,
  industryGdpWeightsTable,
  ontologyRelationshipsTable,
  dvxComponentsTable,
  dvxSnapshotsTable,
  dvxCapabilityHistoryTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { generateDisruptorsTool } from "./agent/tools";
import { logger } from "../lib/logger";

/**
 * DVX = Disruption Velocity Index engine.
 * Tagline: "How fast a capability will be displaced and by what."
 *
 * Runs in parallel with computeCVI on every routine cycle. Walks every
 * capability with a CVI row, computes a 0-100 disruption probability via
 * three weighted factors, persists to dvx_components + dvx_capability_history
 * + dvx_snapshots.
 *
 * Factors (weights sum to 1.0):
 *   Velocity Divergence       40% — fastest-rising substitute/competitor
 *                                   capability vs this one's velocity
 *   Dependency Fragility      30% — % of upstream deps under disruption
 *                                   pressure (a dep is "under pressure" if
 *                                   its own velocity divergence >= 5)
 *   Pattern Match Confidence  30% — Bayesian confidence (0-1) × 100 from
 *                                   generateDisruptorsTool LLM call
 *
 * months_to_displacement heuristic:
 *   score >= 80 → 12
 *   score 50-79 → 24
 *   score 30-49 → 36
 *   score < 30  → null
 *
 * Idempotent — re-running produces the same DB state plus one extra
 * dvx_capability_history row per cap (intentional, time-series).
 *
 * Performance note: pattern-match LLM call is the bottleneck. Cached per
 * cap via dvx_components.matched_pattern_slug — only re-issued when the
 * factor 1 or 2 score changes by >5 points from prior, OR if 7+ days have
 * passed since last LLM call. Keeps cost bounded as the cap count grows.
 */
const WEIGHT_VELOCITY_DIVERGENCE = 0.40;
const WEIGHT_DEPENDENCY_FRAGILITY = 0.30;
const WEIGHT_PATTERN_MATCH = 0.30;

const VELOCITY_DIVERGENCE_SCALE = 12; // gap of 5 velocity-pts → ~60 score points before weighting
const PATTERN_MATCH_REFRESH_DAYS = 7;
const PATTERN_MATCH_TRIGGER_DELTA = 5;

const VELOCITY_DECAY = 0.7;

export interface ComputeDVXOptions {
  /** When false, compute but don't persist (for backtesting / dry-run). */
  persist?: boolean;
}

export interface DVXResult {
  overallIndex: number;
  industryBreakdowns: Record<string, {
    industryName: string;
    indexValue: number;
    velocity: number;
    weight: number;
    topDisruptedCapability: string;
    topDisruptorInnovation: string;
    capabilityCount: number;
  }>;
  capabilitiesScored: number;
  llmCallsIssued: number;
  timestamp: string;
}

export async function computeDVX(opts: ComputeDVXOptions = {}): Promise<DVXResult> {
  const persist = opts.persist !== false;
  const startedAt = Date.now();

  // Pull every cap with a CVI row. DVX is only meaningful for caps that
  // already have a current-value reading.
  const cviRows = await db.select().from(cviComponentsTable);
  if (cviRows.length === 0) {
    return {
      overallIndex: 0,
      industryBreakdowns: {},
      capabilitiesScored: 0,
      llmCallsIssued: 0,
      timestamp: new Date().toISOString(),
    };
  }

  const capIds = cviRows.map(c => c.capabilityId);
  const caps = await db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, capIds));
  const capById = new Map(caps.map(c => [c.id, c]));

  const industries = await db.select().from(industriesTable);
  const industryById = new Map(industries.map(i => [i.id, i]));
  const weights = await db.select().from(industryGdpWeightsTable);
  const weightByIndustryId = new Map(weights.map(w => [w.industryId, w.gdpShare]));

  // Pre-fetch ontology relationships so we don't N+1 the dep-walk.
  const allRelationships = await db.select().from(ontologyRelationshipsTable);
  const substitutesByCapId = new Map<number, number[]>();
  const dependsOnByCapId = new Map<number, number[]>();
  for (const r of allRelationships) {
    if (r.relationshipType === "substitutes" || r.relationshipType === "competes_with") {
      if (!substitutesByCapId.has(r.sourceCapabilityId)) substitutesByCapId.set(r.sourceCapabilityId, []);
      substitutesByCapId.get(r.sourceCapabilityId)!.push(r.targetCapabilityId);
      // Reverse direction too — if X substitutes for Y, then Y's substitutes include X
      if (!substitutesByCapId.has(r.targetCapabilityId)) substitutesByCapId.set(r.targetCapabilityId, []);
      substitutesByCapId.get(r.targetCapabilityId)!.push(r.sourceCapabilityId);
    }
    if (r.relationshipType === "depends_on") {
      if (!dependsOnByCapId.has(r.sourceCapabilityId)) dependsOnByCapId.set(r.sourceCapabilityId, []);
      dependsOnByCapId.get(r.sourceCapabilityId)!.push(r.targetCapabilityId);
    }
  }

  // Pull existing dvx_components to support pattern-match LLM caching
  const existingDvx = await db.select().from(dvxComponentsTable);
  const existingByCapId = new Map(existingDvx.map(d => [`${d.capabilityId}-${d.industryId}`, d]));

  // Map velocities by cap id for quick lookups during factor-1 computation
  const velocityByCapId = new Map<number, number>();
  for (const c of cviRows) velocityByCapId.set(c.capabilityId, c.velocity);

  let llmCallsIssued = 0;
  const computedRows: Array<{
    capabilityId: number;
    industryId: number;
    disruptionScore: number;
    velocity: number;
    monthsToDisplacement: number | null;
    topDisruptors: string[];
    matchedPatternSlug: string | null;
    factorBreakdown: { velocityDivergence: number; dependencyFragility: number; patternMatchConfidence: number };
    rationale: string;
  }> = [];

  for (const cvi of cviRows) {
    const cap = capById.get(cvi.capabilityId);
    if (!cap) continue;
    const industry = industryById.get(cvi.industryId);
    if (!industry) continue;

    // Factor 1 — Velocity Divergence
    const subs = substitutesByCapId.get(cvi.capabilityId) ?? [];
    let maxPeerVelocity = -Infinity;
    for (const subId of subs) {
      const v = velocityByCapId.get(subId);
      if (v != null && v > maxPeerVelocity) maxPeerVelocity = v;
    }
    const velocityDelta = maxPeerVelocity === -Infinity ? 0 : Math.max(0, maxPeerVelocity - cvi.velocity);
    const velocityDivergence = Math.max(0, Math.min(100, velocityDelta * VELOCITY_DIVERGENCE_SCALE));

    // Factor 2 — Dependency Fragility
    const deps = dependsOnByCapId.get(cvi.capabilityId) ?? [];
    let fragilityCount = 0;
    for (const depId of deps) {
      const depSubs = substitutesByCapId.get(depId) ?? [];
      for (const depSubId of depSubs) {
        const depSubVel = velocityByCapId.get(depSubId);
        const depVel = velocityByCapId.get(depId);
        if (depSubVel != null && depVel != null && depSubVel - depVel >= 5) {
          fragilityCount++;
          break;
        }
      }
    }
    const dependencyFragility = deps.length === 0 ? 0 : Math.min(100, (fragilityCount / deps.length) * 100);

    // Factor 3 — Pattern Match Confidence (with caching)
    const existing = existingByCapId.get(`${cvi.capabilityId}-${cvi.industryId}`);
    const priorFactor1 = existing?.factorBreakdown?.velocityDivergence ?? null;
    const priorFactor2 = existing?.factorBreakdown?.dependencyFragility ?? null;
    const factor1Changed = priorFactor1 == null || Math.abs(velocityDivergence - priorFactor1) >= PATTERN_MATCH_TRIGGER_DELTA;
    const factor2Changed = priorFactor2 == null || Math.abs(dependencyFragility - priorFactor2) >= PATTERN_MATCH_TRIGGER_DELTA;
    const cacheAgeDays = existing?.updatedAt
      ? (Date.now() - existing.updatedAt.getTime()) / (24 * 60 * 60 * 1000)
      : Infinity;
    const needsLlm = factor1Changed || factor2Changed || cacheAgeDays >= PATTERN_MATCH_REFRESH_DAYS;

    let patternMatchConfidence: number;
    let matchedPatternSlug: string | null;
    let topDisruptors: string[];
    let rationale: string;

    if (needsLlm) {
      try {
        const raw = await generateDisruptorsTool.invoke({
          capabilityId: cvi.capabilityId,
          capabilityName: cap.name,
          industryName: industry.name,
          cviScore: cvi.consensusScore,
          velocity: cvi.velocity,
        });
        const parsed = JSON.parse(raw) as {
          success?: boolean;
          disruptors?: string[];
          patternMatchSlug?: string | null;
          patternMatchConfidence?: number;
          rationale?: string;
        };
        if (parsed.success === false) throw new Error("generateDisruptors returned failure");
        llmCallsIssued++;
        patternMatchConfidence = (parsed.patternMatchConfidence ?? 0) * 100;
        matchedPatternSlug = parsed.patternMatchSlug ?? null;
        topDisruptors = parsed.disruptors ?? [];
        rationale = parsed.rationale ?? "";
      } catch (err) {
        logger.warn({ err, capId: cvi.capabilityId, capName: cap.name }, "[dvx] generateDisruptors failed, using prior cache or zero");
        patternMatchConfidence = (existing?.factorBreakdown?.patternMatchConfidence ?? 0);
        matchedPatternSlug = existing?.matchedPatternSlug ?? null;
        topDisruptors = (existing?.topDisruptors as string[] | undefined) ?? [];
        rationale = existing?.rationale ?? "";
      }
    } else {
      patternMatchConfidence = existing!.factorBreakdown!.patternMatchConfidence;
      matchedPatternSlug = existing!.matchedPatternSlug;
      topDisruptors = (existing!.topDisruptors as string[]) ?? [];
      rationale = existing!.rationale ?? "";
    }

    const disruptionScore = Math.max(0, Math.min(100,
      WEIGHT_VELOCITY_DIVERGENCE * velocityDivergence +
      WEIGHT_DEPENDENCY_FRAGILITY * dependencyFragility +
      WEIGHT_PATTERN_MATCH * patternMatchConfidence
    ));

    // EMA velocity of disruption score itself
    const priorScore = existing?.disruptionScore ?? disruptionScore;
    const rawVelocity = disruptionScore - priorScore;
    const priorScoreVelocity = existing?.velocity ?? 0;
    const dvxVelocity = VELOCITY_DECAY * priorScoreVelocity + (1 - VELOCITY_DECAY) * rawVelocity;

    const monthsToDisplacement =
      disruptionScore >= 80 ? 12 :
      disruptionScore >= 50 ? 24 :
      disruptionScore >= 30 ? 36 :
      null;

    computedRows.push({
      capabilityId: cvi.capabilityId,
      industryId: cvi.industryId,
      disruptionScore,
      velocity: dvxVelocity,
      monthsToDisplacement,
      topDisruptors,
      matchedPatternSlug,
      factorBreakdown: { velocityDivergence, dependencyFragility, patternMatchConfidence },
      rationale,
    });
  }

  // Industry rollup
  const industryAcc = new Map<number, {
    sum: number;
    count: number;
    topCap: { name: string; score: number };
    topDisruptor: string;
  }>();
  for (const row of computedRows) {
    const cap = capById.get(row.capabilityId);
    if (!cap) continue;
    let acc = industryAcc.get(row.industryId);
    if (!acc) {
      acc = { sum: 0, count: 0, topCap: { name: "", score: 0 }, topDisruptor: "" };
      industryAcc.set(row.industryId, acc);
    }
    acc.sum += row.disruptionScore;
    acc.count++;
    if (row.disruptionScore > acc.topCap.score) {
      acc.topCap = { name: cap.name, score: row.disruptionScore };
      acc.topDisruptor = row.topDisruptors[0] ?? "";
    }
  }

  const industryBreakdowns: DVXResult["industryBreakdowns"] = {};
  let overallWeightedSum = 0;
  let overallWeightTotal = 0;
  for (const [industryId, acc] of industryAcc.entries()) {
    const industry = industryById.get(industryId);
    if (!industry) continue;
    const indexValue = acc.count > 0 ? acc.sum / acc.count : 0;
    const weight = weightByIndustryId.get(industryId) ?? 0;
    industryBreakdowns[String(industryId)] = {
      industryName: industry.name,
      indexValue,
      velocity: 0, // industry-level velocity computed in a future pass
      weight,
      topDisruptedCapability: acc.topCap.name,
      topDisruptorInnovation: acc.topDisruptor,
      capabilityCount: acc.count,
    };
    if (weight > 0) {
      overallWeightedSum += indexValue * weight;
      overallWeightTotal += weight;
    }
  }
  const overallIndex = overallWeightTotal > 0
    ? overallWeightedSum / overallWeightTotal
    : (industryAcc.size > 0
        ? Array.from(industryAcc.values()).reduce((a, b) => a + (b.count > 0 ? b.sum / b.count : 0), 0) / industryAcc.size
        : 0);

  let snapshotAt = new Date();
  if (persist) {
    // Upsert dvx_components per row
    for (const row of computedRows) {
      const existing = existingByCapId.get(`${row.capabilityId}-${row.industryId}`);
      if (existing) {
        await db.update(dvxComponentsTable).set({
          disruptionScore: row.disruptionScore,
          velocity: row.velocity,
          monthsToDisplacement: row.monthsToDisplacement,
          topDisruptors: row.topDisruptors,
          matchedPatternSlug: row.matchedPatternSlug,
          factorBreakdown: row.factorBreakdown,
          rationale: row.rationale,
          updatedAt: new Date(),
        }).where(eq(dvxComponentsTable.id, existing.id));
      } else {
        await db.insert(dvxComponentsTable).values({
          capabilityId: row.capabilityId,
          industryId: row.industryId,
          disruptionScore: row.disruptionScore,
          velocity: row.velocity,
          monthsToDisplacement: row.monthsToDisplacement,
          topDisruptors: row.topDisruptors,
          matchedPatternSlug: row.matchedPatternSlug,
          factorBreakdown: row.factorBreakdown,
          rationale: row.rationale,
        });
      }
    }

    // Insert snapshot
    const [snap] = await db.insert(dvxSnapshotsTable).values({
      overallIndex,
      industryBreakdowns,
      methodologyVersion: "1.0",
    }).returning();
    snapshotAt = snap.snapshotAt;

    // Per-cap history rows
    if (computedRows.length > 0) {
      await db.insert(dvxCapabilityHistoryTable).values(
        computedRows.map(r => ({
          capabilityId: r.capabilityId,
          industryId: r.industryId,
          disruptionScore: r.disruptionScore,
          velocity: r.velocity,
          monthsToDisplacement: r.monthsToDisplacement,
          matchedPatternSlug: r.matchedPatternSlug,
          methodologyVersion: "1.0",
          snapshotAt,
        }))
      ).onConflictDoNothing();
    }
  }

  logger.info({
    capabilitiesScored: computedRows.length,
    llmCallsIssued,
    overallIndex,
    industries: industryAcc.size,
    durationMs: Date.now() - startedAt,
  }, "[dvx] compute complete");

  return {
    overallIndex,
    industryBreakdowns,
    capabilitiesScored: computedRows.length,
    llmCallsIssued,
    timestamp: snapshotAt.toISOString(),
  };
}
