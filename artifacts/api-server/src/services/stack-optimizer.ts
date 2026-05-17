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

/**
 * AI-FIRST: Graph-aware causal recommendation engine.
 *
 * Replaces the original static if/else rules engine with:
 * 1. Neo4j upstream blocker traversal
 * 2. Mem0 historical pattern recall
 * 3. Claude Haiku causal synthesis
 * 4. Heuristic fallback if AI is unavailable
 */
async function pickRecommendedAI(args: {
  capabilityId: number;
  capabilityName: string;
  industryName: string;
  buildDifficulty: number;
  buyCandidates: number;
  outsourceListings: number;
  gap: number;
  depCount: number;
  lifecycleStage: string;
}): Promise<{
  approach: Approach;
  rationale: string;
  upstreamBlockers: Array<{ capabilityId: number; capabilityName: string; relationType: string; weight: number }>;
  patternContext: string | null;
}> {
  // ── Step 1: Neo4j graph traversal for upstream blockers ─────────────────
  // findRelated traverses 1 hop in the capability graph to surface
  // co-dependent capabilities. Strong relationships (weight > 0.4) indicate
  // capabilities that must move together — ignoring them leads to wasted spend.
  let upstreamBlockers: Array<{ capabilityId: number; capabilityName: string; relationType: string; weight: number }> = [];
  try {
    const related = await findRelated(args.capabilityId, 1);
    upstreamBlockers = related
      .filter(r => r.weight > 0.4)
      .slice(0, 4)
      .map(r => ({
        capabilityId: r.entityId,
        capabilityName: r.label,
        relationType: r.relationType,
        weight: r.weight,
      }));
  } catch {
    // Non-fatal — proceed without graph context
  }

  // ── Step 2: Mem0 historical pattern recall ──────────────────────────────
  // Recall validated patterns about similar build/buy/outsource decisions
  // for this capability and industry. These represent accumulated evidence
  // from prior research cycles that should inform the current recommendation.
  let patternContext: string | null = null;
  try {
    const patterns = await recallMemories(
      `${args.capabilityName} ${args.industryName} build buy outsource recommendation decision`,
      "pattern",
      4,
    );
    if (patterns.length > 0) {
      patternContext = patterns.map(p => `- ${p.content}`).join("\n");
    }
  } catch {
    // Non-fatal
  }

  // ── Step 3: Claude Haiku causal synthesis ───────────────────────────────
  // Synthesize a recommendation that explains the causal chain:
  // gap → dependency blockers → historical evidence → approach
  try {
    const { anthropic } = await import("@workspace/integrations-anthropic-ai");

    const blockerText = upstreamBlockers.length > 0
      ? `Upstream capability dependencies (must address before this one):\n${upstreamBlockers.map(b =>
          `  - ${b.capabilityName} (relationship: ${b.relationType}, strength: ${(b.weight * 100).toFixed(0)}%)`
        ).join("\n")}`
      : "No upstream blockers identified in the capability graph.";

    const patternText = patternContext
      ? `Historical patterns from prior research cycles:\n${patternContext}`
      : "No historical patterns on file for this capability.";

    const prompt = `You are a capability economics advisor making a build/buy/outsource recommendation.

Capability: ${args.capabilityName}
Industry: ${args.industryName}
Lifecycle stage: ${args.lifecycleStage}
Current gap to target: ${args.gap.toFixed(1)} points
Build difficulty score: ${(args.buildDifficulty * 100).toFixed(0)}/100 (higher = harder to build in-house)
Dependency count: ${args.depCount}
Buy candidates available: ${args.buyCandidates}
Outsource listings available: ${args.outsourceListings}

${blockerText}

${patternText}

Based on the gap, difficulty, dependency chain, and historical patterns, recommend ONE of: build, buy, or outsource.

Key reasoning rules:
- If upstream blockers exist with strength > 60%, address those first before investing in this capability
- If historical patterns show a prior recommendation was validated, weight it heavily
- If historical patterns show a contradiction, explain why this situation differs
- Large gap (>20pts) + high difficulty (>70) + buy candidates = buy
- Small gap (<10pts) + outsource listings = outsource
- Low difficulty (<50) = build regardless of gap

Respond with ONLY valid JSON (no markdown):
{
  "approach": "build" | "buy" | "outsource",
  "rationale": "2-3 sentences explaining the causal reasoning. Reference upstream blockers if they exist. Reference historical patterns if they confirm or contradict this recommendation."
}`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 350,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { approach: Approach; rationale: string };
      if (["build", "buy", "outsource"].includes(parsed.approach)) {
        return { approach: parsed.approach, rationale: parsed.rationale, upstreamBlockers, patternContext };
      }
    }
  } catch {
    // Fall through to heuristic fallback
  }

  // ── Fallback: original heuristic rules engine ───────────────────────────
  if (args.buyCandidates >= 1 && args.gap >= 15 && args.buildDifficulty > 0.6) {
    return { approach: "buy", rationale: `Large gap (${args.gap.toFixed(1)} pts) and build difficulty is high — acquisition or talent raid is faster.`, upstreamBlockers, patternContext };
  }
  if (args.outsourceListings >= 1 && args.gap < 15) {
    return { approach: "outsource", rationale: `Modest gap (${args.gap.toFixed(1)} pts) with marketplace coverage — outsource is the lowest-friction path.`, upstreamBlockers, patternContext };
  }
  if (args.buildDifficulty < 0.5) {
    return { approach: "build", rationale: `Build difficulty is low (${args.buildDifficulty.toFixed(2)}) — in-house is cost-effective.`, upstreamBlockers, patternContext };
  }
  if (args.buyCandidates >= 1) {
    return { approach: "buy", rationale: "Build is hard and buy candidates exist — acquisition recommended.", upstreamBlockers, patternContext };
  }
  return { approach: "build", rationale: "Default to build — no buy candidates and no outsource listings yet.", upstreamBlockers, patternContext };
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

  const recommendations: CapabilityRecommendation[] = [];
  let buildCount = 0, buyCount = 0, outsourceCount = 0;
  let totalGap = 0;

  // Process capabilities sequentially to avoid overwhelming AI services
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

    // ── AI-FIRST: Graph-aware causal recommendation ──────────────────────
    const pick = await pickRecommendedAI({
      capabilityId: cap.id,
      capabilityName: cap.name,
      industryName: indNameById.get(cap.industryId) ?? "Unknown",
      buildDifficulty: difficulty,
      buyCandidates: candidates.length,
      outsourceListings: matchedListings.length,
      gap,
      depCount: depCountByCap.get(cap.id) ?? 0,
      lifecycleStage,
    });

    if (pick.approach === "build") buildCount += 1;
    else if (pick.approach === "buy") buyCount += 1;
    else outsourceCount += 1;

    recommendations.push({
      capabilityId: cap.id,
      capabilityName: cap.name,
      industryName: indNameById.get(cap.industryId) ?? "Unknown",
      lifecycleStage,
      currentScore: current !== null ? Math.round(current * 100) / 100 : null,
      targetScore: target,
      gap: Math.round(gap * 100) / 100,
      recommended: pick.approach,
      rationale: pick.rationale,
      upstreamBlockers: pick.upstreamBlockers,
      patternContext: pick.patternContext,
      options: { build: buildOption, buy: buyOption, outsource: outsourceOption },
    });
  }

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
