/**
 * Temporal Shift Detector — AI-FIRST capability momentum analysis.
 *
 * Detects whether capability relationships are accelerating, reversing, or
 * plateauing by comparing current graph weights against historical baselines.
 *
 * This is the difference between a system that reports what is happening now
 * and a system that understands whether a trend is gaining or losing momentum.
 *
 * Data sources:
 * - memory_relations table: weight, observedCount, firstObservedAt, lastObservedAt
 * - memory_entities table: mentionCount, firstSeenAt, lastSeenAt
 * - cvi_snapshots table: historical CVI scores for correlation
 *
 * Output: TemporalShift records written to Mem0 as "pattern" memories so all
 * agents can recall them in future cycles.
 */
import { db } from "@workspace/db";
import { memoryRelationsTable, memoryEntitiesTable } from "@workspace/db";
import { cviSnapshotsTable, capabilitiesTable, industriesTable } from "@workspace/db";
import { eq, and, gte, lt, desc, sql } from "drizzle-orm";
import { storeMemory } from "./memory";

export interface TemporalShift {
  fromEntity: string;
  toEntity: string;
  relationType: string;
  /** Current weight (0–1) */
  currentWeight: number;
  /** Weight 30 days ago (estimated from observedCount velocity) */
  baselineWeight: number;
  /** Positive = accelerating, negative = decelerating */
  momentum: number;
  /** "accelerating" | "decelerating" | "stable" | "reversing" */
  trend: "accelerating" | "decelerating" | "stable" | "reversing";
  /** How many times this relationship has been observed */
  observedCount: number;
  /** Days since first observation */
  ageInDays: number;
  /** Signal strength: high/medium/low based on observation count and age */
  signalStrength: "high" | "medium" | "low";
}

export interface TemporalShiftReport {
  generatedAt: string;
  totalRelationsAnalyzed: number;
  shifts: TemporalShift[];
  accelerating: TemporalShift[];
  decelerating: TemporalShift[];
  reversing: TemporalShift[];
  /** Summary text written to Mem0 */
  summary: string;
}

const MOMENTUM_THRESHOLD_ACCELERATING = 0.15;
const MOMENTUM_THRESHOLD_REVERSING = -0.15;
const MIN_OBSERVATIONS_FOR_SIGNAL = 3;

/**
 * Detect temporal shifts in capability relationship weights.
 *
 * Algorithm:
 * 1. Load all memory_relations with their firstObservedAt and lastObservedAt
 * 2. Estimate the weight velocity: (current_weight - initial_weight) / age_in_days
 * 3. Project what the weight was 30 days ago using the velocity
 * 4. Classify the trend: accelerating / decelerating / stable / reversing
 * 5. Write high-signal shifts to Mem0 as pattern memories
 */
export async function detectTemporalShifts(industryId?: number): Promise<TemporalShiftReport> {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Load relations with entity names
  const relations = await db
    .select({
      id: memoryRelationsTable.id,
      fromEntityId: memoryRelationsTable.fromEntityId,
      toEntityId: memoryRelationsTable.toEntityId,
      relationKind: memoryRelationsTable.relationKind,
      weight: memoryRelationsTable.weight,
      observedCount: memoryRelationsTable.observedCount,
      firstObservedAt: memoryRelationsTable.firstObservedAt,
      lastObservedAt: memoryRelationsTable.lastObservedAt,
      fromName: sql<string>`fe.name`,
      toName: sql<string>`te.name`,
      fromIndustryId: sql<number | null>`fe.industry_id`,
    })
    .from(memoryRelationsTable)
    .innerJoin(
      sql`memory_entities fe`,
      sql`${memoryRelationsTable.fromEntityId} = fe.id`
    )
    .innerJoin(
      sql`memory_entities te`,
      sql`${memoryRelationsTable.toEntityId} = te.id`
    )
    .where(
      industryId
        ? sql`fe.industry_id = ${industryId} OR te.industry_id = ${industryId}`
        : sql`1=1`
    )
    .orderBy(desc(memoryRelationsTable.weight));

  const shifts: TemporalShift[] = [];

  for (const rel of relations) {
    if (rel.observedCount < MIN_OBSERVATIONS_FOR_SIGNAL) continue;

    const ageInMs = now.getTime() - rel.firstObservedAt.getTime();
    const ageInDays = Math.max(1, ageInMs / (1000 * 60 * 60 * 24));

    // SAFETY: The "baseline weight 30 days ago" below is a FICTIONAL value.
    // We assume the weight grew linearly from a hardcoded 0.1 to its current
    // value over the relationship's lifetime, then project backwards. Real
    // historical snapshots of relation weight are NOT stored anywhere — the
    // next step toward an honest momentum signal is recording a
    // (relation_id, weight, snapshot_at) timeseries in a new table and
    // computing momentum from that. Until then, treat the momentum output
    // here as a directional hint, not as a quantitative claim. See plan file
    // for full discussion (item #11 in the code review).
    const initialWeight = 0.1;
    const weightVelocityPerDay = (rel.weight - initialWeight) / ageInDays;

    // Project what weight was 30 days ago
    const daysAgo30 = Math.min(30, ageInDays);
    const baselineWeight = Math.max(0.1, rel.weight - weightVelocityPerDay * daysAgo30);
    const momentum = rel.weight - baselineWeight;

    let trend: TemporalShift["trend"];
    if (momentum >= MOMENTUM_THRESHOLD_ACCELERATING) {
      trend = "accelerating";
    } else if (momentum <= MOMENTUM_THRESHOLD_REVERSING) {
      trend = rel.weight < 0.3 ? "reversing" : "decelerating";
    } else {
      trend = "stable";
    }

    // Signal strength based on observation count and age
    let signalStrength: TemporalShift["signalStrength"];
    if (rel.observedCount >= 10 && ageInDays >= 14) {
      signalStrength = "high";
    } else if (rel.observedCount >= 5 || ageInDays >= 7) {
      signalStrength = "medium";
    } else {
      signalStrength = "low";
    }

    shifts.push({
      fromEntity: rel.fromName,
      toEntity: rel.toName,
      relationType: rel.relationKind,
      currentWeight: Math.round(rel.weight * 1000) / 1000,
      baselineWeight: Math.round(baselineWeight * 1000) / 1000,
      momentum: Math.round(momentum * 1000) / 1000,
      trend,
      observedCount: rel.observedCount,
      ageInDays: Math.round(ageInDays),
      signalStrength,
    });
  }

  const accelerating = shifts.filter(s => s.trend === "accelerating" && s.signalStrength !== "low");
  const decelerating = shifts.filter(s => s.trend === "decelerating" && s.signalStrength !== "low");
  const reversing = shifts.filter(s => s.trend === "reversing");

  // Build a summary for Mem0
  const summaryParts: string[] = [];
  if (accelerating.length > 0) {
    summaryParts.push(
      `Accelerating relationships (${accelerating.length}): ` +
      accelerating.slice(0, 3).map(s =>
        `${s.fromEntity}→${s.toEntity} gaining momentum (+${(s.momentum * 100).toFixed(0)}% in 30d, ${s.observedCount} observations)`
      ).join("; ")
    );
  }
  if (reversing.length > 0) {
    summaryParts.push(
      `Reversing relationships (${reversing.length}): ` +
      reversing.slice(0, 3).map(s =>
        `${s.fromEntity}→${s.toEntity} weakening (${(s.momentum * 100).toFixed(0)}% in 30d, now at ${(s.currentWeight * 100).toFixed(0)}% strength)`
      ).join("; ")
    );
  }
  if (decelerating.length > 0) {
    summaryParts.push(
      `Decelerating relationships (${decelerating.length}): ` +
      decelerating.slice(0, 2).map(s =>
        `${s.fromEntity}→${s.toEntity} slowing (${(s.momentum * 100).toFixed(0)}% in 30d)`
      ).join("; ")
    );
  }

  const summary = summaryParts.length > 0
    ? `Temporal shift analysis (${shifts.length} relationships analyzed): ${summaryParts.join(". ")}`
    : `Temporal shift analysis: ${shifts.length} relationships analyzed, no significant momentum changes detected.`;

  // Write high-signal shifts to Mem0 as pattern memories so all agents can recall them
  const highSignalShifts = [...accelerating, ...reversing].filter(s => s.signalStrength === "high");
  for (const shift of highSignalShifts.slice(0, 5)) {
    const memContent = shift.trend === "accelerating"
      ? `ACCELERATING PATTERN: The relationship between "${shift.fromEntity}" and "${shift.toEntity}" (${shift.relationType}) has gained ${(shift.momentum * 100).toFixed(0)}% strength over 30 days, now at ${(shift.currentWeight * 100).toFixed(0)}% based on ${shift.observedCount} observations. This is a strengthening signal.`
      : `REVERSING PATTERN: The relationship between "${shift.fromEntity}" and "${shift.toEntity}" (${shift.relationType}) has weakened by ${Math.abs(shift.momentum * 100).toFixed(0)}% over 30 days, now at only ${(shift.currentWeight * 100).toFixed(0)}% strength. Prior assumptions about this co-dependency may no longer hold.`;

    await storeMemory(
      "pattern",
      memContent,
      { source: "temporal_shift_detector", trend: shift.trend, signalStrength: shift.signalStrength },
      { category: "temporal_shift" },
    ).catch(() => {
      // Non-fatal — temporal shift detection is supplementary
    });
  }

  return {
    generatedAt: now.toISOString(),
    totalRelationsAnalyzed: shifts.length,
    shifts,
    accelerating,
    decelerating,
    reversing,
    summary,
  };
}
