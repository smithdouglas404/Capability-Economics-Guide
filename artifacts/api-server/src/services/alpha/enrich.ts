import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityDependenciesTable,
  capabilityQuadrantsTable,
  capabilityEconomicsTable,
  dependencyEdgeScoresTable,
  industriesTable,
} from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { logger as log } from "../../lib/logger";

let alphaRunning = false;

interface PerplexityResult { content: string; sources: string[]; }

async function perplexity(query: string): Promise<PerplexityResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not set");
  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        { role: "system", content: "You are a capability economics research analyst. Reply with concrete numbers: TAM/SAM in $ millions, margin percentages, time horizons in months, growth rates. Cite specific sources and real figures from 2023-2026." },
        { role: "user", content: query },
      ],
    }),
  });
  if (!resp.ok) throw new Error(`Perplexity ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { choices: Array<{ message: { content: string } }>; citations?: string[] };
  return { content: data.choices[0]?.message?.content ?? "", sources: data.citations ?? [] };
}

async function glmJson(prompt: string, maxTokens = 2000): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://capabilityeconomics.com",
        "X-Title": "Capability Economics Alpha",
      },
      body: JSON.stringify({
        model: "z-ai/glm-5.1",
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        reasoning: { enabled: false, exclude: true },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`GLM ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
    const data = await resp.json() as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
    if (data.error) throw new Error(`GLM: ${data.error.message}`);
    return data.choices?.[0]?.message?.content ?? "";
  } finally { clearTimeout(timeout); }
}

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch {} }
  throw new Error("No JSON in GLM response");
}

async function enrichOneCapabilityEconomics(
  cap: { id: number; name: string; industryId: number },
  industryName: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const research = await perplexity(
      `For the capability "${cap.name}" in the ${industryName} industry (2024-2026): ` +
      `(1) estimated global TAM in USD millions, (2) SAM (serviceable addressable market) in USD millions, ` +
      `(3) typical gross margin percentage for providers of this capability, ` +
      `(4) estimated months until this capability becomes commoditized ("half-life" to table-stakes), ` +
      `(5) annual commoditization velocity (% decay of differentiation per year), ` +
      `(6) total enterprise revenue currently dependent on this capability in ${industryName} (USD millions), ` +
      `(7) current consensus analyst view: is this capability hot/emerging/cooling/table_stakes? ` +
      `Include real figures with source citations.`
    );
    if (!research.content) return { ok: false, error: "empty research" };

    const glmText = await glmJson(
      `Analyst research on "${cap.name}" in ${industryName}:\n\n${research.content}\n\n` +
      `Return ONLY a JSON object with keys:\n` +
      `"tam_usd_mm" (number, null if unknown), ` +
      `"sam_usd_mm" (number, null if unknown), ` +
      `"margin_structure_pct" (number 0-100), ` +
      `"half_life_months" (number 6-120, shorter = faster commoditization), ` +
      `"commoditization_velocity" (number 0-1, fraction of differentiation lost per year), ` +
      `"revenue_exposure_mm" (number, enterprise revenue currently dependent on this capability in this industry), ` +
      `"consensus_quadrant" (one of "hot","emerging","cooling","table_stakes"), ` +
      `"consensus_confidence" (number 0-1), ` +
      `"consensus_summary" (2 sentences of what the street / analyst consensus says), ` +
      `"rationale" (2-3 sentences on the economics reasoning)\n` +
      `Output strict JSON, no prose.`
    );

    const parsed = extractJson(glmText) as {
      tam_usd_mm?: number | null;
      sam_usd_mm?: number | null;
      margin_structure_pct?: number;
      half_life_months?: number;
      commoditization_velocity?: number;
      revenue_exposure_mm?: number;
      consensus_quadrant?: string;
      consensus_confidence?: number;
      consensus_summary?: string;
      rationale?: string;
    };

    if (!parsed || typeof parsed !== "object") return { ok: false, error: "bad JSON" };
    if (parsed.consensus_quadrant && !["hot", "emerging", "cooling", "table_stakes"].includes(parsed.consensus_quadrant)) {
      parsed.consensus_quadrant = undefined;
    }

    await db.insert(capabilityEconomicsTable).values({
      capabilityId: cap.id,
      industryId: cap.industryId,
      tamUsdMm: parsed.tam_usd_mm ?? null,
      samUsdMm: parsed.sam_usd_mm ?? null,
      marginStructurePct: parsed.margin_structure_pct != null ? Math.min(100, Math.max(0, parsed.margin_structure_pct)) : null,
      halfLifeMonths: parsed.half_life_months != null ? Math.min(120, Math.max(6, parsed.half_life_months)) : null,
      commoditizationVelocity: parsed.commoditization_velocity != null ? Math.min(1, Math.max(0, parsed.commoditization_velocity)) : null,
      revenueExposureMm: parsed.revenue_exposure_mm ?? null,
      consensusQuadrant: parsed.consensus_quadrant ?? null,
      consensusConfidence: parsed.consensus_confidence != null ? Math.min(1, Math.max(0, parsed.consensus_confidence)) : null,
      consensusSummary: parsed.consensus_summary ?? null,
      consensusSources: research.sources,
      rationale: parsed.rationale ?? null,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).substring(0, 200) };
  }
}

async function enrichOneEdge(
  edge: { id: number; capabilityId: number; dependsOnId: number; strength: string },
  capById: Map<number, string>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const from = capById.get(edge.capabilityId);
    const to = capById.get(edge.dependsOnId);
    if (!from || !to) return { ok: false, error: "unknown capability ids" };

    const research = await perplexity(
      `The enterprise capability "${from}" depends on "${to}". If "${to}" is disrupted, commoditizes, ` +
      `or is replaced by a new technology in 2024-2026, what happens to "${from}"? Provide: ` +
      `(1) probability that disruption of "${to}" in the next 36 months propagates downstream to ` +
      `materially impair "${from}" (0-1 probability), ` +
      `(2) typical time-to-impact in months, ` +
      `(3) estimated dollar impact in USD millions across the enterprise market for "${from}", ` +
      `(4) one-sentence rationale tying specific companies or technologies.`
    );
    if (!research.content) return { ok: false, error: "empty research" };

    const glmText = await glmJson(
      `Research on cascade edge "${from}" → "${to}":\n\n${research.content}\n\n` +
      `Return ONLY a JSON object with keys:\n` +
      `"disruption_probability" (0-1), ` +
      `"time_to_impact_months" (number 1-60), ` +
      `"dollar_impact_mm" (number), ` +
      `"rationale" (1-2 sentences citing real companies or tech).\n` +
      `Output strict JSON only.`,
      1200,
    );

    const parsed = extractJson(glmText) as {
      disruption_probability?: number;
      time_to_impact_months?: number;
      dollar_impact_mm?: number;
      rationale?: string;
    };

    await db.insert(dependencyEdgeScoresTable).values({
      dependencyId: edge.id,
      disruptionProbability: parsed.disruption_probability != null ? Math.min(1, Math.max(0, parsed.disruption_probability)) : null,
      timeToImpactMonths: parsed.time_to_impact_months != null ? Math.min(60, Math.max(1, parsed.time_to_impact_months)) : null,
      dollarImpactMm: parsed.dollar_impact_mm ?? null,
      rationale: parsed.rationale ?? null,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).substring(0, 200) };
  }
}

export interface AlphaEnrichResult {
  capabilitiesEnriched: number;
  edgesEnriched: number;
  errors: string[];
  durationMs: number;
}

export async function runAlphaEnrichment(opts: { limitCapabilities?: number; limitEdges?: number; industryId?: number } = {}): Promise<AlphaEnrichResult> {
  if (alphaRunning) throw new Error("Alpha enrichment already in progress");
  alphaRunning = true;
  const start = Date.now();
  const errors: string[] = [];
  let capabilitiesEnriched = 0;
  let edgesEnriched = 0;

  try {
    const limitCap = opts.limitCapabilities ?? 12;
    const limitEdge = opts.limitEdges ?? 15;

    const caps = await (opts.industryId
      ? db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, opts.industryId))
      : db.select().from(capabilitiesTable));
    const industries = await db.select().from(industriesTable);
    const indById = new Map(industries.map(i => [i.id, i.name]));

    const alreadyEnriched = await db.select({ capabilityId: capabilityEconomicsTable.capabilityId }).from(capabilityEconomicsTable);
    const enrichedIds = new Set(alreadyEnriched.map(r => r.capabilityId));

    const quadrants = await db.select({ capabilityId: capabilityQuadrantsTable.capabilityId, economicImpactScore: capabilityQuadrantsTable.economicImpactScore }).from(capabilityQuadrantsTable);
    const impactById = new Map(quadrants.map(q => [q.capabilityId, q.economicImpactScore]));

    const toEnrich = caps
      .filter(c => !enrichedIds.has(c.id))
      .sort((a, b) => (impactById.get(b.id) ?? 0) - (impactById.get(a.id) ?? 0))
      .slice(0, limitCap);

    log.info(`[Alpha] Enriching ${toEnrich.length} capabilities...`);
    for (const cap of toEnrich) {
      const indName = indById.get(cap.industryId) ?? "Unknown";
      const r = await enrichOneCapabilityEconymicsLog(cap, indName);
      if (r.ok) capabilitiesEnriched++;
      else errors.push(`[cap:${cap.name}] ${r.error}`);
    }

    const deps = await db.select().from(capabilityDependenciesTable);
    const alreadyScored = await db.select({ dependencyId: dependencyEdgeScoresTable.dependencyId }).from(dependencyEdgeScoresTable);
    const scoredIds = new Set(alreadyScored.map(r => r.dependencyId));
    const capById = new Map(caps.map(c => [c.id, c.name]));
    const edgesToScore = deps.filter(d => !scoredIds.has(d.id)).slice(0, limitEdge);

    log.info(`[Alpha] Scoring ${edgesToScore.length} dependency edges...`);
    for (const edge of edgesToScore) {
      const r = await enrichOneEdge(edge, capById);
      if (r.ok) edgesEnriched++;
      else errors.push(`[edge:${edge.id}] ${r.error}`);
    }

    const durationMs = Date.now() - start;
    log.info(`[Alpha] done in ${(durationMs / 1000).toFixed(1)}s: ${capabilitiesEnriched} caps, ${edgesEnriched} edges, ${errors.length} errors`);
    return { capabilitiesEnriched, edgesEnriched, errors, durationMs };
  } finally {
    alphaRunning = false;
  }
}

async function enrichOneCapabilityEconymicsLog(
  cap: { id: number; name: string; industryId: number },
  industryName: string,
): Promise<{ ok: boolean; error?: string }> {
  return enrichOneCapabilityEconomics(cap, industryName);
}
