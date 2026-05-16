/**
 * Cross-industry capability analogue finder.
 *
 * "Fraud detection is mature in payments (CEI 82). The analogous capability
 *  in healthcare claims is emerging (CEI 51). 31-pt white-space gap."
 *
 * Implementation: reuse the BM25 semantic search index (services/semantic-search.ts)
 * to find the closest semantic match within a target industry. Compose with
 * cvi_components for posterior scores + capability.vcCapitalUsd/startupCount
 * for signal weighting.
 *
 * Returns the top N analogues with maturity gap and contextual signals so the
 * caller can render "white-space opportunity" cards.
 */
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  cviComponentsTable,
  industriesTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { searchCapabilities } from "./semantic-search";
import { deriveLifecycleStage } from "./lifecycle";

export interface AnalogueMatch {
  capabilityId: number;
  capabilityName: string;
  capabilityDescription: string;
  industryId: number;
  industryName: string;
  consensusScore: number | null;
  velocity: number | null;
  lifecycleStage: string;
  vcCapitalUsd: number;
  startupCount: number;
  patentCount: number;
  semanticScore: number;
  maturityGap: number | null;
  whiteSpaceSignal: "high" | "moderate" | "low";
}

export interface AnalogueResult {
  sourceCapability: {
    id: number;
    name: string;
    description: string;
    industryId: number;
    industryName: string;
    consensusScore: number | null;
    lifecycleStage: string;
  };
  targetIndustry: { id: number; name: string };
  matches: AnalogueMatch[];
  /** When matches is empty, this explains why — usually "no analogous capability detected." */
  diagnostic: string | null;
}

function classifyWhiteSpace(args: {
  gap: number | null;
  vcCapitalUsd: number;
  startupCount: number;
}): "high" | "moderate" | "low" {
  if (args.gap === null) return "low";
  // High: large gap + meaningful investment activity (capital flowing in,
  // suggesting the market knows it's white-space).
  const investmentPressure = (args.vcCapitalUsd / 1e9) + (args.startupCount / 25);
  if (args.gap >= 20 && investmentPressure >= 2) return "high";
  if (args.gap >= 15 || investmentPressure >= 3) return "moderate";
  return "low";
}

export async function findAnalogues(args: {
  capabilityId: number;
  targetIndustryId: number;
  limit?: number;
}): Promise<AnalogueResult | null> {
  const [source] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, args.capabilityId));
  if (!source) return null;
  const [sourceComp] = await db.select().from(cviComponentsTable).where(eq(cviComponentsTable.capabilityId, source.id));
  const [sourceInd] = await db.select().from(industriesTable).where(eq(industriesTable.id, source.industryId));
  const [targetInd] = await db.select().from(industriesTable).where(eq(industriesTable.id, args.targetIndustryId));
  if (!targetInd) return null;

  if (source.industryId === args.targetIndustryId) {
    return {
      sourceCapability: {
        id: source.id,
        name: source.name,
        description: source.description,
        industryId: source.industryId,
        industryName: sourceInd?.name ?? "Unknown",
        consensusScore: sourceComp?.consensusScore ?? null,
        lifecycleStage: deriveLifecycleStage({
          consensusScore: sourceComp?.consensusScore ?? null,
          velocity: sourceComp?.velocity ?? null,
          benchmarkScore: source.benchmarkScore,
        }),
      },
      targetIndustry: { id: targetInd.id, name: targetInd.name },
      matches: [],
      diagnostic: "Source and target industries are the same — pick a different target industry.",
    };
  }

  // Use the source capability's name + description as the query against the
  // semantic search index, restricted to the target industry. This finds the
  // closest semantic match in the target industry.
  const query = `${source.name} ${source.description}`;
  const search = await searchCapabilities({
    query,
    industryId: args.targetIndustryId,
    limit: Math.max(10, args.limit ?? 5),
  });

  if (search.results.length === 0) {
    return {
      sourceCapability: {
        id: source.id,
        name: source.name,
        description: source.description,
        industryId: source.industryId,
        industryName: sourceInd?.name ?? "Unknown",
        consensusScore: sourceComp?.consensusScore ?? null,
        lifecycleStage: deriveLifecycleStage({
          consensusScore: sourceComp?.consensusScore ?? null,
          velocity: sourceComp?.velocity ?? null,
          benchmarkScore: source.benchmarkScore,
        }),
      },
      targetIndustry: { id: targetInd.id, name: targetInd.name },
      matches: [],
      diagnostic: "No analogous capability detected in the target industry. This often IS the white-space signal — the capability doesn't exist there yet.",
    };
  }

  // Hydrate full data for top matches.
  const matchIds = search.results.map(r => r.capabilityId);
  const [caps, comps] = await Promise.all([
    db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, matchIds)),
    db.select().from(cviComponentsTable).where(inArray(cviComponentsTable.capabilityId, matchIds)),
  ]);
  const capById = new Map(caps.map(c => [c.id, c]));
  const compById = new Map(comps.map(c => [c.capabilityId, c]));
  const sourceScore = sourceComp?.consensusScore ?? source.benchmarkScore;

  const matches: AnalogueMatch[] = search.results.slice(0, args.limit ?? 5).map(r => {
    const c = capById.get(r.capabilityId)!;
    const comp = compById.get(r.capabilityId);
    const targetScore = comp?.consensusScore ?? c.benchmarkScore;
    const gap = targetScore !== null && sourceScore !== null ? Math.round((sourceScore - targetScore) * 100) / 100 : null;
    return {
      capabilityId: c.id,
      capabilityName: c.name,
      capabilityDescription: c.description,
      industryId: c.industryId,
      industryName: targetInd.name,
      consensusScore: comp?.consensusScore ?? null,
      velocity: comp?.velocity ?? null,
      lifecycleStage: deriveLifecycleStage({
        consensusScore: comp?.consensusScore ?? null,
        velocity: comp?.velocity ?? null,
        benchmarkScore: c.benchmarkScore,
      }),
      vcCapitalUsd: c.vcCapitalUsd ?? 0,
      startupCount: c.startupCount ?? 0,
      patentCount: c.patentCount ?? 0,
      semanticScore: r.score,
      maturityGap: gap,
      whiteSpaceSignal: classifyWhiteSpace({
        gap,
        vcCapitalUsd: c.vcCapitalUsd ?? 0,
        startupCount: c.startupCount ?? 0,
      }),
    };
  });

  return {
    sourceCapability: {
      id: source.id,
      name: source.name,
      description: source.description,
      industryId: source.industryId,
      industryName: sourceInd?.name ?? "Unknown",
      consensusScore: sourceComp?.consensusScore ?? null,
      lifecycleStage: deriveLifecycleStage({
        consensusScore: sourceComp?.consensusScore ?? null,
        velocity: sourceComp?.velocity ?? null,
        benchmarkScore: source.benchmarkScore,
      }),
    },
    targetIndustry: { id: targetInd.id, name: targetInd.name },
    matches,
    diagnostic: null,
  };
}

// silence unused-import
void and;
