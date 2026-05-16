import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  capabilityThresholdsTable,
  capabilityInsightsTable,
  industryWhitePapersTable,
  industryLeaderboardTable,
  ontologyRelationshipsTable,
  ontologyIndustryAdaptersTable,
  capabilitiesTable,
  cviComponentsTable,
  industriesTable,
  dataSourcesTable,
} from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import {
  ListThresholdsQueryParams,
  ListInsightsQueryParams,
  ListLeaderboardQueryParams,
  ListWhitePapersQueryParams,
  GetOntologyQueryParams,
  GenerateInsightsBody,
  ResearchCapabilityBody,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.get("/insights", async (req, res) => {
  const parsed = ListInsightsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { industryId } = parsed.data;

  const insights = await db
    .select()
    .from(capabilityInsightsTable)
    .orderBy(desc(capabilityInsightsTable.generatedAt));

  const filtered = industryId !== undefined
    ? insights.filter(i => i.industryId === industryId)
    : insights;

  res.json(filtered);
});

router.get("/thresholds", async (req, res) => {
  const parsed = ListThresholdsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { industryId } = parsed.data;

  let query = db
    .select({
      id: capabilityThresholdsTable.id,
      capabilityId: capabilityThresholdsTable.capabilityId,
      capabilityName: capabilitiesTable.name,
      capabilitySlug: capabilitiesTable.slug,
      industryId: capabilitiesTable.industryId,
      benchmarkScore: capabilitiesTable.benchmarkScore,
      consensusScore: cviComponentsTable.consensusScore,
      greenMin: capabilityThresholdsTable.greenMin,
      yellowMin: capabilityThresholdsTable.yellowMin,
      redMax: capabilityThresholdsTable.redMax,
      description: capabilityThresholdsTable.description,
      sourceIds: capabilityThresholdsTable.sourceIds,
    })
    .from(capabilityThresholdsTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, capabilityThresholdsTable.capabilityId))
    .leftJoin(cviComponentsTable, eq(cviComponentsTable.capabilityId, capabilityThresholdsTable.capabilityId));

  const thresholds = industryId !== undefined
    ? await query.where(eq(capabilitiesTable.industryId, industryId))
    : await query;

  const enriched = thresholds.map(t => {
    const score = t.consensusScore ?? t.benchmarkScore;
    return {
      ...t,
      benchmarkScore: score,
      status: score >= t.greenMin ? "green" as const : score >= t.yellowMin ? "yellow" as const : "red" as const,
    };
  });

  res.json(enriched);
});

router.get("/leaderboard", async (req, res) => {
  const parsed = ListLeaderboardQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { industryId } = parsed.data;

  const entries = await db
    .select({
      id: industryLeaderboardTable.id,
      industryId: industryLeaderboardTable.industryId,
      industryName: industriesTable.name,
      companyName: industryLeaderboardTable.companyName,
      overallMaturity: industryLeaderboardTable.overallMaturity,
      topCapability: industryLeaderboardTable.topCapability,
      topCapabilityScore: industryLeaderboardTable.topCapabilityScore,
      weakestCapability: industryLeaderboardTable.weakestCapability,
      weakestCapabilityScore: industryLeaderboardTable.weakestCapabilityScore,
      investmentLevel: industryLeaderboardTable.investmentLevel,
      trend: industryLeaderboardTable.trend,
      rank: industryLeaderboardTable.rank,
      sourceIds: industryLeaderboardTable.sourceIds,
    })
    .from(industryLeaderboardTable)
    .innerJoin(industriesTable, eq(industriesTable.id, industryLeaderboardTable.industryId))
    .orderBy(industryLeaderboardTable.rank);

  const filtered = industryId !== undefined
    ? entries.filter(e => e.industryId === industryId)
    : entries;

  res.json(filtered);
});

router.get("/white-papers", async (req, res) => {
  const parsed = ListWhitePapersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { industryId } = parsed.data;

  const papers = await db
    .select({
      id: industryWhitePapersTable.id,
      industryId: industryWhitePapersTable.industryId,
      industryName: industriesTable.name,
      title: industryWhitePapersTable.title,
      author: industryWhitePapersTable.author,
      organization: industryWhitePapersTable.organization,
      abstract: industryWhitePapersTable.abstract,
      category: industryWhitePapersTable.category,
      url: industryWhitePapersTable.url,
      publishedYear: industryWhitePapersTable.publishedYear,
      relevanceScore: industryWhitePapersTable.relevanceScore,
      tags: industryWhitePapersTable.tags,
      sourceIds: industryWhitePapersTable.sourceIds,
    })
    .from(industryWhitePapersTable)
    .innerJoin(industriesTable, eq(industriesTable.id, industryWhitePapersTable.industryId))
    .orderBy(desc(industryWhitePapersTable.relevanceScore));

  const filtered = industryId !== undefined
    ? papers.filter(p => p.industryId === industryId)
    : papers;

  res.json(filtered);
});

router.get("/ontology", async (req, res) => {
  const parsed = GetOntologyQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { industryId } = parsed.data;

  const relationships = await db
    .select({
      id: ontologyRelationshipsTable.id,
      sourceCapabilityId: ontologyRelationshipsTable.sourceCapabilityId,
      targetCapabilityId: ontologyRelationshipsTable.targetCapabilityId,
      relationshipType: ontologyRelationshipsTable.relationshipType,
      strength: ontologyRelationshipsTable.strength,
      description: ontologyRelationshipsTable.description,
    })
    .from(ontologyRelationshipsTable);

  const allCaps = await db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name, slug: capabilitiesTable.slug, industryId: capabilitiesTable.industryId, benchmarkScore: capabilitiesTable.benchmarkScore }).from(capabilitiesTable);
  const capLookup: Record<number, typeof allCaps[0]> = {};
  for (const c of allCaps) capLookup[c.id] = c;

  const enriched = relationships.map(r => ({
    ...r,
    sourceName: capLookup[r.sourceCapabilityId]?.name || "",
    sourceSlug: capLookup[r.sourceCapabilityId]?.slug || "",
    sourceIndustryId: capLookup[r.sourceCapabilityId]?.industryId,
    targetName: capLookup[r.targetCapabilityId]?.name || "",
    targetSlug: capLookup[r.targetCapabilityId]?.slug || "",
    targetIndustryId: capLookup[r.targetCapabilityId]?.industryId,
  }));

  const filtered = industryId !== undefined
    ? enriched.filter(r => r.sourceIndustryId === industryId || r.targetIndustryId === industryId)
    : enriched;

  const adapters = industryId !== undefined
    ? await db.select().from(ontologyIndustryAdaptersTable).where(eq(ontologyIndustryAdaptersTable.industryId, industryId))
    : await db.select().from(ontologyIndustryAdaptersTable);

  res.json({ relationships: filtered, adapters });
});

router.post("/insights/generate", requireAdmin, async (req, res) => {
  const parsed = GenerateInsightsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { industryId, capabilityId, context } = parsed.data;

  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId));
  if (!industry) {
    res.status(404).json({ error: "Industry not found" });
    return;
  }

  const capabilities = await db
    .select()
    .from(capabilitiesTable)
    .where(eq(capabilitiesTable.industryId, industryId));

  const thresholds = await db
    .select({
      capabilityId: capabilityThresholdsTable.capabilityId,
      greenMin: capabilityThresholdsTable.greenMin,
      yellowMin: capabilityThresholdsTable.yellowMin,
    })
    .from(capabilityThresholdsTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, capabilityThresholdsTable.capabilityId))
    .where(eq(capabilitiesTable.industryId, industryId));

  const thresholdMap: Record<number, { greenMin: number; yellowMin: number }> = {};
  for (const t of thresholds) thresholdMap[t.capabilityId] = { greenMin: t.greenMin, yellowMin: t.yellowMin };

  const capSummary = capabilities.map(c => {
    const t = thresholdMap[c.id];
    const status = t ? (c.benchmarkScore >= t.greenMin ? "GREEN" : c.benchmarkScore >= t.yellowMin ? "YELLOW" : "RED") : "UNKNOWN";
    return `- ${c.name} (Score: ${c.benchmarkScore}, Status: ${status}): ${c.economicView}`;
  }).join("\n");

  const prompt = `You are a capability economics advisor analyzing the ${industry.name} industry.

Here are the current capabilities and their maturity scores:
${capSummary}

${context ? `Additional context: ${context}` : ""}
${capabilityId ? `Focus specifically on capability ID ${capabilityId}.` : ""}

Provide a strategic analysis with exactly 3 actionable insights. For each insight, provide:
1. A concise title (max 10 words)
2. A detailed analysis (2-3 sentences) explaining the economic impact
3. A specific recommendation (1-2 sentences)
4. A severity level: "critical" (requires immediate action), "warning" (address within 6 months), or "info" (strategic opportunity)

Format your response as JSON array:
[{"title": "...", "content": "...", "recommendation": "...", "severity": "..."}]

Only output the JSON array, no other text.`;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "AI service not configured" });
    return;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);
    let resp: Response;
    try {
      resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://capabilityeconomics.com",
          "X-Title": "Capability Economics",
        },
        body: JSON.stringify({
          model: "anthropic/claude-haiku-4.5",
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const data = (await resp.json()) as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
    if (data.error) throw new Error(`GLM error: ${data.error.message}`);
    const text = data.choices?.[0]?.message?.content ?? "";

    let insights;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      insights = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      insights = [{ title: "Analysis Complete", content: text, recommendation: "Review the detailed analysis above.", severity: "info" }];
    }

    for (const insight of insights) {
      await db.insert(capabilityInsightsTable).values({
        capabilityId: capabilityId || null,
        industryId,
        insightType: "ai_generated",
        title: insight.title,
        content: insight.content,
        severity: insight.severity || "info",
        recommendation: insight.recommendation,
        metadata: { source: "openrouter", model: "anthropic/claude-haiku-4.5", generatedAt: new Date().toISOString() },
      });
    }

    res.json({ insights, cached: false });
  } catch (err: unknown) {
    console.error("AI insight generation failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: "Failed to generate insights", details: message });
  }
});

const researchRateLimit = new Map<string, { count: number; resetAt: number }>();
const RESEARCH_RATE_LIMIT = 10;
const RESEARCH_RATE_WINDOW_MS = 60 * 60 * 1000;

router.post("/research", requireAdmin, async (req, res) => {
  const clientIp = req.ip || "unknown";
  const now = Date.now();
  const entry = researchRateLimit.get(clientIp);
  if (entry && entry.resetAt > now) {
    if (entry.count >= RESEARCH_RATE_LIMIT) {
      res.status(429).json({ error: "Rate limit exceeded. Try again later." });
      return;
    }
    entry.count++;
  } else {
    researchRateLimit.set(clientIp, { count: 1, resetAt: now + RESEARCH_RATE_WINDOW_MS });
  }
  const parsed = ResearchCapabilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { query, industryId, capabilityId } = parsed.data;

  let contextParts: string[] = [];
  if (industryId) {
    const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId));
    if (industry) contextParts.push(`Industry: ${industry.name}`);
  }
  if (capabilityId) {
    const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, capabilityId));
    if (cap) contextParts.push(`Capability: ${cap.name} (benchmark: ${cap.benchmarkScore})`);
  }

  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Research service not configured" });
    return;
  }

  try {
    const contextLine = contextParts.length > 0 ? `\nContext: ${contextParts.join(", ")}` : "";
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          {
            role: "system",
            content: `You are a capability economics research analyst. Answer the user's question with real data from industry reports. Return ONLY valid JSON with no markdown, no code fences:
{
  "findings": [
    { "title": "<finding title>", "summary": "<2-3 sentence summary with specific data points>", "relevance": "high"|"medium"|"low", "sourceUrl": "<url or null>" }
  ]
}
Base answers on real reports from Gartner, McKinsey, Forrester, Deloitte, Accenture, BCG, or other major analysts. Include specific numbers, percentages, and benchmarks where available.`,
          },
          {
            role: "user",
            content: `${query}${contextLine}`,
          },
        ],
      }),
    });

    if (!resp.ok) {
      throw new Error(`Perplexity API error: ${resp.status}`);
    }

    const data = (await resp.json()) as { choices: Array<{ message: { content: string } }>; citations: string[] };
    const rawAnalysis = data.choices[0]?.message?.content ?? "";
    const citations = data.citations ?? [];

    let findings: Array<{ title: string; summary: string; relevance: string; sourceUrl: string | null }> = [];
    try {
      const cleaned = rawAnalysis.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const jsonStart = cleaned.indexOf("{");
      const jsonEnd = cleaned.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const parsed = JSON.parse(cleaned.substring(jsonStart, jsonEnd + 1));
        findings = parsed.findings || [];
      }
    } catch {
      findings = [{ title: "Research Results", summary: rawAnalysis.substring(0, 500), relevance: "high", sourceUrl: null }];
    }

    for (const citation of citations) {
      const domain = (() => { try { return new URL(citation).hostname; } catch { return null; } })();
      await db.insert(dataSourcesTable).values({
        title: `Research: ${query.substring(0, 80)}`,
        url: citation,
        publisher: domain,
        accessedDate: new Date(),
        sourceType: "article",
      }).onConflictDoNothing({ target: dataSourcesTable.url });
    }

    res.json({ findings, citations, rawAnalysis });
  } catch (err: unknown) {
    console.error("Research query failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: "Research query failed", details: message });
  }
});

router.get("/data-sources", async (req, res) => {
  const idsParam = req.query.ids;
  if (idsParam && typeof idsParam === "string") {
    const ids = idsParam.split(",").map(Number).filter(n => !isNaN(n)).slice(0, 50);
    if (ids.length === 0) {
      res.json([]);
      return;
    }
    const sources = await db.select().from(dataSourcesTable).where(inArray(dataSourcesTable.id, ids));
    res.json(sources);
    return;
  }

  const sources = await db.select().from(dataSourcesTable);
  res.json(sources);
});

export default router;
