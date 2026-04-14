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
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
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

        const prompt = `You are a Capability Economics expert. Generate a vivid, specific executive perspective for the ${role.title} (${role.name}) role. Focus area: ${role.focus}${contextSection}

Use the research context above to include real benchmarks, specific numbers, and credible industry data in your response.

Return ONLY valid JSON:
{
  "scenario": "A 3-4 sentence specific real-world scenario where this executive applies Capability Economics to make a concrete business decision — include actual numbers and outcomes drawn from real industry benchmarks.",
  "questions": ["Sharp provocative question 1 a ${role.title} would ask about capability economics", "Question 2", "Question 3"],
  "capabilities": ["Real functional capability this role owns 1", "Capability 2", "Capability 3"],
  "metrics": ["Specific named KPI with measured improvement grounded in real data, e.g. Return on Capability Investment (ROCI): 340%", "Metric 2"],
  "chartData": [
    {"subject": "Relevant Dimension 1", "A": 85, "fullMark": 100},
    {"subject": "Relevant Dimension 2", "A": 72, "fullMark": 100},
    {"subject": "Relevant Dimension 3", "A": 90, "fullMark": 100},
    {"subject": "Relevant Dimension 4", "A": 65, "fullMark": 100},
    {"subject": "Relevant Dimension 5", "A": 78, "fullMark": 100}
  ]
}

chartData subjects must be the 5 most relevant capability dimensions for a ${role.title}. Values should be varied (40-95 range).`;

        const message = await anthropic.messages.create({
          model: rm("claude-opus-4-5"),
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        });

        const text = message.content[0].type === "text" ? message.content[0].text : "";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON in response");

        const parsed = JSON.parse(jsonMatch[0]) as {
          scenario: string;
          questions: string[];
          capabilities: string[];
          metrics: string[];
          chartData: { subject: string; A: number; fullMark: number }[];
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
    description: "Generate AI-powered C-suite executive perspectives for all roles using Perplexity (real-world research context) + Claude (structured output). Stores results in the database for the frontend to display. Skips roles with fresh content (< 48h old). Call once per research cycle.",
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
        model: rm("claude-opus-4-5"),
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

export const allTools = [
  perplexityResearchTool,
  queryDatabaseTool,
  computeCEITool,
  recallMemoriesTool,
  storeMemoryTool,
  generateCsuitePerspectivesTool,
  generateCaseStudyContentTool,
];
