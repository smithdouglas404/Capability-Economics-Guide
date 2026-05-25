import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  cviComponentsTable,
  cviSnapshotsTable,
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
  disruptionPatternsTable,
} from "@workspace/db";
import { eq, desc, and, gt } from "drizzle-orm";
import { triangulateCapability } from "../triangulation";
import { computeCVI } from "../cvi-engine";
import { recallMemories, storeMemory } from "./memory";
import { findCorrelations, findRelated } from "./graphMemory";
import { cypherCascadeImpacted } from "./capabilityGraphSync";
import {
  isGraphitiAvailable,
  searchNodes as graphitiSearchNodes,
  queryCypher as graphitiQueryCypher,
} from "../../lib/graphiti-client";
import { chatWithFallback, EDITORIAL_FALLBACK_CHAIN } from "../llm-fallback";
import { logLlmCall } from "../llm-usage";
import { inngest } from "../../inngest/client";
import { maybeStepAiWrap } from "../../inngest/step-context";

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

async function perplexityContextSearch(query: string, callerLabel: string = "agent.unspecified"): Promise<string> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return "";
  const startedAt = Date.now();
  const endpoint = `agent.${callerLabel}`;
  try {
    const resp = await maybeStepAiWrap(`perplexity:context-search:${callerLabel}`, () =>
      fetch("https://api.perplexity.ai/chat/completions", {
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
      }),
    );
    if (!resp.ok) {
      logLlmCall({ provider: "perplexity", model: "sonar", endpoint, startedAt, httpStatus: resp.status, errorMessage: `HTTP ${resp.status}` });
      return "";
    }
    const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
    logLlmCall({ provider: "perplexity", model: "sonar", endpoint, startedAt, httpStatus: resp.status, responseJson: data });
    return data.choices[0]?.message?.content ?? "";
  } catch (err) {
    logLlmCall({ provider: "perplexity", model: "sonar", endpoint, startedAt, errorMessage: err instanceof Error ? err.message : String(err) });
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

      if (queryType === "cvi_components") {
        const conditions = industryId
          ? eq(cviComponentsTable.industryId, industryId)
          : undefined;
        const components = conditions
          ? await db.select().from(cviComponentsTable).where(conditions)
          : await db.select().from(cviComponentsTable);
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
        const [snap] = await db.select().from(cviSnapshotsTable)
          .orderBy(desc(cviSnapshotsTable.snapshotAt)).limit(1);
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
    description: "Query the capability economics database for current state. Supports: industries, capabilities, cvi_components, latest_snapshot, recent_triangulations.",
    schema: z.object({
      queryType: z.enum(["industries", "capabilities", "cvi_components", "latest_snapshot", "recent_triangulations"]),
      industryId: z.number().optional().describe("Industry ID for filtered queries"),
    }),
  },
);

/**
 * Graph queries against the world model. Sibling to query_database.
 * Routes through the Graphiti+FalkorDB MCP server when configured; returns
 * a hint when it isn't, so agents can fall back to query_database for
 * relational lookups.
 *
 * Three operations:
 *   - cascade_dependents: walk upstream the dependency chain from a
 *     capability, returning everything that transitively depends on it
 *     within N hops. Equivalent to disruption.ts:computeDisruptionRisk's
 *     multi-hop traversal but exposed as a first-class agent tool.
 *   - find_related_entities: traverse memory-entity relationships
 *     outbound from a memory entity. Wraps graphMemory.findRelated which
 *     itself routes through Graphiti when USE_GRAPHITI_WORLD_MODEL=1.
 *   - search_world_model: semantic + structural search over the global
 *     world model (capabilities, CVI history, macro-events) via
 *     Graphiti's bitemporal search. Agents use this for "find anything
 *     about X" queries that don't map to a known table.
 */
export const queryGraphTool = tool(
  async ({ operation, capabilityId, entityId, hops, query, groupIds, limit }) => {
    try {
      if (operation === "cascade_dependents") {
        if (!capabilityId) {
          return JSON.stringify({ error: "capabilityId required for cascade_dependents" });
        }
        // Routes through capabilityGraphSync.cypherCascadeImpacted which
        // itself picks Graphiti (USE_GRAPHITI_WORLD_MODEL=1) or Neo4j
        // (USE_NEO4J_CAPABILITY_GRAPH=1) and returns null if neither is on.
        const cascade = await cypherCascadeImpacted(capabilityId, hops ?? 3);
        if (cascade === null) {
          return JSON.stringify({
            source: "none",
            note: "Neither USE_GRAPHITI_WORLD_MODEL=1 nor USE_NEO4J_CAPABILITY_GRAPH=1 — cascade unavailable. Use query_database with capabilities/cvi_components for 1-hop relational lookups.",
            results: [],
          });
        }
        return JSON.stringify({ source: "graph", count: cascade.length, results: cascade });
      }

      if (operation === "find_related_entities") {
        if (!entityId) {
          return JSON.stringify({ error: "entityId required for find_related_entities" });
        }
        const related = await findRelated(entityId, hops ?? 1);
        return JSON.stringify({
          count: related.length,
          results: related.map((r) => ({
            entityId: r.entity.id,
            entityName: r.entity.name,
            relation: r.relation,
            weight: r.weight,
            observedCount: r.observedCount,
            hop: r.hop,
          })),
        });
      }

      if (operation === "search_world_model") {
        if (!query) {
          return JSON.stringify({ error: "query required for search_world_model" });
        }
        if (!isGraphitiAvailable()) {
          return JSON.stringify({
            source: "none",
            note: "Graphiti MCP not configured — search_world_model unavailable. Use query_database or perplexity_research as fallbacks.",
            results: [],
          });
        }
        const result = await graphitiSearchNodes({
          query,
          groupIds: groupIds ?? ["global"],
          limit: limit ?? 10,
        });
        if (!result.ok) {
          return JSON.stringify({ error: result.error ?? "search_nodes failed" });
        }
        return JSON.stringify({
          source: "graphiti",
          count: result.results?.length ?? 0,
          results: result.results ?? [],
        });
      }

      return JSON.stringify({ error: "Unknown operation" });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : "Graph query failed" });
    }
  },
  {
    name: "query_graph",
    description:
      "Query the world model graph (Graphiti+FalkorDB). Use cascade_dependents to walk dependency chains, find_related_entities to traverse memory-entity relationships, search_world_model for semantic search across capabilities/CVI/macro-events. Sibling to query_database (relational); prefer this for multi-hop or semantic queries.",
    schema: z.object({
      operation: z.enum(["cascade_dependents", "find_related_entities", "search_world_model"]),
      capabilityId: z.number().optional().describe("For cascade_dependents — the root capability whose dependents to walk."),
      entityId: z.number().optional().describe("For find_related_entities — the memory_entities.id to traverse from."),
      hops: z.number().int().min(1).max(5).optional().describe("Hop depth for cascade/relation walks. Default 3 for cascade, 1 for relations."),
      query: z.string().optional().describe("For search_world_model — natural-language query."),
      groupIds: z.array(z.string()).optional().describe("For search_world_model — Graphiti group_ids to search. Default ['global']. Pass ['global', 'user-<id>'] to include a user subgraph."),
      limit: z.number().int().min(1).max(50).optional().describe("For search_world_model — max results. Default 10."),
    }),
  },
);

// Escape-hatch tool for raw Cypher when the typed operations above can't
// express what the agent needs. Use sparingly — raw Cypher bypasses
// Graphiti's bitemporal helpers AND lets the agent write whatever it wants
// (no SQL-injection-style protection beyond FalkorDB's own query parser).
export const cypherGraphTool = tool(
  async ({ cypher, params }) => {
    if (!isGraphitiAvailable()) {
      return JSON.stringify({ error: "Graphiti MCP not configured" });
    }
    try {
      const result = await graphitiQueryCypher({ cypher, params: params ?? {} });
      if (!result.ok) {
        return JSON.stringify({ error: result.error ?? "Cypher query failed" });
      }
      return JSON.stringify({ count: result.rows?.length ?? 0, rows: result.rows ?? [] });
    } catch (err) {
      return JSON.stringify({ error: err instanceof Error ? err.message : "Cypher exec failed" });
    }
  },
  {
    name: "cypher_graph",
    description:
      "Escape hatch — execute raw Cypher against the Graphiti+FalkorDB world model. Bypasses bitemporal helpers. Use only when query_graph's typed operations can't express what you need (custom traversals, aggregations, etc.).",
    schema: z.object({
      cypher: z.string().describe("Cypher query. Parameterize via $name placeholders."),
      params: z.record(z.string(), z.unknown()).optional().describe("Parameter map for $name placeholders."),
    }),
  },
);

export const computeCVITool = tool(
  async () => {
    try {
      const result = await computeCVI();
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
    name: "compute_cvi",
    description: "Recompute the CVI index from current database state and save a new snapshot. Call this after research updates to refresh the index.",
    schema: z.object({}),
  },
);

export const recallMemoriesTool = tool(
  async ({ query, memoryType, limit, runId, category }) => {
    try {
      const memories = await recallMemories(
        query,
        memoryType as "pattern" | "observation" | "insight" | "decision_context" | undefined,
        limit,
        { runId, category: category as "capability_signal" | "industry_trend" | "contradiction" | "validated_pattern" | "decision" | "observation" | undefined },
      );
      return JSON.stringify(memories.map(m => ({
        content: m.content,
        type: m.memoryType,
        category: m.category,
        runScope: m.runScope,
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
      runId: z.number().optional().describe("Restrict recall to a specific cycle (run_id) scope"),
      category: z.enum(["capability_signal", "industry_trend", "contradiction", "validated_pattern", "decision", "observation"]).optional(),
    }),
  },
);

export const storeMemoryTool = tool(
  async ({ type, content, metadata, runId, category, context }) => {
    try {
      const memory = await storeMemory(
        type as "pattern" | "observation" | "insight" | "decision_context",
        content,
        metadata || {},
        {
          runId,
          category: category as "capability_signal" | "industry_trend" | "contradiction" | "validated_pattern" | "decision" | "observation" | undefined,
          context,
        },
      );
      return JSON.stringify({ success: true, id: memory.id, mem0Id: memory.mem0Id, status: memory.mem0Status });
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
      runId: z.number().optional().describe("Cycle/run id this memory belongs to (for run_id scoping)"),
      category: z.enum(["capability_signal", "industry_trend", "contradiction", "validated_pattern", "decision", "observation"]).optional().describe("Mem0 custom category"),
      context: z.string().optional().describe("Optional conversational user-prompt to give Mem0 fact-extraction richer context"),
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
          `What are the most important capability economics metrics, decision frameworks, and real-world outcomes relevant to a ${role.title} (${role.name}) in 2024-2026? Include specific benchmarks, percentages, and named KPIs that ${role.title}s track when evaluating capability investments. Focus on: ${role.focus}`,
          "csuite-perspectives",
        );

        const contextSection = researchContext
          ? `\n\nPERPLEXITY RESEARCH CONTEXT (use this to ground your response in real data):\n${researchContext}\n`
          : "";

        // GLM 5.1 — provocative questions + role-specific chart dimensions
        const glmPrompt = `You are a Inflexcvi expert advising a ${role.title} (${role.name}). Focus: ${role.focus}${contextSection}

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

        // Budget-aware fallback chain — production was failing every CXO render
        // with "GLM error: requires more credits, or fewer max_tokens. Requested
        // 4096, can afford 129". The 4096-cap was wildly oversized for a payload
        // that's reliably ~600-800 tokens; cap at 1500 and let chatWithFallback
        // step through Sonnet → Haiku → GLM 5.1 on credit errors so the page
        // never renders empty.
        const glmResult = await chatWithFallback({
          models: EDITORIAL_FALLBACK_CHAIN,
          messages: [{ role: "user", content: glmPrompt }],
          maxTokens: 1500,
          endpoint: `csuite_perspective:${role.slug}`,
        });
        const glmText = glmResult.text;
        const glmMatch = glmText.match(/\{[\s\S]*\}/);
        if (!glmMatch) throw new Error("LLM returned no JSON");
        const glmParsed = JSON.parse(glmMatch[0]) as { questions: string[]; chartData: { subject: string; A: number; fullMark: number }[] };

        // Sonnet 4.5 — grounded scenario, capabilities, and metrics with real numbers
        const sonnetPrompt = `You are a Inflexcvi consultant. Generate a data-grounded executive perspective for the ${role.title} (${role.name}) role. Focus: ${role.focus}${contextSection}

Use the research context to include real benchmarks and specific numbers.

Return ONLY valid JSON:
{
  "scenario": "A 3-4 sentence real-world scenario where this executive applies Inflexcvi to make a concrete business decision — include actual dollar amounts, percentages, and timeframes from real industry benchmarks.",
  "capabilities": ["Real functional capability this ${role.title} owns 1", "Capability 2", "Capability 3"],
  "metrics": ["Specific named KPI with measured outcome grounded in real data, e.g. Return on Capability Investment (ROCI): 340%", "Metric 2 with number", "Metric 3 with number", "Metric 4 with number", "Metric 5 with number"]
}`;

        const message = await maybeStepAiWrap(`anthropic:csuite-perspective:${role.id}`, () =>
          anthropic.messages.create({
            model: rm("claude-sonnet-4-6"),
            max_tokens: 1024,
            messages: [{ role: "user", content: sonnetPrompt }],
          }),
        );

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
  async ({ industrySlug, force }) => {
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterKey) return JSON.stringify({ success: false, error: "OPENROUTER_API_KEY not configured" });

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
    if (allFresh && !force) return JSON.stringify({ success: true, skipped: true, reason: "Content is fresh" });

    const capSummaries = allCaps.map(c =>
      `- ${c.name} (slug: ${c.slug}): Traditional view: "${c.traditionalView}" | Economic view: "${c.economicView}" | Benchmark: ${c.benchmarkScore}/100`
    ).join("\n");

    const researchContext = await perplexityContextSearch(
      `Provide real-world benchmarks, ROI data, and case study evidence for capability economics in the ${industry.name} industry (2023-2026). Specifically cover: (1) ${allCaps[0]?.name} — measurable outcomes, KPIs, cost reductions, revenue impacts; (2) ${allCaps[1]?.name} — measurable outcomes, KPIs, NPS impacts, efficiency gains. Include specific percentages, dollar amounts, and named metrics from real insurers or comparable companies.`,
      "case-study-generator",
    );

    const contextSection = researchContext
      ? `\nPERPLEXITY RESEARCH CONTEXT (real benchmarks to ground your response):\n${researchContext}\n`
      : "";

    const prompt = `You are a Inflexcvi consultant specialising in the ${industry.name} industry. Generate a detailed, credible case study grounded in real data.

Top capabilities from our database:
${capSummaries}
${contextSection}
Use the research context above to ensure metrics and ROI data reflect real ${industry.name} industry benchmarks.

CRITICAL FORMAT RULES for each metric — these are non-negotiable:
- "value" MUST be ≤ 40 characters. It is rendered as a scoreboard headline cell.
  GOOD: "Reduced from 48h to 2h", "Improved by 4.2%", "+$25M per $1B", "20–35% improvement", "Decreased by 65%", "+28 points post-claim", "Reduced by $12M/yr"
  BAD (too long, do NOT write like this): "Up to $25M incremental revenue per $1B vs. lower-maturity peers", "FCR improvement of 20–35% when service staff are equipped with unified order and customer data"
- "detail" carries the source, methodology, and elaboration. ≤ 180 chars, one sentence. Put benchmark names, sample sizes, comparison cohorts, and qualifying conditions HERE — never in "value".
  GOOD detail: "Manhattan Associates / Incisiv Unified Commerce Benchmark 2026, n=250 retailers; leading-maturity vs. lower-maturity peers"
- "name" is the KPI label. Title-case, ≤ 50 chars.
- "trend" is "up", "down", or "neutral".

Return ONLY valid JSON:
{
  "capabilities": [
    {
      "capabilitySlug": "${allCaps[0]?.slug}",
      "capabilityName": "${allCaps[0]?.name}",
      "description": "2 sentence description of the economic value of this capability in ${industry.name}.",
      "traditionalView": "How firms historically viewed this capability as a cost center.",
      "economicView": "How Inflexcvi reframes it as a quantifiable revenue and value driver.",
      "metrics": [
        {"name": "<≤50c KPI Name>", "value": "<≤40c outcome, no citations>", "detail": "<≤180c source + methodology>", "trend": "up"},
        {"name": "<≤50c KPI Name>", "value": "<≤40c outcome, no citations>", "detail": "<≤180c source + methodology>", "trend": "down"},
        {"name": "<≤50c KPI Name>", "value": "<≤40c outcome, no citations>", "detail": "<≤180c source + methodology>", "trend": "up"}
      ]
    },
    {
      "capabilitySlug": "${allCaps[1]?.slug}",
      "capabilityName": "${allCaps[1]?.name}",
      "description": "2 sentence description.",
      "traditionalView": "Traditional view as cost.",
      "economicView": "Economic reframe as value.",
      "metrics": [
        {"name": "<≤50c>", "value": "<≤40c>", "detail": "<≤180c>", "trend": "up"},
        {"name": "<≤50c>", "value": "<≤40c>", "detail": "<≤180c>", "trend": "up"},
        {"name": "<≤50c>", "value": "<≤40c>", "detail": "<≤180c>", "trend": "down"}
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

All ROI numbers are $M. Metrics must be real ${industry.name} KPIs grounded in the research context above. Value generated should show compelling compounding ROI. If you violate the 40-char "value" cap, the response is invalid.`;

    try {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 180_000);
      let gResp: Response;
      try {
        const modelName = process.env.LLM_MODEL || "anthropic/claude-sonnet-4.6";
        gResp = await maybeStepAiWrap(`openrouter:capability-research:${modelName}`, () =>
          fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${openrouterKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://inflexcvi.ai",
              "X-Title": "Inflexcvi",
            },
            body: JSON.stringify({
              model: modelName,
              max_tokens: 4096,
              messages: [{ role: "user", content: prompt }],
              usage: { include: true },
            }),
            signal: controller.signal,
          }),
        );
      } finally {
        clearTimeout(abortTimer);
      }
      const gData = (await gResp.json()) as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
      if (gData.error) throw new Error(gData.error.message);
      const text = gData.choices?.[0]?.message?.content ?? "";
      const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");

      const parsed = JSON.parse(jsonMatch[0]) as {
        capabilities: Array<{
          capabilitySlug: string;
          capabilityName: string;
          description: string;
          traditionalView: string;
          economicView: string;
          metrics: Array<{ name: string; value: string; trend: "up" | "down" | "neutral"; detail?: string }>;
        }>;
        roiData: Array<{ year: string; traditionalCost: number; capabilityCost: number; valueGenerated: number }>;
      };

      const oversizeValues = parsed.capabilities.flatMap(c =>
        c.metrics.filter(m => !m.value || m.value.length > 40).map(m => `${c.capabilityName} / ${m.name}: "${m.value}" (${m.value?.length ?? 0}c)`)
      );
      if (oversizeValues.length > 0) {
        return JSON.stringify({ success: false, error: `LLM violated value-length contract (≤40c): ${oversizeValues.join("; ")}` });
      }

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
      force: z.boolean().optional().describe("If true, bypass the staleness check and regenerate even when content is fresh"),
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
      capabilityId: cviComponentsTable.capabilityId,
      consensusScore: cviComponentsTable.consensusScore,
      velocity: cviComponentsTable.velocity,
    }).from(cviComponentsTable).where(eq(cviComponentsTable.industryId, industry.id));

    const compMap = new Map(components.map(c => [c.capabilityId, c]));
    const capSummary = caps.map(c => {
      const comp = compMap.get(c.id);
      const score = comp?.consensusScore ?? c.benchmarkScore;
      const velocity = comp?.velocity ?? 0;
      return `- ${c.name}: score ${score}/100, trend ${velocity >= 0 ? "+" : ""}${velocity.toFixed(1)}/mo. ${c.economicView}`;
    }).join("\n");

    const researchContext = await perplexityContextSearch(
      `What are the most urgent capability gaps, market disruptions, and strategic opportunities facing the ${industry.name} industry in 2024-2026? Include specific companies, percentages, dollar amounts, and real analyst data from McKinsey, Gartner, Deloitte, or Forrester. Focus on operational risks and economic impact.`,
      "insights-generator",
    );

    // ── AI-FIRST: Pull institutional memory from Mem0 ──────────────────────
    // Recall the agent's accumulated patterns and validated observations about
    // this industry. These represent months of research cycles distilled into
    // high-confidence signals that ground insights beyond current-cycle data.
    let mem0PatternContext = "";
    try {
      const [industryPatterns, validatedPatterns, contradictions] = await Promise.all([
        recallMemories(`${industry.name} capability patterns trends observations`, "pattern", 8),
        recallMemories(`${industry.name} validated confirmed signal`, "pattern", 4),
        recallMemories(`${industry.name} contradiction reversal unexpected`, "pattern", 3),
      ]);
      const allPatterns = [...new Map(
        [...industryPatterns, ...validatedPatterns, ...contradictions].map(m => [m.mem0Id ?? m.id, m])
      ).values()].slice(0, 12);
      if (allPatterns.length > 0) {
        mem0PatternContext = `\nINSTITUTIONAL MEMORY (${allPatterns.length} validated patterns from prior research cycles):\n` +
          allPatterns.map(m =>
            `- [${m.category ?? m.memoryType}] ${m.content}` +
            (m.relevanceScore ? ` (confidence: ${(m.relevanceScore * 100).toFixed(0)}%)` : "")
          ).join("\n");
      }
    } catch (memErr) {
      // Non-fatal — insights still generate without historical context
      console.warn("[generateInsightsTool] Mem0 recall failed:", memErr instanceof Error ? memErr.message : memErr);
    }

    // ── AI-FIRST: Pull graph correlations from Neo4j ───────────────────────
    // findCorrelations traverses the capability relationship graph to surface
    // structural co-dependencies observed across research cycles. This reveals
    // which capabilities move together and which are upstream blockers.
    let graphCorrelationContext = "";
    try {
      const topCapsByScore = caps
        .map(c => ({ ...c, score: compMap.get(c.id)?.consensusScore ?? c.benchmarkScore ?? 0 }))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 5);
      const correlationResults = await Promise.all(
        topCapsByScore.map(c => findCorrelations(industry.id, c.id, 2).catch(() => []))
      );
      const allCorrelations = correlationResults.flat()
        .sort((a, b) => b.observedCount - a.observedCount)
        .slice(0, 10);
      if (allCorrelations.length > 0) {
        graphCorrelationContext = `\nGRAPH INTELLIGENCE (capability co-occurrence patterns from ${allCorrelations.length} observed relationships):\n` +
          allCorrelations.map(r =>
            `- ${r.fromName} ↔ ${r.toName}: observed ${r.observedCount}x, relationship strength ${(r.weight * 100).toFixed(0)}% [${r.kind}]`
          ).join("\n");
      }
    } catch (graphErr) {
      console.warn("[generateInsightsTool] Neo4j correlation fetch failed:", graphErr instanceof Error ? graphErr.message : graphErr);
    }

    const prompt = `You are a Inflexcvi advisor analyzing the ${industry.name} industry using real market data, institutional memory, and graph intelligence.

Current capability scores:
${capSummary}

PERPLEXITY RESEARCH (use this to ground insights in real data):
${researchContext}${mem0PatternContext}${graphCorrelationContext}

Generate exactly 4 strategic insights. Each insight MUST:
1. Reference specific data points from the Perplexity research
2. Where relevant, reference patterns from Institutional Memory to show whether this is a new signal or a confirmed trend
3. Where relevant, reference Graph Intelligence to explain structural co-dependencies (e.g. "improving X requires first addressing Y")

Return ONLY valid JSON array:
[
  {
    "title": "Concise insight title (max 12 words)",
    "content": "2-3 sentences with specific data points, percentages, dollar amounts from the research. Reference real companies or analyst data. If a pattern from Institutional Memory confirms or contradicts this, cite it.",
    "recommendation": "1-2 sentences with a specific, actionable recommendation including timeline and measurable target. If graph co-dependencies exist, name the upstream capability that must be addressed first.",
    "severity": "critical" | "warning" | "info",
    "capabilityFocus": "name of the most relevant capability from the list above",
    "evidenceSources": ["perplexity", "institutional_memory", "graph_intelligence"] // include only sources actually used
  }
]

Severity rules: "critical" = immediate revenue or operational risk, "warning" = 6-month strategic concern, "info" = growth opportunity. Use at least 1 critical and 1 info.`;

    try {
      const message = await maybeStepAiWrap(`anthropic:insights:${industry.slug}`, () =>
        anthropic.messages.create({
          model: rm("claude-haiku-4-5"),
          max_tokens: 2048,
          messages: [{ role: "user", content: prompt }],
        }),
      );
      const text = message.content[0].type === "text" ? message.content[0].text : "";
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("No JSON array in response");

      const insights = JSON.parse(jsonMatch[0]) as Array<{
        title: string; content: string; recommendation: string; severity: string; capabilityFocus?: string;
      }>;

      const capNameMap = new Map(caps.map(c => [c.name, c.id]));

      await db.delete(capabilityInsightsTable).where(eq(capabilityInsightsTable.industryId, industry.id));

      // Insert and capture the new rows so we can emit a
      // `agent.insight.created` Inngest event per insight — the event-driven
      // recommendation-feedback function listens on this event and sleeps
      // 60 days before scoring the recommendation's CVI outcome.
      const insertedRows = (await Promise.all(insights.map(insight => {
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
        }).returning({ id: capabilityInsightsTable.id, generatedAt: capabilityInsightsTable.generatedAt });
      }))).flat();

      // Fire-and-forget: don't fail the tool if Inngest is unreachable. Only
      // emit for rows that actually carry a recommendation — feedback scoring
      // is a no-op without one.
      const eventsToSend = insertedRows
        .map((row, idx) => ({ row, recommendation: insights[idx]?.recommendation }))
        .filter(({ recommendation }) => Boolean(recommendation))
        .map(({ row }) => ({
          name: "agent.insight.created",
          // Idempotency: an agent retry that re-emits the same insight id
          // must not double-schedule the 60-day recommendationFeedback
          // sleeper. insightId is unique-per-row in capability_insights.
          id: `agent.insight.created:${row.id}`,
          data: {
            insightId: row.id,
            industrySlug,
            createdAt: (row.generatedAt ?? new Date()).toISOString(),
          },
        }));
      if (eventsToSend.length > 0) {
        inngest.send(eventsToSend).catch(err => {
          console.warn("[generateInsightsTool] inngest.send failed (non-fatal):", err instanceof Error ? err.message : err);
        });
      }

      return JSON.stringify({ success: true, industry: industrySlug, insightsGenerated: insertedRows.length });
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
      `Who are the top 4-5 companies in the ${industry.name} industry ranked by operational capability maturity, digital transformation, and innovation investment in 2024-2026? Include specific capability strengths and weaknesses, maturity scores, investment levels, and whether they are improving or declining. Use real data from analyst reports.`,
      "leaderboard-generator",
    );

    const prompt = `You are a Inflexcvi analyst. Based on this research, generate a leaderboard of the top companies in ${industry.name}.

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
      const message = await maybeStepAiWrap(`anthropic:leaderboard:${industry.slug}`, () =>
        anthropic.messages.create({
          model: rm("claude-haiku-4-5"),
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
      );
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
      `What are the most important and cited industry research reports, white papers, and analyst publications on capability maturity, digital transformation ROI, and operational excellence in the ${industry.name} sector published 2022-2026? Include actual titles, authors, organizations (McKinsey, Gartner, Deloitte, Forrester, Accenture, BCG, WEF, etc.) and key findings.`,
      "white-papers-generator",
    );

    const prompt = `You are a research librarian for a Inflexcvi platform. Generate 3 real research paper entries for the ${industry.name} industry.

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
      const message = await maybeStepAiWrap(`anthropic:white-papers:${industry.slug}`, () =>
        anthropic.messages.create({
          model: rm("claude-haiku-4-5"),
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
      );
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
      `How do these ${industry.name} industry capabilities relate to each other in practice? Which capabilities enable others, which depend on others, which compete for investment, and which can substitute for each other? Capabilities: ${capNames}. Focus on real strategic and operational dependencies used by industry leaders.`,
      "ontology-adapter",
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
      const dsResp = await maybeStepAiWrap(`openrouter:ontology-relationships:${industry.slug}`, () =>
        fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://inflexcvi.ai",
            "X-Title": "Inflexcvi",
          },
          body: JSON.stringify({
            model: "deepseek/deepseek-chat",
            max_tokens: 4096,
            messages: [{ role: "user", content: relationshipsPrompt }],
            usage: { include: true },
          }),
        }),
      );
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

/**
 * DVX disruption generator. Given a capability + industry context, asks
 * Claude (via the fallback chain) to (a) identify 2-5 emerging innovations
 * that could disrupt it within 36 months and (b) classify against the
 * disruption_patterns library (Uber/Airbnb/Stripe/SpaceX/...) returning a
 * Bayesian match confidence 0-1.
 *
 * Output is consumed by services/dvx-engine.ts to compute the Pattern
 * Match Confidence factor (30% of the DVX score) and to populate
 * dvx_components.top_disruptors for the capability detail UI.
 */
export const generateDisruptorsTool = tool(
  async ({ capabilityId, capabilityName, industryName, cviScore, velocity }) => {
    try {
      const patterns = await db.select({
        slug: disruptionPatternsTable.slug,
        title: disruptionPatternsTable.title,
        headline: disruptionPatternsTable.headline,
      }).from(disruptionPatternsTable);
      const patternMenu = patterns.map(p => `  - ${p.slug}: ${p.title} — ${p.headline}`).join("\n");

      const prompt = [
        `You are a capability strategy analyst with deep pattern recognition for disruption events.`,
        ``,
        `Capability under analysis: "${capabilityName}" in the ${industryName} industry.`,
        `Current CVI score: ${cviScore?.toFixed?.(1) ?? "unknown"} (0-1000 scale).`,
        `Velocity: ${velocity?.toFixed?.(2) ?? "unknown"} (change per cycle).`,
        ``,
        `Identify 2 to 5 emerging innovations or technologies that could DISRUPT, BYPASS, or ELIMINATE this capability within the next 36 months.`,
        `Do not suggest incremental improvements. We are looking for "Uber moments" / "Stripe moments" / "SpaceX moments" — innovations that make the incumbent capability economically non-competitive, not just slightly worse.`,
        ``,
        `Disruption pattern library to classify against:`,
        patternMenu,
        ``,
        `Pick the ONE pattern (slug) whose structure best matches what's happening to this capability today. Return Bayesian confidence (0-1) that the pattern actually applies — be honest, low confidence is fine if no pattern fits cleanly.`,
        ``,
        `Return JSON only, no prose:`,
        `{`,
        `  "disruptors": ["<innovation 1>", "<innovation 2>", ...],  // 2-5 items, no incremental ones`,
        `  "patternMatchSlug": "<one of the slugs above>",`,
        `  "patternMatchConfidence": <0-1>,`,
        `  "rationale": "<2-3 sentences explaining the disruption thesis>",`,
        `  "recommendedAction": "<one of: 'Investigate and build production-ready pilots', 'Watch this space', 'Defensive M&A target', 'Already disrupted'>"`,
        `}`,
      ].join("\n");

      const result = await chatWithFallback({
        messages: [{ role: "user", content: prompt }],
        models: EDITORIAL_FALLBACK_CHAIN,
        responseFormat: { type: "json_object" },
        maxTokens: 1024,
        endpoint: "generate_disruptors",
      });

      const raw = result.text.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim();
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("LLM returned non-JSON");
      const parsed = JSON.parse(match[0]) as {
        disruptors: string[];
        patternMatchSlug: string;
        patternMatchConfidence: number;
        rationale: string;
        recommendedAction: string;
      };

      // Validate pattern slug exists; null it if hallucinated
      const validSlugs = new Set(patterns.map(p => p.slug));
      const slug = validSlugs.has(parsed.patternMatchSlug) ? parsed.patternMatchSlug : null;

      return JSON.stringify({
        success: true,
        capabilityId,
        disruptors: Array.isArray(parsed.disruptors) ? parsed.disruptors.slice(0, 5) : [],
        patternMatchSlug: slug,
        patternMatchConfidence: typeof parsed.patternMatchConfidence === "number"
          ? Math.max(0, Math.min(1, parsed.patternMatchConfidence))
          : 0,
        rationale: parsed.rationale ?? "",
        recommendedAction: parsed.recommendedAction ?? "Watch this space",
      });
    } catch (err) {
      return JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  {
    name: "generate_disruptors",
    description: "For a target capability, generate 2-5 emerging innovations that could disrupt it within 36 months and classify against the disruption pattern library (Uber/Airbnb/Stripe/SpaceX/...). Returns disruptor names + matched pattern slug + Bayesian confidence + recommended action. Used by the DVX engine to compute Pattern Match Confidence (30% of disruption score).",
    schema: z.object({
      capabilityId: z.number().describe("ID of the capability to analyze"),
      capabilityName: z.string().describe("Name of the capability"),
      industryName: z.string().describe("Industry context"),
      cviScore: z.number().optional().describe("Current CVI score (0-1000)"),
      velocity: z.number().optional().describe("Current CVI velocity"),
    }),
  },
);

export const allTools = [
  perplexityResearchTool,
  queryDatabaseTool,
  queryGraphTool,
  cypherGraphTool,
  computeCVITool,
  recallMemoriesTool,
  storeMemoryTool,
  generateCsuitePerspectivesTool,
  generateCaseStudyContentTool,
  generateInsightsTool,
  generateLeaderboardTool,
  generateWhitePapersTool,
  generateOntologyTool,
  generateDisruptorsTool,
];
