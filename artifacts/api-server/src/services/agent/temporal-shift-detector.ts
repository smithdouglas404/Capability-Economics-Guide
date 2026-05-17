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
import { memoryRelationsTable, memoryEntitiesTable, memoryRelationSnapshotsTable } from "@workspace/db";
import { cviSnapshotsTable, capabilitiesTable, industriesTable } from "@workspace/db";
import { eq, and, gte, lt, desc, sql } from "drizzle-orm";
import { storeMemory } from "./memory";
import { ensureSharedStoreReady, getSharedStore, NS } from "./store";

/**
 * Daily writer: snapshot every memory_relations row's current weight + observedCount
 * into memory_relation_snapshots. Idempotent per (relation_id, calendar day) via the
 * uniqueIndex on the table — re-running on the same day is a no-op rather than an
 * error. Wired into the daily cron in scheduler.ts.
 *
 * Backfills nothing. The first 30 days after deployment will have <30d of history,
 * so detectTemporalShifts() falls back to the legacy fictional baseline. After
 * day 30+ the detector uses real momentum.
 */
export async function writeMemoryRelationSnapshots(): Promise<{ written: number; skipped: number }> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0); // normalise to UTC midnight so multiple cron firings collapse

  const rows = await db
    .select({ id: memoryRelationsTable.id, weight: memoryRelationsTable.weight, observedCount: memoryRelationsTable.observedCount })
    .from(memoryRelationsTable);

  if (rows.length === 0) return { written: 0, skipped: 0 };

  let written = 0;
  let skipped = 0;
  // Batch in chunks of 500 to avoid statement-size issues.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    try {
      const result = await db
        .insert(memoryRelationSnapshotsTable)
        .values(chunk.map(r => ({
          relationId: r.id,
          weight: r.weight,
          observedCount: r.observedCount,
          snapshotAt: today,
        })))
        .onConflictDoNothing()
        .returning({ id: memoryRelationSnapshotsTable.id });
      written += result.length;
      skipped += chunk.length - result.length;
    } catch {
      // Non-fatal — partial day's snapshot is acceptable; tomorrow will retry.
      skipped += chunk.length;
    }
  }
  return { written, skipped };
}

/**
 * Look up the snapshot weight closest to (now - 30d) for a single relation.
 * Returns null when no snapshot exists within the +/-7d acceptance window — the
 * caller falls back to the legacy fictional baseline in that case.
 */
async function getBaselineWeightFromSnapshots(relationId: number, targetDate: Date): Promise<{ weight: number; observedCount: number } | null> {
  const windowStart = new Date(targetDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(targetDate.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [snap] = await db
    .select({ weight: memoryRelationSnapshotsTable.weight, observedCount: memoryRelationSnapshotsTable.observedCount, snapshotAt: memoryRelationSnapshotsTable.snapshotAt })
    .from(memoryRelationSnapshotsTable)
    .where(and(
      eq(memoryRelationSnapshotsTable.relationId, relationId),
      gte(memoryRelationSnapshotsTable.snapshotAt, windowStart),
      lt(memoryRelationSnapshotsTable.snapshotAt, windowEnd),
    ))
    .orderBy(sql`abs(extract(epoch from (snapshot_at - ${targetDate.toISOString()}::timestamp)))`)
    .limit(1);

  return snap ? { weight: snap.weight, observedCount: snap.observedCount } : null;
}

/**
 * Synthesis-agent reads the latest temporal-shift report through this cache
 * rather than re-running detectTemporalShifts() inside an LLM tool-call loop.
 * Cache is filled by the 6h scheduled cron in scheduler.ts; TTL is 7h so a
 * single missed cron tick still returns last-known-good rather than triggering
 * a synchronous full memory_relations scan on the request path.
 */
const TEMPORAL_SHIFT_CACHE_TTL_MS = 7 * 60 * 60 * 1000;

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

  const thirtyDaysAgoForBaseline = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  for (const rel of relations) {
    if (rel.observedCount < MIN_OBSERVATIONS_FOR_SIGNAL) continue;

    const ageInMs = now.getTime() - rel.firstObservedAt.getTime();
    const ageInDays = Math.max(1, ageInMs / (1000 * 60 * 60 * 24));

    // Prefer a real snapshot from memory_relation_snapshots (written daily by
    // scheduler.ts). The window is centered on (now - 30d) with +/-7d tolerance
    // so a single missed daily snapshot doesn't break momentum computation.
    const realBaseline = await getBaselineWeightFromSnapshots(rel.id, thirtyDaysAgoForBaseline);

    let baselineWeight: number;
    let baselineSource: "snapshot" | "extrapolated";
    if (realBaseline) {
      baselineWeight = realBaseline.weight;
      baselineSource = "snapshot";
    } else {
      // FALLBACK: no snapshot in window — likely a relation younger than 30d,
      // or a fresh deployment where the daily snapshot cron hasn't accumulated
      // 30d of history. Use the legacy linear extrapolation from a hardcoded
      // initial weight of 0.1. Direction is reliable; magnitude is approximate.
      // Once snapshots are 30+ days deep the snapshot path takes over and this
      // fallback is no longer hit.
      const initialWeight = 0.1;
      const weightVelocityPerDay = (rel.weight - initialWeight) / ageInDays;
      const daysAgo30 = Math.min(30, ageInDays);
      baselineWeight = Math.max(0.1, rel.weight - weightVelocityPerDay * daysAgo30);
      baselineSource = "extrapolated";
    }
    const momentum = rel.weight - baselineWeight;
    void baselineSource; // reserved for future telemetry / debug logging

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

  const report: TemporalShiftReport = {
    generatedAt: now.toISOString(),
    totalRelationsAnalyzed: shifts.length,
    shifts,
    accelerating,
    decelerating,
    reversing,
    summary,
  };

  // Cache for synthesis-agent's readTemporalShiftsTool — avoids a full
  // memory_relations scan from inside the LLM tool-call loop.
  try {
    await ensureSharedStoreReady();
    await getSharedStore().put(
      NS.sharedKnowledge("temporal_shifts"),
      "latest",
      { ...report, cachedAt: now.toISOString() },
    );
  } catch {
    // Non-fatal — cache miss is acceptable, agent will recompute on demand
  }

  return report;
}

/**
 * Read the most recent cached temporal-shift report. Returns null if the cache
 * is empty or stale (> 7h old, allowing one missed 6h cron tick). Callers on
 * the request path (synthesis-agent tool) prefer this over detectTemporalShifts()
 * because the underlying scan is expensive.
 */
export async function getCachedTemporalShiftReport(): Promise<TemporalShiftReport | null> {
  try {
    await ensureSharedStoreReady();
    const items = await getSharedStore().search(NS.sharedKnowledge("temporal_shifts"), { limit: 1 });
    if (items.length === 0) return null;
    const cached = items[0]!.value as TemporalShiftReport & { cachedAt?: string };
    if (cached.cachedAt) {
      const age = Date.now() - new Date(cached.cachedAt).getTime();
      if (age > TEMPORAL_SHIFT_CACHE_TTL_MS) return null;
    }
    return cached;
  } catch {
    return null;
  }
}
