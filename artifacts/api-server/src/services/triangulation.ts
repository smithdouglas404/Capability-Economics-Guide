import { db } from "@workspace/db";
import { sourceTriangulationsTable, capabilitiesTable, industriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { perplexityChat } from "./perplexity";

interface SourcePerspective {
  label: string;
  systemPrompt: string;
  weight: number;
}

const PERSPECTIVES: SourcePerspective[] = [
  {
    label: "Consulting Analyst",
    weight: 0.30,
    systemPrompt: `You are a senior management consulting analyst at a top-tier firm (McKinsey, BCG, Bain level). 
Evaluate capability maturity using consulting frameworks like McKinsey's Digital Quotient, BCG's Digital Acceleration Index, or Deloitte's Digital Maturity Model.
Focus on: organizational readiness, process maturity, talent gaps, and strategic alignment.
Return ONLY valid JSON, no markdown.`,
  },
  {
    label: "Market Data Analyst",
    weight: 0.30,
    systemPrompt: `You are a quantitative market research analyst specializing in technology adoption and digital transformation metrics.
Evaluate capability maturity using hard market data: adoption rates, investment levels, vendor penetration, patent filings, and market sizing data from Gartner, IDC, Statista, and CB Insights.
Focus on: measurable adoption percentages, spending trends, market growth rates, and technology penetration curves.
Return ONLY valid JSON, no markdown.`,
  },
  {
    label: "Academic Researcher",
    weight: 0.20,
    systemPrompt: `You are an academic researcher in information systems and digital transformation at a leading research university.
Evaluate capability maturity using peer-reviewed research, academic maturity models (CMMI, TDWI, etc.), and longitudinal studies.
Focus on: theoretical frameworks, empirical evidence, statistical validation, and measurement rigor.
Return ONLY valid JSON, no markdown.`,
  },
  {
    label: "Industry Practitioner",
    weight: 0.20,
    systemPrompt: `You are a seasoned Chief Digital Officer who has led transformation programs at Fortune 500 companies.
Evaluate capability maturity from hands-on experience: what works in practice, common failure modes, realistic timelines, and practitioner benchmarks from CIO surveys, Harvey Nash, Foundry, and Flexera reports.
Focus on: practical implementation reality, common blockers, real-world adoption curves, and operational benchmarks.
Return ONLY valid JSON, no markdown.`,
  },
];

interface TriangulationResult {
  capabilityName: string;
  sources: Array<{
    sourceLabel: string;
    rawScore: number;
    weight: number;
    methodology: string;
    rationale: string;
    citations: string[];
  }>;
  consensusScore: number;
  confidence: number;
  bayesianPosterior: {
    mean: number;
    variance: number;
    credibleInterval: [number, number];
  };
}

/**
 * One Perplexity call asks for all 4 perspectives' ratings in a single
 * JSON response. Replaces the prior fan-out of 4 parallel calls — cuts
 * Perplexity volume 4× per triangulated capability (and 4× the
 * Gemini-:online fallback cost when Perplexity is down).
 *
 * The single call yields one `citations[]` array; we attach it to all 4
 * source rows so the downstream `sourceTriangulationsTable` write +
 * Bayesian math behave the same way they did with the fan-out.
 */
const UNIFIED_SYSTEM_PROMPT = `You are a multi-disciplinary research analyst producing a triangulated maturity assessment. For each capability, you will produce FOUR independent ratings, one per analytical lens:

1. "Consulting Analyst" — Senior management consulting analyst at a top-tier firm (McKinsey, BCG, Bain). Uses consulting frameworks (McKinsey's Digital Quotient, BCG's Digital Acceleration Index, Deloitte's Digital Maturity Model). Focus: organizational readiness, process maturity, talent gaps, strategic alignment.

2. "Market Data Analyst" — Quantitative market research analyst (technology adoption, digital transformation metrics). Uses hard market data: adoption rates, investment levels, vendor penetration, patent filings, Gartner / IDC / Statista / CB Insights. Focus: measurable adoption %, spending trends, market growth rates, penetration curves.

3. "Academic Researcher" — Academic researcher in information systems and digital transformation at a leading university. Uses peer-reviewed research, academic maturity models (CMMI, TDWI), longitudinal studies. Focus: theoretical frameworks, empirical evidence, statistical validation, measurement rigor.

4. "Industry Practitioner" — Seasoned Chief Digital Officer at a Fortune 500. Uses hands-on experience: what works in practice, common failure modes, realistic timelines, practitioner benchmarks (CIO surveys, Harvey Nash, Foundry, Flexera). Focus: practical implementation reality, blockers, real adoption curves, operational benchmarks.

Each lens must produce its OWN independent score — do NOT average across lenses. Differences between lenses are signal, not noise. Return ONLY valid JSON, no markdown fences.`;

export async function triangulateCapability(
  industryName: string,
  capabilityName: string,
  industryId: number,
  capabilityId: number,
): Promise<TriangulationResult> {
  const userPrompt = `Rate the current maturity of "${capabilityName}" in the ${industryName} industry on a 0-100 scale, producing one rating per analytical lens.

Return this EXACT JSON structure (4 entries, in this order):
{
  "perspectives": [
    { "label": "Consulting Analyst",   "score": <0-100>, "methodology": "<framework/source>", "rationale": "<2-3 sentences with specific numbers, benchmarks, or examples>" },
    { "label": "Market Data Analyst",  "score": <0-100>, "methodology": "<framework/source>", "rationale": "<2-3 sentences with specific numbers, benchmarks, or examples>" },
    { "label": "Academic Researcher",  "score": <0-100>, "methodology": "<framework/source>", "rationale": "<2-3 sentences with specific numbers, benchmarks, or examples>" },
    { "label": "Industry Practitioner","score": <0-100>, "methodology": "<framework/source>", "rationale": "<2-3 sentences with specific numbers, benchmarks, or examples>" }
  ]
}

Base each score on the most recent data available (2024-2026). Each lens applies its own methodology independently.`;

  let data;
  try {
    data = await perplexityChat({
      model: "sonar",
      endpoint: "triangulation",
      context: { capabilityId, capabilityName, perspective: "unified-4-lens" },
      messages: [
        { role: "system", content: UNIFIED_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const has401 = msg.includes("401");
    const hint = has401 ? " (PERPLEXITY_API_KEY missing or invalid in this environment)" : "";
    throw new Error(`Triangulation call failed — ${msg}${hint}`);
  }

  const content = data.choices[0]?.message?.content ?? "";
  const citations = data.citations ?? [];

  const validSources: TriangulationResult["sources"] = [];
  const errored: Array<{ sourceLabel: string; message: string }> = [];

  try {
    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    const parsed = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1)) as {
      perspectives?: Array<{ label?: string; score?: number; methodology?: string; rationale?: string }>;
    };
    const returnedByLabel = new Map<string, { score?: number; methodology?: string; rationale?: string }>();
    for (const p of parsed.perspectives ?? []) {
      if (typeof p.label === "string") returnedByLabel.set(p.label.trim(), p);
    }
    for (const perspective of PERSPECTIVES) {
      const got = returnedByLabel.get(perspective.label);
      if (!got || got.score === undefined) {
        errored.push({ sourceLabel: perspective.label, message: "missing from unified response" });
        continue;
      }
      validSources.push({
        sourceLabel: perspective.label,
        rawScore: Math.max(0, Math.min(100, Number(got.score) || 50)),
        weight: perspective.weight,
        methodology: got.methodology || perspective.label,
        rationale: got.rationale || "",
        citations,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[Triangulation] capabilityId=${capabilityId} capability="${capabilityName}" ` +
        `industry="${industryName}" — unified-response parse failed: ${msg}`,
    );
  }

  if (validSources.length === 0) {
    const messages = errored.length > 0
      ? errored.map(e => `${e.sourceLabel}: ${e.message}`).join("; ")
      : `parse-failed (raw ${content.length} chars)`;
    throw new Error(`All triangulation sources failed — ${messages}`);
  }
  if (errored.length > 0) {
    console.warn(`[Triangulation] ${capabilityName}: ${errored.length}/${PERSPECTIVES.length} perspectives missing (${errored.map(e => e.sourceLabel).join(", ")}) — proceeding with ${validSources.length}`);
  }

  const totalWeight = validSources.reduce((sum, s) => sum + s.weight, 0);
  const normalizedSources = validSources.map(s => ({
    ...s,
    weight: s.weight / totalWeight,
  }));

  const bayesian = computeBayesianConsensus(normalizedSources);

  for (const source of validSources) {
    await db.insert(sourceTriangulationsTable).values({
      capabilityId,
      industryId,
      sourceLabel: source.sourceLabel,
      rawScore: source.rawScore,
      weight: source.weight,
      methodology: source.methodology,
      rationale: source.rationale,
      citations: source.citations,
    });
  }

  return {
    capabilityName,
    sources: validSources,
    consensusScore: bayesian.mean,
    confidence: bayesian.confidence,
    bayesianPosterior: bayesian,
  };
}

function computeBayesianConsensus(
  sources: Array<{ rawScore: number; weight: number }>,
): { mean: number; variance: number; credibleInterval: [number, number]; confidence: number } {
  const priorMean = 50;
  const priorVariance = 1500;

  let posteriorPrecision = 1 / priorVariance;
  let weightedMeanNumerator = priorMean / priorVariance;

  for (const source of sources) {
    const observationVariance = 40 / source.weight;
    const observationPrecision = 1 / observationVariance;
    posteriorPrecision += observationPrecision;
    weightedMeanNumerator += source.rawScore * observationPrecision;
  }

  const posteriorMean = weightedMeanNumerator / posteriorPrecision;
  const posteriorVariance = 1 / posteriorPrecision;
  const posteriorStd = Math.sqrt(posteriorVariance);

  const credibleLower = Math.max(0, posteriorMean - 1.96 * posteriorStd);
  const credibleUpper = Math.min(100, posteriorMean + 1.96 * posteriorStd);

  const scoreRange = sources.length > 1
    ? Math.max(...sources.map(s => s.rawScore)) - Math.min(...sources.map(s => s.rawScore))
    : 50;
  const agreementFactor = Math.max(0, 1 - scoreRange / 50);
  const coverageFactor = sources.length / 4;
  const confidence = Math.min(1, agreementFactor * 0.6 + coverageFactor * 0.4);

  return {
    mean: Math.round(posteriorMean * 10) / 10,
    variance: Math.round(posteriorVariance * 10) / 10,
    credibleInterval: [
      Math.round(credibleLower * 10) / 10,
      Math.round(credibleUpper * 10) / 10,
    ],
    confidence: Math.round(confidence * 100) / 100,
  };
}

export async function getStaleCapabilities(limit: number, industryId?: number): Promise<Array<{
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  lastTriangulatedAt: Date | null;
}>> {
  const allCaps = industryId
    ? await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId))
    : await db.select().from(capabilitiesTable);
  // Only triangulate leaf capabilities — parents are rolled up from children.
  const caps = allCaps.filter(c => c.isLeaf);

  const industries = await db.select().from(industriesTable);
  const indMap = new Map(industries.map(i => [i.id, i.name]));

  const lastByCap = new Map<number, Date>();
  const allTris = await db.select().from(sourceTriangulationsTable);
  for (const t of allTris) {
    const prev = lastByCap.get(t.capabilityId);
    if (!prev || t.queriedAt > prev) lastByCap.set(t.capabilityId, t.queriedAt);
  }

  const ranked = caps.map(c => ({
    capabilityId: c.id,
    capabilityName: c.name,
    industryId: c.industryId,
    industryName: indMap.get(c.industryId) || "Unknown",
    lastTriangulatedAt: lastByCap.get(c.id) || null,
  }));

  ranked.sort((a, b) => {
    const aT = a.lastTriangulatedAt?.getTime() ?? 0;
    const bT = b.lastTriangulatedAt?.getTime() ?? 0;
    return aT - bT;
  });

  return ranked.slice(0, limit);
}

export async function rotateTriangulations(limit = 10, industryId?: number): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
  capabilities: string[];
}> {
  const stale = await getStaleCapabilities(limit, industryId);
  const capabilities: string[] = [];
  let succeeded = 0;
  let failed = 0;

  const concurrency = 2;
  for (let i = 0; i < stale.length; i += concurrency) {
    const batch = stale.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (c) => {
        try {
          await triangulateCapability(c.industryName, c.capabilityName, c.industryId, c.capabilityId);
          capabilities.push(`${c.industryName}/${c.capabilityName}`);
          return true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Triangulation Rotation] failed for ${c.capabilityName}: ${msg}`);
          return false;
        }
      }),
    );
    succeeded += results.filter(Boolean).length;
    failed += results.filter(r => !r).length;
  }

  console.log(`[Triangulation Rotation] refreshed ${succeeded}/${stale.length} caps (${failed} failed)`);
  return { attempted: stale.length, succeeded, failed, capabilities };
}

export async function triangulateIndustry(
  industryId: number,
): Promise<TriangulationResult[]> {
  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId));
  if (!industry) throw new Error(`Industry ${industryId} not found`);

  const capabilities = await db
    .select()
    .from(capabilitiesTable)
    .where(eq(capabilitiesTable.industryId, industryId));

  const sample = capabilities.slice(0, 5);

  const results: TriangulationResult[] = [];
  for (const cap of sample) {
    const result = await triangulateCapability(
      industry.name,
      cap.name,
      industryId,
      cap.id,
    );
    results.push(result);
  }

  return results;
}
