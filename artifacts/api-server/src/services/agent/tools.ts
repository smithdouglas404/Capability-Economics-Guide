import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  ceiComponentsTable,
  ceiSnapshotsTable,
  sourceTriangulationsTable,
  cSuiteRolesTable,
  csuitePerspectivesTable,
  caseStudyContentTable,
  capabilityMetricsTable,
  capabilityInsightsTable,
  industryLeaderboardTable,
  industryWhitePapersTable,
  ontologyRelationshipsTable,
  ontologyIndustryAdaptersTable,
} from "@workspace/db";
import { eq, desc, and, gt } from "drizzle-orm";
import { triangulateCapability } from "../triangulation";
import { computeCEI } from "../cei-engine";
import { recallMemories, storeMemory } from "./memory";

type AnthropicClient = Awaited<typeof import("@workspace/integrations-anthropic-ai")>["anthropic"];
let _anthropic: AnthropicClient | null = null;
let _resolveModel: ((name: string) => string) | null = null;
async function getAnthropic(): Promise<AnthropicClient> {
  if (!_anthropic) {
    const mod = await import("@workspace/integrations-anthropic-ai");
    _anthropic = mod.anthropic;
    _resolveModel = mod.resolveModel;
  }
  return _anthropic;
}
function rm(name: string): string {
  return _resolveModel ? _resolveModel(name) : name;
}

const CONTENT_STALE_HOURS = 48;
function isContentStale(generatedAt: Date): boolean {
  return Date.now() - generatedAt.getTime() > CONTENT_STALE_HOURS * 60 * 60 * 1000;
}

async function perplexityContextSearch(query: string): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return "";
  try {
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
            content: "You are a management consulting research analyst. Provide concise, factual research context with specific numbers, benchmarks, and real examples from 2023-2026 data. Focus on practical, measurable outcomes.",
          },
          { role: "user", content: query },
        ],
      }),
    });
    if (!resp.ok) return "";
    const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? "";
  } catch {
    return "";
  }
}

export const perplexityResearchTool = tool(
  async ({ industryName, capabilityName, industryId, capabilityId }) => {
    try {
      const result = await triangulateCapability(
        industryName,
        capabilityName,
        industryId,
        capabilityId,
      );
      return JSON.stringify({
        success: true,
        capabilityName: result.capabilityName,
        consensusScore: result.consensusScore,
        confidence: result.confidence,
        sourcesCount: result.sources.length,
        bayesianPosterior: result.bayesianPosterior,
      });
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Research failed",
      });
    }
  },
  {
    name: "perplexity_research",
    description: "Research a specific capability in an industry using multi-source Perplexity triangulation (4 analytical perspectives with Bayesian consensus). Use this ONLY when the decision engine determines fresh research is needed.",
    schema: z.object({
      industryName: z.string().describe("Name of the industry"),
      capabilityName: z.string().describe("Name of the capability to research"),
      industryId: z.number().describe("Database ID of the industry"),
      capabilityId: z.number().describe("Database ID of the capability"),
    }),
  },
);

export const queryDatabaseTool = tool(
  async ({ queryType, industryId }) => {
    try {
      if (queryType === "industries") {
        const industries = await db.select().from(industriesTable);
        return JSON.stringify(industries.map(i => ({ id: i.id, name: i.name, slug: i.slug })));
      }

      if (queryType === "capabilities" && industryId) {
        const caps = await db.select().from(capabilitiesTable)
          .where(eq(capabilitiesTable.industryId, industryId));
        return JSON.stringify(caps.map(c => ({
          id: c.id,
          name: c.name,
          benchmarkScore: c.benchmarkScore,
        })));
      }

      if (queryType === "cei_components") {
        const conditions = industryId
          ? eq(ceiComponentsTable.industryId, industryId)
          : undefined;
        const components = conditions
          ? await db.select().from(ceiComponentsTable).where(conditions)
          : await db.select().from(ceiComponentsTable);
        return JSON.stringify(components.map(c => ({
          id: c.id,
          capabilityId: c.capabilityId,
          industryId: c.industryId,
          consensusScore: c.consensusScore,
          confidence: c.confidence,
          velocity: c.velocity,
          economicMultiplier: c.economicMultiplier,
          updatedAt: c.updatedAt.toISOString(),
        })));
      }

      if (queryType === "latest_snapshot") {
        const [snap] = await db.select().from(ceiSnapshotsTable)
          .orderBy(desc(ceiSnapshotsTable.snapshotAt)).limit(1);
        if (!snap) return JSON.stringify({ exists: false });
        return JSON.stringify({
          exists: true,
          overallIndex: snap.overallIndex,
          snapshotAt: snap.snapshotAt.toISOString(),
          volatility: snap.volatility,
          marketSentiment: snap.marketSentiment,
        });
      }

      if (queryType === "recent_triangulations" && industryId) {
        const tris = await db.select().from(sourceTriangulationsTable)
          .where(eq(sourceTriangulationsTable.industryId, industryId))
          .orderBy(desc(sourceTriangulationsTable.queriedAt))
          .limit(20);
        return JSON.stringify(tris.map(t => ({
          capabilityId: t.capabilityId,
          sourceLabel: t.sourceLabel,
          rawScore: t.rawScore,
          queriedAt: t.queriedAt.toISOString(),
        })));
      }

      return JSON.stringify({ error: "Unknown query type" });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : "Query failed" });
    }
  },
  {
    name: "query_database",
    description: "Query the capability economics database for current state. Supports: industries, capabilities, cei_components, latest_snapshot, recent_triangulations.",
    schema: z.object({
      queryType: z.enum(["industries", "capabilities", "cei_components", "latest_snapshot", "recent_triangulations"]),
      industryId: z.number().optional().describe("Industry ID for filtered queries"),
    }),
  },
);

export const computeCEITool = tool(
  async () => {
    try {
      const result = await computeCEI();
      return JSON.stringify({
        success: true,
        overallIndex: result.overallIndex,
        industriesCount: Object.keys(result.industryBreakdowns).length,
        marketSentiment: result.marketSentiment,
        volatility: result.volatility,
        timestamp: result.timestamp,
      });
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : "Computation failed",
      });
    }
  },
  {
    name: "compute_cei",
    description: "Recompute the CEI index from current database state and save a new snapshot. Call this after research updates to refresh the index.",
    schema: z.object({}),
  },
);

export const recallMemoriesTool = tool(
  async ({ query, memoryType, limit }) => {
    try {
      const memories = await recallMemories(
        query,
        memoryType as "pattern" | "observation" | "insight" | "decision_context" | undefined,
        limit,
      );
      return JSON.stringify(memories.map(m => ({
        content: m.content,
        type: m.memoryType,
        relevance: m.relevanceScore,
        createdAt: m.createdAt,
        metadata: m.metadata,
      })));
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : "Recall failed" });
    }
  },
  {
    name: "recall_memories",
    description: "Search agent memory for relevant past observations, patterns, and decision context. Use before making research decisions to leverage institutional learning.",
    schema: z.object({
      query: z.string().describe("Search query describing what memories to find"),
      memoryType: z.enum(["pattern", "observation", "insight", "decision_context"]).optional(),
      limit: z.number().default(5).describe("Max memories to return"),
    }),
  },
);

export const storeMemoryTool = tool(
  async ({ type, content, metadata }) => {
    try {
      const memory = await storeMemory(
        type as "pattern" | "observation" | "insight" | "decision_context",
        content,
        metadata || {},
      );
      return JSON.stringify({ success: true, id: memory.id });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : "Store failed" });
    }
  },
  {
    name: "store_memory",
    description: "Store a new observation, pattern, or insight in agent memory. Call after completing research to record what was learned for future decision-making.",
    schema: z.object({
      type: z.enum(["pattern", "observation", "insight", "decision_context"]),
      content: z.string().describe("The memory content to store"),
      metadata: z.record(z.unknown()).optional().describe("Additional structured metadata"),
    }),
  },
);

export const generateCsuitePerspectivesTool = tool(
  async () => {
    const anthropic = await getAnthropic();

    const roles = await db.select().from(cSuiteRolesTable).orderBy(cSuiteRolesTable.id);
    const generated: string[] = [];
    const skipped: string[] = [];

    for (const role of roles) {
      const [latest] = await db
        .select()
        .from(csuitePerspectivesTable)
        .where(eq(csuitePerspectivesTable.roleId, role.id))
        .orderBy(desc(csuitePerspectivesTable.generatedAt))
        .limit(1);

      if (latest && !isContentStale(latest.generatedAt)) {
        skipped.push(role.slug);
        continue;
      }

      try {
        const researchContext = await perplexityContextSearch(
          `What are the most important capability economics metrics, decision frameworks, and real-world outcomes relevant to a ${role.title} (${role.name}) in 2024-2026? Include specific benchmarks, percentages, and named KPIs that ${role.title}s track when evaluating capability investments. Focus on: ${role.focus}`
        );

        const contextSection = researchContext
          ? `\n\nPERPLEXITY RESEARCH CONTEXT (use this to ground your response in real data):\n${researchContext}\n`
          : "";

        // GLM 5.1 — provocative questions + role-specific chart dimensions
        const glmPrompt = `You are a Capability Economics expert advising a ${role.title} (${role.name}). Focus: ${role.focus}${contextSection}

Return ONLY valid JSON:
{
  "questions": ["Sharp, provocative question 1 a ${role.title} would demand answered about capability economics — challenge assumptions", "Question 2", "Question 3"],
  "chartData": [
    {"subject": "Most relevant capability dimension for a ${role.title} — specific label", "A": 85, "fullMark": 100},
    {"subject": "Dimension 2", "A": 62, "fullMark": 100},
    {"subject": "Dimension 3", "A": 75, "fullMark": 100},
    {"subject": "Dimension 4", "A": 48, "fullMark": 100},
    {"subject": "Dimension 5", "A": 83, "fullMark": 100}
  ]
}

Questions must challenge conventional thinking and be specific to ${role.title} accountability. Chart subjects must be the 5 most relevant capability dimensions for this role, with values varied across 40-95.`;

        const glmResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://capabilityeconomics.com",
            "X-Title": "Capability Economics",
          },
          body: JSON.stringify({ model: "z-ai/glm-5.1", max_tokens: 4096, messages: [{ role: "user", content: glmPrompt }] }),
        });
        const glmData = await glmResp.json() as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
        if (glmData.error) throw new Error(`GLM error: ${glmData.error.message}`);
        const glmText = glmData.choices?.[0]?.message?.content ?? "";
        const glmMatch = glmText.match(/\{[\s\S]*\}/);
        if (!glmMatch) throw new Error("GLM returned no JSON");
        const glmParsed = JSON.parse(glmMatch[0]) as { questions: string[]; chartData: { subject: string; A: number; fullMark: number }[] };

        // Sonnet 4.5 — grounded scenario, capabilities, and metrics with real numbers
        const sonnetPrompt = `You are a Capability Economics consultant. Generate a data-grounded executive perspective for the ${role.title} (${role.name}) role. Focus: ${role.focus}${contextSection}

Use the research context to include real benchmarks and specific numbers.

Return ONLY valid JSON:
{
  "scenario": "A 3-4 sentence real-world scenario where this executive applies Capability Economics to make a concrete business decision — include actual dollar amounts, percentages, and timeframes from real industry benchmarks.",
  "capabilities": ["Real functional capability this ${role.title} owns 1", "Capability 2", "Capability 3"],
  "metrics": ["Specific named KPI with measured outcome grounded in real data, e.g. Return on Capability Investment (ROCI): 340%", "Metric 2 with number", "Metric 3 with number", "Metric 4 with number", "Metric 5 with number"]
}`;

        const message = await anthropic.messages.create({
          model: rm("claude-sonnet-4-5"),
          max_tokens: 1024,
          messages: [{ role: "user", content: sonnetPrompt }],
        });

        const text = message.content[0].type === "text" ? message.content[0].text : "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON in Sonnet response");

        const sonnetParsed = JSON.parse(jsonMatch[0]) as {
          scenario: string;
          capabilities: string[];
          metrics: string[];
        };

        const parsed = {
          scenario: sonnetParsed.scenario,
          questions: glmParsed.questions,
          capabilities: sonnetParsed.capabilities,
          metrics: sonnetParsed.metrics,
          chartData: glmParsed.chartData,
        };

        await db.insert(csuitePerspectivesTable).values({
          roleId: role.id,
          scenario: parsed.scenario,
          questions: parsed.questions,
          capabilities: parsed.capabilities,
          metrics: parsed.metrics,
          chartData: parsed.chartData,
        });

        generated.push(role.slug);
      } catch (err) {
        console.error(`Failed to generate perspective for ${role.slug}:`, err);
      }
    }

    return JSON.stringify({ success: true, generated, skipped });
  },
  {
    name: "generate_csuite_perspectives",
    description: "Generate AI-powered C-suite executive perspectives for all roles. Uses Perplexity for research context, GLM 5.1 for provocative questions + chart dimensions, and Sonnet 4.5 for grounded scenario + metrics. Stores results in the database. Skips roles with fresh content (< 48h old). Call once per research cycle.",
    schema: z.object({}),
  },
);

export const generateCaseStudyContentTool = tool(
  async ({ industrySlug }) => {
    const anthropic = await getAnthropic();

    const [industry] = await db
      .select()
      .from(industriesTable)
      .where(eq(industriesTable.slug, industrySlug));

    if (!industry) return JSON.stringify({ success: false, error: `Industry ${industrySlug} not found` });

    const allCaps = await db
      .select()
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.industryId, industry.id))
      .orderBy(desc(capabilitiesTable.benchmarkScore))
      .limit(2);

    if (allCaps.length === 0) return JSON.stringify({ success: false, error: "No capabilities found" });

    const existing = await db
      .select()
      .from(caseStudyContentTable)
      .where(eq(caseStudyContentTable.industryId, industry.id))
      .orderBy(desc(caseStudyContentTable.generatedAt));

    const allFresh = existing.length >= allCaps.length && existing.every(e => !isContentStale(e.generatedAt));
    if (allFresh) return JSON.stringify({ success: true, skipped: true, reason: "Content is fresh" });

    const capSummaries = allCaps.map(c =>
      `- ${c.name} (slug: ${c.slug}): Traditional view: "${c.traditionalView}" | Economic view: "${c.economicView}" | Benchmark: ${c.benchmarkScore}/100`
    ).join("\n");

    const researchContext = await perplexityContextSearch(
      `Provide real-world benchmarks, ROI data, and case study evidence for capability economics in the ${industry.name} industry (2023-2026). Specifically cover: (1) ${allCaps[0]?.name} — measurable outcomes, KPIs, cost reductions, revenue impacts; (2) ${allCaps[1]?.name} — measurable outcomes, KPIs, NPS impacts, efficiency gains. Include specific percentages, dollar amounts, and named metrics from real insurers or comparable companies.`
    );

    const contextSection = researchContext
      ? `\nPERPLEXITY RESEARCH CONTEXT (real benchmarks to ground your response):\n${researchContext}\n`
      : "";

    const prompt = `You are a Capability Economics consultant specialising in the ${industry.name} industry. Generate a detailed, credible case study grounded in real data.

Top capabilities from our database:
${capSummaries}
${contextSection}
Use the research context above to ensure metrics and ROI data reflect real ${industry.name} industry benchmarks.

Return ONLY valid JSON:
{
  "capabilities": [
    {
      "capabilitySlug": "${allCaps[0]?.slug}",
      "capabilityName": "${allCaps[0]?.name}",
      "description": "2 sentence description of the economic value of this capability in ${industry.name}.",
      "traditionalView": "How insurers/firms historically viewed this capability as a cost center.",
      "economicView": "How Capability Economics reframes it as a quantifiable revenue and value driver.",
      "metrics": [
        {"name": "Specific KPI Name", "value": "Measured outcome with real numbers", "trend": "up"},
        {"name": "Specific KPI Name 2", "value": "Measured outcome with real numbers", "trend": "down"},
        {"name": "Specific KPI Name 3", "value": "Measured outcome with real numbers", "trend": "up"}
      ]
    },
    {
      "capabilitySlug": "${allCaps[1]?.slug}",
      "capabilityName": "${allCaps[1]?.name}",
      "description": "2 sentence description.",
      "traditionalView": "Traditional view as cost.",
      "economicView": "Economic reframe as value.",
      "metrics": [
        {"name": "KPI Name", "value": "Number-backed outcome", "trend": "up"},
        {"name": "KPI Name 2", "value": "Number-backed outcome", "trend": "up"},
        {"name": "KPI Name 3", "value": "Number-backed outcome", "trend": "down"}
      ]
    }
  ],
  "roiData": [
    {"year": "Year 1", "traditionalCost": 12, "capabilityCost": 18, "valueGenerated": 14},
    {"year": "Year 2", "traditionalCost": 13, "capabilityCost": 16, "valueGenerated": 31},
    {"year": "Year 3", "traditionalCost": 14, "capabilityCost": 14, "valueGenerated": 55},
    {"year": "Year 4", "traditionalCost": 15, "capabilityCost": 12, "valueGenerated": 84},
    {"year": "Year 5", "traditionalCost": 16, "capabilityCost": 11, "valueGenerated": 128}
  ]
}

Trend must be "up", "down", or "neutral". All numbers in $M. Metrics must be real ${industry.name} KPIs. Value generated should show compelling compounding ROI.`;

    try {
      const message = await anthropic.messages.create({
        model: rm("claude-sonnet-4-5"),
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");

      const parsed = JSON.parse(jsonMatch[0]) as {
        capabilities: Array<{
          capabilitySlug: string;
          capabilityName: string;
          description: string;
          traditionalView: string;
          economicView: string;
          metrics: Array<{ name: string; value: string; trend: "up" | "down" | "neutral" }>;
        }>;
        roiData: Array<{ year: string; traditionalCost: number; capabilityCost: number; valueGenerated: number }>;
      };

      await db.delete(caseStudyContentTable).where(eq(caseStudyContentTable.industryId, industry.id));

      await Promise.all(
        parsed.capabilities.map((cap, i) =>
          db.insert(caseStudyContentTable).values({
            industryId: industry.id,
            capabilitySlug: cap.capabilitySlug,
            capabilityName: cap.capabilityName,
            description: cap.description,
            traditionalView: cap.traditionalView,
            economicView: cap.economicView,
            metrics: cap.metrics,
            roiData: i === 0 ? parsed.roiData : null,
          })
        )
      );

      return JSON.stringify({ success: true, industry: industry.slug, capabilitiesGenerated: parsed.capabilities.length });
    } catch (err) {
      return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
  {
    name: "generate_case_study",
    description: "Generate AI-powered case study content (capability descriptions, metrics, 5-year ROI data) for an industry using Perplexity (real industry benchmarks) + Claude (structured output). Stores results in the database for the frontend to display. Call once per research cycle for each featured industry.",
    schema: z.object({
      industrySlug: z.string().describe("Slug of the industry to generate case study content for (e.g. 'insurance')"),
    }),
  },
);

export const generateInsightsTool = tool(
  async ({ industrySlug }) => {
    const anthropic = await getAnthropic();

    const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.slug, industrySlug));
    if (!industry) return JSON.stringify({ success: false, error: `Industry ${industrySlug} not found` });

    const cutoff = new Date(Date.now() - CONTENT_STALE_HOURS * 60 * 60 * 1000);
    const recent = await db.select().from(capabilityInsightsTable)
      .where(and(eq(capabilityInsightsTable.industryId, industry.id), gt(capabilityInsightsTable.generatedAt, cutoff)))
      .limit(1);
    if (recent.length > 0) return JSON.stringify({ success: true, skipped: true, reason: "Insights are fresh" });

    const caps = await db.select({
      id: capabilitiesTable.id,
      name: capabilitiesTable.name,
      benchmarkScore: capabilitiesTable.benchmarkScore,
      economicView: capabilitiesTable.economicView,
    }).from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industry.id));

    const components = await db.select({
      capabilityId: ceiComponentsTable.capabilityId,
      consensusScore: ceiComponentsTable.consensusScore,
      velocity: ceiComponentsTable.velocity,
    }).from(ceiComponentsTable).where(eq(ceiComponentsTable.industryId, industry.id));

    const compMap = new Map(components.map(c => [c.capabilityId, c]));
    const capSummary = caps.map(c => {
      const comp = compMap.get(c.id);
      const score = comp?.consensusScore ?? c.benchmarkScore;
      const velocity = comp?.velocity ?? 0;
      return `- ${c.name}: score ${score}/100, trend ${velocity >= 0 ? "+" : ""}${velocity.toFixed(1)}/mo. ${c.economicView}`;
    }).join("\n");

    const researchContext = await perplexityContextSearch(
      `What are the most urgent capability gaps, market disruptions, and strategic opportunities facing the ${industry.name} industry in 2024-2026? Include specific companies, percentages, dollar amounts, and real analyst data from McKinsey, Gartner, Deloitte, or Forrester. Focus on operational risks and economic impact.`
    );

    const prompt = `You are a Capability Economics advisor analyzing the ${industry.name} industry using real market data.

Current capability scores:
${capSummary}

PERPLEXITY RESEARCH (use this to ground insights in real data):
${researchContext}

Generate exactly 4 strategic insights based on the capability scores and research above. Each must reference specific data points from the research.

Return ONLY valid JSON array:
[
  {
    "title": "Concise insight title (max 12 words)",
    "content": "2-3 sentences with specific data points, percentages, dollar amounts from the research. Reference real companies or analyst data.",
    "recommendation": "1-2 sentences with a specific, actionable recommendation including timeline and measurable target.",
    "severity": "critical" | "warning" | "info",
    "capabilityFocus": "name of the most relevant capability from the list above"
  }
]

Severity rules: "critical" = immediate revenue or operational risk, "warning" = 6-month strategic concern, "info" = growth opportunity. Use at least 1 critical and 1 info.`;

    try {
      const message = await anthropic.messages.create({
        model: rm("claude-haiku-4-5"),
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });
      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No JSON array in response");

      const insights = JSON.parse(jsonMatch[0]) as Array<{
        title: string; content: string; recommendation: string; severity: string; capabilityFocus?: string;
      }>;

      const capNameMap = new Map(caps.map(c => [c.name, c.id]));

      await db.delete(capabilityInsightsTable).where(eq(capabilityInsightsTable.industryId, industry.id));

      await Promise.all(insights.map(insight => {
        const capId = insight.capabilityFocus ? capNameMap.get(insight.capabilityFocus) ?? null : null;
        return db.insert(capabilityInsightsTable).values({
          industryId: industry.id,
          capabilityId: capId,
          insightType: "agent_generated",
          title: insight.title,
          content: insight.content,
          severity: insight.severity as "critical" | "warning" | "info",
          recommendation: insight.recommendation,
          metadata: { source: "perplexity+claude", model: "claude-haiku-4-5", generatedAt: new Date().toISOString() },
        });
      }));

      return JSON.stringify({ success: true, industry: industrySlug, insightsGenerated: insights.length });
    } catch (err) {
      return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
  {
    name: "generate_insights",
    description: "Generate AI-powered capability insights and alerts for an industry using Perplexity (real market research) + Claude (structured analysis). Writes directly to the database. Skips if insights are fresh (< 48h). Call once per cycle per industry.",
    schema: z.object({
      industrySlug: z.string().describe("Slug of the industry (e.g. 'healthcare', 'insurance', 'retail')"),
    }),
  },
);

export const generateLeaderboardTool = tool(
  async ({ industrySlug }) => {
    const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.slug, industrySlug));
    if (!industry) return JSON.stringify({ success: false, error: `Industry ${industrySlug} not found` });

    const existing = await db.select().from(industryLeaderboardTable)
      .where(eq(industryLeaderboardTable.industryId, industry.id)).limit(1);
    if (existing.length > 0) return JSON.stringify({ success: true, skipped: true, reason: "Leaderboard exists" });

    const anthropic = await getAnthropic();

    const researchContext = await perplexityContextSearch(
      `Who are the top 4-5 companies in the ${industry.name} industry ranked by operational capability maturity, digital transformation, and innovation investment in 2024-2026? Include specific capability strengths and weaknesses, maturity scores, investment levels, and whether they are improving or declining. Use real data from analyst reports.`
    );

    const prompt = `You are a Capability Economics analyst. Based on this research, generate a leaderboard of the top companies in ${industry.name}.

PERPLEXITY RESEARCH:
${researchContext}

Return ONLY valid JSON array of exactly 4 companies, ranked 1-4:
[
  {
    "companyName": "Real company name",
    "overallMaturity": 85,
    "topCapability": "Their strongest capability name",
    "topCapabilityScore": 92,
    "weakestCapability": "Their weakest capability name",
    "weakestCapabilityScore": 58,
    "investmentLevel": "high" | "medium" | "low",
    "trend": "up" | "down" | "stable",
    "rank": 1
  }
]

All scores must be integers 40-100. Use real companies from the research. Investment level and trend must reflect real analyst data.`;

    try {
      const message = await anthropic.messages.create({
        model: rm("claude-haiku-4-5"),
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No JSON array in response");

      const entries = JSON.parse(jsonMatch[0]) as Array<{
        companyName: string; overallMaturity: number; topCapability: string; topCapabilityScore: number;
        weakestCapability: string; weakestCapabilityScore: number; investmentLevel: string; trend: string; rank: number;
      }>;

      await Promise.all(entries.map(e =>
        db.insert(industryLeaderboardTable).values({
          industryId: industry.id,
          companyName: e.companyName,
          overallMaturity: e.overallMaturity,
          topCapability: e.topCapability,
          topCapabilityScore: e.topCapabilityScore,
          weakestCapability: e.weakestCapability,
          weakestCapabilityScore: e.weakestCapabilityScore,
          investmentLevel: e.investmentLevel as "high" | "medium" | "low",
          trend: e.trend as "up" | "down" | "stable",
          rank: e.rank,
        })
      ));

      return JSON.stringify({ success: true, industry: industrySlug, entriesGenerated: entries.length });
    } catch (err) {
      return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
  {
    name: "generate_leaderboard",
    description: "Generate a real-data industry capability leaderboard using Perplexity research + Claude synthesis. Writes top companies and their capability scores to the database. Skips if leaderboard already exists for this industry.",
    schema: z.object({
      industrySlug: z.string().describe("Slug of the industry (e.g. 'healthcare', 'insurance', 'retail')"),
    }),
  },
);

export const generateWhitePapersTool = tool(
  async ({ industrySlug }) => {
    const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.slug, industrySlug));
    if (!industry) return JSON.stringify({ success: false, error: `Industry ${industrySlug} not found` });

    const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - FIFTEEN_DAYS_MS);
    const existing = await db.select({ id: industryWhitePapersTable.id, createdAt: industryWhitePapersTable.createdAt })
      .from(industryWhitePapersTable)
      .where(eq(industryWhitePapersTable.industryId, industry.id))
      .orderBy(desc(industryWhitePapersTable.createdAt))
      .limit(1);
    if (existing.length > 0 && existing[0].createdAt && existing[0].createdAt > cutoff) {
      return JSON.stringify({ success: true, skipped: true, reason: "White papers refreshed within last 30 days" });
    }

    const anthropic = await getAnthropic();

    const researchContext = await perplexityContextSearch(
      `What are the most important and cited industry research reports, white papers, and analyst publications on capability maturity, digital transformation ROI, and operational excellence in the ${industry.name} sector published 2022-2026? Include actual titles, authors, organizations (McKinsey, Gartner, Deloitte, Forrester, Accenture, BCG, WEF, etc.) and key findings.`
    );

    const prompt = `You are a research librarian for a Capability Economics platform. Generate 3 real research paper entries for the ${industry.name} industry.

PERPLEXITY RESEARCH (use only real publications found in this data):
${researchContext}

Return ONLY valid JSON array of exactly 3 papers:
[
  {
    "title": "Exact or close to exact real report title",
    "author": "Real author name or organization research team",
    "organization": "Real organization (McKinsey, Gartner, Deloitte, etc.)",
    "abstract": "2-3 sentences summarizing the real key findings with specific data points, percentages, and conclusions.",
    "category": "One of: Strategy | Operations | Technology | Workforce | Finance | Risk",
    "url": "Real URL if known, or organization's research page URL",
    "publishedYear": 2024,
    "relevanceScore": 90,
    "tags": "comma separated relevant tags"
  }
]

Only include REAL publications. If unsure of exact title, use the organization's well-known research series. relevanceScore must be 75-98.`;

    try {
      const message = await anthropic.messages.create({
        model: rm("claude-haiku-4-5"),
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      });
      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No JSON array in response");

      const papers = JSON.parse(jsonMatch[0]) as Array<{
        title: string; author: string; organization: string; abstract: string;
        category: string; url: string; publishedYear: number; relevanceScore: number; tags: string;
      }>;

      await Promise.all(papers.map(p =>
        db.insert(industryWhitePapersTable).values({
          industryId: industry.id,
          title: p.title,
          author: p.author,
          organization: p.organization,
          abstract: p.abstract,
          category: p.category,
          url: p.url,
          publishedYear: p.publishedYear,
          relevanceScore: p.relevanceScore,
          tags: p.tags,
        })
      ));

      return JSON.stringify({ success: true, industry: industrySlug, papersGenerated: papers.length });
    } catch (err) {
      return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
  {
    name: "generate_white_papers",
    description: "Generate real industry research paper entries using Perplexity (finds real publications) + Claude (structured output). Writes to the database. Refreshes every 15 days, keeping all historical papers.",
    schema: z.object({
      industrySlug: z.string().describe("Slug of the industry (e.g. 'healthcare', 'insurance', 'retail')"),
    }),
  },
);

export const generateOntologyTool = tool(
  async ({ industrySlug }) => {
    const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.slug, industrySlug));
    if (!industry) return JSON.stringify({ success: false, error: `Industry ${industrySlug} not found` });

    const [existingAdapter] = await db.select({ id: ontologyIndustryAdaptersTable.id })
      .from(ontologyIndustryAdaptersTable)
      .where(eq(ontologyIndustryAdaptersTable.industryId, industry.id))
      .limit(1);

    const caps = await db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name, slug: capabilitiesTable.slug })
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.industryId, industry.id));

    if (caps.length === 0) return JSON.stringify({ success: false, error: "No capabilities found for industry" });

    const capMap = Object.fromEntries(caps.map(c => [c.slug, c.id]));
    const capNames = caps.map(c => c.name).join(", ");

    if (existingAdapter) {
      return JSON.stringify({ success: true, skipped: true, reason: "Ontology refreshed within last 90 days" });
    }

    const anthropic = await getAnthropic();

    const researchContext = await perplexityContextSearch(
      `How do these ${industry.name} industry capabilities relate to each other in practice? Which capabilities enable others, which depend on others, which compete for investment, and which can substitute for each other? Capabilities: ${capNames}. Focus on real strategic and operational dependencies used by industry leaders.`
    );

    const relationshipsPrompt = `You are a capability economics ontologist. Based on Perplexity research, generate ontology relationships for the ${industry.name} industry.

Available capabilities (use exact names):
${caps.map(c => `- ${c.name} (slug: ${c.slug})`).join("\n")}

PERPLEXITY RESEARCH:
${researchContext}

Return ONLY valid JSON with this structure:
{
  "relationships": [
    {
      "sourceSlug": "exact-capability-slug",
      "targetSlug": "exact-capability-slug",
      "relationshipType": "enables|depends_on|competes_with|substitutes",
      "strength": "strong|moderate|weak",
      "description": "1 sentence explaining the real-world relationship",
      "industryContext": "Brief context specific to ${industry.name}"
    }
  ],
  "adapter": {
    "adapterName": "${industry.name} Capability Ontology Adapter",
    "adapterDescription": "2-3 sentence description of how capabilities are structured in ${industry.name}",
    "capabilityFocusAreas": "Area1 | Area2 | Area3 | Area4 | Area5",
    "maturityModel": "Level 1 - Initial | Level 2 - Developing | Level 3 - Defined | Level 4 - Managed | Level 5 - Optimizing",
    "keyDifferentiators": "2-3 sentences on what separates top-performing ${industry.name} organizations in capability maturity"
  }
}

Generate 8-12 relationships. Use only slugs from the provided capability list. relationshipType must be one of: enables, depends_on, competes_with, substitutes.`;

    try {
      // DeepSeek — most precise logical relationship typing (enables/depends_on/competes_with/substitutes)
      const dsResp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://capabilityeconomics.com",
          "X-Title": "Capability Economics",
        },
        body: JSON.stringify({
          model: "deepseek/deepseek-chat",
          max_tokens: 4096,
          messages: [{ role: "user", content: relationshipsPrompt }],
        }),
      });
      const dsData = await dsResp.json() as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
      if (dsData.error) throw new Error(`DeepSeek error: ${dsData.error.message}`);
      const text = dsData.choices?.[0]?.message?.content ?? "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON object in response");

      const parsed = JSON.parse(jsonMatch[0]) as {
        relationships: Array<{
          sourceSlug: string; targetSlug: string;
          relationshipType: string; strength: string;
          description: string; industryContext: string;
        }>;
        adapter: {
          adapterName: string; adapterDescription: string;
          capabilityFocusAreas: string; maturityModel: string; keyDifferentiators: string;
        };
      };

      const validRelationships = parsed.relationships.filter(
        r => capMap[r.sourceSlug] && capMap[r.targetSlug] &&
          ["enables", "depends_on", "competes_with", "substitutes"].includes(r.relationshipType) &&
          ["strong", "moderate", "weak"].includes(r.strength)
      );

      if (validRelationships.length === 0) throw new Error("No valid relationships generated");

      const capIds = caps.map(c => c.id);
      const { inArray } = await import("drizzle-orm");
      await db.delete(ontologyRelationshipsTable)
        .where(inArray(ontologyRelationshipsTable.sourceCapabilityId, capIds));

      for (const rel of validRelationships) {
        const srcId = capMap[rel.sourceSlug];
        const tgtId = capMap[rel.targetSlug];
        if (!srcId || !tgtId) continue;
        await db.insert(ontologyRelationshipsTable).values({
          sourceCapabilityId: srcId,
          targetCapabilityId: tgtId,
          relationshipType: rel.relationshipType,
          strength: rel.strength,
          description: rel.description,
          industryContext: rel.industryContext,
        });
      }

      await db.delete(ontologyIndustryAdaptersTable)
        .where(eq(ontologyIndustryAdaptersTable.industryId, industry.id));
      await db.insert(ontologyIndustryAdaptersTable).values({
        industryId: industry.id,
        adapterName: parsed.adapter.adapterName,
        adapterDescription: parsed.adapter.adapterDescription,
        capabilityFocusAreas: parsed.adapter.capabilityFocusAreas,
        maturityModel: parsed.adapter.maturityModel,
        keyDifferentiators: parsed.adapter.keyDifferentiators,
      });

      return JSON.stringify({ success: true, industry: industrySlug, relationshipsGenerated: validRelationships.length });
    } catch (err) {
      return JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  },
  {
    name: "generate_ontology",
    description: "Generate capability ontology relationships and industry adapter using Perplexity research + Claude synthesis. Maps how capabilities enable, depend on, compete with, or substitute each other. Refreshes every 90 days.",
    schema: z.object({
      industrySlug: z.string().describe("Slug of the industry (e.g. 'healthcare', 'insurance', 'retail')"),
    }),
  },
);

export const allTools = [
  perplexityResearchTool,
  queryDatabaseTool,
  computeCEITool,
  recallMemoriesTool,
  storeMemoryTool,
  generateCsuitePerspectivesTool,
  generateCaseStudyContentTool,
  generateInsightsTool,
  generateLeaderboardTool,
  generateWhitePapersTool,
  generateOntologyTool,
];
