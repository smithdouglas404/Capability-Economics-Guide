import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityDependenciesTable,
  capabilityQuadrantsTable,
  capabilityEconomicsTable,
  capabilityMetricsTable,
  capabilityRoleMappingsTable,
  cSuiteRolesTable,
  dependencyEdgeScoresTable,
  industriesTable,
} from "@workspace/db";
import { eq, desc, inArray, isNull, and } from "drizzle-orm";
import { logger as log } from "../../lib/logger";

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

async function enrichOneCapabilityDetail(
  cap: { id: number; name: string; industryId: number; description: string | null; traditionalView: string | null; economicView: string | null; benchmarkScore: number | null },
  industryName: string,
  econRowId: number,
  econ: { consensusQuadrant: string | null; consensusSummary: string | null; halfLifeMonths: number | null; marginStructurePct: number | null; revenueExposureMm: number | null },
  metrics: Array<{ name: string; description: string | null; benchmarkValue: number | null; unit: string | null }>,
  deps: Array<{ dependsOnName: string; strength: string | null }>,
  roles: Array<{ roleTitle: string; roleName: string; relevance: string | null }>,
  revisionGuidance?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const research = await perplexity(
      `For the enterprise capability "${cap.name}" in ${industryName} (2024-2026): ` +
      `(1) How is generative AI / LLMs disrupting or augmenting this capability? Which AI vendors or open models are credible substitutes? ` +
      `(2) What % of incumbent revenue is at risk from AI substitution within 36 months? ` +
      `(3) Why is the conventional / "checklist" view of this capability ("${cap.traditionalView ?? "treated as IT"}") economically wrong? ` +
      `(4) What is the actual dollar consequence of treating it as a real economic capability? ` +
      `(5) For each of these metrics, what does a top-quartile vs bottom-quartile reading actually mean in dollars or risk: ${metrics.map(m => `"${m.name}"`).join(", ") || "n/a"}. ` +
      `(6) For each dependency, why does it matter: ${deps.map(d => `"${d.dependsOnName}"`).join(", ") || "n/a"}. ` +
      `Cite real companies, regulators, or 10-K disclosures from 2024-2026.`
    );
    if (!research.content) return { ok: false, error: "empty detail research" };

    const metricList = metrics.map(m => ({ name: m.name, benchmark: m.benchmarkValue, unit: m.unit }));
    const depList = deps.map(d => ({ name: d.dependsOnName, strength: d.strength }));
    const roleList = roles.map(r => ({ title: r.roleTitle, name: r.roleName, relevance: r.relevance }));

    const glmText = await glmJson(
      `Research on "${cap.name}" (${industryName}):\n\n${research.content.substring(0, 6000)}\n\n` +
      `Existing context:\n` +
      `- traditional view: "${cap.traditionalView ?? ""}"\n` +
      `- economic view: "${cap.economicView ?? ""}"\n` +
      `- benchmark score: ${cap.benchmarkScore ?? "?"} / 100\n` +
      `- CE quadrant (street consensus): ${econ.consensusQuadrant ?? "?"}\n` +
      `- half-life months: ${econ.halfLifeMonths ?? "?"}\n` +
      `- margin %: ${econ.marginStructurePct ?? "?"}\n` +
      `- revenue exposure $M: ${econ.revenueExposureMm ?? "?"}\n` +
      `- metrics: ${JSON.stringify(metricList)}\n` +
      `- dependencies: ${JSON.stringify(depList)}\n` +
      `- c-suite roles: ${JSON.stringify(roleList)}\n\n` +
      `Return ONLY a JSON object with these keys:\n\n` +
      `"summary_narrative" (string, 2-3 sentences in plain English explaining what THIS capability actually does inside a ${industryName} company — name a concrete activity, a tool category, and a typical outcome a non-expert executive would recognize. Definitional, no jargon, no $ figures), ` +
      `"traditional_narrative" (string, 2-3 sentences "consequence-style" explaining WHY the conventional view is wrong with a concrete number or example — must include a $ figure, regulator, or competitor name), ` +
      `"economic_narrative" (string, 2-3 sentences quantifying the dollar value of treating this as a real capability, include a specific multiplier or $ figure), ` +
      `"metric_interpretations" (array of {name: string, interpretation: string} — interpretation is 1-2 sentences explaining what crossing the benchmark means in money or risk; one entry per metric in input order), ` +
      `"dependency_rationales" (array of {dependsOnName: string, rationale: string} — rationale is 1-2 sentences naming the real-world risk if the upstream cap is disrupted, mention a vendor or regulation; one per dependency), ` +
      `"role_consequences" (array of {roleTitle: string, consequence: string} — 1-2 sentences naming what this exec must do or explain this quarter; one per role), ` +
      `"playbook" (array of exactly 3 strings — concrete actions a buyer should take this week, ≤ 18 words each, no fluff), ` +
      `"benchmark_interpretation" (string, 1-2 sentences telling the user what their benchmark score means in dollars vs the median), ` +
      `"ai_exposure_score" (number 0-100, % of incumbent revenue at risk from AI substitution within 36 months), ` +
      `"ai_time_to_displacement_months" (number 6-60, months until ≥50% of revenue is at risk), ` +
      `"ai_substitutes" (array of 2-6 strings — real AI vendor / model names that credibly substitute or augment this capability), ` +
      `"ai_narrative" (string, 2-3 sentences on how GenAI specifically reshapes this capability, name vendors and a probability or $ figure)\n\n` +
      (revisionGuidance ? `\n\nREVIEWER FEEDBACK ON PRIOR DRAFT (must address): "${revisionGuidance}"\n` : "") +
      `Output strict JSON only, no prose.`,
      4000,
    );

    const parsed = extractJson(glmText) as {
      summary_narrative?: string;
      traditional_narrative?: string;
      economic_narrative?: string;
      metric_interpretations?: Array<{ name: string; interpretation: string }>;
      dependency_rationales?: Array<{ dependsOnName: string; rationale: string }>;
      role_consequences?: Array<{ roleTitle: string; consequence: string }>;
      playbook?: string[];
      benchmark_interpretation?: string;
      ai_exposure_score?: number;
      ai_time_to_displacement_months?: number;
      ai_substitutes?: string[];
      ai_narrative?: string;
    };
    if (!parsed || typeof parsed !== "object") return { ok: false, error: "bad detail JSON" };

    await db.update(capabilityEconomicsTable).set({
      summaryNarrative: parsed.summary_narrative ?? null,
      traditionalNarrative: parsed.traditional_narrative ?? null,
      economicNarrative: parsed.economic_narrative ?? null,
      metricInterpretations: Array.isArray(parsed.metric_interpretations) ? parsed.metric_interpretations.slice(0, 12) : null,
      dependencyRationales: Array.isArray(parsed.dependency_rationales) ? parsed.dependency_rationales.slice(0, 20) : null,
      roleConsequences: Array.isArray(parsed.role_consequences) ? parsed.role_consequences.slice(0, 12) : null,
      playbook: Array.isArray(parsed.playbook) ? parsed.playbook.slice(0, 3) : null,
      benchmarkInterpretation: parsed.benchmark_interpretation ?? null,
      aiExposureScore: parsed.ai_exposure_score != null ? Math.min(100, Math.max(0, parsed.ai_exposure_score)) : null,
      aiTimeToDisplacementMonths: parsed.ai_time_to_displacement_months != null ? Math.min(60, Math.max(6, parsed.ai_time_to_displacement_months)) : null,
      aiSubstitutes: Array.isArray(parsed.ai_substitutes) ? parsed.ai_substitutes.slice(0, 8) : null,
      aiNarrative: parsed.ai_narrative ?? null,
    }).where(eq(capabilityEconomicsTable.id, econRowId));

    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).substring(0, 200) };
  }
}

export interface AlphaEnrichResult {
  capabilitiesEnriched: number;
  edgesEnriched: number;
  detailsEnriched?: number;
  errors: string[];
  durationMs: number;
}

export async function runDetailEnrichment(opts: { limit?: number; force?: boolean; capabilityId?: number; revisionGuidance?: string } = {}): Promise<{ enriched: number; errors: string[]; durationMs: number }> {
  const start = Date.now();
  const errors: string[] = [];
  let enriched = 0;
  {
    const limit = opts.limit ?? 6;
    const econRows = await db.select().from(capabilityEconomicsTable);
    const targets = opts.capabilityId != null
      ? econRows.filter(r => r.capabilityId === opts.capabilityId)
      : econRows
          .filter(r => opts.force || r.summaryNarrative == null || r.traditionalNarrative == null || r.aiExposureScore == null)
          .slice(0, limit);
    if (targets.length === 0) return { enriched: 0, errors: [], durationMs: Date.now() - start };

    const caps = await db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, targets.map(t => t.capabilityId)));
    const capById = new Map(caps.map(c => [c.id, c]));
    const industries = await db.select().from(industriesTable);
    const indById = new Map(industries.map(i => [i.id, i.name]));
    const allMetrics = await db.select().from(capabilityMetricsTable).where(inArray(capabilityMetricsTable.capabilityId, targets.map(t => t.capabilityId)));
    const allDeps = await db.select({
      capabilityId: capabilityDependenciesTable.capabilityId,
      dependsOnId: capabilityDependenciesTable.dependsOnId,
      strength: capabilityDependenciesTable.strength,
    }).from(capabilityDependenciesTable).where(inArray(capabilityDependenciesTable.capabilityId, targets.map(t => t.capabilityId)));
    const depCapIds = Array.from(new Set(allDeps.map(d => d.dependsOnId)));
    const depCaps = depCapIds.length > 0 ? await db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name }).from(capabilitiesTable).where(inArray(capabilitiesTable.id, depCapIds)) : [];
    const depCapById = new Map(depCaps.map(c => [c.id, c.name]));
    const allRoleMappings = await db.select({
      capabilityId: capabilityRoleMappingsTable.capabilityId,
      roleId: capabilityRoleMappingsTable.roleId,
      relevance: capabilityRoleMappingsTable.relevance,
    }).from(capabilityRoleMappingsTable).where(inArray(capabilityRoleMappingsTable.capabilityId, targets.map(t => t.capabilityId)));
    const allRoles = await db.select().from(cSuiteRolesTable);
    const roleById = new Map(allRoles.map(r => [r.id, r]));

    log.info(`[AlphaDetail] enriching detail for ${targets.length} capabilities`);
    for (const econRow of targets) {
      const cap = capById.get(econRow.capabilityId);
      if (!cap) { errors.push(`[detail:cap${econRow.capabilityId}] missing capability`); continue; }
      const indName = indById.get(cap.industryId) ?? "Unknown";
      const metrics = allMetrics.filter(m => m.capabilityId === cap.id).map(m => ({ name: m.name, description: m.description, benchmarkValue: m.benchmarkValue, unit: m.unit }));
      const deps = allDeps.filter(d => d.capabilityId === cap.id).map(d => ({ dependsOnName: depCapById.get(d.dependsOnId) ?? "?", strength: d.strength }));
      const roles = allRoleMappings.filter(rm => rm.capabilityId === cap.id).map(rm => {
        const role = roleById.get(rm.roleId);
        return { roleTitle: role?.title ?? "?", roleName: role?.name ?? "?", relevance: rm.relevance };
      });
      const r = await enrichOneCapabilityDetail(cap, indName, econRow.id, {
        consensusQuadrant: econRow.consensusQuadrant,
        consensusSummary: econRow.consensusSummary,
        halfLifeMonths: econRow.halfLifeMonths,
        marginStructurePct: econRow.marginStructurePct,
        revenueExposureMm: econRow.revenueExposureMm,
      }, metrics, deps, roles, opts.revisionGuidance);
      if (r.ok) enriched++; else errors.push(`[detail:${cap.name}] ${r.error}`);
    }
    return { enriched, errors, durationMs: Date.now() - start };
  }
}

export async function runAlphaEnrichment(opts: { limitCapabilities?: number; limitEdges?: number; industryId?: number } = {}): Promise<AlphaEnrichResult> {
  const start = Date.now();
  const errors: string[] = [];
  let capabilitiesEnriched = 0;
  let edgesEnriched = 0;

  {
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
  }
}

async function enrichOneCapabilityEconymicsLog(
  cap: { id: number; name: string; industryId: number },
  industryName: string,
): Promise<{ ok: boolean; error?: string }> {
  return enrichOneCapabilityEconomics(cap, industryName);
}
