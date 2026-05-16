/**
 * Capability stack assembly optimizer.
 *
 * Given a target stack — a set of capabilities the org wants to be top-quartile
 * in — produce a build / buy / outsource recommendation per gap.
 *
 * "Build" cost is heuristic: a function of the capability's complexity (number
 * of dependencies) and the current incumbent count (more startups + more VC =
 * harder to outcompete from scratch). It is NOT a real $$ estimate — surface
 * it as a *relative* difficulty score so analysts can rank, not invoice.
 *
 * "Buy" surfaces companies whose capability profile already includes the
 * target capability — taken from organization_capabilities — sorted by their
 * maturityScore on that capability. The recommendation is to acquire one
 * (M&A) or hire from one (talent raid).
 *
 * "Outsource" surfaces marketplace listings of type "service" whose tags
 * include the capability slug. Falls back to "no current options" when no
 * matching service exists in the marketplace.
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
  // Higher dep count / vc / startups / patents = harder to build from scratch
  // because the incumbents are entrenched and the technical surface is large.
  const depPenalty = Math.min(0.3, args.depCount * 0.05);
  const vcPenalty = Math.min(0.3, args.vcBillions / 30);
  const competitorPenalty = Math.min(0.25, args.startupCount / 100);
  const patentPenalty = Math.min(0.15, args.patentCount / 5000);
  return Math.min(1, depPenalty + vcPenalty + competitorPenalty + patentPenalty + 0.2);
}

function pickRecommended(args: {
  buildDifficulty: number;
  buyCandidates: number;
  outsourceListings: number;
  gap: number;
}): { approach: Approach; rationale: string } {
  // Cheap rules engine — adjustable. Higher gap + low buy candidates = build;
  // medium gap + buy candidates exist = buy; small gap = outsource if a
  // listing exists, else build.
  if (args.buyCandidates >= 1 && args.gap >= 15 && args.buildDifficulty > 0.6) {
    return {
      approach: "buy",
      rationale: `Large gap (${args.gap.toFixed(1)} pts) and build difficulty is high — acquisition or talent raid is faster.`,
    };
  }
  if (args.outsourceListings >= 1 && args.gap < 15) {
    return {
      approach: "outsource",
      rationale: `Modest gap (${args.gap.toFixed(1)} pts) with marketplace coverage — outsource is the lowest-friction path.`,
    };
  }
  if (args.buildDifficulty < 0.5) {
    return {
      approach: "build",
      rationale: `Build difficulty is low (${args.buildDifficulty.toFixed(2)}) — in-house is cost-effective.`,
    };
  }
  if (args.buyCandidates >= 1) {
    return {
      approach: "buy",
      rationale: `Build is hard and buy candidates exist — acquisition recommended.`,
    };
  }
  return {
    approach: "build",
    rationale: "Default to build — no buy candidates and no outsource listings yet.",
  };
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

  // Industry name resolution.
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
      estimatedTimeMonths: Math.round(12 + difficulty * 24), // 12mo baseline, up to +24
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

    // Outsource match: service listings whose tags include the cap slug OR whose
    // title/description contains the cap slug as a word.
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

    const pick = pickRecommended({
      buildDifficulty: difficulty,
      buyCandidates: candidates.length,
      outsourceListings: matchedListings.length,
      gap,
    });
    if (pick.approach === "build") buildCount += 1;
    else if (pick.approach === "buy") buyCount += 1;
    else outsourceCount += 1;

    recommendations.push({
      capabilityId: cap.id,
      capabilityName: cap.name,
      industryName: indNameById.get(cap.industryId) ?? "Unknown",
      lifecycleStage: deriveLifecycleStage({
        consensusScore: comp?.consensusScore ?? null,
        velocity: comp?.velocity ?? null,
        benchmarkScore: cap.benchmarkScore,
      }),
      currentScore: current !== null ? Math.round(current * 100) / 100 : null,
      targetScore: target,
      gap: Math.round(gap * 100) / 100,
      recommended: pick.approach,
      rationale: pick.rationale,
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
