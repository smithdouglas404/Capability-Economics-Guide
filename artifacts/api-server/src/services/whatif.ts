/**
 * What-if macro event simulator.
 *
 * Takes a hypothetical macro event spec (industry/capability scope, severity,
 * sentiment direction, decay) and projects what the per-capability + per-industry
 * CVI would look like if it actually fired right now. Read-only: does not insert
 * into macro_events.
 *
 * Re-uses the same propagation as the live engine — capability scope expands
 * bidirectionally across the parent/child tree (services/macro-events.ts).
 */
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  cviComponentsTable,
  industriesTable,
  industryGdpWeightsTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { expandAffectedCapabilityIds } from "./macro-events";

const SENTIMENT_SHOCK_PER_SEVERITY = 0.5;

export interface WhatIfInput {
  eventType: string;
  severity: number;            // 0–10
  sentimentDirection: "positive" | "negative" | "neutral";
  decayDays: number;           // typically 14–180
  affectedIndustryIds: number[];
  affectedCapabilityIds: number[];
}

export interface WhatIfCapProjection {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  currentScore: number | null;
  projectedScore: number | null;
  delta: number | null;
  shockPoints: number;
  via: "explicit" | "industry" | "expanded";
}

export interface WhatIfIndustryProjection {
  industryId: number;
  industryName: string;
  capabilityCount: number;
  currentMean: number | null;
  projectedMean: number | null;
  delta: number | null;
  gdpShare: number | null;
}

export interface WhatIfResult {
  input: WhatIfInput;
  expandedAffectedCapabilityIds: number[];
  totalCapabilitiesAffected: number;
  capabilities: WhatIfCapProjection[];
  industries: WhatIfIndustryProjection[];
  aggregate: {
    gdpWeightedDelta: number | null;
    biggestPositiveMove: { name: string; delta: number } | null;
    biggestNegativeMove: { name: string; delta: number } | null;
  };
  narrative: string;
}

function directionSign(d: WhatIfInput["sentimentDirection"]): number {
  if (d === "positive") return 1;
  if (d === "negative") return -1;
  return 0;
}

/** Per-cap shock magnitude. Same formula the live engine uses, minus decay
 *  (we always evaluate at t=0 for what-if, so decayFactor = 1). */
function shockFor(severity: number, sign: number): number {
  return severity * SENTIMENT_SHOCK_PER_SEVERITY * sign;
}

function clamp(score: number): number {
  return Math.max(0, Math.min(100, score));
}

export async function runWhatIf(input: WhatIfInput): Promise<WhatIfResult> {
  const sign = directionSign(input.sentimentDirection);
  const shock = shockFor(input.severity, sign);

  const [allCaps, components, industries, gdpRows] = await Promise.all([
    db.select().from(capabilitiesTable),
    db.select().from(cviComponentsTable),
    db.select().from(industriesTable),
    db.select().from(industryGdpWeightsTable),
  ]);

  // 1) Resolve the affected set: explicit cap ids (expanded over parent/child)
  // ∪ all caps in any affected industry.
  const explicit = await expandAffectedCapabilityIds(input.affectedCapabilityIds);
  const explicitSet = new Set(explicit);
  const industrySet = new Set(input.affectedIndustryIds);
  const affectedSet = new Set<number>(explicit);
  for (const c of allCaps) if (industrySet.has(c.industryId)) affectedSet.add(c.id);

  // Per-cap projection.
  const compByCap = new Map(components.map(c => [c.capabilityId, c]));
  const indById = new Map(industries.map(i => [i.id, i]));
  const gdpByInd = new Map(gdpRows.map(g => [g.industryId, g.gdpShare]));

  const capRows: WhatIfCapProjection[] = [];
  for (const cap of allCaps) {
    if (!affectedSet.has(cap.id)) continue;
    const comp = compByCap.get(cap.id);
    const current = comp?.consensusScore ?? cap.benchmarkScore ?? null;
    const projected = current !== null ? clamp(current + shock) : null;
    const delta = current !== null && projected !== null ? Math.round((projected - current) * 100) / 100 : null;
    let via: WhatIfCapProjection["via"] = "expanded";
    if (input.affectedCapabilityIds.includes(cap.id)) via = "explicit";
    else if (industrySet.has(cap.industryId)) via = "industry";
    else if (explicitSet.has(cap.id)) via = "expanded";
    capRows.push({
      capabilityId: cap.id,
      capabilityName: cap.name,
      industryId: cap.industryId,
      industryName: indById.get(cap.industryId)?.name ?? "Unknown",
      currentScore: current !== null ? Math.round(current * 100) / 100 : null,
      projectedScore: projected,
      delta,
      shockPoints: Math.round(shock * 100) / 100,
      via,
    });
  }
  capRows.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));

  // Per-industry rollup: mean of affected caps in that industry vs the
  // same caps' projection. Untouched caps in the industry don't dilute the
  // delta because they're outside the simulation's scope.
  const byInd = new Map<number, { current: number[]; projected: number[] }>();
  for (const r of capRows) {
    if (r.currentScore === null || r.projectedScore === null) continue;
    const agg = byInd.get(r.industryId) ?? { current: [], projected: [] };
    agg.current.push(r.currentScore);
    agg.projected.push(r.projectedScore);
    byInd.set(r.industryId, agg);
  }
  const indRows: WhatIfIndustryProjection[] = [];
  for (const [iid, agg] of byInd.entries()) {
    const cur = agg.current.length > 0 ? agg.current.reduce((s, x) => s + x, 0) / agg.current.length : null;
    const proj = agg.projected.length > 0 ? agg.projected.reduce((s, x) => s + x, 0) / agg.projected.length : null;
    indRows.push({
      industryId: iid,
      industryName: indById.get(iid)?.name ?? "Unknown",
      capabilityCount: agg.current.length,
      currentMean: cur !== null ? Math.round(cur * 100) / 100 : null,
      projectedMean: proj !== null ? Math.round(proj * 100) / 100 : null,
      delta: cur !== null && proj !== null ? Math.round((proj - cur) * 100) / 100 : null,
      gdpShare: gdpByInd.get(iid) ?? null,
    });
  }
  indRows.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));

  // GDP-weighted delta across industries (matches the live CVI rollup shape).
  let weighted = 0;
  let weightSum = 0;
  for (const r of indRows) {
    if (r.delta === null || r.gdpShare === null) continue;
    weighted += r.delta * r.gdpShare;
    weightSum += r.gdpShare;
  }
  const gdpWeightedDelta = weightSum > 0 ? Math.round((weighted / weightSum) * 100) / 100 : null;

  const positive = capRows.filter(r => (r.delta ?? 0) > 0).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))[0];
  const negative = capRows.filter(r => (r.delta ?? 0) < 0).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0))[0];

  return {
    input,
    expandedAffectedCapabilityIds: [...affectedSet],
    totalCapabilitiesAffected: affectedSet.size,
    capabilities: capRows,
    industries: indRows,
    aggregate: {
      gdpWeightedDelta,
      biggestPositiveMove: positive ? { name: positive.capabilityName, delta: positive.delta ?? 0 } : null,
      biggestNegativeMove: negative ? { name: negative.capabilityName, delta: negative.delta ?? 0 } : null,
    },
    narrative: composeNarrative(input, capRows, indRows, gdpWeightedDelta),
  };
}

function composeNarrative(
  input: WhatIfInput,
  caps: WhatIfCapProjection[],
  inds: WhatIfIndustryProjection[],
  gdpWeightedDelta: number | null,
): string {
  const dirWord = input.sentimentDirection === "negative" ? "drag" : input.sentimentDirection === "positive" ? "tailwind" : "neutral shock";
  const parts: string[] = [];
  parts.push(`Hypothetical ${input.eventType} at severity ${input.severity.toFixed(1)} would create a ${dirWord} on ${caps.length} capabilities.`);
  if (gdpWeightedDelta !== null) {
    parts.push(`GDP-weighted CVI delta: ${gdpWeightedDelta > 0 ? "+" : ""}${gdpWeightedDelta.toFixed(2)} pts.`);
  }
  if (inds.length > 0) {
    const topInd = inds[0];
    if (topInd && topInd.delta !== null) {
      parts.push(`Largest industry impact: ${topInd.industryName} (${topInd.delta > 0 ? "+" : ""}${topInd.delta.toFixed(2)}).`);
    }
  }
  return parts.join(" ");
}
