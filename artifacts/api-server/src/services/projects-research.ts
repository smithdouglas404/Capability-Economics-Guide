import { db } from "@workspace/db";
import {
  technologyProjectsTable,
  projectCapabilityImpactsTable,
  projectExecutiveInsightsTable,
  projectRisksTable,
  capabilitiesTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { perplexityChat } from "./perplexity";

export interface ResearchProjectsResult {
  ok: boolean;
  category: string;
  projectsIngested: number;
  errors: string[];
}

interface RawProject {
  slug: string;
  name: string;
  category: string;
  description: string;
  business_case: string;
  typical_timeline: string;
  investment_range: string;
  complexity_level: "low" | "medium" | "high";
  icon?: string;
  capability_impacts: Array<{
    capability_slug: string;
    maturity_uplift: number;
    time_to_impact_months: number;
    impact_description: string;
  }>;
  executive_insights: Array<{
    role: string;
    agenda_title: string;
    agenda_description: string;
    key_metrics: string;
    decision_framework: string;
  }>;
  risks: Array<{
    risk_category: string;
    severity: "low" | "medium" | "high";
    description: string;
    consequence: string;
    mitigation_path: string;
  }>;
}

interface PerplexityResponse {
  choices: Array<{ message: { content: string } }>;
  citations?: string[];
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function extractJsonArray(content: string): unknown[] | null {
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(cleaned.substring(start, end + 1)) as unknown[]; }
  catch { return null; }
}

/**
 * Use Perplexity to research current real-world technology projects in a given
 * category, with citations. Replaces the prior hardcoded seed.
 */
export async function researchProjectsForCategory(category: string): Promise<ResearchProjectsResult> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { ok: false, category, projectsIngested: 0, errors: ["PERPLEXITY_API_KEY not set"] };

  const allCaps = await db
    .select({ id: capabilitiesTable.id, slug: capabilitiesTable.slug, name: capabilitiesTable.name })
    .from(capabilitiesTable);
  const capSlugList = allCaps.map(c => c.slug).slice(0, 200).join(", ");

  const sysPrompt = "You are a senior enterprise-technology analyst. Return ONLY a JSON array — no prose. Cite sources via Perplexity's citation system; do not invent statistics.";
  const userPrompt = `Identify 4-6 currently active enterprise technology project archetypes in the "${category}" category that real organizations are deploying in 2025-2026.

For each, return:
{
  "slug": "<kebab-case>",
  "name": "<short title>",
  "category": "${category}",
  "description": "<2-3 sentences, sourced>",
  "business_case": "<sourced ROI/value statement, no fabricated %s>",
  "typical_timeline": "<e.g. 6-12 months, sourced if possible>",
  "investment_range": "<e.g. $500K - $3M, sourced if possible, otherwise omit numbers>",
  "complexity_level": "low|medium|high",
  "icon": "<optional lucide icon name>",
  "capability_impacts": [
    { "capability_slug": "<from list below>", "maturity_uplift": <0-30>, "time_to_impact_months": <int>, "impact_description": "<sourced, 1 sentence>" }
  ],
  "executive_insights": [
    { "role": "CEO|CFO|CIO|CTO|COO|CHRO|CMO", "agenda_title": "<short>", "agenda_description": "<1-2 sentences, sourced>", "key_metrics": "<comma-separated KPIs>", "decision_framework": "<1 sentence>" }
  ],
  "risks": [
    { "risk_category": "<short>", "severity": "low|medium|high", "description": "<1 sentence>", "consequence": "<1 sentence>", "mitigation_path": "<1 sentence>" }
  ]
}

Capability slugs to choose from (use exact slugs only): ${capSlugList}

Rules:
- Only include capability_impacts whose slug is in the list above. Skip if no good match.
- Do NOT invent precise percentages or dollar figures unless they come from a cited source. Use ranges or qualitative language otherwise.
- maturity_uplift is your conservative analyst estimate of benchmark-score points gained (0-30); explain in impact_description.
Return a JSON array of 4-6 such objects. No prose.`;

  // Routed through perplexityChat() to use the shared content-hash cache
  // (PERPLEXITY_CACHE_TTL_HOURS, default 168h). Same-category project
  // research within a week reuses the response instead of re-billing Sonar.
  let data: PerplexityResponse;
  try {
    data = (await perplexityChat({
      model: "sonar",
      endpoint: "projects-research",
      timeoutMs: 90_000,
      // maxRetries: 0 preserves the prior ~90s hard wall-clock cap. The
      // original code used AbortSignal.timeout(90_000) on a single fetch
      // with no retry loop; without this, perplexityChat's default
      // maxRetries=3 + per-attempt timeout could push total time well past
      // 90s, breaking the upstream caller's deadline expectations.
      maxRetries: 0,
      context: { category },
      messages: [
        { role: "system", content: sysPrompt },
        { role: "user", content: userPrompt },
      ],
    })) as PerplexityResponse;
  } catch (err) {
    return { ok: false, category, projectsIngested: 0, errors: [err instanceof Error ? err.message : String(err)] };
  }

  const content = data.choices[0]?.message?.content ?? "";
  const citations = Array.isArray(data.citations) ? data.citations.filter(c => typeof c === "string") : [];
  const arr = extractJsonArray(content);
  if (!arr) return { ok: false, category, projectsIngested: 0, errors: ["Perplexity returned no parseable JSON array"] };

  const capBySlug = new Map(allCaps.map(c => [c.slug, c]));
  const errors: string[] = [];
  let ingested = 0;

  for (const raw of arr) {
    const p = raw as Partial<RawProject>;
    if (!p?.name || !p.description || !p.business_case || !p.complexity_level) {
      errors.push(`Skipped malformed project: ${JSON.stringify(p).slice(0, 120)}`);
      continue;
    }
    const slug = (p.slug && slugify(p.slug)) || slugify(p.name);
    if (!slug) { errors.push(`Empty slug for "${p.name}"`); continue; }

    const existing = await db
      .select({ id: technologyProjectsTable.id })
      .from(technologyProjectsTable)
      .where(eq(technologyProjectsTable.slug, slug))
      .limit(1);

    let projectId: number;
    const projectFields = {
      slug,
      name: p.name,
      category: p.category ?? category,
      description: p.description,
      businessCase: p.business_case,
      typicalTimeline: p.typical_timeline ?? "TBD",
      investmentRange: p.investment_range ?? "TBD",
      complexityLevel: p.complexity_level,
      icon: p.icon ?? "Cpu",
      source: "perplexity",
      citations: citations.length > 0 ? citations : null,
      researchedAt: new Date(),
    };

    if (existing.length > 0) {
      projectId = existing[0]!.id;
      await db.update(technologyProjectsTable).set(projectFields).where(eq(technologyProjectsTable.id, projectId));
      await db.delete(projectCapabilityImpactsTable).where(eq(projectCapabilityImpactsTable.projectId, projectId));
      await db.delete(projectExecutiveInsightsTable).where(eq(projectExecutiveInsightsTable.projectId, projectId));
      await db.delete(projectRisksTable).where(eq(projectRisksTable.projectId, projectId));
    } else {
      const [inserted] = await db.insert(technologyProjectsTable).values(projectFields).returning({ id: technologyProjectsTable.id });
      projectId = inserted!.id;
    }

    const impacts = (p.capability_impacts ?? [])
      .map(ci => {
        const cap = capBySlug.get(ci.capability_slug);
        if (!cap) return null;
        return {
          projectId,
          capabilityId: cap.id,
          maturityUplift: Number.isFinite(ci.maturity_uplift) ? Math.max(0, Math.min(30, Number(ci.maturity_uplift))) : 5,
          timeToImpactMonths: Number.isInteger(ci.time_to_impact_months) ? ci.time_to_impact_months : 12,
          impactDescription: ci.impact_description ?? "",
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (impacts.length > 0) await db.insert(projectCapabilityImpactsTable).values(impacts);

    const insights = (p.executive_insights ?? []).map(ei => ({
      projectId,
      role: ei.role,
      agendaTitle: ei.agenda_title,
      agendaDescription: ei.agenda_description,
      keyMetrics: ei.key_metrics,
      decisionFramework: ei.decision_framework,
    })).filter(i => i.role && i.agendaTitle);
    if (insights.length > 0) await db.insert(projectExecutiveInsightsTable).values(insights);

    const risks = (p.risks ?? []).map(r => ({
      projectId,
      riskCategory: r.risk_category,
      severity: r.severity,
      description: r.description,
      consequence: r.consequence,
      mitigationPath: r.mitigation_path,
    })).filter(r => r.riskCategory && r.description);
    if (risks.length > 0) await db.insert(projectRisksTable).values(risks);

    ingested++;
  }

  return { ok: true, category, projectsIngested: ingested, errors };
}

export async function researchProjectsForCategories(categories: string[]): Promise<ResearchProjectsResult[]> {
  const results: ResearchProjectsResult[] = [];
  for (const c of categories) {
    results.push(await researchProjectsForCategory(c));
    await new Promise(r => setTimeout(r, 500));
  }
  return results;
}

export async function listExistingCategories(): Promise<string[]> {
  const rows = await db.execute<{ category: string }>(sql`SELECT DISTINCT category FROM technology_projects ORDER BY category`);
  // drizzle's db.execute returns { rows: [...] } in pg
  const list = (rows as unknown as { rows?: Array<{ category: string }> }).rows ?? (rows as unknown as Array<{ category: string }>);
  return Array.isArray(list) ? list.map(r => r.category).filter(Boolean) : [];
}
