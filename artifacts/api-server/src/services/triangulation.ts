import { db } from "@workspace/db";
import { sourceTriangulationsTable, capabilitiesTable, industriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface PerplexityResponse {
  choices: Array<{ message: { content: string } }>;
  citations: string[];
}

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

export async function triangulateCapability(
  industryName: string,
  capabilityName: string,
  industryId: number,
  capabilityId: number,
): Promise<TriangulationResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not set");

  const sourceResults = await Promise.all(
    PERSPECTIVES.map(async (perspective) => {
      try {
        const resp = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [
              { role: "system", content: perspective.systemPrompt },
              {
                role: "user",
                content: `Rate the current maturity of "${capabilityName}" in the ${industryName} industry on a 0-100 scale.

Return this exact JSON structure:
{
  "score": <number 0-100>,
  "methodology": "<name of framework or data source used>",
  "rationale": "<2-3 sentences explaining the score with specific data points, percentages, or benchmarks>"
}

Base your score on the most recent data available (2024-2026). Be specific about what data informs your score.`,
              },
            ],
          }),
        });

        if (!resp.ok) throw new Error(`Perplexity ${resp.status}`);
        const data = (await resp.json()) as PerplexityResponse;
        const content = data.choices[0]?.message?.content ?? "";
        const citations = data.citations ?? [];

        const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const jsonStart = cleaned.indexOf("{");
        const jsonEnd = cleaned.lastIndexOf("}");
        const parsed = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));

        return {
          sourceLabel: perspective.label,
          rawScore: Math.max(0, Math.min(100, Number(parsed.score) || 50)),
          weight: perspective.weight,
          methodology: parsed.methodology || perspective.label,
          rationale: parsed.rationale || "",
          citations,
        };
      } catch (err) {
        console.warn(`Triangulation source ${perspective.label} failed:`, err);
        return null;
      }
    }),
  );

  const validSources = sourceResults.filter((s): s is NonNullable<typeof s> => s !== null);

  if (validSources.length === 0) {
    throw new Error("All triangulation sources failed");
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
  const priorVariance = 625;

  let posteriorPrecision = 1 / priorVariance;
  let weightedMeanNumerator = priorMean / priorVariance;

  for (const source of sources) {
    const observationVariance = 100 / source.weight;
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
