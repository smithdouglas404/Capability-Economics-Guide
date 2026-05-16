/**
 * Score-change explainability service.
 *
 * "Why did this capability's CEI move?"
 *
 * The CEI components table only stores the latest posterior, so we can't read
 * a per-capability time series directly. Instead we reconstruct two snapshots
 * — one at T=now, one at T=now-windowDays — from source_triangulations
 * (which IS append-only and timestamped), then attribute the delta to:
 *
 *   - New triangulations landed in the window (source-driven shift)
 *   - Macro events affecting this capability (or any of its dependencies)
 *     that started during the window
 *   - Triangulations that fell out of the window's lookback horizon and
 *     stopped contributing to the rolling weighted mean
 *
 * The reconstruction uses the same weighted-mean shape that triangulation.ts
 * uses for the posterior mean — see weightedMean() below — but it's
 * intentionally a simplification: it ignores the prior and the variance
 * propagation. The point is to make the *story* legible to a human, not to
 * be the canonical scoring engine. For the canonical number, point users at
 * the cvi_components row.
 */
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  cviComponentsTable,
  sourceTriangulationsTable,
  capabilityDependenciesTable,
  macroEventsTable,
} from "@workspace/db";
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";

export interface TriangulationContribution {
  id: number;
  sourceLabel: string;
  methodology: string;
  rawScore: number;
  weight: number;
  queriedAt: string;
  /** Direction relative to prior weighted mean: +1 = pulled score up, -1 = down, 0 = neutral. */
  direction: "up" | "down" | "neutral";
  /** Approximate contribution to the delta (raw score * weight, mean-centered). */
  contributionPoints: number;
}

export interface MacroEventTrigger {
  id: number;
  eventType: string;
  severity: number;
  title: string;
  description: string;
  sentimentDirection: string;
  startedAt: string;
  affectedDirectly: boolean;
  /** When the event is on a dependency rather than this capability. */
  viaDependencyCapabilityId: number | null;
  viaDependencyCapabilityName: string | null;
}

export interface ExplainResponse {
  capabilityId: number;
  capabilityName: string;
  windowDays: number;
  generatedAt: string;
  currentScore: number | null;
  priorScore: number | null;
  delta: number | null;
  direction: "up" | "down" | "flat" | "unknown";
  narrative: string;
  attribution: {
    sourceDriven: TriangulationContribution[];
    macroEvents: MacroEventTrigger[];
  };
  /** Sources that *fell out* of the lookback window — they used to contribute, now they don't. */
  agedOutSources: TriangulationContribution[];
}

function weightedMean(rows: Array<{ rawScore: number; weight: number }>): number | null {
  if (rows.length === 0) return null;
  let sumW = 0;
  let sumWX = 0;
  for (const r of rows) {
    sumW += r.weight;
    sumWX += r.weight * r.rawScore;
  }
  if (sumW === 0) return null;
  return sumWX / sumW;
}

function direction(rawScore: number, priorMean: number | null): "up" | "down" | "neutral" {
  if (priorMean === null) return "neutral";
  if (rawScore > priorMean + 0.5) return "up";
  if (rawScore < priorMean - 0.5) return "down";
  return "neutral";
}

function deltaDirection(delta: number | null): "up" | "down" | "flat" | "unknown" {
  if (delta === null) return "unknown";
  if (delta > 0.5) return "up";
  if (delta < -0.5) return "down";
  return "flat";
}

export async function explainCapabilityChange(
  capabilityId: number,
  windowDays = 30,
): Promise<ExplainResponse | null> {
  const [cap] = await db
    .select()
    .from(capabilitiesTable)
    .where(eq(capabilitiesTable.id, capabilityId));
  if (!cap) return null;

  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  // We look back twice the window for "prior" so a 30d delta has 30d of
  // history feeding both sides of the comparison.
  const priorHorizonStart = new Date(now.getTime() - 2 * windowDays * 24 * 60 * 60 * 1000);

  // Triangulations that are CURRENT (queriedAt > windowStart) and PRIOR
  // (windowStart >= queriedAt > priorHorizonStart). A triangulation that
  // falls outside priorHorizonStart is too old to anchor either side.
  const allTri = await db
    .select()
    .from(sourceTriangulationsTable)
    .where(and(
      eq(sourceTriangulationsTable.capabilityId, capabilityId),
      gte(sourceTriangulationsTable.queriedAt, priorHorizonStart),
    ));

  const currentSet = allTri.filter(t => t.queriedAt >= windowStart);
  const priorSet = allTri.filter(t => t.queriedAt < windowStart);

  const currentScore = weightedMean(currentSet.length > 0 ? currentSet : allTri);
  const priorScore = weightedMean(priorSet);

  // Fallback: if there's no prior set (cold start), use the cvi_components
  // table's current consensusScore as the "current" anchor. We still won't
  // have a delta — that's honest.
  const [comp] = await db
    .select({ consensusScore: cviComponentsTable.consensusScore })
    .from(cviComponentsTable)
    .where(eq(cviComponentsTable.capabilityId, capabilityId))
    .limit(1);
  const canonicalCurrent = comp?.consensusScore ?? currentScore;

  const delta = currentScore !== null && priorScore !== null
    ? Math.round((currentScore - priorScore) * 100) / 100
    : null;

  // Attribute each in-window triangulation to its direction vs the prior mean.
  const sourceDriven: TriangulationContribution[] = currentSet
    .map(t => {
      const dir = direction(t.rawScore, priorScore);
      const centered = priorScore !== null ? t.rawScore - priorScore : 0;
      return {
        id: t.id,
        sourceLabel: t.sourceLabel,
        methodology: t.methodology,
        rawScore: t.rawScore,
        weight: t.weight,
        queriedAt: t.queriedAt.toISOString(),
        direction: dir,
        contributionPoints: Math.round(centered * t.weight * 100) / 100,
      };
    })
    .sort((a, b) => Math.abs(b.contributionPoints) - Math.abs(a.contributionPoints));

  const agedOutSources: TriangulationContribution[] = priorSet
    .filter(t => t.queriedAt < windowStart)
    .map(t => ({
      id: t.id,
      sourceLabel: t.sourceLabel,
      methodology: t.methodology,
      rawScore: t.rawScore,
      weight: t.weight,
      queriedAt: t.queriedAt.toISOString(),
      direction: direction(t.rawScore, currentScore),
      contributionPoints: 0,
    }));

  // Macro events: this capability OR any of its dependency capabilities.
  // affectedCapabilityIds is a jsonb int array — we use the @> operator.
  const dependencyRows = await db
    .select({
      depId: capabilityDependenciesTable.dependsOnId,
      depName: capabilitiesTable.name,
    })
    .from(capabilityDependenciesTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, capabilityDependenciesTable.dependsOnId))
    .where(eq(capabilityDependenciesTable.capabilityId, capabilityId));

  const dependencyIds = dependencyRows.map(d => d.depId);
  const dependencyNameById = new Map(dependencyRows.map(d => [d.depId, d.depName]));
  const allInterestingCapIds = [capabilityId, ...dependencyIds];

  const macroRows = await db
    .select()
    .from(macroEventsTable)
    .where(and(
      gte(macroEventsTable.startedAt, windowStart),
      lte(macroEventsTable.startedAt, now),
      sql`${macroEventsTable.affectedCapabilityIds} ?| array[${sql.join(allInterestingCapIds.map(id => sql`${String(id)}`), sql`,`)}]`,
    ));

  const macroEvents: MacroEventTrigger[] = macroRows.map(ev => {
    const affected = ev.affectedCapabilityIds ?? [];
    const direct = affected.includes(capabilityId);
    let viaCapId: number | null = null;
    if (!direct) {
      const viaId = affected.find(id => dependencyIds.includes(id));
      viaCapId = viaId ?? null;
    }
    return {
      id: ev.id,
      eventType: ev.eventType,
      severity: ev.severity,
      title: ev.title,
      description: ev.description,
      sentimentDirection: ev.sentimentDirection,
      startedAt: ev.startedAt.toISOString(),
      affectedDirectly: direct,
      viaDependencyCapabilityId: viaCapId,
      viaDependencyCapabilityName: viaCapId ? dependencyNameById.get(viaCapId) ?? null : null,
    };
  });
  macroEvents.sort((a, b) => b.severity - a.severity);

  // Compose a short narrative summary.
  const narrative = composeNarrative({
    capName: cap.name,
    delta,
    windowDays,
    sourceDriven,
    macroEvents,
  });

  return {
    capabilityId,
    capabilityName: cap.name,
    windowDays,
    generatedAt: now.toISOString(),
    currentScore: canonicalCurrent !== null ? Math.round(canonicalCurrent * 100) / 100 : null,
    priorScore: priorScore !== null ? Math.round(priorScore * 100) / 100 : null,
    delta,
    direction: deltaDirection(delta),
    narrative,
    attribution: { sourceDriven, macroEvents },
    agedOutSources,
  };
}

function composeNarrative(args: {
  capName: string;
  delta: number | null;
  windowDays: number;
  sourceDriven: TriangulationContribution[];
  macroEvents: MacroEventTrigger[];
}): string {
  const { capName, delta, windowDays, sourceDriven, macroEvents } = args;
  if (delta === null) {
    return `Not enough triangulation history to compute a ${windowDays}-day delta for "${capName}". The current score is based on whatever evidence is in cvi_components.`;
  }
  const dirWord = delta > 0.5 ? "up" : delta < -0.5 ? "down" : "roughly flat";
  const magnitude = Math.abs(delta).toFixed(1);
  const parts: string[] = [];
  parts.push(`"${capName}" moved ${dirWord} by ${magnitude} points over the last ${windowDays} days.`);

  if (sourceDriven.length > 0) {
    const top = sourceDriven.slice(0, 2);
    const fragments = top.map(t => {
      const sign = t.contributionPoints > 0 ? "+" : "";
      return `${t.sourceLabel} (${t.methodology}, ${sign}${t.contributionPoints.toFixed(1)})`;
    });
    parts.push(`Largest source contributors: ${fragments.join(", ")}.`);
  }

  if (macroEvents.length > 0) {
    const direct = macroEvents.filter(m => m.affectedDirectly);
    const viaDep = macroEvents.filter(m => !m.affectedDirectly);
    const macroFrags: string[] = [];
    if (direct.length > 0) {
      macroFrags.push(`${direct.length} direct macro event${direct.length === 1 ? "" : "s"} (${direct.slice(0, 2).map(e => e.title).join("; ")})`);
    }
    if (viaDep.length > 0) {
      macroFrags.push(`${viaDep.length} via dependency (${viaDep.slice(0, 2).map(e => `${e.title} on ${e.viaDependencyCapabilityName ?? "upstream cap"}`).join("; ")})`);
    }
    parts.push(`Macro: ${macroFrags.join("; ")}.`);
  } else if (sourceDriven.length === 0) {
    parts.push(`No new triangulations or macro events in the window — this delta is residual.`);
  }

  return parts.join(" ");
}
