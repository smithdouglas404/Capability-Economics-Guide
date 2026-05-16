/**
 * Net-new capability watch.
 *
 * Identifies capabilities created in the last N months — the "agentic AI
 * orchestration" pattern: capabilities that didn't exist in the ontology
 * two years ago but now have non-trivial CEI scores, velocity, and VC capital.
 *
 * Tracking capability *genesis* (not just maturity) is one of the platform's
 * distinctive features — no competitor surfaces this.
 */
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  cviComponentsTable,
  industriesTable,
} from "@workspace/db";
import { gte, inArray, desc } from "drizzle-orm";
import { deriveLifecycleStage } from "./lifecycle";

export interface NewCapabilityEntry {
  capabilityId: number;
  capabilityName: string;
  capabilitySlug: string;
  capabilityDescription: string;
  industryId: number;
  industryName: string;
  consensusScore: number | null;
  velocity: number | null;
  lifecycleStage: string;
  ageMonths: number;
  createdAt: string;
  vcCapitalUsd: number;
  startupCount: number;
  patentCount: number;
}

export interface NewCapabilityWatchResult {
  generatedAt: string;
  ttlSeconds: number;
  filters: { maxAgeMonths: number; minScore: number };
  rows: NewCapabilityEntry[];
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let cached: { at: number; value: NewCapabilityWatchResult } | null = null;

export async function getNewCapabilityWatch(opts?: {
  maxAgeMonths?: number;
  minScore?: number;
  industryId?: number;
  limit?: number;
}): Promise<NewCapabilityWatchResult> {
  const maxAgeMonths = opts?.maxAgeMonths ?? 24;
  const minScore = opts?.minScore ?? 30;
  const limit = opts?.limit ?? 50;

  if (!opts && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
  const since = new Date(Date.now() - maxAgeMonths * MONTH_MS);

  const caps = await db
    .select()
    .from(capabilitiesTable)
    .where(gte(capabilitiesTable.createdAt, since))
    .orderBy(desc(capabilitiesTable.createdAt));

  let pool = caps;
  if (opts?.industryId !== undefined) pool = pool.filter(c => c.industryId === opts.industryId);

  const ids = pool.map(c => c.id);
  const [comps, industries] = await Promise.all([
    ids.length > 0 ? db.select().from(cviComponentsTable).where(inArray(cviComponentsTable.capabilityId, ids)) : Promise.resolve([]),
    db.select().from(industriesTable),
  ]);
  const compById = new Map(comps.map(c => [c.capabilityId, c]));
  const indById = new Map(industries.map(i => [i.id, i]));

  const now = Date.now();
  const rows: NewCapabilityEntry[] = pool
    .map(cap => {
      const comp = compById.get(cap.id);
      const score = comp?.consensusScore ?? cap.benchmarkScore ?? 0;
      return {
        capabilityId: cap.id,
        capabilityName: cap.name,
        capabilitySlug: cap.slug,
        capabilityDescription: cap.description,
        industryId: cap.industryId,
        industryName: indById.get(cap.industryId)?.name ?? "Unknown",
        consensusScore: comp?.consensusScore ?? null,
        velocity: comp?.velocity ?? null,
        lifecycleStage: deriveLifecycleStage({
          consensusScore: comp?.consensusScore ?? null,
          velocity: comp?.velocity ?? null,
          benchmarkScore: cap.benchmarkScore,
        }),
        ageMonths: Math.round(((now - cap.createdAt.getTime()) / MONTH_MS) * 10) / 10,
        createdAt: cap.createdAt.toISOString(),
        vcCapitalUsd: cap.vcCapitalUsd ?? 0,
        startupCount: cap.startupCount ?? 0,
        patentCount: cap.patentCount ?? 0,
        _score: score,
      } as NewCapabilityEntry & { _score: number };
    })
    .filter(r => r._score >= minScore)
    .sort((a, b) => (b.velocity ?? 0) - (a.velocity ?? 0))
    .slice(0, limit)
    .map(({ _score, ...rest }) => { void _score; return rest; });

  const result: NewCapabilityWatchResult = {
    generatedAt: new Date().toISOString(),
    ttlSeconds: CACHE_TTL_MS / 1000,
    filters: { maxAgeMonths, minScore },
    rows,
  };
  if (!opts) cached = { at: Date.now(), value: result };
  return result;
}

export function _resetNewCapabilityCacheForTest(): void {
  cached = null;
}
