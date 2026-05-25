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
  watchlistsTable,
  watchlistItemsTable,
  cviCapabilityHistoryTable,
  macroEventsTable,
} from "@workspace/db";
import { eq, desc, inArray, and, gte, sql } from "drizzle-orm";
import { forSession } from "../lib/tenant-scope";
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
import { z } from "zod";
import { haiku, generateObject, NoObjectGeneratedError } from "../services/workflows/models";
import { perplexityChat } from "../services/perplexity";

const InsightsSchema = z.object({
  insights: z.array(z.object({
    title: z.string().max(80),
    content: z.string(),
    recommendation: z.string(),
    severity: z.enum(["critical", "warning", "info"]),
  })).length(3),
});

const router: IRouter = Router();

/**
 * GET /insights/for-you?sessionToken=...&windowDays=14
 *
 * Personalized "what changed in capabilities you watch" feed. Joins:
 *
 *   - watchlist_items (filtered to caller's session-token-scoped watchlist)
 *   - cvi_capability_history (latest vs windowDays-ago snapshot, delta per
 *     watched capability)
 *   - macro_events overlap (events whose affected_capability_ids JSON includes
 *     a watched capability, within the same window)
 *
 * Response: { watchedCount, windowDays, movements: [...], macroEvents: [...] }
 * where each movement carries capabilityId/name/currentScore/priorScore/delta
 * and each macroEvent carries id/title/severity/startedAt/sentimentDirection.
 *
 * Returns empty arrays (not 404) when the user has no watchlist yet, so the
 * frontend can render a friendly "follow some capabilities to populate this"
 * empty state without branching on HTTP status.
 */
router.get("/insights/for-you", async (req, res) => {
  const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
  const windowDays = (() => {
    const raw = Number(req.query.windowDays);
    if (!Number.isFinite(raw) || raw <= 0) return 14;
    return Math.min(Math.max(Math.floor(raw), 1), 90);
  })();

  if (!token) {
    res.json({ watchedCount: 0, windowDays, movements: [], macroEvents: [] });
    return;
  }

  // Watchlist for the caller. forSession() enforces session-token scope.
  const [watchlist] = await db.select().from(watchlistsTable).where(forSession("watchlists", token));
  if (!watchlist) {
    res.json({ watchedCount: 0, windowDays, movements: [], macroEvents: [] });
    return;
  }

  const items = await db.select({
    capabilityId: watchlistItemsTable.capabilityId,
    industryId: watchlistItemsTable.industryId,
  }).from(watchlistItemsTable).where(eq(watchlistItemsTable.watchlistId, watchlist.id));

  const capIds = Array.from(new Set(items.map(i => i.capabilityId)));
  if (capIds.length === 0) {
    res.json({ watchedCount: 0, windowDays, movements: [], macroEvents: [] });
    return;
  }

  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  // ── Movements: latest vs prior-window snapshot per watched capability.
  // Pull all history for those caps in the window + the most recent snapshot
  // overall. Then build current = max(snapshotAt), prior = oldest in window.
  const [historyRows, caps] = await Promise.all([
    db.select().from(cviCapabilityHistoryTable)
      .where(and(
        inArray(cviCapabilityHistoryTable.capabilityId, capIds),
        gte(cviCapabilityHistoryTable.snapshotAt, since),
      ))
      .orderBy(desc(cviCapabilityHistoryTable.snapshotAt)),
    db.select({
      id: capabilitiesTable.id,
      name: capabilitiesTable.name,
      slug: capabilitiesTable.slug,
      industryId: capabilitiesTable.industryId,
    }).from(capabilitiesTable).where(inArray(capabilitiesTable.id, capIds)),
  ]);
  const capMap = new Map(caps.map(c => [c.id, c]));

  type Row = typeof cviCapabilityHistoryTable.$inferSelect;
  const byCapability = new Map<number, Row[]>();
  for (const r of historyRows) {
    const arr = byCapability.get(r.capabilityId);
    if (arr) arr.push(r); else byCapability.set(r.capabilityId, [r]);
  }

  const movements = Array.from(byCapability.entries()).map(([capabilityId, rows]) => {
    const sorted = [...rows].sort((a, b) => a.snapshotAt.getTime() - b.snapshotAt.getTime());
    const prior = sorted[0];
    const current = sorted[sorted.length - 1];
    const meta = capMap.get(capabilityId);
    const delta = current.consensusScore - prior.consensusScore;
    return {
      capabilityId,
      capabilityName: meta?.name ?? `Capability #${capabilityId}`,
      capabilitySlug: meta?.slug ?? null,
      industryId: meta?.industryId ?? prior.industryId,
      currentScore: current.consensusScore,
      priorScore: prior.consensusScore,
      delta,
      direction: delta > 0.5 ? "up" : delta < -0.5 ? "down" : "flat",
      velocity: current.velocity,
      snapshotAt: current.snapshotAt,
    };
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // ── Macro events: those whose affected_capability_ids JSON array overlaps
  // the watched cap ids, started within the window. Postgres jsonb @> check
  // per-id is the safest portable form here.
  const eventRows = await db.select().from(macroEventsTable)
    .where(and(
      gte(macroEventsTable.startedAt, since),
      sql`(${macroEventsTable.affectedCapabilityIds})::jsonb ?| ${capIds.map(String)}`,
    ))
    .orderBy(desc(macroEventsTable.startedAt))
    .limit(20);

  const macroEvents = eventRows.map(e => ({
    id: e.id,
    title: e.title,
    description: e.description,
    eventType: e.eventType,
    severity: e.severity,
    sentimentDirection: e.sentimentDirection,
    startedAt: e.startedAt,
    affectedCapabilityIds: ((e.affectedCapabilityIds ?? []) as number[]).filter(id => capIds.includes(id)),
  }));

  res.json({
    watchedCount: capIds.length,
    windowDays,
    movements,
    macroEvents,
  });
});

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

  const system = `You are a capability economics advisor. Produce strategic insights about an industry's capabilities. Each insight has a concise title (≤ 80 chars), 2-3 sentence content explaining the economic impact, 1-2 sentence recommendation, and a severity ("critical" = immediate, "warning" = address within 6 months, "info" = strategic opportunity).`;
  const userPrompt = `Industry: ${industry.name}\n\nCurrent capabilities and maturity scores:\n${capSummary}\n\n${context ? `Additional context: ${context}\n\n` : ""}${capabilityId ? `Focus specifically on capability ID ${capabilityId}.\n` : ""}Produce exactly 3 actionable insights.`;

  if (!process.env.OPENROUTER_API_KEY) {
    res.status(503).json({ error: "AI service not configured" });
    return;
  }

  try {
    let insights: z.infer<typeof InsightsSchema>["insights"];
    try {
      const { object } = await generateObject({
        model: haiku,
        schema: InsightsSchema,
        system,
        prompt: userPrompt,
        temperature: 0.2,
        maxTokens: 4096,
      });
      insights = object.insights;
    } catch (err) {
      if (err instanceof NoObjectGeneratedError) {
        insights = [{ title: "Analysis Complete", content: err.text?.slice(0, 1000) ?? "", recommendation: "Review the detailed analysis above.", severity: "info" as const }];
      } else {
        throw err;
      }
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
        metadata: { source: "openrouter", model: process.env.LLM_MODEL || "anthropic/claude-haiku-4.5", generatedAt: new Date().toISOString() },
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

  if (!process.env.PERPLEXITY_API_KEY) {
    res.status(503).json({ error: "Research service not configured" });
    return;
  }

  try {
    const contextLine = contextParts.length > 0 ? `\nContext: ${contextParts.join(", ")}` : "";
    // Routed through perplexityChat() to use the shared content-hash cache
    // (PERPLEXITY_CACHE_TTL_HOURS, default 168h). Repeated insight queries
    // on the same capability/industry within a week reuse the call.
    const data = await perplexityChat({
      model: "sonar-pro",
      endpoint: "insights.research",
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
    });
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
