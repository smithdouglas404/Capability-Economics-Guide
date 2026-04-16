import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  caseStudiesTable,
  caseStudyContentTable,
  industriesTable,
  capabilitiesTable,
  dataSourcesTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

function requireAdmin(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const token = req.headers["x-admin-token"];
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return true;
  return typeof token === "string" && token === expected;
}

const GenerateBody = z.object({
  industrySlug: z.string().min(2).max(80),
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
    })
    .from(caseStudiesTable)
    .innerJoin(industriesTable, eq(industriesTable.id, caseStudiesTable.industryId))
    .orderBy(desc(caseStudiesTable.generatedAt));
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

router.delete("/admin/case-studies/:id", async (req, res) => {
  if (!requireAdmin(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(caseStudiesTable).where(eq(caseStudiesTable.id, id));
  res.status(204).end();
});

router.post("/case-studies/generate", async (req, res) => {
  if (!requireAdmin(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
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

  const prompt = `You are a Capability Economics advisor authoring a strategic case study for the ${industry.name} industry.

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

  let studyJson: {
    title: string;
    executiveSummary: string;
    situation: string;
    challenges: string[];
    recommendations: { title: string; rationale: string; impact: string }[];
    fiveYearOutlook: string;
    kpis: { name: string; baseline: string; target: string }[];
  };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    let gResp: Response;
    try {
      gResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://capabilityeconomics.com",
          "X-Title": "Capability Economics",
        },
        body: JSON.stringify({
          model: "z-ai/glm-5.1",
          max_tokens: 8192,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const gData = (await gResp.json()) as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
    if (gData.error) throw new Error(gData.error.message);
    const text = gData.choices?.[0]?.message?.content ?? "";
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON object in GLM response");
    studyJson = JSON.parse(cleaned.substring(start, end + 1));
  } catch (err) {
    res.status(502).json({ error: "GLM synthesis failed", details: String(err) });
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
      model: "z-ai/glm-5.1+sonar-pro",
    })
    .returning();

  res.status(201).json({ caseStudy: inserted, sourcesCount: sources.length });
});

export default router;
