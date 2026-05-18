import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityDependenciesTable,
  capabilityQuadrantsTable,
  capabilityAlphaTable,
  capabilityMetricsTable,
  capabilityRoleMappingsTable,
  cSuiteRolesTable,
  dependencyEdgeScoresTable,
  industriesTable,
} from "@workspace/db";
import { eq, desc, inArray, isNull, and } from "drizzle-orm";
import { logger as log } from "../../lib/logger";
import { retry } from "../../lib/llm-retry";
import { runResearchPipeline } from "../workflows";
import { z } from "zod";
import { sonnet, generateObject } from "../workflows/models";

// ── Zod schemas for each enrichment LLM call ───────────────────────────────
// These replace the legacy `openrouterChatJson` + `extractJson` pattern with
// SDK-validated structured output. Field names match the legacy snake_case
// the consumers downstream still expect.

const EconomicsSchema = z.object({
  tam_usd_mm: z.number().nullable(),
  sam_usd_mm: z.number().nullable(),
  margin_structure_pct: z.number().min(0).max(100).nullable(),
  half_life_months: z.number().min(6).max(120).nullable(),
  commoditization_velocity: z.number().min(0).max(1).nullable(),
  revenue_exposure_mm: z.number().nullable(),
  consensus_quadrant: z.enum(["hot", "emerging", "cooling", "table_stakes"]).nullable(),
  consensus_confidence: z.number().min(0).max(1).nullable(),
  consensus_summary: z.string().nullable(),
  rationale: z.string().nullable(),
});

const EdgeSchema = z.object({
  disruption_probability: z.number().min(0).max(1).nullable(),
  time_to_impact_months: z.number().min(1).max(60).nullable(),
  dollar_impact_mm: z.number().nullable(),
  rationale: z.string().nullable(),
});

const DetailSchema = z.object({
  summary_narrative: z.string(),
  traditional_narrative: z.string(),
  alpha_narrative: z.string(),
  metric_interpretations: z.array(z.object({ name: z.string(), interpretation: z.string() })).max(12),
  dependency_rationales: z.array(z.object({ dependsOnName: z.string(), rationale: z.string() })).max(20),
  role_consequences: z.array(z.object({ roleTitle: z.string(), consequence: z.string() })).max(12),
  playbook: z.array(z.string()).length(3),
  benchmark_interpretation: z.string(),
  ai_exposure_score: z.number().min(0).max(100),
  ai_time_to_displacement_months: z.number().min(6).max(60),
  ai_substitutes: z.array(z.string()).min(2).max(8),
  ai_narrative: z.string(),
});

const AiSectionSchema = z.object({
  ai_exposure_score: z.number().min(0).max(100),
  ai_time_to_displacement_months: z.number().min(6).max(60),
  ai_substitutes: z.array(z.string()).min(2).max(8),
  ai_narrative: z.string().min(50),
});

interface PerplexityResult { content: string; sources: string[]; }

/**
 * Delegate to the research-pipeline workflow when
 * . Returns null on workflow failure so the
 * caller falls back to the inline Perplexity + Sonnet path. Each runner here
 * can short-circuit at the top of its function with this helper.
 */
async function tryAlphaWorkflowResearch(capabilityId: number, prompt: string): Promise<Record<string, unknown> | null> {
  const result = await runResearchPipeline({ capabilityId, kind: "alpha", prompt }).catch(() => null);
  if (!result || result.status === "degraded") return null;
  return result.payload as Record<string, unknown>;
}

async function perplexity(query: string): Promise<PerplexityResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) throw new Error("PERPLEXITY_API_KEY not set");
  return retry(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
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
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`Perplexity ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
      const data = await resp.json() as { choices: Array<{ message: { content: string } }>; citations?: string[] };
      return { content: data.choices[0]?.message?.content ?? "", sources: data.citations ?? [] };
    } finally { clearTimeout(timeout); }
  }, { label: "alpha.perplexity" });
}

// `openrouterChatJson` + `extractJson` helpers retired 2026-05-18 — replaced
// by `generateObject({ schema })` from the AI SDK at every call site.

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

    const { object: parsed } = await generateObject({
      model: sonnet,
      schema: EconomicsSchema,
      system: "You extract capability-economics estimates from analyst research. Return null for any field you can't ground in the research; never fabricate. consensus_summary is 2 sentences; rationale is 2-3.",
      prompt: `Analyst research on "${cap.name}" in ${industryName}:\n\n${research.content}`,
      temperature: 0.2,
      maxTokens: 2000,
    });

    // Snapshot previous consensus quadrant so we can fire quadrant_transition
    // subscriptions if it changes after this insert.
    const [prevRow] = await db.select({ q: capabilityAlphaTable.consensusQuadrant })
      .from(capabilityAlphaTable)
      .where(eq(capabilityAlphaTable.capabilityId, cap.id))
      .orderBy(desc(capabilityAlphaTable.generatedAt))
      .limit(1);
    const prevQuadrant = prevRow?.q ?? null;

    await db.insert(capabilityAlphaTable).values({
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

    // Fire quadrant_transition subscriptions if the consensus quadrant changed.
    // Lazy-imported to keep alpha/enrich free of any subscriptions coupling.
    if ((parsed.consensus_quadrant ?? null) !== prevQuadrant) {
      try {
        const { evaluateAfterQuadrantChange } = await import("../subscriptions");
        await evaluateAfterQuadrantChange(cap.id, cap.industryId, prevQuadrant, parsed.consensus_quadrant ?? null);
      } catch (err) {
        log.warn({ err, capabilityId: cap.id }, "[alpha/enrich] quadrant subscription evaluation failed");
      }
    }
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

    const { object: parsed } = await generateObject({
      model: sonnet,
      schema: EdgeSchema,
      system: "You score how disruption propagates across a capability dependency edge. Return null fields when the research doesn't support a confident number.",
      prompt: `Research on cascade edge "${from}" → "${to}":\n\n${research.content}`,
      temperature: 0.2,
      maxTokens: 1200,
    });

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
      `(1) How is the broader wave of innovation — AI (generative LLMs, classical ML, agents, automation), plus adjacent innovative ideas (open data ecosystems, embedded fintech / embedded insurance / embedded health rails, low-code / no-code, decentralized infra, digital twins, IoT / edge sensors, synthetic data, robotic process automation, regulatory sandboxes, marketplace / API-first business models, vertical SaaS bundling, novel pricing models like outcome-based or usage-based, etc.) — disrupting or augmenting this capability? Be specific about WHICH innovations apply (don't list ones that don't). Name credible vendors, open-source projects, regulators, or new entrants. ` +
      `(2) What % of incumbent revenue is at risk from AI + adjacent-innovation substitution within 36 months? ` +
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

    const detailSystem = `You produce inflexcvi capability-detail narratives grounded in the supplied research.

Rules:
- summary_narrative: 2-3 sentences in plain English; concrete activity + tool category + outcome; no $ figures.
- traditional_narrative: 2-3 sentences "consequence-style" with a $ figure, regulator, or competitor name showing why the conventional view is wrong.
- alpha_narrative: 2-3 sentences quantifying the dollar value of treating this as a real capability.
- metric_interpretations: one entry per input metric in input order.
- dependency_rationales: one per dependency.
- role_consequences: one per role.
- playbook: exactly 3 strings, each ≤ 18 words.
- ai_substitutes: real vendor/project/regulator names (AI vendors, embedded-finance rails, vertical SaaS, marketplaces, RPA, IoT/edge, etc.) — only those that genuinely apply.
- ai_narrative: 3-4 sentences naming 2-3 specific vendors/projects/regulators and at least one probability or $ figure.${revisionGuidance ? `\n\nREVIEWER FEEDBACK ON PRIOR DRAFT (must address): "${revisionGuidance}"` : ""}`;

    const detailUserPrompt = `Research on "${cap.name}" (${industryName}):\n\n${research.content.substring(0, 6000)}\n\nExisting context:\n- traditional view: "${cap.traditionalView ?? ""}"\n- economic view: "${cap.economicView ?? ""}"\n- benchmark score: ${cap.benchmarkScore ?? "?"} / 100\n- CE quadrant: ${econ.consensusQuadrant ?? "?"}\n- half-life months: ${econ.halfLifeMonths ?? "?"}\n- margin %: ${econ.marginStructurePct ?? "?"}\n- revenue exposure $M: ${econ.revenueExposureMm ?? "?"}\n- metrics: ${JSON.stringify(metricList)}\n- dependencies: ${JSON.stringify(depList)}\n- c-suite roles: ${JSON.stringify(roleList)}`;

    const { object: parsed } = await generateObject({
      model: sonnet,
      schema: DetailSchema,
      system: detailSystem,
      prompt: detailUserPrompt,
      temperature: 0.2,
      maxTokens: 4000,
    });

    await db.update(capabilityAlphaTable).set({
      summaryNarrative: parsed.summary_narrative,
      traditionalNarrative: parsed.traditional_narrative,
      alphaNarrative: parsed.alpha_narrative,
      metricInterpretations: parsed.metric_interpretations.slice(0, 12),
      dependencyRationales: parsed.dependency_rationales.slice(0, 20),
      roleConsequences: parsed.role_consequences.slice(0, 12),
      playbook: parsed.playbook.slice(0, 3),
      benchmarkInterpretation: parsed.benchmark_interpretation,
      aiExposureScore: Math.min(100, Math.max(0, parsed.ai_exposure_score)),
      aiTimeToDisplacementMonths: Math.min(60, Math.max(6, parsed.ai_time_to_displacement_months)),
      aiSubstitutes: parsed.ai_substitutes.slice(0, 8),
      aiNarrative: parsed.ai_narrative,
    }).where(eq(capabilityAlphaTable.id, econRowId));

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

export async function runDetailEnrichment(opts: { limit?: number; force?: boolean; capabilityId?: number; industryIds?: number[]; revisionGuidance?: string } = {}): Promise<{ enriched: number; errors: string[]; durationMs: number }> {
  const start = Date.now();
  const errors: string[] = [];
  let enriched = 0;
  {
    const limit = opts.limit ?? 6;
    const econRows = await db.select().from(capabilityAlphaTable);
    // industryIds filter: scope the null-detail sweep to the target industries
    // so a bulk-path call after enriching Industry X doesn't also burn LLM
    // budget catching up backlog in unrelated industries.
    let industryCapIds: Set<number> | null = null;
    if (opts.industryIds && opts.industryIds.length > 0) {
      const indCaps = await db.select({ id: capabilitiesTable.id }).from(capabilitiesTable).where(inArray(capabilitiesTable.industryId, opts.industryIds));
      industryCapIds = new Set(indCaps.map(c => c.id));
    }
    const targets = opts.capabilityId != null
      ? econRows.filter(r => r.capabilityId === opts.capabilityId)
      : econRows
          .filter(r => industryCapIds == null || industryCapIds.has(r.capabilityId))
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
    // Same systemic-failure guard as alpha — throw if every attempt failed
    // so BullMQ retries instead of silently succeeding.
    if (targets.length > 0 && enriched === 0) {
      throw new Error(`Detail enrichment: 0 of ${targets.length} succeeded — ${errors[0] ?? "unknown"}`);
    }
    return { enriched, errors, durationMs: Date.now() - start };
  }
}

async function regenerateOneAiSection(
  cap: { id: number; name: string; industryId: number; traditionalView: string | null },
  industryName: string,
  econRowId: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const research = await perplexity(
      `For the enterprise capability "${cap.name}" in ${industryName} (2024-2026): ` +
      `How is the broader wave of innovation — AI (generative LLMs, classical ML, agents, automation), ` +
      `plus adjacent innovative ideas (open data ecosystems, embedded fintech / embedded insurance / embedded health rails, ` +
      `low-code / no-code, decentralized infrastructure, digital twins, IoT / edge sensors, synthetic data, ` +
      `robotic process automation, regulatory sandboxes, marketplace / API-first business models, vertical SaaS bundling, ` +
      `outcome-based or usage-based pricing) — disrupting or augmenting this capability? ` +
      `Be specific about WHICH innovations apply and which DON'T. Name credible vendors, open-source projects, ` +
      `regulators, or new entrants. Provide: ` +
      `(a) % of incumbent revenue at risk from AI + adjacent-innovation substitution within 36 months, ` +
      `(b) months until ≥50% of revenue is at risk, ` +
      `(c) 2-6 named real substitutes/augmentors, ` +
      `(d) at least one $ figure or probability tied to a real company. Cite sources.`
    );
    if (!research.content) return { ok: false, error: "empty research" };

    const { object: parsed } = await generateObject({
      model: sonnet,
      schema: AiSectionSchema,
      system: "You describe how AI + adjacent innovations reshape an enterprise capability. ai_substitutes lists real vendor/project/regulator names — only those that genuinely apply. ai_narrative is 3-4 sentences with 2-3 specific names and at least one probability or $ figure. Don't shoehorn innovations that aren't relevant.",
      prompt: `Research on "${cap.name}" (${industryName}):\n\n${research.content.substring(0, 6000)}`,
      temperature: 0.2,
      maxTokens: 2000,
    });

    await db.update(capabilityAlphaTable).set({
      aiExposureScore: Math.min(100, Math.max(0, parsed.ai_exposure_score)),
      aiTimeToDisplacementMonths: Math.min(60, Math.max(6, parsed.ai_time_to_displacement_months)),
      aiSubstitutes: parsed.ai_substitutes.slice(0, 8),
      aiNarrative: parsed.ai_narrative,
    }).where(eq(capabilityAlphaTable.id, econRowId));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e).substring(0, 200) };
  }
}

export async function backfillAiNarratives(opts: { limit?: number; capabilityIds?: number[]; concurrency?: number } = {}): Promise<{ updated: number; failed: number; errors: string[]; durationMs: number }> {
  const start = Date.now();
  const errors: string[] = [];
  let updated = 0;
  let failed = 0;

  const econRows = await db.select().from(capabilityAlphaTable);
  let targets = opts.capabilityIds && opts.capabilityIds.length > 0
    ? econRows.filter(r => opts.capabilityIds!.includes(r.capabilityId))
    : econRows;
  if (opts.limit != null) targets = targets.slice(0, opts.limit);

  const caps = await db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, targets.map(t => t.capabilityId)));
  const capById = new Map(caps.map(c => [c.id, c]));
  const industries = await db.select().from(industriesTable);
  const indById = new Map(industries.map(i => [i.id, i.name]));

  log.info(`[AiBackfill] regenerating ai_narrative for ${targets.length} capabilities`);

  // Default concurrency 1 — concurrent OpenRouter calls trigger 429s under
  // the default free-tier rate limit and there's no internal backoff between
  // workers; serialised retries-with-backoff finish faster end-to-end than
  // parallel-with-burst-failures. Admin can opt back into higher concurrency
  // via the body param when running against a paid OpenRouter account.
  const concurrency = Math.max(1, Math.min(4, opts.concurrency ?? 1));
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const idx = cursor++;
      const econRow = targets[idx];
      const cap = capById.get(econRow.capabilityId);
      if (!cap) { failed++; errors.push(`[ai:cap${econRow.capabilityId}] missing cap`); continue; }
      const indName = indById.get(cap.industryId) ?? "Unknown";
      const r = await regenerateOneAiSection(cap, indName, econRow.id);
      if (r.ok) {
        updated++;
        log.info(`[AiBackfill] ${updated}/${targets.length} ✓ ${cap.name}`);
      } else {
        failed++;
        errors.push(`[ai:${cap.name}] ${r.error}`);
        log.warn(`[AiBackfill] ✗ ${cap.name}: ${r.error}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const durationMs = Date.now() - start;
  log.info(`[AiBackfill] done in ${(durationMs / 1000).toFixed(1)}s: ${updated} updated, ${failed} failed`);
  return { updated, failed, errors: errors.slice(0, 20), durationMs };
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

    const alreadyEnriched = await db.select({ capabilityId: capabilityAlphaTable.capabilityId }).from(capabilityAlphaTable);
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

    // If we attempted work and *everything* failed, this is a systemic issue
    // (bad API key, provider outage, etc.) — throw so BullMQ burns a retry
    // attempt. Per-item failures are still surfaced in `errors[]` on success.
    const attempted = toEnrich.length + edgesToScore.length;
    const succeeded = capabilitiesEnriched + edgesEnriched;
    if (attempted > 0 && succeeded === 0) {
      throw new Error(`Alpha enrichment: 0 of ${attempted} succeeded — ${errors[0] ?? "unknown"}`);
    }
    return { capabilitiesEnriched, edgesEnriched, errors, durationMs };
  }
}

async function enrichOneCapabilityEconymicsLog(
  cap: { id: number; name: string; industryId: number },
  industryName: string,
): Promise<{ ok: boolean; error?: string }> {
  return enrichOneCapabilityEconomics(cap, industryName);
}
