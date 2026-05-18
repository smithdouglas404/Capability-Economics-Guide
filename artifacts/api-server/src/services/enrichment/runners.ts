/**
 * Per-table enrichment runners — the actual functions that hit Perplexity +
 * an LLM (Claude Sonnet 4.6 via OpenRouter by default; override with LLM_MODEL)
 * and write to capability_quadrants / value_chain_stages /
 * company_capability_profiles. The LangGraph tools in `tools.ts` wrap these,
 * and the synchronous per-cap rerun route pre-calls `enrichCapabilityQuadrants`
 * directly. There is no "linear pipeline" entry point — `runEnrichmentGraph`
 * in `graph.ts` is the only orchestrator.
 */

import { db } from "@workspace/db";
import {
  capabilityQuadrantsTable,
  valueChainStagesTable,
  companyCapabilityProfilesTable,
  companyCapabilityMappingsTable,
} from "@workspace/db";
import { logger as log } from "../../lib/logger";
import { retry } from "../../lib/llm-retry";
import { runResearchPipeline } from "../workflows";
import { generateObject } from "ai";
import { z } from "zod";
import { sonnet } from "../workflows/models";

// ── Zod schemas for the three enrichment LLM calls ─────────────────────────

const QuadrantItemSchema = z.object({
  name: z.string(),
  quadrant: z.enum(["hot", "emerging", "cooling", "table_stakes"]),
  economic_impact_score: z.number().min(0).max(100),
  adoption_momentum_score: z.number().min(0).max(100),
  disruption_intensity: z.number().min(0).max(1),
  rationale: z.string(),
});
const QuadrantListSchema = z.object({ items: z.array(QuadrantItemSchema) });

const ValueChainStageSchema = z.object({
  stage_name: z.string(),
  stage_order: z.number().int().min(1).max(10),
  num_sectors: z.number().int().nullable(),
  hhi_score: z.number().min(0).max(1).nullable(),
  patent_count: z.number().int().nullable(),
  patent_trend_pct: z.number().nullable(),
  startup_count: z.number().int().nullable(),
  startup_trend_pct: z.number().nullable(),
  capital_flow_mm: z.number().nullable(),
  capital_trend_pct: z.number().nullable(),
  disruption_summary: z.string(),
  shifts: z.array(z.string()).max(6).default([]),
  risks: z.array(z.string()).max(6).default([]),
  key_capabilities: z.array(z.string()).default([]),
  key_companies: z.array(z.string()).default([]),
});
const ValueChainListSchema = z.object({ stages: z.array(ValueChainStageSchema).min(4).max(10) });

const CompanyProfileSchema = z.object({
  name: z.string(),
  country: z.string(),
  naics_code: z.string().nullable(),
  naics_sector: z.string(),
  fevi_score: z.number().min(0).max(1),
  cdi_score: z.number().min(0).max(1),
  quadrant: z.enum(["hot", "emerging", "cooling", "table_stakes"]),
  funding_stage: z.enum(["seed", "series_a", "series_b", "growth", "public", "private"]),
  description: z.string(),
  primary_capabilities: z.array(z.string()).max(3),
});
const CompanyListSchema = z.object({ companies: z.array(CompanyProfileSchema).min(10).max(25) });

interface PerplexityResult {
  content: string;
  sources: string[];
}

/**
 * Optionally delegate Perplexity+Sonnet to the in-process research-pipeline
 * workflow and pull the structured payload out of its synchronous response.
 * Returns null when the workflow fails — caller falls back to the inline
 * perplexitySearch() + LLM path. Wired into each runner's top-of-function
 * check.
 */
async function tryWorkflowResearch(
  capabilityId: number,
  kind: "quadrant" | "alpha" | "value_chain" | "generic",
  prompt: string,
): Promise<Record<string, unknown> | null> {
  const result = await runResearchPipeline({ capabilityId, kind, prompt }).catch(() => null);
  if (!result || result.status === "degraded") return null;
  return result.payload as Record<string, unknown>;
}

async function perplexitySearch(query: string): Promise<PerplexityResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not set");
  return retry(async () => {
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
    const data = await resp.json() as { choices: Array<{ message: { content: string } }>; citations?: string[] };
    const content = data.choices[0]?.message?.content ?? "";
    const sources = data.citations ?? [];
    return { content, sources };
  }, { label: "enrich.perplexity" });
}

// `openrouterSynthesize` + `extractJson` helpers retired 2026-05-18 —
// replaced by `generateObject({ schema })` from the AI SDK at every call site.

export async function enrichCapabilityQuadrants(
  industryId: number,
  industryName: string,
  capabilities: Array<{ id: number; name: string; benchmarkScore: number }>,
  runId: number | null,
): Promise<{ classified: number; errors: string[] }> {
  let classified = 0;
  const errors: string[] = [];

  const capNames = capabilities.map(c => c.name).join(", ");
  const researchResult = await perplexitySearch(
    `For the ${industryName} industry, analyze the following capabilities in terms of their current adoption trajectory, enterprise ROI evidence, economic impact, patent activity trends, and startup funding momentum (2023-2026). Capabilities: ${capNames}. For each capability, provide: (1) whether it is Hot (proven ROI, scaling), Emerging (early traction, high potential), Cooling (commoditizing, declining differentiation), or Table Stakes (baseline requirement); (2) economic impact percentage or dollar figure; (3) adoption rate or growth percentage. Be specific with numbers.`
  );

  if (!researchResult.content) return { classified: 0, errors: [`No Perplexity response for ${industryName} quadrants`] };

  const llmPrompt = `You are a Inflexcvi analyst. Based on this research about ${industryName} capabilities:

${researchResult.content}

For each of these capabilities, produce a JSON array where each element has:
- "name": capability name (must exactly match one of: ${JSON.stringify(capabilities.map(c => c.name))})
- "quadrant": one of "hot", "emerging", "cooling", "table_stakes"
- "economic_impact_score": number 0-100 (how much economic value this capability drives)
- "adoption_momentum_score": number 0-100 (trajectory/growth rate of adoption)
- "disruption_intensity": number 0-1 (how widely this disrupts adjacent value chain stages)
- "rationale": 2-3 sentence explanation of the classification

Return ONLY a JSON array. No markdown, no explanation outside the array.`;

  let parsed: z.infer<typeof QuadrantListSchema>["items"];
  try {
    const result = await generateObject({
      model: sonnet,
      schema: QuadrantListSchema,
      system: `You classify enterprise capabilities into Hot / Emerging / Cooling / Table Stakes quadrants based on analyst research. Capability names MUST exactly match one of: ${JSON.stringify(capabilities.map(c => c.name))}`,
      prompt: `Industry: ${industryName}\n\nResearch:\n${researchResult.content}`,
      temperature: 0.2,
      maxTokens: 4096,
    });
    parsed = result.object.items;
  } catch (e) {
    errors.push(`LLM parse error for ${industryName} quadrants: ${e}`);
    return { classified, errors };
  }

  const capMap = new Map(capabilities.map(c => [c.name.toLowerCase(), c]));

  for (const item of parsed) {
    const cap = capMap.get(item.name?.toLowerCase());
    if (!cap) continue;
    if (!["hot", "emerging", "cooling", "table_stakes"].includes(item.quadrant)) {
      errors.push(`Skipping ${item.name}: invalid quadrant "${item.quadrant}"`);
      continue;
    }
    if (item.economic_impact_score == null || item.adoption_momentum_score == null || item.disruption_intensity == null || !item.rationale) {
      errors.push(`Skipping ${item.name}: missing required fields from LLM output`);
      continue;
    }
    try {
      await db.insert(capabilityQuadrantsTable).values({
        capabilityId: cap.id,
        industryId,
        runId,
        quadrant: item.quadrant,
        economicImpactScore: Math.min(100, Math.max(0, item.economic_impact_score)),
        adoptionMomentumScore: Math.min(100, Math.max(0, item.adoption_momentum_score)),
        disruptionIntensity: Math.min(1, Math.max(0, item.disruption_intensity)),
        rationale: item.rationale,
        perplexitySources: researchResult.sources,
      });
      classified++;
    } catch (e) {
      errors.push(`Insert quadrant ${cap.name}: ${e}`);
    }
  }

  return { classified, errors };
}

export async function enrichValueChainStages(
  industryId: number,
  industryName: string,
  capabilities: Array<{ id: number; name: string }>,
  runId: number,
): Promise<{ created: number; errors: string[] }> {
  let created = 0;
  const errors: string[] = [];

  log.info(`  Value chain: calling Perplexity for ${industryName}...`);
  let researchResult: PerplexityResult;
  try {
    researchResult = await perplexitySearch(
      `What are the 6-8 key value chain stages for ${industryName} industry digital transformation and capability development in 2024-2026? For each stage provide: (1) name of the stage, (2) how many distinct NAICS sectors are involved, (3) approximate patent filings in this area (2019-2024 count and 5-year growth %), (4) number of active startups and 5-year growth %, (5) estimated capital flow in $millions and 5-year growth %, (6) market concentration (high/medium/low), (7) key technologies and capabilities at this stage, (8) key companies at this stage. Be specific with real numbers.`
    );
  } catch (e) {
    log.error(`  Value chain Perplexity FAILED for ${industryName}: ${e}`);
    errors.push(`Perplexity call failed for ${industryName} value chain: ${e}`);
    return { created, errors };
  }

  if (!researchResult.content) return { created: 0, errors: [`No Perplexity response for ${industryName} value chain`] };

  const llmPrompt = `You are a Inflexcvi analyst. Based on this research about the ${industryName} value chain:

${researchResult.content}

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
- "shifts": array of 3-5 short bullet strings describing structural shifts at this stage (e.g. "Additive manufacturing for long-tail spares")
- "risks": array of 3-5 short bullet strings describing disruptors and downside risks (e.g. "Supply chain fragility", "Data silos & versioning")
- "key_capabilities": array of 3-5 capability names
- "key_companies": array of 3-5 real company names

Return ONLY a JSON array. No markdown.`;

  log.info(`  Value chain: calling Perplexity done, calling LLM for ${industryName}...`);
  let parsed: z.infer<typeof ValueChainListSchema>["stages"];
  try {
    const result = await generateObject({
      model: sonnet,
      schema: ValueChainListSchema,
      system: `You produce structured value chain stages for an industry from analyst research. Stage names are 3-5 words; stage_order is sequential 1-N.`,
      prompt: `Industry: ${industryName}\n\nResearch:\n${researchResult.content}`,
      temperature: 0.2,
      maxTokens: 8192,
    });
    parsed = result.object.stages;
  } catch (e) {
    log.error(`  Value chain LLM FAILED for ${industryName}: ${e}`);
    errors.push(`LLM call failed for ${industryName} value chain: ${e}`);
    return { created, errors };
  }

  const capMap = new Map(capabilities.map(c => [c.name.toLowerCase(), c]));

  for (const stage of parsed) {
    try {
      const capIds: number[] = [];
      if (stage.key_capabilities) {
        for (const capName of stage.key_capabilities) {
          const cap = capMap.get(capName.toLowerCase());
          if (cap) capIds.push(cap.id);
        }
      }

      await db.insert(valueChainStagesTable).values({
        industryId,
        runId,
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
        disruptionSummary: stage.disruption_summary || "",
        shifts: Array.isArray(stage.shifts) ? stage.shifts.filter(s => typeof s === "string" && s.trim()).slice(0, 6) : null,
        risks: Array.isArray(stage.risks) ? stage.risks.filter(s => typeof s === "string" && s.trim()).slice(0, 6) : null,
        keyCapabilities: capIds,
        keyCompanies: stage.key_companies || [],
        perplexitySources: researchResult.sources,
      });
      created++;
    } catch (e) {
      errors.push(`Insert value chain stage ${stage.stage_name}: ${e}`);
    }
  }

  return { created, errors };
}

export async function enrichCompanyProfiles(
  industryId: number,
  industryName: string,
  capabilities: Array<{ id: number; name: string }>,
  runId: number,
): Promise<{ profiled: number; mapped: number; errors: string[] }> {
  let profiled = 0;
  let mapped = 0;
  const errors: string[] = [];

  const capNames = capabilities.map(c => c.name).slice(0, 10).join(", ");
  const researchResult = await perplexitySearch(
    `Who are the top 20-25 companies (startups, scaleups, and established players) that are leading innovators in ${industryName} capabilities in 2024-2026? Focus on companies enabling: ${capNames}. For each company provide: (1) company name, (2) country/headquarters, (3) NAICS code and sector if known, (4) primary capability they enable, (5) funding stage (seed, Series A, Series B, growth, public, private), (6) whether their approach is hot (proven ROI, scaling), emerging (early traction), cooling (commoditizing), or table stakes (baseline). Include global companies, not just US-based. Be specific with real company names.`
  );

  if (!researchResult.content) return { profiled: 0, mapped: 0, errors: [`No Perplexity response for ${industryName} companies`] };

  const llmPrompt = `You are a Inflexcvi analyst. Based on this research about ${industryName} companies:

${researchResult.content}

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

  let parsed: z.infer<typeof CompanyListSchema>["companies"];
  try {
    const result = await generateObject({
      model: sonnet,
      schema: CompanyListSchema,
      system: `You profile real companies (startups, scaleups, public players) in an industry from analyst research. primary_capabilities entries MUST match from: ${JSON.stringify(capabilities.map(c => c.name))}`,
      prompt: `Industry: ${industryName}\n\nResearch:\n${researchResult.content}`,
      temperature: 0.2,
      maxTokens: 6144,
    });
    parsed = result.object.companies;
  } catch (e) {
    errors.push(`LLM parse error for ${industryName} companies: ${e}`);
    return { profiled, mapped, errors };
  }

  const capMap = new Map(capabilities.map(c => [c.name.toLowerCase(), c]));

  for (const company of parsed) {
    if (!company.name) continue;
    if (!["hot", "emerging", "cooling", "table_stakes"].includes(company.quadrant)) {
      errors.push(`Skipping ${company.name}: invalid quadrant "${company.quadrant}"`);
      continue;
    }
    if (company.fevi_score == null || company.cdi_score == null) {
      errors.push(`Skipping ${company.name}: missing FEVI/CDI scores from LLM output`);
      continue;
    }
    try {
      const [inserted] = await db.insert(companyCapabilityProfilesTable).values({
        name: company.name,
        country: company.country || "Unknown",
        naicsCode: company.naics_code || null,
        naicsSector: company.naics_sector || null,
        industryId,
        runId,
        feviScore: Math.min(1, Math.max(0, company.fevi_score)),
        cdiScore: Math.min(1, Math.max(0, company.cdi_score)),
        quadrant: company.quadrant,
        fundingStage: company.funding_stage || "private",
        description: company.description || "",
        perplexitySources: researchResult.sources,
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
              runId,
              strength: company.quadrant === "hot" ? "core" : company.quadrant === "emerging" ? "emerging" : "adjacent",
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
