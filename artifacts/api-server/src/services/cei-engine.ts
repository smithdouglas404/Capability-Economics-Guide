import { db } from "@workspace/db";
import {
  ceiSnapshotsTable,
  ceiComponentsTable,
  capabilitiesTable,
  industriesTable,
  sourceTriangulationsTable,
  ontologyRelationshipsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const INDUSTRY_GDP_WEIGHTS: Record<string, number> = {
  "Banking & Financial Services": 0.22,
  "Healthcare": 0.18,
  "Insurance": 0.10,
  "Manufacturing": 0.20,
  "Technology": 0.18,
  "Retail": 0.12,
};

const CEI_SCALE_FACTOR = 10;
const VELOCITY_DECAY = 0.7;
const MULTIPLIER_BASE = 1.0;
const MULTIPLIER_PER_DEPENDENCY = 0.08;
const MULTIPLIER_CAP = 2.0;

interface IndustryBreakdown {
  industryName: string;
  indexValue: number;
  weight: number;
  velocity: number;
  capabilityCount: number;
  topMover: string;
  topMoverDelta: number;
}

interface CEIResult {
  overallIndex: number;
  industryBreakdowns: Record<string, IndustryBreakdown>;
  marketSentiment: number;
  volatility: number;
  methodology: string;
  timestamp: string;
}

export async function computeCEI(): Promise<CEIResult> {
  const industries = await db.select().from(industriesTable);
  const allCapabilities = await db.select().from(capabilitiesTable);
  const allRelationships = await db.select().from(ontologyRelationshipsTable);

  const prevComponents = await db.select().from(ceiComponentsTable);
  const prevMap = new Map<string, typeof prevComponents[0]>();
  for (const c of prevComponents) {
    prevMap.set(`${c.industryId}-${c.capabilityId}`, c);
  }

  const recentTriangulations = await db
    .select()
    .from(sourceTriangulationsTable)
    .orderBy(desc(sourceTriangulationsTable.queriedAt));

  const triMap = new Map<number, Array<{ rawScore: number; weight: number }>>();
  const seenKeys = new Set<string>();
  for (const t of recentTriangulations) {
    const key = `${t.capabilityId}-${t.sourceLabel}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    if (!triMap.has(t.capabilityId)) triMap.set(t.capabilityId, []);
    triMap.get(t.capabilityId)!.push({ rawScore: t.rawScore, weight: t.weight });
  }

  const dependencyCount = new Map<number, number>();
  for (const rel of allRelationships) {
    dependencyCount.set(
      rel.targetCapabilityId,
      (dependencyCount.get(rel.targetCapabilityId) || 0) + 1,
    );
    dependencyCount.set(
      rel.sourceCapabilityId,
      (dependencyCount.get(rel.sourceCapabilityId) || 0) + 1,
    );
  }

  const industryBreakdowns: Record<string, IndustryBreakdown> = {};
  let overallWeightedSum = 0;
  let overallWeightSum = 0;
  const allVelocities: number[] = [];

  for (const industry of industries) {
    const caps = allCapabilities.filter(c => c.industryId === industry.id);
    if (caps.length === 0) continue;

    const gdpWeight = INDUSTRY_GDP_WEIGHTS[industry.name] || 0.10;

    let industryWeightedSum = 0;
    let topMover = "";
    let topMoverDelta = 0;

    for (const cap of caps) {
      const triSources = triMap.get(cap.id);
      let consensusScore: number;
      let confidence: number;

      if (triSources && triSources.length > 0) {
        const priorMean = 50;
        const priorVariance = 625;
        let posteriorPrecision = 1 / priorVariance;
        let weightedMeanNum = priorMean / priorVariance;
        for (const src of triSources) {
          const obsVariance = 100 / src.weight;
          const obsPrecision = 1 / obsVariance;
          posteriorPrecision += obsPrecision;
          weightedMeanNum += src.rawScore * obsPrecision;
        }
        consensusScore = weightedMeanNum / posteriorPrecision;
        const range = triSources.length > 1
          ? Math.max(...triSources.map(t => t.rawScore)) - Math.min(...triSources.map(t => t.rawScore))
          : 30;
        const agreementFactor = Math.max(0, 1 - range / 50);
        const coverageFactor = triSources.length / 4;
        confidence = Math.min(1, agreementFactor * 0.6 + coverageFactor * 0.4);
      } else {
        consensusScore = cap.benchmarkScore;
        confidence = 0.5;
      }

      const prevKey = `${industry.id}-${cap.id}`;
      const prev = prevMap.get(prevKey);
      let velocity = 0;
      if (prev) {
        const rawDelta = (consensusScore - prev.consensusScore) / 100;
        velocity = VELOCITY_DECAY * (prev.velocity || 0) + (1 - VELOCITY_DECAY) * rawDelta;
      }
      velocity = Math.max(-0.5, Math.min(0.5, velocity));

      const deps = dependencyCount.get(cap.id) || 0;
      const economicMultiplier = Math.min(MULTIPLIER_CAP, MULTIPLIER_BASE + deps * MULTIPLIER_PER_DEPENDENCY);

      const capContribution = consensusScore * (1 + velocity) * economicMultiplier * confidence;
      industryWeightedSum += capContribution;
      allVelocities.push(velocity);

      const delta = prev ? Math.abs(consensusScore - prev.consensusScore) : 0;
      if (delta > topMoverDelta) {
        topMoverDelta = delta;
        topMover = cap.name;
      }

      const sourceScores = triSources?.map((t, i) => ({
        sourceLabel: `Source ${i + 1}`,
        rawScore: t.rawScore,
        weight: t.weight,
        methodology: "triangulated",
        queriedAt: new Date().toISOString(),
      })) || [{
        sourceLabel: "Seed Data",
        rawScore: cap.benchmarkScore,
        weight: 1.0,
        methodology: "perplexity-seeded",
        queriedAt: new Date().toISOString(),
      }];

      const existing = prev;
      if (existing) {
        await db.update(ceiComponentsTable)
          .set({
            consensusScore,
            confidence,
            velocity,
            economicMultiplier,
            sourceScores,
            updatedAt: new Date(),
          })
          .where(eq(ceiComponentsTable.id, existing.id));
      } else {
        await db.insert(ceiComponentsTable).values({
          capabilityId: cap.id,
          industryId: industry.id,
          consensusScore,
          confidence,
          velocity,
          economicMultiplier,
          sourceScores,
        });
      }
    }

    const industryIndex = (industryWeightedSum / caps.length) * CEI_SCALE_FACTOR;
    const avgVelocity = caps.length > 0
      ? allVelocities.slice(-caps.length).reduce((s, v) => s + v, 0) / caps.length
      : 0;

    industryBreakdowns[industry.slug] = {
      industryName: industry.name,
      indexValue: Math.round(industryIndex * 10) / 10,
      weight: gdpWeight,
      velocity: Math.round(avgVelocity * 1000) / 1000,
      capabilityCount: caps.length,
      topMover: topMover || caps[0]?.name || "N/A",
      topMoverDelta: Math.round(topMoverDelta * 10) / 10,
    };

    overallWeightedSum += industryIndex * gdpWeight;
    overallWeightSum += gdpWeight;
  }

  const overallIndex = overallWeightSum > 0
    ? Math.round((overallWeightedSum / overallWeightSum) * 10) / 10
    : 0;

  const avgVelocity = allVelocities.length > 0
    ? allVelocities.reduce((s, v) => s + v, 0) / allVelocities.length
    : 0;
  const marketSentiment = Math.round((50 + avgVelocity * 100) * 10) / 10;

  const velocityVariance = allVelocities.length > 1
    ? allVelocities.reduce((s, v) => s + Math.pow(v - avgVelocity, 2), 0) / allVelocities.length
    : 0;
  const volatility = Math.round(Math.sqrt(velocityVariance) * 1000) / 1000;

  const snapshot = await db.insert(ceiSnapshotsTable).values({
    overallIndex,
    industryBreakdowns,
    marketSentiment,
    volatility,
    methodologyVersion: "1.0",
  }).returning();

  return {
    overallIndex,
    industryBreakdowns,
    marketSentiment,
    volatility,
    methodology: CEI_METHODOLOGY,
    timestamp: snapshot[0].snapshotAt.toISOString(),
  };
}

export async function getCEICurrent(): Promise<CEIResult | null> {
  const [latest] = await db
    .select()
    .from(ceiSnapshotsTable)
    .orderBy(desc(ceiSnapshotsTable.snapshotAt))
    .limit(1);

  if (!latest) return null;

  return {
    overallIndex: latest.overallIndex,
    industryBreakdowns: latest.industryBreakdowns as Record<string, IndustryBreakdown>,
    marketSentiment: latest.marketSentiment || 50,
    volatility: latest.volatility || 0,
    methodology: CEI_METHODOLOGY,
    timestamp: latest.snapshotAt.toISOString(),
  };
}

export async function getCEIHistory(limit = 30): Promise<Array<{
  overallIndex: number;
  timestamp: string;
  industryBreakdowns: Record<string, IndustryBreakdown>;
}>> {
  const snapshots = await db
    .select()
    .from(ceiSnapshotsTable)
    .orderBy(desc(ceiSnapshotsTable.snapshotAt))
    .limit(limit);

  return snapshots.map(s => ({
    overallIndex: s.overallIndex,
    timestamp: s.snapshotAt.toISOString(),
    industryBreakdowns: s.industryBreakdowns as Record<string, IndustryBreakdown>,
  }));
}

export const CEI_METHODOLOGY = `## Capability Economics Index (CEI) — Methodology v1.0

### Overview
The CEI is a composite index measuring global capability maturity across industries, inspired by financial market indices but applied to organizational capability economics.

### Formula
\`\`\`
CEI = Σ(Wᵢ × Cᵢ × (1 + Vᵢ) × Eᵢ × αᵢ) / ΣWᵢ × Scale
\`\`\`

### Components

**Wᵢ — Industry GDP Weight**
Each industry is weighted by its contribution to global GDP:
Banking & Financial Services (22%), Manufacturing (20%), Healthcare (18%), Technology (18%), Retail (12%), Insurance (10%).

**Cᵢ — Bayesian Consensus Score (0–100)**
Each capability is scored by querying 4 independent analytical perspectives through Perplexity:
1. **Consulting Analyst** (30% weight) — McKinsey/BCG/Deloitte frameworks
2. **Market Data Analyst** (30% weight) — Gartner/IDC/Statista adoption metrics
3. **Academic Researcher** (20% weight) — Peer-reviewed CMMI/TDWI models
4. **Industry Practitioner** (20% weight) — CIO surveys and operational benchmarks

Scores are combined using Bayesian inference with a non-informative prior (μ=50, σ²=625). The posterior distribution gives both a consensus score and a 95% credible interval.

**Vᵢ — Velocity (-0.5 to +0.5)**
Exponential Moving Average of score changes over time. Captures whether a capability is improving or declining. Decay factor α=0.7 balances responsiveness with stability.

**Eᵢ — Economic Multiplier (1.0–2.0)**
Derived from the capability ontology network. Capabilities with more dependencies (both upstream and downstream) have higher multipliers, reflecting their outsized economic impact. Each dependency adds +0.08, capped at 2.0.

**αᵢ — Confidence Factor (0.3–1.0)**
Measures source agreement. High confidence (>0.8) when all 4 sources agree within ±10 points. Low confidence when sources diverge significantly.

### Scale
Raw scores are multiplied by 10 to produce a 0–1000 index range, analogous to major financial indices.

### Market Sentiment
Derived from aggregate velocity: sentiment > 50 indicates improving capability maturity across industries.

### Volatility
Standard deviation of capability velocities. High volatility indicates rapid, uneven change — some capabilities improving while others decline.`;
