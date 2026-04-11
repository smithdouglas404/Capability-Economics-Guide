import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  ceiComponentsTable,
  ceiSnapshotsTable,
  sourceTriangulationsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { triangulateCapability } from "../triangulation";
import { computeCEI } from "../cei-engine";
import { recallMemories, storeMemory } from "./memory";

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

export const allTools = [
  perplexityResearchTool,
  queryDatabaseTool,
  computeCEITool,
  recallMemoriesTool,
  storeMemoryTool,
];
