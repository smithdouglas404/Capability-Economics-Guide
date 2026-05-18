import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityAlphaTable,
  capabilityQuadrantsTable,
  capabilityDependenciesTable,
  dependencyEdgeScoresTable,
  industriesTable,
  companyCapabilityMappingsTable,
  companyCapabilityProfilesTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { modelFor, generateObject } from "../workflows/models";

export interface ThesisMemo {
  capabilityId: number;
  capabilityName: string;
  industryName: string;
  generatedAt: string;
  memoMarkdown: string;
  inputs: {
    economics: any;
    quadrant: any;
    upstream: number;
    downstream: number;
    topCompanies: Array<{ name: string; country: string; stage: string | null; fevi: number; strength: string }>;
  };
}

const DEFAULT_LLM_MODEL = "anthropic/claude-sonnet-4.6";
const ThesisSchema = z.object({ memoMarkdown: z.string().min(1) });

async function generateThesisMarkdown(prompt: string, maxTokens = 3000): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const { object } = await generateObject({
      model: modelFor(process.env.LLM_MODEL || DEFAULT_LLM_MODEL),
      schema: ThesisSchema,
      prompt,
      maxTokens,
      abortSignal: controller.signal,
    });
    return object.memoMarkdown;
  } finally { clearTimeout(timeout); }
}

export async function generateThesisMemo(capabilityId: number): Promise<ThesisMemo> {
  const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, capabilityId));
  if (!cap) throw new Error("capability not found");
  const [ind] = await db.select().from(industriesTable).where(eq(industriesTable.id, cap.industryId));
  const [econ] = await db.select().from(capabilityAlphaTable).where(eq(capabilityAlphaTable.capabilityId, capabilityId));
  const [quad] = await db.select().from(capabilityQuadrantsTable).where(eq(capabilityQuadrantsTable.capabilityId, capabilityId));

  const upstreamDeps = await db.select().from(capabilityDependenciesTable).where(eq(capabilityDependenciesTable.capabilityId, capabilityId));
  const downstreamDeps = await db.select().from(capabilityDependenciesTable).where(eq(capabilityDependenciesTable.dependsOnId, capabilityId));
  const allEdgeIds = [...upstreamDeps, ...downstreamDeps].map(d => d.id);
  const edgeScores = allEdgeIds.length > 0
    ? await db.select().from(dependencyEdgeScoresTable).where(sql`${dependencyEdgeScoresTable.dependencyId} IN (${sql.join(allEdgeIds.map(id => sql`${id}`), sql`, `)})`)
    : [];
  const scoreById = new Map(edgeScores.map(s => [s.dependencyId, s]));

  const allCapIds = Array.from(new Set([...upstreamDeps.map(d => d.dependsOnId), ...downstreamDeps.map(d => d.capabilityId)]));
  const relatedCaps = allCapIds.length > 0
    ? await db.select().from(capabilitiesTable).where(sql`${capabilitiesTable.id} IN (${sql.join(allCapIds.map(id => sql`${id}`), sql`, `)})`)
    : [];
  const capById = new Map(relatedCaps.map(c => [c.id, c]));

  const mappings = await db.select().from(companyCapabilityMappingsTable).where(eq(companyCapabilityMappingsTable.capabilityId, capabilityId));
  const profiles = mappings.length > 0
    ? await db.select().from(companyCapabilityProfilesTable).where(sql`${companyCapabilityProfilesTable.id} IN (${sql.join(mappings.map(m => sql`${m.companyId}`), sql`, `)})`)
    : [];
  const profById = new Map(profiles.map(p => [p.id, p]));
  const topCompanies = mappings
    .map(m => { const p = profById.get(m.companyId); return p ? { name: p.name, country: p.country, stage: p.fundingStage, fevi: p.feviScore, strength: m.strength } : null; })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.fevi - a.fevi)
    .slice(0, 8);

  const upstreamSummary = upstreamDeps.map(d => {
    const sc = scoreById.get(d.id);
    return `- ${capById.get(d.dependsOnId)?.name ?? `cap#${d.dependsOnId}`} (strength: ${d.strength}${sc ? `, disruption p=${(sc.disruptionProbability ?? 0).toFixed(2)}, time=${sc.timeToImpactMonths}mo, $impact=${sc.dollarImpactMm}M` : ""})`;
  }).join("\n") || "(none)";
  const downstreamSummary = downstreamDeps.map(d => `- ${capById.get(d.capabilityId)?.name ?? `cap#${d.capabilityId}`} depends on this`).join("\n") || "(none)";
  const companySummary = topCompanies.map(c => `- ${c.name} (${c.country}, ${c.stage ?? "—"}, FEVI=${c.fevi.toFixed(1)}, ${c.strength})`).join("\n") || "(no mapped companies)";

  const econBlock = econ ? `
- TAM: $${econ.tamUsdMm ?? "?"}M / SAM: $${econ.samUsdMm ?? "?"}M
- Margin: ${econ.marginStructurePct ?? "?"}% / Half-life: ${econ.halfLifeMonths ?? "?"}mo / Velocity: ${econ.commoditizationVelocity ?? "?"}
- Revenue exposure: $${econ.revenueExposureMm ?? "?"}M
- Street consensus: ${econ.consensusQuadrant ?? "?"} (confidence ${econ.consensusConfidence ?? "?"})
- Consensus narrative: ${econ.consensusSummary ?? "—"}
- CE rationale: ${econ.rationale ?? "—"}` : "(no economics enrichment yet)";

  const quadBlock = quad ? `
- CE quadrant: ${quad.quadrant}
- Economic impact score: ${quad.economicImpactScore}
- Adoption momentum: ${quad.adoptionMomentumScore}
- Disruption intensity: ${quad.disruptionIntensity}
- CE classification rationale: ${quad.rationale}` : "(no quadrant classification)";

  const prompt = `You are a senior analyst writing an investment thesis memo about the capability "${cap.name}" in the ${ind?.name ?? "?"} industry. Synthesize the structured data below into a concrete, decision-ready memo.

ECONOMICS:${econBlock}

CE QUADRANT CLASSIFICATION:${quadBlock}

UPSTREAM DEPENDENCIES (this capability depends on):
${upstreamSummary}

DOWNSTREAM (these capabilities depend on this one):
${downstreamSummary}

LEADING COMPANIES MAPPED TO THIS CAPABILITY:
${companySummary}

Return a JSON object with one key "memoMarkdown" whose value is a markdown-formatted memo with these sections in this exact order:

# Thesis: ${cap.name} in ${ind?.name ?? "?"}

## Verdict
One sentence: long, short, or neutral, with conviction level (high/medium/low) and the single most important driver.

## Inflexcvi
Numeric facts: TAM, margin, half-life, $ at risk over 36 months. State the implied annual EVaR.

## Where We Disagree With Consensus
Compare CE quadrant vs street consensus. If they agree, say so and explain why we don't see asymmetric edge.

## Cascade & Fragility
Name the top 1–2 upstream disruption risks with $ impact and timing. Identify any single-point-of-failure dependency.

## Companies To Track
Name 3–5 specific companies from the list, with one sentence each on why they matter (use real funding stage if known).

## Catalysts (Next 12 Months)
Three concrete events (regulatory, technology, M&A) that would materially move the thesis.

## Kill Criteria
Two specific observations that would invalidate this thesis.

Be concrete. Use real numbers from the data. Do not hedge. Do not add disclaimers. Output ONLY the JSON object with the "memoMarkdown" key.`;

  const memoMarkdown = await generateThesisMarkdown(prompt, 3500);

  return {
    capabilityId,
    capabilityName: cap.name,
    industryName: ind?.name ?? "",
    generatedAt: new Date().toISOString(),
    memoMarkdown,
    inputs: {
      economics: econ ?? null,
      quadrant: quad ?? null,
      upstream: upstreamDeps.length,
      downstream: downstreamDeps.length,
      topCompanies,
    },
  };
}
