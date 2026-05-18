/**
 * Capability stack assembly optimizer — AI-FIRST edition.
 *
 * Given a target stack — a set of capabilities the org wants to be top-quartile
 * in — produce a build / buy / outsource recommendation per gap.
 *
 * AI-FIRST changes (replacing the original heuristic rules engine):
 * 1. Neo4j graph traversal: findRelated() surfaces upstream capability blockers
 *    that must be resolved before the target capability can improve.
 * 2. Mem0 pattern recall: historical validated patterns about similar decisions
 *    are injected into the reasoning context.
 * 3. Claude Haiku: synthesizes a causal recommendation that explains the
 *    dependency chain and references historical evidence.
 * 4. Heuristic fallback: if AI services are unavailable, the original rules
 *    engine runs as a safety net.
 */
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  cviComponentsTable,
  capabilityDependenciesTable,
  organizationsTable,
  organizationCapabilitiesTable,
  marketplaceListingsTable,
  marketplaceSellersTable,
} from "@workspace/db";
import { inArray, eq, and, sql, desc, gte } from "drizzle-orm";
import { deriveLifecycleStage } from "./lifecycle";
import { findRelated } from "./agent/graphMemory";
import { recallMemories } from "./agent/memory";

export type Approach = "build" | "buy" | "outsource";

export interface BuildOption {
  approach: "build";
  estimatedDifficulty: number;     // 0–1, higher = harder
  estimatedTimeMonths: number;
  rationale: string;
}

export interface BuyOption {
  approach: "buy";
  candidates: Array<{ organizationId: number; organizationName: string; maturityScore: number; strategicImportance: string }>;
  rationale: string;
}

export interface OutsourceOption {
  approach: "outsource";
  listings: Array<{ listingId: number; title: string; sellerName: string | null; sellerTier: string | null; priceCents: number }>;
  rationale: string;
}

export interface CapabilityRecommendation {
  capabilityId: number;
  capabilityName: string;
  industryName: string;
  lifecycleStage: string;
  currentScore: number | null;
  targetScore: number;
  gap: number;
  recommended: Approach;
  rationale: string;
  /** Upstream capabilities that must be addressed before this one (from Neo4j graph traversal) */
  upstreamBlockers: Array<{ capabilityId: number; capabilityName: string; relationType: string; weight: number }>;
  /** Historical pattern context from Mem0 that informed this recommendation */
  patternContext: string | null;
  options: {
    build: BuildOption;
    buy: BuyOption;
    outsource: OutsourceOption;
  };
}

export interface StackOptimizerInput {
  targetCapabilityIds: number[];
  targetScore?: number;       // default 75 (top quartile heuristic)
  currentCapabilityScores?: Record<number, number>;  // override per-cap current
}

export interface StackOptimizerResult {
  input: StackOptimizerInput;
  generatedAt: string;
  recommendations: CapabilityRecommendation[];
  summary: {
    build: number;
    buy: number;
    outsource: number;
    totalGap: number;
    averageGap: number;
  };
}

const DEFAULT_TARGET = 75;

function buildDifficulty(args: {
  depCount: number;
  vcBillions: number;
  startupCount: number;
  patentCount: number;
}): number {
  const depPenalty = Math.min(0.3, args.depCount * 0.05);
  const vcPenalty = Math.min(0.3, args.vcBillions / 30);
  const competitorPenalty = Math.min(0.25, args.startupCount / 100);
  const patentPenalty = Math.min(0.15, args.patentCount / 5000);
  return Math.min(1, depPenalty + vcPenalty + competitorPenalty + patentPenalty + 0.2);
}

type UpstreamBlocker = { capabilityId: number; capabilityName: string; relationType: string; weight: number };
type RecommendationArgs = {
  capabilityId: number;
  capabilityName: string;
  industryName: string;
  buildDifficulty: number;
  buyCandidates: number;
  outsourceListings: number;
  gap: number;
  depCount: number;
  lifecycleStage: string;
};
type CapabilityContext = { upstreamBlockers: UpstreamBlocker[]; patternContext: string | null };

/**
 * Per-capability prefetch (Neo4j + Mem0). No LLM call.
 *
 * recommendStack calls this in parallel via Promise.all so a 50-capability
 * request triggers one fan-out, not 50 sequential per-capability prefetches.
 */
async function gatherCapabilityContext(args: { capabilityId: number; capabilityName: string; industryName: string }): Promise<CapabilityContext> {
  const [related, patterns] = await Promise.all([
    findRelated(args.capabilityId, 1).catch(() => [] as Awaited<ReturnType<typeof findRelated>>),
    recallMemories(
      `${args.capabilityName} ${args.industryName} build buy outsource recommendation decision`,
      "pattern",
      4,
    ).catch(() => []),
  ]);

  const upstreamBlockers: UpstreamBlocker[] = related
    .filter(r => r.weight > 0.4)
    .slice(0, 4)
    .map(r => ({
      capabilityId: r.entity.id,
      capabilityName: r.entity.name,
      relationType: r.relation,
      weight: r.weight,
    }));

  const patternContext = patterns.length > 0
    ? patterns.map(p => `- ${p.content}`).join("\n")
    : null;

  return { upstreamBlockers, patternContext };
}

/**
 * Heuristic recommender — safety net when the batched LLM call fails, returns
 * unparseable output, or omits a capability. Same rules engine as before the
 * AI-first upgrade, kept as a fallback rather than a primary path.
 */
function heuristicRecommend(args: RecommendationArgs): { approach: Approach; rationale: string } {
  if (args.buyCandidates >= 1 && args.gap >= 15 && args.buildDifficulty > 0.6) {
    return { approach: "buy", rationale: `Large gap (${args.gap.toFixed(1)} pts) and build difficulty is high — acquisition or talent raid is faster.` };
  }
  if (args.outsourceListings >= 1 && args.gap < 15) {
    return { approach: "outsource", rationale: `Modest gap (${args.gap.toFixed(1)} pts) with marketplace coverage — outsource is the lowest-friction path.` };
  }
  if (args.buildDifficulty < 0.5) {
    return { approach: "build", rationale: `Build difficulty is low (${args.buildDifficulty.toFixed(2)}) — in-house is cost-effective.` };
  }
  if (args.buyCandidates >= 1) {
    return { approach: "buy", rationale: "Build is hard and buy candidates exist — acquisition recommended." };
  }
  return { approach: "build", rationale: "Default to build — no buy candidates and no outsource listings yet." };
}

/**
 * AI-FIRST: Batched graph-aware causal recommendation.
 *
 * Bundles all capabilities in a recommendStack request into ONE Haiku call
 * rather than one call per capability. For a typical agent-driven request of
 * 5–15 capabilities this cuts Haiku invocations by 5–15× with no loss of
 * per-capability reasoning — the prompt gives the model the full per-capability
 * context (upstream blockers, historical patterns, metrics) for each item.
 *
 * Returns a Map keyed by capabilityId. Any capability that fails parsing or
 * validation is filled in from heuristicRecommend() by the caller.
 */
async function batchHaikuRecommend(
  items: Array<{ args: RecommendationArgs; context: CapabilityContext }>,
): Promise<Map<number, { approach: Approach; rationale: string }>> {
  const out = new Map<number, { approach: Approach; rationale: string }>();
  if (items.length === 0) return out;

  try {
    const { generateObject } = await import("ai");
    const { z } = await import("zod");
    const { haiku } = await import("./workflows/models");

    const RecommendationsSchema = z.object({
      recommendations: z.array(z.object({
        capabilityId: z.number().int(),
        approach: z.enum(["build", "buy", "outsource"]),
        rationale: z.string().min(20),
      })),
    });

    const capabilityBlocks = items.map(({ args, context }, idx) => {
      const blockerText = context.upstreamBlockers.length > 0
        ? `  Upstream blockers (must address before this one):\n${context.upstreamBlockers.map(b =>
            `    - ${b.capabilityName} (${b.relationType}, ${(b.weight * 100).toFixed(0)}%)`
          ).join("\n")}`
        : "  No upstream blockers identified.";
      const patternText = context.patternContext
        ? `  Historical patterns:\n${context.patternContext.split("\n").map(l => "  " + l).join("\n")}`
        : "  No historical patterns on file.";
      return `[${idx + 1}] capabilityId=${args.capabilityId}, name=${args.capabilityName}, industry=${args.industryName}
  Lifecycle: ${args.lifecycleStage} · Gap: ${args.gap.toFixed(1)}pts · Build difficulty: ${(args.buildDifficulty * 100).toFixed(0)}/100 · Deps: ${args.depCount}
  Buy candidates: ${args.buyCandidates} · Outsource listings: ${args.outsourceListings}
${blockerText}
${patternText}`;
    }).join("\n\n");

    const system = `You are a capability economics advisor making build/buy/outsource recommendations.

Reasoning rules per capability:
- If upstream blockers with strength > 60% exist, the rationale should call out addressing those first.
- If historical patterns validate a prior recommendation, weight it heavily.
- If historical patterns contradict, explain why this situation differs.
- Large gap (>20pts) + high difficulty (>70) + buy candidates → buy.
- Small gap (<10pts) + outsource listings → outsource.
- Low difficulty (<50) → build regardless of gap.

Each rationale is 2-3 sentences referencing upstream blockers and historical patterns when present. Return one recommendation per input capability in the same order.`;

    const { object } = await generateObject({
      model: haiku,
      schema: RecommendationsSchema,
      system,
      prompt: `Make build/buy/outsource recommendations for ${items.length} capabilities:\n\n${capabilityBlocks}`,
      temperature: 0.2,
      maxTokens: Math.min(8000, 400 * items.length + 200),
    });

    for (const row of object.recommendations) {
      out.set(row.capabilityId, { approach: row.approach, rationale: row.rationale });
    }
  } catch {
    // Non-fatal — caller falls back to heuristicRecommend for any missing IDs
  }
  return out;
}

/**
 * Legacy single-capability wrapper preserved for callers that want a one-off
 * recommendation. Internally delegates to gatherCapabilityContext +
 * batchHaikuRecommend with a one-item array. Most usage should go through
 * recommendStack(), which batches.
 */
async function pickRecommendedAI(args: RecommendationArgs): Promise<{
  approach: Approach;
  rationale: string;
  upstreamBlockers: UpstreamBlocker[];
  patternContext: string | null;
}> {
  const context = await gatherCapabilityContext({
    capabilityId: args.capabilityId,
    capabilityName: args.capabilityName,
    industryName: args.industryName,
  });
  const llmResults = await batchHaikuRecommend([{ args, context }]);
  const llm = llmResults.get(args.capabilityId);
  const pick = llm ?? heuristicRecommend(args);
  return { approach: pick.approach, rationale: pick.rationale, upstreamBlockers: context.upstreamBlockers, patternContext: context.patternContext };
}

export async function recommendStack(input: StackOptimizerInput): Promise<StackOptimizerResult> {
  const target = input.targetScore ?? DEFAULT_TARGET;
  const targetIds = Array.from(new Set(input.targetCapabilityIds));
  if (targetIds.length === 0) {
    return {
      input,
      generatedAt: new Date().toISOString(),
      recommendations: [],
      summary: { build: 0, buy: 0, outsource: 0, totalGap: 0, averageGap: 0 },
    };
  }

  const [caps, components, allDeps, orgCaps, orgs, listings] = await Promise.all([
    db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, targetIds)),
    db.select().from(cviComponentsTable).where(inArray(cviComponentsTable.capabilityId, targetIds)),
    db.select().from(capabilityDependenciesTable).where(inArray(capabilityDependenciesTable.capabilityId, targetIds)),
    db.select().from(organizationCapabilitiesTable).where(inArray(organizationCapabilitiesTable.capabilityId, targetIds)),
    db.select().from(organizationsTable),
    db
      .select({
        listing: marketplaceListingsTable,
        sellerName: marketplaceSellersTable.displayName,
        sellerTier: marketplaceSellersTable.tier,
      })
      .from(marketplaceListingsTable)
      .leftJoin(marketplaceSellersTable, eq(marketplaceListingsTable.sellerId, marketplaceSellersTable.id))
      .where(and(
        eq(marketplaceListingsTable.status, "approved"),
        eq(marketplaceListingsTable.type, "service"),
      )),
  ]);

  const { industriesTable } = await import("@workspace/db");
  const allIndustries = await db.select().from(industriesTable);
  const indNameById = new Map(allIndustries.map(i => [i.id, i.name]));

  const compByCap = new Map(components.map(c => [c.capabilityId, c]));
  const depCountByCap = new Map<number, number>();
  for (const d of allDeps) depCountByCap.set(d.capabilityId, (depCountByCap.get(d.capabilityId) ?? 0) + 1);

  const orgsById = new Map(orgs.map(o => [o.id, o]));

  // ── Phase 1: deterministic per-capability data (no LLM, no remote calls) ───
  type CapPlan = {
    cap: typeof caps[number];
    args: RecommendationArgs;
    buildOption: BuildOption;
    buyOption: BuyOption;
    outsourceOption: OutsourceOption;
    current: number | null;
    gap: number;
    lifecycleStage: string;
  };
  const plans: CapPlan[] = [];
  let totalGap = 0;

  for (const cap of caps) {
    const comp = compByCap.get(cap.id);
    const current = input.currentCapabilityScores?.[cap.id]
      ?? comp?.consensusScore
      ?? cap.benchmarkScore
      ?? null;
    const gap = current !== null ? Math.max(0, target - current) : target;
    totalGap += gap;

    const difficulty = buildDifficulty({
      depCount: depCountByCap.get(cap.id) ?? 0,
      vcBillions: (cap.vcCapitalUsd ?? 0) / 1e9,
      startupCount: cap.startupCount ?? 0,
      patentCount: cap.patentCount ?? 0,
    });

    const buildOption: BuildOption = {
      approach: "build",
      estimatedDifficulty: Math.round(difficulty * 100) / 100,
      estimatedTimeMonths: Math.round(12 + difficulty * 24),
      rationale: `${(depCountByCap.get(cap.id) ?? 0)} deps · $${((cap.vcCapitalUsd ?? 0) / 1e9).toFixed(1)}B VC · ${cap.startupCount ?? 0} startups · ${cap.patentCount ?? 0} patents`,
    };

    const candidates = orgCaps
      .filter(oc => oc.capabilityId === cap.id && oc.maturityScore >= 60)
      .sort((a, b) => b.maturityScore - a.maturityScore)
      .slice(0, 5)
      .map(oc => ({
        organizationId: oc.organizationId,
        organizationName: orgsById.get(oc.organizationId)?.name ?? `Org #${oc.organizationId}`,
        maturityScore: oc.maturityScore,
        strategicImportance: oc.strategicImportance,
      }));

    const buyOption: BuyOption = {
      approach: "buy",
      candidates,
      rationale: candidates.length > 0
        ? `${candidates.length} organizations with maturity ≥60 — top: ${candidates[0]?.organizationName} (${candidates[0]?.maturityScore.toFixed(1)})`
        : "No organizations with high-maturity coverage of this capability on file.",
    };

    const slugLc = cap.slug.toLowerCase();
    const nameLc = cap.name.toLowerCase();
    const matchedListings = listings.filter(l => {
      const tags = ((l.listing.tags ?? []) as string[]).map(t => t.toLowerCase());
      if (tags.includes(slugLc)) return true;
      const blob = `${l.listing.title} ${l.listing.description}`.toLowerCase();
      return blob.includes(slugLc) || blob.includes(nameLc);
    }).slice(0, 5).map(l => ({
      listingId: l.listing.id,
      title: l.listing.title,
      sellerName: l.sellerName,
      sellerTier: l.sellerTier,
      priceCents: l.listing.priceCents,
    }));

    const outsourceOption: OutsourceOption = {
      approach: "outsource",
      listings: matchedListings,
      rationale: matchedListings.length > 0
        ? `${matchedListings.length} marketplace services match this capability.`
        : "No marketplace services match this capability yet.",
    };

    const lifecycleStage = deriveLifecycleStage({
      consensusScore: comp?.consensusScore ?? null,
      velocity: comp?.velocity ?? null,
      benchmarkScore: cap.benchmarkScore,
    });

    plans.push({
      cap,
      args: {
        capabilityId: cap.id,
        capabilityName: cap.name,
        industryName: indNameById.get(cap.industryId) ?? "Unknown",
        buildDifficulty: difficulty,
        buyCandidates: candidates.length,
        outsourceListings: matchedListings.length,
        gap,
        depCount: depCountByCap.get(cap.id) ?? 0,
        lifecycleStage,
      },
      buildOption,
      buyOption,
      outsourceOption,
      current,
      gap,
      lifecycleStage,
    });
  }

  // ── Phase 2: parallel context prefetch (Neo4j + Mem0) for every capability ─
  const contexts = await Promise.all(
    plans.map(p => gatherCapabilityContext({
      capabilityId: p.args.capabilityId,
      capabilityName: p.args.capabilityName,
      industryName: p.args.industryName,
    })),
  );

  // ── Phase 3: ONE batched Haiku call covering all capabilities ──────────────
  // Replaces N per-capability Haiku invocations (was 1 LLM call per cap) with a
  // single batched prompt — keeps the per-cap reasoning while cutting cost and
  // latency by ~Nx for typical 5–15 cap agent requests.
  const llmResults = await batchHaikuRecommend(
    plans.map((p, i) => ({ args: p.args, context: contexts[i]! })),
  );

  // ── Phase 4: assemble final recommendations ────────────────────────────────
  const recommendations: CapabilityRecommendation[] = [];
  let buildCount = 0, buyCount = 0, outsourceCount = 0;

  plans.forEach((p, i) => {
    const context = contexts[i]!;
    const llm = llmResults.get(p.args.capabilityId);
    const pick = llm ?? heuristicRecommend(p.args);

    if (pick.approach === "build") buildCount += 1;
    else if (pick.approach === "buy") buyCount += 1;
    else outsourceCount += 1;

    recommendations.push({
      capabilityId: p.cap.id,
      capabilityName: p.cap.name,
      industryName: indNameById.get(p.cap.industryId) ?? "Unknown",
      lifecycleStage: p.lifecycleStage,
      currentScore: p.current !== null ? Math.round(p.current * 100) / 100 : null,
      targetScore: target,
      gap: Math.round(p.gap * 100) / 100,
      recommended: pick.approach,
      rationale: pick.rationale,
      upstreamBlockers: context.upstreamBlockers,
      patternContext: context.patternContext,
      options: { build: p.buildOption, buy: p.buyOption, outsource: p.outsourceOption },
    });
  });

  recommendations.sort((a, b) => b.gap - a.gap);

  return {
    input,
    generatedAt: new Date().toISOString(),
    recommendations,
    summary: {
      build: buildCount,
      buy: buyCount,
      outsource: outsourceCount,
      totalGap: Math.round(totalGap * 100) / 100,
      averageGap: recommendations.length > 0 ? Math.round((totalGap / recommendations.length) * 100) / 100 : 0,
    },
  };
}

// satisfy unused-import linters
void desc;
void gte;
void sql;
