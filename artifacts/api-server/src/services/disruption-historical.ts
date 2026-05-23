/**
 * Disruption playback — point-in-time reconstruction of the disruption watch
 * list. Given an as-of date (e.g., 30 / 60 / 90 days ago), returns the set of
 * capabilities that would have been on the watch list at that point, using
 * the per-capability snapshot row from `cvi_capability_history` instead of
 * the live `cvi_components` row.
 *
 * Eligibility is intentionally simplified vs. the live `getDisruptionWatch`
 * pipeline (which depends on freshness + macro + innovation + lifecycle
 * factors that don't have a stable point-in-time historical snapshot):
 *
 *   consensusScore <= CONSENSUS_BAND_THRESHOLD AND velocity >= minVelocity
 *
 * The threshold value (50) mirrors the "stressed / disrupting" half of the
 * CVI scale. A future iteration can re-run the full factor model against
 * historical capability + macro state if needed.
 */
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  cviCapabilityHistoryTable,
  industriesTable,
  macroEventsTable,
} from "@workspace/db";
import { and, lte, inArray, gte, sql } from "drizzle-orm";

/** Consensus score at-or-below this counts as the "below band" disruption zone. */
const CONSENSUS_BAND_THRESHOLD = 50;
/** Same default as live watch (services/disruption.ts) for parity. */
const DEFAULT_MIN_VELOCITY = 1.5;
/** Window for linking macro events to a capability's entry into the watch list. */
const MACRO_LINK_WINDOW_DAYS = 30;

export interface HistoricalWatchEntry {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  consensusScore: number;
  velocity: number;
  confidence: number;
  snapshotAt: string;
  /** Macro events whose startedAt is within MACRO_LINK_WINDOW_DAYS of snapshotAt. */
  triggeringMacroEvents: Array<{
    id: number;
    title: string;
    severity: number;
    startedAt: string;
  }>;
}

export interface HistoricalWatchResult {
  asOf: string;
  /** Threshold used for eligibility — surfaced so the UI can label the diff. */
  filters: {
    consensusBandThreshold: number;
    minVelocity: number;
  };
  rows: HistoricalWatchEntry[];
  /**
   * Subset of `cvi_capability_history` is sparse for very recent capabilities
   * (history backfill is best-effort). When this is true the asOf date is
   * outside the history window — callers should show a "not enough history"
   * banner instead of an empty diff.
   */
  outsideHistoryWindow: boolean;
}

/**
 * Latest history row per capability at or before `asOf`. Uses a single
 * window-function query to avoid N+1 over the capability table.
 */
async function latestHistoryAtOrBefore(asOf: Date): Promise<Array<{
  capabilityId: number;
  industryId: number;
  consensusScore: number;
  velocity: number;
  confidence: number;
  snapshotAt: Date;
}>> {
  // DISTINCT ON (capability_id) ordered by snapshot_at desc gives the most
  // recent row per capability at or before the cutoff in one pass.
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (capability_id)
      capability_id AS "capabilityId",
      industry_id AS "industryId",
      consensus_score AS "consensusScore",
      velocity,
      confidence,
      snapshot_at AS "snapshotAt"
    FROM cvi_capability_history
    WHERE snapshot_at <= ${asOf.toISOString()}
    ORDER BY capability_id, snapshot_at DESC
  `);
  // drizzle's execute returns a result whose .rows is the array under pg.
  // Normalize so callers see a plain array regardless of driver shape.
  const list = Array.isArray((rows as { rows?: unknown }).rows)
    ? ((rows as { rows: Array<Record<string, unknown>> }).rows)
    : (rows as unknown as Array<Record<string, unknown>>);
  return list.map(r => ({
    capabilityId: Number(r.capabilityId),
    industryId: Number(r.industryId),
    consensusScore: Number(r.consensusScore),
    velocity: Number(r.velocity),
    confidence: Number(r.confidence),
    snapshotAt: r.snapshotAt instanceof Date ? r.snapshotAt : new Date(String(r.snapshotAt)),
  }));
}

export async function getHistoricalDisruptionWatch(opts: {
  asOf: Date;
  minVelocity?: number;
}): Promise<HistoricalWatchResult> {
  const minVelocity = opts.minVelocity ?? DEFAULT_MIN_VELOCITY;
  const asOf = opts.asOf;

  // 1. Latest snapshot per capability at or before asOf.
  const history = await latestHistoryAtOrBefore(asOf);

  // Detect whether the asOf falls outside the available history window: if no
  // rows came back AT ALL, history hasn't been backfilled that far. We also
  // flag when the most-recent snapshot we found is significantly older than
  // asOf (suggests cap-history writes were paused).
  const outsideHistoryWindow = history.length === 0;

  // 2. Apply eligibility: below the band, velocity above threshold.
  const eligible = history.filter(
    h => h.consensusScore <= CONSENSUS_BAND_THRESHOLD && h.velocity >= minVelocity,
  );
  if (eligible.length === 0) {
    return {
      asOf: asOf.toISOString(),
      filters: { consensusBandThreshold: CONSENSUS_BAND_THRESHOLD, minVelocity },
      rows: [],
      outsideHistoryWindow,
    };
  }

  // 3. Hydrate capability + industry names.
  const ids = eligible.map(e => e.capabilityId);
  const [caps, inds] = await Promise.all([
    db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, ids)),
    db.select().from(industriesTable),
  ]);
  const capById = new Map(caps.map(c => [c.id, c]));
  const indNameById = new Map(inds.map(i => [i.id, i.name]));

  // 4. Macro events around the snapshot window. Pull all events that started
  // within MACRO_LINK_WINDOW_DAYS before asOf — these are the candidates that
  // could plausibly have triggered a capability into the watch list at that
  // point in time.
  const macroWindowStart = new Date(asOf.getTime() - MACRO_LINK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const macroRows = await db
    .select({
      id: macroEventsTable.id,
      title: macroEventsTable.title,
      severity: macroEventsTable.severity,
      startedAt: macroEventsTable.startedAt,
      affected: macroEventsTable.affectedCapabilityIds,
    })
    .from(macroEventsTable)
    .where(and(gte(macroEventsTable.startedAt, macroWindowStart), lte(macroEventsTable.startedAt, asOf)));

  // Index macro events by affected capability for O(1) lookup.
  const macroByCap = new Map<number, typeof macroRows>();
  for (const m of macroRows) {
    const aff = (m.affected ?? []) as number[];
    for (const cid of aff) {
      const arr = macroByCap.get(cid) ?? [];
      arr.push(m);
      macroByCap.set(cid, arr);
    }
  }

  // 5. Build response rows.
  const rows: HistoricalWatchEntry[] = eligible.map(e => {
    const cap = capById.get(e.capabilityId);
    const triggering = (macroByCap.get(e.capabilityId) ?? [])
      .slice()
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 3)
      .map(m => ({
        id: m.id,
        title: m.title,
        severity: m.severity,
        startedAt: m.startedAt.toISOString(),
      }));
    return {
      capabilityId: e.capabilityId,
      capabilityName: cap?.name ?? `Capability ${e.capabilityId}`,
      industryId: e.industryId,
      industryName: indNameById.get(e.industryId) ?? "Unknown",
      consensusScore: Math.round(e.consensusScore * 10) / 10,
      velocity: Math.round(e.velocity * 100) / 100,
      confidence: Math.round(e.confidence * 100) / 100,
      snapshotAt: e.snapshotAt.toISOString(),
      triggeringMacroEvents: triggering,
    };
  });

  // Stable order: highest velocity first (most dramatic movers).
  rows.sort((a, b) => b.velocity - a.velocity);

  return {
    asOf: asOf.toISOString(),
    filters: { consensusBandThreshold: CONSENSUS_BAND_THRESHOLD, minVelocity },
    rows,
    outsideHistoryWindow,
  };
}
