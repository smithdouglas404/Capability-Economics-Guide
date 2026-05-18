import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  caseStudiesTable,
  caseStudyContentTable,
  industriesTable,
  capabilitiesTable,
  dataSourcesTable,
  featuredCaseStudyPolicyTable,
  featuredCaseStudyScheduleTable,
} from "@workspace/db";
import { and, asc, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../middlewares/requireAdmin";
import { generateCaseStudyContentTool } from "../services/agent/tools";
import { logger } from "../lib/logger";
import { runCaseStudyGenerator } from "../services/workflows";
import { sonnet, generateObject } from "../services/workflows/models";

const router: IRouter = Router();

const GenerateBody = z.object({
  industrySlug: z.string().min(2).max(80),
});

/**
 * Pick the industry to feature on the homepage. Priority:
 *   1. The case study with is_featured=true (admin-pinned)
 *   2. Otherwise the most recently generated one
 * Returns a compact payload — the homepage only needs industry slug/name + title + blurb.
 */
router.get("/featured-case-study", async (_req, res) => {
  const rows = await db
    .select({
      id: caseStudiesTable.id,
      industryId: caseStudiesTable.industryId,
      industrySlug: industriesTable.slug,
      industryName: industriesTable.name,
      title: caseStudiesTable.title,
      executiveSummary: caseStudiesTable.executiveSummary,
      generatedAt: caseStudiesTable.generatedAt,
      isFeatured: caseStudiesTable.isFeatured,
    })
    .from(caseStudiesTable)
    .innerJoin(industriesTable, eq(industriesTable.id, caseStudiesTable.industryId))
    .orderBy(desc(caseStudiesTable.isFeatured), desc(caseStudiesTable.generatedAt))
    .limit(1);
  if (rows.length === 0) { res.json({ featured: null }); return; }
  res.json({ featured: rows[0] });
});

/** Admin pins (or unpins) a case study as the homepage-featured example. */
router.patch("/admin/case-studies/:id/feature", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const pin = req.body?.featured !== false;

  if (pin) {
    // Only one can be featured at a time — unfeature everything else first.
    await db.transaction(async (tx) => {
      await tx.update(caseStudiesTable).set({ isFeatured: false });
      await tx.update(caseStudiesTable).set({ isFeatured: true }).where(eq(caseStudiesTable.id, id));
    });
  } else {
    await db.update(caseStudiesTable).set({ isFeatured: false }).where(eq(caseStudiesTable.id, id));
  }

  res.json({ ok: true, featured: pin });
});

/**
 * Reports whether the dependencies required for case study generation are
 * configured, plus a count of existing studies. Use this before showing the
 * Generate button so the admin knows if the attempt will fail.
 */
router.get("/case-studies/diagnostics", async (_req, res) => {
  const rows = await db.select({ id: caseStudiesTable.id }).from(caseStudiesTable);
  res.json({
    totalStudies: rows.length,
    perplexityConfigured: !!process.env.PERPLEXITY_API_KEY,
    openrouterConfigured: !!process.env.OPENROUTER_API_KEY,
    canGenerate: !!process.env.PERPLEXITY_API_KEY && !!process.env.OPENROUTER_API_KEY,
  });
});

/**
 * POST /api/admin/case-studies/:id/regenerate-economics-breakdown
 *
 * Admin-triggered Perplexity research that re-populates the
 * economics_breakdown column for a single case study. Idempotent: any
 * existing breakdown is overwritten with the fresh research result.
 *
 * Body shape (optional): { companyName: string, transformationHint?: string }
 * If omitted, the route picks the company from the most-recent case-study
 * row's title — but explicit companyName is recommended.
 */
router.post("/admin/case-studies/:id/regenerate-economics-breakdown", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const [study] = await db
    .select()
    .from(caseStudiesTable)
    .innerJoin(industriesTable, eq(industriesTable.id, caseStudiesTable.industryId))
    .where(eq(caseStudiesTable.id, id));
  if (!study) { res.status(404).json({ error: "Case study not found" }); return; }

  const body = (req.body ?? {}) as { companyName?: string; transformationHint?: string };
  const companyName = (body.companyName ?? "").trim();
  if (!companyName) {
    res.status(400).json({ error: "companyName is required in body" });
    return;
  }

  try {
    // Delegate to the case-study-generator workflow. Falls
    // through to the inline researchEconomicsBreakdown if the workflow
    // is off / fails. The workflow's callback also writes to
    // research_artifacts so admins can review history.
    const cs = study.case_studies;
    const currentText = [
      cs.title,
      cs.executiveSummary,
      cs.situation,
      Array.isArray(cs.challenges) ? cs.challenges.join("\n") : "",
      body.transformationHint ?? "",
    ].filter(Boolean).join("\n\n").slice(0, 12000);
    const workflowResult = await runCaseStudyGenerator({
      caseStudyId: id,
      industryName: study.industries.name,
      currentText,
    }).catch(() => null);
    if (workflowResult?.payload && Object.keys(workflowResult.payload).length > 0) {
      // The workflow emits a generic shape; coerce to the
      // economicsBreakdown JSONB shape Drizzle expects.
      await db.update(caseStudiesTable)
        .set({ economicsBreakdown: workflowResult.payload as unknown as typeof caseStudiesTable.$inferInsert["economicsBreakdown"] })
        .where(eq(caseStudiesTable.id, id));
      res.json({ ok: true, breakdown: workflowResult.payload, source: "workflow" });
      return;
    }
    const { researchEconomicsBreakdown } = await import("../services/case-study-economics-research");
    const breakdown = await researchEconomicsBreakdown({
      companyName,
      industryName: study.industries.name,
      transformationHint: body.transformationHint,
    });
    if (!breakdown) {
      res.status(502).json({ error: "Perplexity research did not produce a valid breakdown — check server logs" });
      return;
    }
    await db.update(caseStudiesTable).set({ economicsBreakdown: breakdown }).where(eq(caseStudiesTable.id, id));
    res.json({ ok: true, breakdown });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), id }, "[admin/regenerate-economics-breakdown] failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});

/**
 * GET /api/admin/case-studies
 *
 * Lists every case study with a compact admin payload (id, industry, title,
 * isFeatured, whether economicsBreakdown is populated). Used by the admin
 * UI to render the rotation table. Requires admin auth.
 */
router.get("/admin/case-studies", requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      id: caseStudiesTable.id,
      industryId: caseStudiesTable.industryId,
      industrySlug: industriesTable.slug,
      industryName: industriesTable.name,
      title: caseStudiesTable.title,
      isFeatured: caseStudiesTable.isFeatured,
      economicsBreakdown: caseStudiesTable.economicsBreakdown,
      generatedAt: caseStudiesTable.generatedAt,
    })
    .from(caseStudiesTable)
    .innerJoin(industriesTable, eq(industriesTable.id, caseStudiesTable.industryId))
    .orderBy(desc(caseStudiesTable.isFeatured), desc(caseStudiesTable.generatedAt));
  res.json({
    caseStudies: rows.map(r => ({
      id: r.id,
      industryId: r.industryId,
      industrySlug: r.industrySlug,
      industryName: r.industryName,
      title: r.title,
      isFeatured: r.isFeatured,
      hasEconomicsBreakdown: !!r.economicsBreakdown,
      economicsCompanyName: r.economicsBreakdown?.companyName ?? null,
      economicsEventTitle: r.economicsBreakdown?.eventTitle ?? null,
      generatedAt: r.generatedAt,
    })),
  });
});

/**
 * GET /api/case-study/:industrySlug/economics-breakdown
 *
 * Backs the homepage analogy card (was the hardcoded "WireDrop closed $1.2B
 * Series B" prose in pages/home.tsx:458-497). Returns the structured
 * finance decomposition only if it's been populated — when null, the
 * frontend should fall back to the existing executive_summary or hide the
 * card entirely (rather than show invented numbers).
 *
 * Populating the column requires real public-company financials (10-K
 * filings, press releases). Use the admin tool or a one-off SQL update
 * once you have sourced numbers. See docs/Must Fix/PLAN.md item #4.
 */
router.get("/case-study/:industrySlug/economics-breakdown", async (req, res) => {
  const [industry] = await db
    .select()
    .from(industriesTable)
    .where(eq(industriesTable.slug, req.params.industrySlug));
  if (!industry) { res.status(404).json({ error: "Industry not found" }); return; }
  const [study] = await db
    .select({
      id: caseStudiesTable.id,
      title: caseStudiesTable.title,
      executiveSummary: caseStudiesTable.executiveSummary,
      economicsBreakdown: caseStudiesTable.economicsBreakdown,
      generatedAt: caseStudiesTable.generatedAt,
    })
    .from(caseStudiesTable)
    .where(eq(caseStudiesTable.industryId, industry.id))
    .orderBy(desc(caseStudiesTable.isFeatured), desc(caseStudiesTable.generatedAt))
    .limit(1);
  if (!study) { res.status(404).json({ error: "No case study for this industry" }); return; }
  res.json({
    industrySlug: industry.slug,
    industryName: industry.name,
    title: study.title,
    executiveSummary: study.executiveSummary,
    economicsBreakdown: study.economicsBreakdown, // null until populated with real data
    generatedAt: study.generatedAt,
  });
});

router.get("/case-studies", async (_req, res) => {
  const rows = await db
    .select({
      id: caseStudiesTable.id,
      industryId: caseStudiesTable.industryId,
      industrySlug: industriesTable.slug,
      industryName: industriesTable.name,
      title: caseStudiesTable.title,
      executiveSummary: caseStudiesTable.executiveSummary,
      generatedAt: caseStudiesTable.generatedAt,
      model: caseStudiesTable.model,
      isFeatured: caseStudiesTable.isFeatured,
    })
    .from(caseStudiesTable)
    .innerJoin(industriesTable, eq(industriesTable.id, caseStudiesTable.industryId))
    .orderBy(desc(caseStudiesTable.isFeatured), desc(caseStudiesTable.generatedAt));
  res.json(rows);
});

router.get("/case-studies/:industrySlug", async (req, res) => {
  const [industry] = await db
    .select()
    .from(industriesTable)
    .where(eq(industriesTable.slug, req.params.industrySlug));
  if (!industry) {
    res.status(404).json({ error: "Industry not found" });
    return;
  }
  const [study] = await db
    .select()
    .from(caseStudiesTable)
    .where(eq(caseStudiesTable.industryId, industry.id))
    .orderBy(desc(caseStudiesTable.generatedAt))
    .limit(1);
  const capabilities = await db
    .select()
    .from(caseStudyContentTable)
    .where(eq(caseStudyContentTable.industryId, industry.id))
    .orderBy(desc(caseStudyContentTable.generatedAt));
  res.json({ industry, study: study ?? null, capabilities });
});

router.delete("/admin/case-studies/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(caseStudiesTable).where(eq(caseStudiesTable.id, id));
  res.status(204).end();
});

router.post("/case-studies/generate", requireAdmin, async (req, res) => {
  const parsed = GenerateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { industrySlug } = parsed.data;

  const [industry] = await db
    .select()
    .from(industriesTable)
    .where(eq(industriesTable.slug, industrySlug));
  if (!industry) {
    res.status(404).json({ error: "Industry not found" });
    return;
  }

  const capabilities = await db
    .select()
    .from(capabilitiesTable)
    .where(eq(capabilitiesTable.industryId, industry.id));

  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!perplexityKey || !openrouterKey) {
    res.status(503).json({ error: "AI services not configured" });
    return;
  }

  const researchQuery = `Provide a current, sourced industry briefing for the ${industry.name} industry. Cover: top 3-5 strategic challenges in 2025-2026, the most impactful capability shifts, recent investment trends from major analyst firms (Gartner/McKinsey/Forrester/Deloitte), and 2-3 measurable KPI benchmarks operators are tracking. Include specific numbers and cite sources.`;

  let researchContent = "";
  let citations: string[] = [];
  try {
    const pResp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${perplexityKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          { role: "system", content: "You are an industry research analyst. Provide specific, sourced facts with numbers." },
          { role: "user", content: researchQuery },
        ],
      }),
    });
    if (!pResp.ok) throw new Error(`Perplexity ${pResp.status}`);
    const pData = (await pResp.json()) as {
      choices: Array<{ message: { content: string } }>;
      citations?: string[];
    };
    researchContent = pData.choices[0]?.message?.content ?? "";
    citations = pData.citations ?? [];
  } catch (err) {
    res.status(502).json({ error: "Perplexity research failed", details: String(err) });
    return;
  }

  const capList = capabilities.map(c => `- ${c.name} (benchmark ${c.benchmarkScore}): ${c.description}`).join("\n");

  const prompt = `You are a Inflexcvi advisor authoring a strategic case study for the ${industry.name} industry.

CURRENT MAPPED CAPABILITIES:
${capList || "(no capabilities mapped yet — synthesize from research)"}

CURRENT MARKET RESEARCH (cite when relevant):
${researchContent}

Produce a structured case study as a single JSON object with EXACTLY these fields and constraints:
{
  "title": "<8-14 word title naming the strategic moment>",
  "executiveSummary": "<3-5 sentences synthesizing the situation and stakes>",
  "situation": "<2-3 paragraphs describing where the industry stands now, with specific numbers from the research>",
  "challenges": ["<5-7 challenge statements, each 1 sentence>"],
  "recommendations": [
    { "title": "<short title>", "rationale": "<2-3 sentences>", "impact": "<expected economic impact>" }
  ],
  "fiveYearOutlook": "<2-3 paragraph forward view with concrete capability investments and outcomes>",
  "kpis": [
    { "name": "<KPI name>", "baseline": "<current industry baseline with units>", "target": "<5yr target with units>" }
  ]
}

Constraints:
- recommendations: minimum 4, maximum 6 entries
- kpis: minimum 4, maximum 6 entries
- Use specific numbers from the research where possible
- Output ONLY the JSON object. No markdown, no commentary.`;

  const CaseStudySchema = z.object({
    title: z.string(),
    executiveSummary: z.string(),
    situation: z.string(),
    challenges: z.array(z.string()),
    recommendations: z.array(z.object({ title: z.string(), rationale: z.string(), impact: z.string() })).min(4).max(6),
    fiveYearOutlook: z.string(),
    kpis: z.array(z.object({ name: z.string(), baseline: z.string(), target: z.string() })).min(4).max(6),
  });
  let studyJson: z.infer<typeof CaseStudySchema>;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    try {
      const { object } = await generateObject({
        model: sonnet,
        schema: CaseStudySchema,
        prompt,
        maxTokens: 8192,
        abortSignal: controller.signal,
      });
      studyJson = object;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    res.status(502).json({ error: "Synthesis failed", details: String(err) });
    return;
  }

  const sources: { url: string; title: string }[] = [];
  for (const c of citations) {
    try {
      const u = new URL(c);
      sources.push({ url: c, title: u.hostname });
      await db
        .insert(dataSourcesTable)
        .values({
          title: `Case study research: ${industry.name}`,
          url: c,
          publisher: u.hostname,
          accessedDate: new Date(),
          sourceType: "article",
        })
        .onConflictDoNothing({ target: dataSourcesTable.url });
    } catch {
      /* skip invalid url */
    }
  }

  const [inserted] = await db
    .insert(caseStudiesTable)
    .values({
      industryId: industry.id,
      title: studyJson.title,
      executiveSummary: studyJson.executiveSummary,
      situation: studyJson.situation,
      challenges: studyJson.challenges,
      recommendations: studyJson.recommendations,
      fiveYearOutlook: studyJson.fiveYearOutlook,
      kpis: studyJson.kpis,
      sources,
      model: "anthropic/claude-sonnet-4.6+sonar-pro",
    })
    .returning();

  // Also populate case_study_content (per-capability traditional/economic view
  // cards that back the case-study page grid). This is a separate LLM call —
  // if it fails we still return the study metadata so the admin sees partial
  // success rather than losing the whole run.
  let content: { generated: number; error?: string } = { generated: 0 };
  try {
    const raw = await generateCaseStudyContentTool.invoke({ industrySlug });
    const parsed = JSON.parse(raw) as { success: boolean; capabilitiesGenerated?: number; error?: string };
    if (parsed.success) content = { generated: parsed.capabilitiesGenerated ?? 0 };
    else content = { generated: 0, error: parsed.error ?? "unknown" };
  } catch (err) {
    logger.warn({ err, industrySlug }, "[case-studies] content generation failed");
    content = { generated: 0, error: err instanceof Error ? err.message : String(err) };
  }

  res.status(201).json({ caseStudy: inserted, sourcesCount: sources.length, content });
});

// ── Featured case study scheduling + auto-rotation admin API ────────────
//
// Backs the UI at /admin/case-studies. The cron in
// services/featured-case-study-rotation.ts reads from these tables every
// 10 minutes and applies any work that's due. Both tables have a single
// concrete writer: this router (admin-gated).

router.get("/admin/case-studies/policy", requireAdmin, async (_req, res) => {
  const [row] = await db.select().from(featuredCaseStudyPolicyTable).orderBy(asc(featuredCaseStudyPolicyTable.id)).limit(1);
  res.json({ policy: row ?? null });
});

const PolicyBody = z.object({
  mode: z.enum(["manual", "rotation"]),
  rotationDays: z.number().int().min(1).max(365).nullable().optional(),
  rotationSource: z.enum(["existing_rotate", "anthropic_new"]).nullable().optional(),
  industryFilter: z.string().max(80).nullable().optional(),
});

router.put("/admin/case-studies/policy", requireAdmin, async (req, res) => {
  const parsed = PolicyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const { mode, rotationDays, rotationSource, industryFilter } = parsed.data;
  const now = new Date();
  const nextAt = mode === "rotation" && rotationDays
    ? new Date(now.getTime() + rotationDays * 24 * 60 * 60 * 1000)
    : null;
  const updatedBy = (req.headers["x-user-email"] as string | undefined) ?? "admin";

  const [existing] = await db.select().from(featuredCaseStudyPolicyTable).orderBy(asc(featuredCaseStudyPolicyTable.id)).limit(1);
  if (existing) {
    const [updated] = await db.update(featuredCaseStudyPolicyTable)
      .set({ mode, rotationDays: rotationDays ?? null, rotationSource: rotationSource ?? null, industryFilter: industryFilter ?? null, nextRotationAt: nextAt, updatedBy, updatedAt: now })
      .where(eq(featuredCaseStudyPolicyTable.id, existing.id))
      .returning();
    res.json({ policy: updated });
    return;
  }
  const [created] = await db.insert(featuredCaseStudyPolicyTable).values({
    mode, rotationDays: rotationDays ?? null, rotationSource: rotationSource ?? null, industryFilter: industryFilter ?? null, nextRotationAt: nextAt, updatedBy,
  }).returning();
  res.status(201).json({ policy: created });
});

router.get("/admin/case-studies/schedule", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(featuredCaseStudyScheduleTable).orderBy(asc(featuredCaseStudyScheduleTable.scheduledFor)).limit(100);
  res.json({ schedule: rows });
});

const ScheduleBody = z.object({
  scheduledFor: z.string().min(1),
  caseStudyId: z.number().int().positive().optional(),
  generateForIndustryId: z.number().int().positive().optional(),
  generateCompanyName: z.string().min(1).max(200).optional(),
}).refine(b => Boolean(b.caseStudyId) !== Boolean(b.generateForIndustryId), {
  message: "Exactly one of caseStudyId or generateForIndustryId must be set",
});

router.post("/admin/case-studies/schedule", requireAdmin, async (req, res) => {
  const parsed = ScheduleBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const when = new Date(parsed.data.scheduledFor);
  if (isNaN(when.getTime())) { res.status(400).json({ error: "Invalid scheduledFor — must be a parseable timestamp" }); return; }

  const createdBy = (req.headers["x-user-email"] as string | undefined) ?? "admin";
  const [row] = await db.insert(featuredCaseStudyScheduleTable).values({
    scheduledFor: when,
    caseStudyId: parsed.data.caseStudyId ?? null,
    generateForIndustryId: parsed.data.generateForIndustryId ?? null,
    generateCompanyName: parsed.data.generateCompanyName ?? null,
    createdBy,
  }).returning();
  res.status(201).json({ schedule: row });
});

router.delete("/admin/case-studies/schedule/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "bad id" }); return; }
  const [updated] = await db.update(featuredCaseStudyScheduleTable)
    .set({ status: "cancelled", executedAt: new Date() })
    .where(and(eq(featuredCaseStudyScheduleTable.id, id), eq(featuredCaseStudyScheduleTable.status, "pending")))
    .returning();
  if (!updated) { res.status(409).json({ error: "Schedule not found or already executed" }); return; }
  res.json({ ok: true, cancelled: updated });
});

export default router;
