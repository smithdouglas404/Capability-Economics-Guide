import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  cviComponentsTable,
  sourceTriangulationsTable,
} from "@workspace/db";

export type QualityFlag =
  | "stale"
  | "single_source"
  | "no_consulting_corroboration"
  | "low_confidence"
  | "wide_credible_interval"
  | "seed_only"
  | "no_evidence";

export interface CapabilityQualityRow {
  capabilityId: number;
  capabilitySlug: string;
  capabilityName: string;
  industryId: number;
  industryName: string;
  reviewStatus: string;
  isLeaf: boolean;
  sourceCount: number;
  distinctMethodologies: string[];
  lastQueriedAt: string | null;
  ageDays: number | null;
  consensusScore: number | null;
  confidence: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  ciWidth: number | null;
  flags: QualityFlag[];
  severity: "critical" | "warning" | "ok";
}

export interface SourceQualitySummary {
  totalCapabilities: number;
  totalLeaf: number;
  stale90d: number;
  singleSource: number;
  noConsultingCorroboration: number;
  lowConfidence: number;
  wideCredibleInterval: number;
  seedOnly: number;
  noEvidence: number;
  critical: number;
  warning: number;
  ok: number;
}

export interface SourceQualityResult {
  generatedAt: string;
  ttlSeconds: number;
  summary: SourceQualitySummary;
  capabilities: CapabilityQualityRow[];
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { at: number; value: SourceQualityResult } | null = null;
let inFlight: Promise<SourceQualityResult> | null = null;

const STALE_DAYS = 90;
const LOW_CONFIDENCE = 0.5;
const WIDE_CI = 30;

// Methodologies that count as "real" corroboration (not just news/seed).
// Adjust here if the enrichment pipeline introduces new high-quality source
// types — keep the consulting/academic/regulatory bucket explicit so the
// "no_consulting_corroboration" flag remains meaningful as evidence diversifies.
const CORROBORATING_METHODOLOGIES = new Set([
  "consulting",
  "consulting_report",
  "academic",
  "academic_paper",
  "regulatory",
  "standards_body",
  "industry_analyst",
  "gartner",
  "forrester",
  "mckinsey",
  "bcg",
  "bain",
]);

function deriveFlags(args: {
  sourceCount: number;
  distinctMethodologies: string[];
  ageDays: number | null;
  confidence: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  hasAnyEvidence: boolean;
}): { flags: QualityFlag[]; severity: "critical" | "warning" | "ok" } {
  const flags: QualityFlag[] = [];
  if (!args.hasAnyEvidence) flags.push("no_evidence");
  if (args.sourceCount === 1) flags.push("single_source");
  if (args.ageDays !== null && args.ageDays > STALE_DAYS) flags.push("stale");
  if (args.confidence !== null && args.confidence < LOW_CONFIDENCE) flags.push("low_confidence");
  if (args.ciLow !== null && args.ciHigh !== null && args.ciHigh - args.ciLow > WIDE_CI) {
    flags.push("wide_credible_interval");
  }
  const methSet = new Set(args.distinctMethodologies);
  const onlySeed = methSet.size > 0 && [...methSet].every(m => m === "perplexity-seeded" || m === "rollup_from_children");
  if (onlySeed) flags.push("seed_only");
  const hasCorroboration = [...methSet].some(m => CORROBORATING_METHODOLOGIES.has(m));
  if (args.hasAnyEvidence && !hasCorroboration && !onlySeed) {
    flags.push("no_consulting_corroboration");
  }

  // Severity: no_evidence/seed_only/no_consulting_corroboration/stale = critical;
  // single_source/low_confidence/wide_CI alone = warning; nothing flagged = ok.
  let severity: "critical" | "warning" | "ok" = "ok";
  if (flags.includes("no_evidence") || flags.includes("seed_only") || flags.includes("stale") || flags.includes("no_consulting_corroboration")) {
    severity = "critical";
  } else if (flags.length > 0) {
    severity = "warning";
  }
  return { flags, severity };
}

async function compute(): Promise<SourceQualityResult> {
  const [industries, capabilities, components, triRows] = await Promise.all([
    db.select().from(industriesTable),
    db.select().from(capabilitiesTable),
    db.select().from(cviComponentsTable),
    db.select({
      capabilityId: sourceTriangulationsTable.capabilityId,
      sourceLabel: sourceTriangulationsTable.sourceLabel,
      methodology: sourceTriangulationsTable.methodology,
      queriedAt: sourceTriangulationsTable.queriedAt,
    }).from(sourceTriangulationsTable),
  ]);

  const industryById = new Map(industries.map(i => [i.id, i]));

  // Aggregate triangulations per capability.
  type TriAgg = {
    sources: Set<string>;
    methodologies: Set<string>;
    latest: Date | null;
  };
  const triByCap = new Map<number, TriAgg>();
  for (const r of triRows) {
    let agg = triByCap.get(r.capabilityId);
    if (!agg) {
      agg = { sources: new Set(), methodologies: new Set(), latest: null };
      triByCap.set(r.capabilityId, agg);
    }
    agg.sources.add(r.sourceLabel);
    agg.methodologies.add(r.methodology);
    if (!agg.latest || r.queriedAt > agg.latest) agg.latest = r.queriedAt;
  }

  const compByCap = new Map(components.map(c => [c.capabilityId, c]));
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const rows: CapabilityQualityRow[] = capabilities.map(cap => {
    const tri = triByCap.get(cap.id);
    const comp = compByCap.get(cap.id);
    const sourceCount = tri?.sources.size ?? 0;
    const distinctMethodologies = tri ? [...tri.methodologies].sort() : [];
    const lastQueriedAt = tri?.latest ?? null;
    const ageDays = lastQueriedAt ? (now - lastQueriedAt.getTime()) / DAY : null;
    const consensusScore = comp?.consensusScore ?? null;
    const confidence = comp?.confidence ?? null;
    const ciLow = comp?.ciLow ?? null;
    const ciHigh = comp?.ciHigh ?? null;
    const ciWidth = ciLow !== null && ciHigh !== null ? ciHigh - ciLow : null;
    const hasAnyEvidence = sourceCount > 0;

    const { flags, severity } = deriveFlags({
      sourceCount,
      distinctMethodologies,
      ageDays,
      confidence,
      ciLow,
      ciHigh,
      hasAnyEvidence,
    });

    return {
      capabilityId: cap.id,
      capabilitySlug: cap.slug,
      capabilityName: cap.name,
      industryId: cap.industryId,
      industryName: industryById.get(cap.industryId)?.name ?? "Unknown",
      reviewStatus: cap.reviewStatus,
      isLeaf: cap.isLeaf,
      sourceCount,
      distinctMethodologies,
      lastQueriedAt: lastQueriedAt ? lastQueriedAt.toISOString() : null,
      ageDays: ageDays !== null ? Math.round(ageDays * 10) / 10 : null,
      consensusScore,
      confidence,
      ciLow,
      ciHigh,
      ciWidth: ciWidth !== null ? Math.round(ciWidth * 10) / 10 : null,
      flags,
      severity,
    };
  });

  // Order: critical first, then warning, then ok; within group most-stale first.
  const sevRank = { critical: 0, warning: 1, ok: 2 } as const;
  rows.sort((a, b) => {
    const s = sevRank[a.severity] - sevRank[b.severity];
    if (s !== 0) return s;
    const aAge = a.ageDays ?? -1;
    const bAge = b.ageDays ?? -1;
    return bAge - aAge;
  });

  const summary: SourceQualitySummary = {
    totalCapabilities: capabilities.length,
    totalLeaf: capabilities.filter(c => c.isLeaf).length,
    stale90d: rows.filter(r => r.flags.includes("stale")).length,
    singleSource: rows.filter(r => r.flags.includes("single_source")).length,
    noConsultingCorroboration: rows.filter(r => r.flags.includes("no_consulting_corroboration")).length,
    lowConfidence: rows.filter(r => r.flags.includes("low_confidence")).length,
    wideCredibleInterval: rows.filter(r => r.flags.includes("wide_credible_interval")).length,
    seedOnly: rows.filter(r => r.flags.includes("seed_only")).length,
    noEvidence: rows.filter(r => r.flags.includes("no_evidence")).length,
    critical: rows.filter(r => r.severity === "critical").length,
    warning: rows.filter(r => r.severity === "warning").length,
    ok: rows.filter(r => r.severity === "ok").length,
  };

  return {
    generatedAt: new Date().toISOString(),
    ttlSeconds: CACHE_TTL_MS / 1000,
    summary,
    capabilities: rows,
  };
}

export async function getSourceQualityAudit(force = false): Promise<SourceQualityResult> {
  if (!force && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  if (inFlight) return inFlight;
  inFlight = compute()
    .then(value => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export async function getCapabilityQuality(capabilityId: number): Promise<CapabilityQualityRow | null> {
  const audit = await getSourceQualityAudit();
  return audit.capabilities.find(c => c.capabilityId === capabilityId) ?? null;
}

export function _resetSourceQualityCacheForTest(): void {
  cached = null;
  inFlight = null;
}
