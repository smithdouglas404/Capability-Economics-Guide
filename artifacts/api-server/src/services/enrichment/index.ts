import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  capabilityQuadrantsTable,
  valueChainStagesTable,
  companyCapabilityProfilesTable,
  companyCapabilityMappingsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger as log } from "../../lib/logger";

let enrichmentRunning = false;

interface EnrichmentResult {
  quadrantsClassified: number;
  valueChainStagesCreated: number;
  companiesProfiled: number;
  companyMappingsCreated: number;
  errors: string[];
  durationMs: number;
}

async function perplexitySearch(query: string): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not set");
  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        {
          role: "system",
          content: "You are a management consulting research analyst specializing in capability economics. Provide concise, factual research with specific numbers, percentages, dollar figures, company names, and real-world data from 2023-2026. Focus on measurable outcomes, adoption rates, patent trends, and startup activity.",
        },
        { role: "user", content: query },
      ],
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Perplexity error ${resp.status}: ${errText}`);
  }
  const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? "";
}

async function glmSynthesize(prompt: string, maxTokens = 4096): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000);

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://capabilityeconomics.com",
        "X-Title": "Capability Economics",
      },
      body: JSON.stringify({
        model: "z-ai/glm-5.1",
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "unknown");
      throw new Error(`GLM HTTP ${resp.status}: ${errText.substring(0, 200)}`);
    }
    const data = await resp.json() as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
    if (data.error) throw new Error(`GLM error: ${data.error.message}`);
    return data.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

function extractJson(text: string): unknown {
  let cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();

  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch {}
  }

  const arrStart = cleaned.indexOf("[");
  if (arrStart >= 0) {
    let candidate = cleaned.substring(arrStart);
    try { return JSON.parse(candidate); } catch {}

    const lastBrace = candidate.lastIndexOf("}");
    if (lastBrace > 0) {
      candidate = candidate.substring(0, lastBrace + 1) + "]";
      try { return JSON.parse(candidate); } catch {}
    }
  }

  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }

  throw new Error("No JSON found in GLM response");
}

async function enrichCapabilityQuadrants(
  industryId: number,
  industryName: string,
  capabilities: Array<{ id: number; name: string; benchmarkScore: number }>,
): Promise<{ classified: number; errors: string[] }> {
  let classified = 0;
  const errors: string[] = [];

  const capNames = capabilities.map(c => c.name).join(", ");
  const research = await perplexitySearch(
    `For the ${industryName} industry, analyze the following capabilities in terms of their current adoption trajectory, enterprise ROI evidence, economic impact, patent activity trends, and startup funding momentum (2023-2026). Capabilities: ${capNames}. For each capability, provide: (1) whether it is Hot (proven ROI, scaling), Emerging (early traction, high potential), Cooling (commoditizing, declining differentiation), or Table Stakes (baseline requirement); (2) economic impact percentage or dollar figure; (3) adoption rate or growth percentage. Be specific with numbers.`
  );

  if (!research) return { classified: 0, errors: [`No Perplexity response for ${industryName} quadrants`] };

  const glmPrompt = `You are a Capability Economics analyst. Based on this research about ${industryName} capabilities:

${research}

For each of these capabilities, produce a JSON array where each element has:
- "name": capability name (must exactly match one of: ${JSON.stringify(capabilities.map(c => c.name))})
- "quadrant": one of "hot", "emerging", "cooling", "table_stakes"
- "economic_impact_score": number 0-100 (how much economic value this capability drives)
- "adoption_momentum_score": number 0-100 (trajectory/growth rate of adoption)
- "disruption_intensity": number 0-1 (how widely this disrupts adjacent value chain stages)
- "rationale": 2-3 sentence explanation of the classification

Return ONLY a JSON array. No markdown, no explanation outside the array.`;

  const glmText = await glmSynthesize(glmPrompt);
  let parsed: Array<{
    name: string;
    quadrant: string;
    economic_impact_score: number;
    adoption_momentum_score: number;
    disruption_intensity: number;
    rationale: string;
  }>;
  try {
    parsed = extractJson(glmText) as typeof parsed;
    if (!Array.isArray(parsed)) throw new Error("Not an array");
  } catch (e) {
    errors.push(`GLM parse error for ${industryName} quadrants: ${e}`);
    return { classified, errors };
  }

  const capMap = new Map(capabilities.map(c => [c.name.toLowerCase(), c]));

  for (const item of parsed) {
    const cap = capMap.get(item.name?.toLowerCase());
    if (!cap) continue;
    const quadrant = ["hot", "emerging", "cooling", "table_stakes"].includes(item.quadrant)
      ? item.quadrant
      : "emerging";
    try {
      await db.insert(capabilityQuadrantsTable).values({
        capabilityId: cap.id,
        industryId,
        quadrant,
        economicImpactScore: Math.min(100, Math.max(0, item.economic_impact_score || 50)),
        adoptionMomentumScore: Math.min(100, Math.max(0, item.adoption_momentum_score || 50)),
        disruptionIntensity: Math.min(1, Math.max(0, item.disruption_intensity || 0.5)),
        rationale: item.rationale || `${cap.name} classified as ${quadrant} based on research analysis.`,
      });
      classified++;
    } catch (e) {
      errors.push(`Insert quadrant ${cap.name}: ${e}`);
    }
  }

  return { classified, errors };
}

async function enrichValueChainStages(
  industryId: number,
  industryName: string,
): Promise<{ created: number; errors: string[] }> {
  let created = 0;
  const errors: string[] = [];

  log.info(`  Value chain: calling Perplexity for ${industryName}...`);
  let research: string;
  try {
    research = await perplexitySearch(
      `What are the 6-8 key value chain stages for ${industryName} industry digital transformation and capability development in 2024-2026? For each stage provide: (1) name of the stage, (2) how many distinct NAICS sectors are involved, (3) approximate patent filings in this area (2019-2024 count and 5-year growth %), (4) number of active startups and 5-year growth %, (5) estimated capital flow in $millions and 5-year growth %, (6) market concentration (high/medium/low), (7) key technologies and capabilities at this stage, (8) key companies at this stage. Be specific with real numbers.`
    );
  } catch (e) {
    log.error(`  Value chain Perplexity FAILED for ${industryName}: ${e}`);
    errors.push(`Perplexity call failed for ${industryName} value chain: ${e}`);
    return { created, errors };
  }

  if (!research) return { created: 0, errors: [`No Perplexity response for ${industryName} value chain`] };

  const glmPrompt = `You are a Capability Economics analyst. Based on this research about the ${industryName} value chain:

${research}

Produce a JSON array of 6-8 value chain stages, each with:
- "stage_name": short name (3-5 words)
- "stage_order": integer 1-8
- "num_sectors": number of NAICS sectors involved (integer)
- "hhi_score": market concentration 0-1 (0=fragmented, 1=monopoly)
- "patent_count": approximate patent count (integer)
- "patent_trend_pct": 5-year growth percentage (number)
- "startup_count": number of active startups (integer)
- "startup_trend_pct": 5-year startup growth percentage (number)
- "capital_flow_mm": capital flow in $millions (number)
- "capital_trend_pct": 5-year capital growth percentage (number)
- "disruption_summary": 2-3 sentence disruption narrative
- "key_capabilities": array of 3-5 capability names
- "key_companies": array of 3-5 real company names

Return ONLY a JSON array. No markdown.`;

  log.info(`  Value chain: calling Perplexity done, calling GLM for ${industryName}...`);
  let glmText: string;
  try {
    glmText = await glmSynthesize(glmPrompt, 8192);
  } catch (e) {
    log.error(`  Value chain GLM FAILED for ${industryName}: ${e}`);
    errors.push(`GLM call failed for ${industryName} value chain: ${e}`);
    return { created, errors };
  }

  log.info(`  Value chain GLM response length: ${glmText.length} chars`);

  let parsed: Array<{
    stage_name: string;
    stage_order: number;
    num_sectors: number;
    hhi_score: number;
    patent_count: number;
    patent_trend_pct: number;
    startup_count: number;
    startup_trend_pct: number;
    capital_flow_mm: number;
    capital_trend_pct: number;
    disruption_summary: string;
    key_capabilities: string[];
    key_companies: string[];
  }>;
  try {
    parsed = extractJson(glmText) as typeof parsed;
    if (!Array.isArray(parsed)) throw new Error("Not an array");
  } catch (e) {
    log.error(`  Value chain parse failed. First 500 chars of GLM text: ${glmText.substring(0, 500)}`);
    errors.push(`GLM parse error for ${industryName} value chain: ${e}`);
    return { created, errors };
  }

  for (const stage of parsed) {
    try {
      await db.insert(valueChainStagesTable).values({
        industryId,
        stageName: stage.stage_name || "Unknown Stage",
        stageOrder: stage.stage_order || created + 1,
        numSectors: stage.num_sectors || null,
        hhiScore: stage.hhi_score != null ? Math.min(1, Math.max(0, stage.hhi_score)) : null,
        patentCount: stage.patent_count || null,
        patentTrendPct: stage.patent_trend_pct || null,
        startupCount: stage.startup_count || null,
        startupTrendPct: stage.startup_trend_pct || null,
        capitalFlowMm: stage.capital_flow_mm || null,
        capitalTrendPct: stage.capital_trend_pct || null,
        disruptionSummary: stage.disruption_summary || "Research-derived disruption analysis.",
        keyCapabilities: stage.key_capabilities || [],
        keyCompanies: stage.key_companies || [],
      });
      created++;
    } catch (e) {
      errors.push(`Insert value chain stage ${stage.stage_name}: ${e}`);
    }
  }

  return { created, errors };
}

async function enrichCompanyProfiles(
  industryId: number,
  industryName: string,
  capabilities: Array<{ id: number; name: string }>,
): Promise<{ profiled: number; mapped: number; errors: string[] }> {
  let profiled = 0;
  let mapped = 0;
  const errors: string[] = [];

  const capNames = capabilities.map(c => c.name).slice(0, 10).join(", ");
  const research = await perplexitySearch(
    `Who are the top 20-25 companies (startups, scaleups, and established players) that are leading innovators in ${industryName} capabilities in 2024-2026? Focus on companies enabling: ${capNames}. For each company provide: (1) company name, (2) country/headquarters, (3) NAICS code and sector if known, (4) primary capability they enable, (5) funding stage (seed, Series A, Series B, growth, public, private), (6) whether their approach is hot (proven ROI, scaling), emerging (early traction), cooling (commoditizing), or table stakes (baseline). Include global companies, not just US-based. Be specific with real company names.`
  );

  if (!research) return { profiled: 0, mapped: 0, errors: [`No Perplexity response for ${industryName} companies`] };

  const glmPrompt = `You are a Capability Economics analyst. Based on this research about ${industryName} companies:

${research}

Produce a JSON array of 15-25 real companies, each with:
- "name": company name
- "country": headquarters country
- "naics_code": NAICS code if known, or null
- "naics_sector": NAICS sector description
- "fevi_score": number 0-1 (Forecasted Economic Value Index — composite of market traction, capability uniqueness, geographic reach, funding stage)
- "cdi_score": number 0-1 (Capability Disruption Index — how broadly this company disrupts)
- "quadrant": one of "hot", "emerging", "cooling", "table_stakes"
- "funding_stage": one of "seed", "series_a", "series_b", "growth", "public", "private"
- "description": 1-sentence capability profile
- "primary_capabilities": array of 1-3 capability names this company enables (must match from: ${JSON.stringify(capabilities.map(c => c.name))})

Return ONLY a JSON array. No markdown.`;

  const glmText = await glmSynthesize(glmPrompt, 6144);
  let parsed: Array<{
    name: string;
    country: string;
    naics_code: string | null;
    naics_sector: string;
    fevi_score: number;
    cdi_score: number;
    quadrant: string;
    funding_stage: string;
    description: string;
    primary_capabilities: string[];
  }>;
  try {
    parsed = extractJson(glmText) as typeof parsed;
    if (!Array.isArray(parsed)) throw new Error("Not an array");
  } catch (e) {
    errors.push(`GLM parse error for ${industryName} companies: ${e}`);
    return { profiled, mapped, errors };
  }

  const capMap = new Map(capabilities.map(c => [c.name.toLowerCase(), c]));

  for (const company of parsed) {
    if (!company.name) continue;
    const quadrant = ["hot", "emerging", "cooling", "table_stakes"].includes(company.quadrant)
      ? company.quadrant
      : "emerging";
    try {
      const [inserted] = await db.insert(companyCapabilityProfilesTable).values({
        name: company.name,
        country: company.country || "Unknown",
        naicsCode: company.naics_code || null,
        naicsSector: company.naics_sector || null,
        industryId,
        feviScore: Math.min(1, Math.max(0, company.fevi_score || 0.5)),
        cdiScore: Math.min(1, Math.max(0, company.cdi_score || 0.3)),
        quadrant,
        fundingStage: company.funding_stage || "private",
        description: company.description || `${company.name} — ${industryName} capability provider.`,
      }).returning({ id: companyCapabilityProfilesTable.id });

      profiled++;

      if (inserted && company.primary_capabilities) {
        for (const capName of company.primary_capabilities) {
          const cap = capMap.get(capName.toLowerCase());
          if (!cap) continue;
          try {
            await db.insert(companyCapabilityMappingsTable).values({
              companyId: inserted.id,
              capabilityId: cap.id,
              strength: quadrant === "hot" ? "core" : quadrant === "emerging" ? "emerging" : "adjacent",
            });
            mapped++;
          } catch (e) {
            errors.push(`Map ${company.name}→${capName}: ${e}`);
          }
        }
      }
    } catch (e) {
      errors.push(`Insert company ${company.name}: ${e}`);
    }
  }

  return { profiled, mapped, errors };
}

export async function runEnrichment(): Promise<EnrichmentResult> {
  if (enrichmentRunning) {
    throw new Error("Enrichment already in progress");
  }
  enrichmentRunning = true;

  try {
    return await _runEnrichmentInner();
  } finally {
    enrichmentRunning = false;
  }
}

async function _runEnrichmentInner(): Promise<EnrichmentResult> {
  const start = Date.now();
  const result: EnrichmentResult = {
    quadrantsClassified: 0,
    valueChainStagesCreated: 0,
    companiesProfiled: 0,
    companyMappingsCreated: 0,
    errors: [],
    durationMs: 0,
  };

  const industries = await db.select().from(industriesTable);
  const allCaps = await db.select().from(capabilitiesTable);

  log.info(`Enrichment started: ${industries.length} industries, ${allCaps.length} capabilities`);

  for (const industry of industries) {
    const industryCaps = allCaps
      .filter(c => c.industryId === industry.id)
      .map(c => ({ id: c.id, name: c.name, benchmarkScore: c.benchmarkScore }));

    log.info(`Enriching ${industry.name}: ${industryCaps.length} capabilities`);

    await db.delete(capabilityQuadrantsTable).where(eq(capabilityQuadrantsTable.industryId, industry.id));
    await db.delete(valueChainStagesTable).where(eq(valueChainStagesTable.industryId, industry.id));
    const existingCompanies = await db.select({ id: companyCapabilityProfilesTable.id }).from(companyCapabilityProfilesTable).where(eq(companyCapabilityProfilesTable.industryId, industry.id));
    for (const c of existingCompanies) {
      await db.delete(companyCapabilityMappingsTable).where(eq(companyCapabilityMappingsTable.companyId, c.id));
    }
    await db.delete(companyCapabilityProfilesTable).where(eq(companyCapabilityProfilesTable.industryId, industry.id));

    try {
      const qResult = await enrichCapabilityQuadrants(industry.id, industry.name, industryCaps);
      result.quadrantsClassified += qResult.classified;
      result.errors.push(...qResult.errors);
      log.info(`  Quadrants: ${qResult.classified} classified`);
    } catch (e) {
      result.errors.push(`Quadrant enrichment ${industry.name}: ${e}`);
    }

    try {
      const vcResult = await enrichValueChainStages(industry.id, industry.name);
      result.valueChainStagesCreated += vcResult.created;
      result.errors.push(...vcResult.errors);
      log.info(`  Value chain: ${vcResult.created} stages`);
    } catch (e) {
      result.errors.push(`Value chain enrichment ${industry.name}: ${e}`);
    }

    try {
      const compResult = await enrichCompanyProfiles(industry.id, industry.name, industryCaps);
      result.companiesProfiled += compResult.profiled;
      result.companyMappingsCreated += compResult.mapped;
      result.errors.push(...compResult.errors);
      log.info(`  Companies: ${compResult.profiled} profiled, ${compResult.mapped} mappings`);
    } catch (e) {
      result.errors.push(`Company enrichment ${industry.name}: ${e}`);
    }
  }

  result.durationMs = Date.now() - start;
  log.info(`Enrichment complete in ${(result.durationMs / 1000).toFixed(1)}s: ${result.quadrantsClassified} quadrants, ${result.valueChainStagesCreated} stages, ${result.companiesProfiled} companies, ${result.companyMappingsCreated} mappings, ${result.errors.length} errors`);

  return result;
}
