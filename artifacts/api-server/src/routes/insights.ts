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
  industriesTable,
} from "@workspace/db";
import { eq, sql, and, desc } from "drizzle-orm";

import type Anthropic from "@anthropic-ai/sdk";
let anthropicClient: Anthropic | null = null;
async function getAnthropic() {
  if (!anthropicClient) {
    try {
      const mod = await import("@workspace/integrations-anthropic-ai");
      anthropicClient = mod.anthropic;
    } catch (e) {
      console.warn("Anthropic integration not available:", (e as Error).message);
      return null;
    }
  }
  return anthropicClient;
}

const router: IRouter = Router();

router.get("/insights", async (req, res) => {
  const industryId = req.query.industryId ? parseInt(req.query.industryId as string) : undefined;

  let query = db
    .select()
    .from(capabilityInsightsTable)
    .orderBy(desc(capabilityInsightsTable.generatedAt));

  const insights = await query;
  const filtered = industryId
    ? insights.filter(i => i.industryId === industryId)
    : insights;

  res.json(filtered);
});

router.get("/thresholds", async (req, res) => {
  const industryId = req.query.industryId ? parseInt(req.query.industryId as string) : undefined;

  const conditions = [eq(capabilitiesTable.id, capabilityThresholdsTable.capabilityId)];

  let query = db
    .select({
      id: capabilityThresholdsTable.id,
      capabilityId: capabilityThresholdsTable.capabilityId,
      capabilityName: capabilitiesTable.name,
      capabilitySlug: capabilitiesTable.slug,
      industryId: capabilitiesTable.industryId,
      benchmarkScore: capabilitiesTable.benchmarkScore,
      greenMin: capabilityThresholdsTable.greenMin,
      yellowMin: capabilityThresholdsTable.yellowMin,
      redMax: capabilityThresholdsTable.redMax,
    })
    .from(capabilityThresholdsTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, capabilityThresholdsTable.capabilityId));

  const thresholds = industryId
    ? await query.where(eq(capabilitiesTable.industryId, industryId))
    : await query;

  const enriched = thresholds.map(t => ({
    ...t,
    status: t.benchmarkScore >= t.greenMin ? "green" : t.benchmarkScore >= t.yellowMin ? "yellow" : "red",
  }));

  res.json(enriched);
});

router.get("/leaderboard", async (req, res) => {
  const industryId = req.query.industryId ? parseInt(req.query.industryId as string) : undefined;

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
    })
    .from(industryLeaderboardTable)
    .innerJoin(industriesTable, eq(industriesTable.id, industryLeaderboardTable.industryId))
    .orderBy(industryLeaderboardTable.rank);

  const filtered = industryId
    ? entries.filter(e => e.industryId === industryId)
    : entries;

  res.json(filtered);
});

router.get("/white-papers", async (req, res) => {
  const industryId = req.query.industryId ? parseInt(req.query.industryId as string) : undefined;

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
      publishedYear: industryWhitePapersTable.publishedYear,
      relevanceScore: industryWhitePapersTable.relevanceScore,
      tags: industryWhitePapersTable.tags,
    })
    .from(industryWhitePapersTable)
    .innerJoin(industriesTable, eq(industriesTable.id, industryWhitePapersTable.industryId))
    .orderBy(desc(industryWhitePapersTable.relevanceScore));

  const filtered = industryId
    ? papers.filter(p => p.industryId === industryId)
    : papers;

  res.json(filtered);
});

router.get("/ontology", async (req, res) => {
  const industryId = req.query.industryId ? parseInt(req.query.industryId as string) : undefined;

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

  const sourceCap = await db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name, slug: capabilitiesTable.slug, industryId: capabilitiesTable.industryId, benchmarkScore: capabilitiesTable.benchmarkScore }).from(capabilitiesTable);
  const capLookup: Record<number, typeof sourceCap[0]> = {};
  for (const c of sourceCap) capLookup[c.id] = c;

  const enriched = relationships.map(r => ({
    ...r,
    sourceName: capLookup[r.sourceCapabilityId]?.name || "",
    sourceSlug: capLookup[r.sourceCapabilityId]?.slug || "",
    sourceIndustryId: capLookup[r.sourceCapabilityId]?.industryId,
    targetName: capLookup[r.targetCapabilityId]?.name || "",
    targetSlug: capLookup[r.targetCapabilityId]?.slug || "",
    targetIndustryId: capLookup[r.targetCapabilityId]?.industryId,
  }));

  const filtered = industryId
    ? enriched.filter(r => r.sourceIndustryId === industryId || r.targetIndustryId === industryId)
    : enriched;

  const adapters = industryId
    ? await db.select().from(ontologyIndustryAdaptersTable).where(eq(ontologyIndustryAdaptersTable.industryId, industryId))
    : await db.select().from(ontologyIndustryAdaptersTable);

  res.json({ relationships: filtered, adapters });
});

router.post("/insights/generate", async (req, res) => {
  const { industryId, capabilityId, context } = req.body;

  if (!industryId) {
    res.status(400).json({ error: "industryId is required" });
    return;
  }

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

  const ai = await getAnthropic();
  if (!ai) {
    res.status(503).json({ error: "AI service not available" });
    return;
  }

  try {
    const message = await ai.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

    const block = message.content[0];
    const text = block.type === "text" ? block.text : "";

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
        metadata: { source: "anthropic", model: "claude-haiku-4-5", generatedAt: new Date().toISOString() },
      });
    }

    res.json({ insights, cached: false });
  } catch (err: unknown) {
    console.error("AI insight generation failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: "Failed to generate insights", details: message });
  }
});

export default router;
