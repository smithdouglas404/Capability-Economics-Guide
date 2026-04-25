/**
 * Enrichment agent tools — OpenAI/Anthropic-compatible tool schemas plus
 * their executors. Each executor wraps an existing enrichment function so the
 * agent can call exactly the same code paths the "Rerun economics" button uses.
 *
 * Tools intentionally accept *intent-level* arguments (industryId, capabilityId)
 * so the LLM doesn't have to know about quadrant/value-chain/company internals.
 * Every executor is wrapped in try/catch and returns a JSON-string envelope
 * `{ ok, ... }` — the loop never throws past the agent.
 */

import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  capabilityEconomicsTable,
  capabilityQuadrantsTable,
  valueChainStagesTable,
  companyCapabilityProfilesTable,
} from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import {
  enrichCapabilityQuadrants,
  enrichValueChainStages,
  enrichCompanyProfiles,
} from "./index";
import { runAlphaEnrichment, runDetailEnrichment } from "../alpha/enrich";
import { recallMemories, storeMemory } from "../agent/memory";

// OpenAI/Anthropic tool format — OpenRouter accepts this directly when
// proxying to Claude.
export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

// Tool executor signature — receives parsed args, the runId for the current
// graph invocation, and an emit hook for streaming progress to SSE.
export type ToolExecutor = (
  args: Record<string, unknown>,
  ctx: { runId: number; emit: (event: string, payload: Record<string, unknown>) => void },
) => Promise<string>;

// ─────────────────────────────────────────────────────────────────────────
// Schemas — these are what the LLM sees
// ─────────────────────────────────────────────────────────────────────────

export const toolSchemas: ToolSchema[] = [
  {
    type: "function",
    function: {
      name: "query_database",
      description:
        "Read current enrichment state. Use this first to decide what's missing or stale. " +
        "queryType: 'industries' lists all industries; 'capabilities' lists caps in an industry; " +
        "'enrichment_status' summarises which caps have economics rows / quadrants / value chain / companies.",
      parameters: {
        type: "object",
        properties: {
          queryType: {
            type: "string",
            enum: ["industries", "capabilities", "enrichment_status"],
          },
          industryId: { type: "number", description: "Industry to scope the query to (optional for 'industries')" },
        },
        required: ["queryType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "classify_quadrants",
      description:
        "Run quadrant classification (hot / emerging / cooling / table_stakes) for every capability " +
        "in an industry. Populates capability_quadrants with economic_impact_score, adoption_momentum, " +
        "disruption_intensity, rationale. Uses Perplexity research + GLM 5.1 synthesis. ~1–2 minutes.",
      parameters: {
        type: "object",
        properties: { industryId: { type: "number" } },
        required: ["industryId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "map_value_chain",
      description:
        "Generate 6–8 value-chain stages for an industry. Populates value_chain_stages with sector " +
        "counts, HHI, patent/startup/capital flows, shifts, risks, and key companies. ~1–2 minutes.",
      parameters: {
        type: "object",
        properties: { industryId: { type: "number" } },
        required: ["industryId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "discover_companies",
      description:
        "Find 15–25 leading companies for an industry's capabilities and map them to capabilities " +
        "with FEVI/CDI scores. Populates company_capability_profiles + company_capability_mappings.",
      parameters: {
        type: "object",
        properties: { industryId: { type: "number" } },
        required: ["industryId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_economic_alpha",
      description:
        "Run the SAME function the 'Rerun economic' button uses — alpha enrichment. Inserts " +
        "capability_economics rows (TAM, EVaR inputs, half-life, margin structure, sources) and " +
        "scores dependency edges. Picks the top-N un-enriched capabilities ranked by economic impact. " +
        "Use industryId to scope; use limitCapabilities to bound batch size (default 12).",
      parameters: {
        type: "object",
        properties: {
          industryId: { type: "number" },
          limitCapabilities: { type: "number", description: "Max capabilities to enrich this call (default 12)" },
          limitEdges: { type: "number", description: "Max dependency edges to score (default 15)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_economic_detail",
      description:
        "Second half of the 'Rerun economic' flow — narrative enrichment. Fills the UI-rendered " +
        "fields: Traditional View, Economic View, Key Metrics with benchmarks, dependencies rationale, " +
        "C-suite relevance, this-week's playbook, AI exposure narrative. Either pass capabilityId for " +
        "a single cap or limit/force for a batch.",
      parameters: {
        type: "object",
        properties: {
          capabilityId: { type: "number" },
          limit: { type: "number", description: "Batch size when capabilityId not set (default 6)" },
          force: { type: "boolean", description: "Re-run even if already enriched" },
          revisionGuidance: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall_memories",
      description:
        "Retrieve learned patterns from prior enrichment runs (Mem0 + local DB). Useful before " +
        "deciding what to enrich — prior runs may have flagged industries that produced bad data " +
        "or capabilities that need force=true.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query — what kind of memory" },
          category: {
            type: "string",
            enum: ["capability_signal", "industry_trend", "contradiction", "validated_pattern", "decision", "observation"],
          },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "store_memory",
      description:
        "Save a learned pattern for future runs (e.g., 'Insurance value chain consistently returns " +
        "fewer than 6 stages, may need a different prompt'). Categorise to make recall predictable.",
      parameters: {
        type: "object",
        properties: {
          content: { type: "string" },
          type: { type: "string", enum: ["pattern", "observation", "insight", "decision_context"] },
          category: { type: "string", enum: ["capability_signal", "industry_trend", "contradiction", "validated_pattern", "decision", "observation"] },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description:
        "Call when all required enrichment is done for the current run. Always include a summary " +
        "describing what was enriched and what (if anything) failed.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Executors — keyed by tool name
// ─────────────────────────────────────────────────────────────────────────

export const toolExecutors: Record<string, ToolExecutor> = {
  query_database: async (args) => {
    const queryType = String(args.queryType ?? "");
    const industryId = typeof args.industryId === "number" ? args.industryId : undefined;
    try {
      if (queryType === "industries") {
        const rows = await db.select().from(industriesTable);
        return JSON.stringify({ ok: true, industries: rows.map(i => ({ id: i.id, name: i.name, slug: i.slug })) });
      }
      if (queryType === "capabilities") {
        if (!industryId) return JSON.stringify({ ok: false, error: "industryId required" });
        const rows = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId));
        return JSON.stringify({ ok: true, capabilities: rows.map(c => ({ id: c.id, name: c.name, benchmarkScore: c.benchmarkScore })) });
      }
      if (queryType === "enrichment_status") {
        // Per-industry tally of: total caps, caps with economics row, caps with quadrant, value-chain stages, companies
        const where = industryId ? eq(capabilitiesTable.industryId, industryId) : undefined;
        const caps = where
          ? await db.select().from(capabilitiesTable).where(where)
          : await db.select().from(capabilitiesTable);
        const capIds = caps.map(c => c.id);
        if (capIds.length === 0) return JSON.stringify({ ok: true, status: { totalCapabilities: 0 } });

        const econ = await db
          .select({ capabilityId: capabilityEconomicsTable.capabilityId, generatedAt: capabilityEconomicsTable.generatedAt })
          .from(capabilityEconomicsTable);
        const econByCapId = new Map(econ.map(e => [e.capabilityId, e]));

        const quad = await db
          .select({ capabilityId: capabilityQuadrantsTable.capabilityId })
          .from(capabilityQuadrantsTable);
        const quadCapIds = new Set(quad.map(q => q.capabilityId));

        const vcCount = industryId
          ? await db.select({ c: sql<number>`count(*)::int` }).from(valueChainStagesTable).where(eq(valueChainStagesTable.industryId, industryId))
          : await db.select({ c: sql<number>`count(*)::int` }).from(valueChainStagesTable);
        const compCount = industryId
          ? await db.select({ c: sql<number>`count(*)::int` }).from(companyCapabilityProfilesTable).where(eq(companyCapabilityProfilesTable.industryId, industryId))
          : await db.select({ c: sql<number>`count(*)::int` }).from(companyCapabilityProfilesTable);

        return JSON.stringify({
          ok: true,
          status: {
            totalCapabilities: caps.length,
            withEconomics: caps.filter(c => econByCapId.has(c.id)).length,
            withoutEconomics: caps.filter(c => !econByCapId.has(c.id)).length,
            withQuadrant: caps.filter(c => quadCapIds.has(c.id)).length,
            valueChainStages: Number(vcCount[0]?.c ?? 0),
            companies: Number(compCount[0]?.c ?? 0),
            sampleMissing: caps.filter(c => !econByCapId.has(c.id)).slice(0, 8).map(c => ({ id: c.id, name: c.name, industryId: c.industryId })),
          },
        });
      }
      return JSON.stringify({ ok: false, error: `unknown queryType ${queryType}` });
    } catch (err) {
      return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "query failed" });
    }
  },

  classify_quadrants: async (args, { runId, emit }) => {
    const industryId = Number(args.industryId);
    if (!Number.isFinite(industryId)) return JSON.stringify({ ok: false, error: "industryId required" });
    const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId));
    if (!industry) return JSON.stringify({ ok: false, error: `industry ${industryId} not found` });
    const caps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId));
    const capList = caps.map(c => ({ id: c.id, name: c.name, benchmarkScore: c.benchmarkScore }));
    emit("tool.classify_quadrants.start", { industryId, industryName: industry.name, capabilityCount: capList.length });
    try {
      const r = await enrichCapabilityQuadrants(industryId, industry.name, capList, runId);
      emit("tool.classify_quadrants.complete", { industryId, classified: r.classified, errorCount: r.errors.length });
      return JSON.stringify({ ok: true, industryId, industryName: industry.name, classified: r.classified, errors: r.errors });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "classify failed";
      emit("tool.classify_quadrants.error", { industryId, error: msg });
      return JSON.stringify({ ok: false, error: msg });
    }
  },

  map_value_chain: async (args, { runId, emit }) => {
    const industryId = Number(args.industryId);
    if (!Number.isFinite(industryId)) return JSON.stringify({ ok: false, error: "industryId required" });
    const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId));
    if (!industry) return JSON.stringify({ ok: false, error: `industry ${industryId} not found` });
    const caps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId));
    const capList = caps.map(c => ({ id: c.id, name: c.name }));
    emit("tool.map_value_chain.start", { industryId, industryName: industry.name });
    try {
      const r = await enrichValueChainStages(industryId, industry.name, capList, runId);
      emit("tool.map_value_chain.complete", { industryId, stagesCreated: r.created, errorCount: r.errors.length });
      return JSON.stringify({ ok: true, industryId, industryName: industry.name, stagesCreated: r.created, errors: r.errors });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "value chain failed";
      emit("tool.map_value_chain.error", { industryId, error: msg });
      return JSON.stringify({ ok: false, error: msg });
    }
  },

  discover_companies: async (args, { runId, emit }) => {
    const industryId = Number(args.industryId);
    if (!Number.isFinite(industryId)) return JSON.stringify({ ok: false, error: "industryId required" });
    const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId));
    if (!industry) return JSON.stringify({ ok: false, error: `industry ${industryId} not found` });
    const caps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId));
    const capList = caps.map(c => ({ id: c.id, name: c.name }));
    emit("tool.discover_companies.start", { industryId, industryName: industry.name });
    try {
      const r = await enrichCompanyProfiles(industryId, industry.name, capList, runId);
      emit("tool.discover_companies.complete", { industryId, profiled: r.profiled, mapped: r.mapped, errorCount: r.errors.length });
      return JSON.stringify({ ok: true, industryId, industryName: industry.name, profiled: r.profiled, mapped: r.mapped, errors: r.errors });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "discover companies failed";
      emit("tool.discover_companies.error", { industryId, error: msg });
      return JSON.stringify({ ok: false, error: msg });
    }
  },

  run_economic_alpha: async (args, { emit }) => {
    const industryId = typeof args.industryId === "number" ? args.industryId : undefined;
    const limitCapabilities = typeof args.limitCapabilities === "number" ? args.limitCapabilities : undefined;
    const limitEdges = typeof args.limitEdges === "number" ? args.limitEdges : undefined;
    emit("tool.run_economic_alpha.start", { industryId, limitCapabilities, limitEdges });
    try {
      const r = await runAlphaEnrichment({ industryId, limitCapabilities, limitEdges });
      emit("tool.run_economic_alpha.complete", {
        industryId,
        capabilitiesEnriched: r.capabilitiesEnriched,
        edgesEnriched: r.edgesEnriched,
        errorCount: r.errors.length,
        durationMs: r.durationMs,
      });
      return JSON.stringify({
        ok: true,
        industryId,
        capabilitiesEnriched: r.capabilitiesEnriched,
        edgesEnriched: r.edgesEnriched,
        durationMs: r.durationMs,
        errors: r.errors.slice(0, 10),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "alpha failed";
      emit("tool.run_economic_alpha.error", { industryId, error: msg });
      return JSON.stringify({ ok: false, error: msg });
    }
  },

  run_economic_detail: async (args, { emit }) => {
    const capabilityId = typeof args.capabilityId === "number" ? args.capabilityId : undefined;
    const limit = typeof args.limit === "number" ? args.limit : undefined;
    const force = args.force === true;
    const revisionGuidance = typeof args.revisionGuidance === "string" ? args.revisionGuidance : undefined;
    emit("tool.run_economic_detail.start", { capabilityId, limit, force });
    try {
      const r = await runDetailEnrichment({ capabilityId, limit, force, revisionGuidance });
      emit("tool.run_economic_detail.complete", {
        capabilityId,
        enriched: r.enriched,
        errorCount: r.errors.length,
        durationMs: r.durationMs,
      });
      return JSON.stringify({ ok: true, capabilityId, enriched: r.enriched, durationMs: r.durationMs, errors: r.errors.slice(0, 10) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "detail failed";
      emit("tool.run_economic_detail.error", { capabilityId, error: msg });
      return JSON.stringify({ ok: false, error: msg });
    }
  },

  recall_memories: async (args, { emit }) => {
    const query = String(args.query ?? "");
    const category = typeof args.category === "string" ? args.category : undefined;
    const limit = typeof args.limit === "number" ? args.limit : 5;
    emit("tool.recall_memories.start", { query, category, limit });
    try {
      const memories = await recallMemories(query, undefined, limit, category ? { category: category as Parameters<typeof recallMemories>[3] extends infer T ? T extends { category?: infer C } ? C : never : never } : undefined);
      emit("tool.recall_memories.complete", { count: memories.length });
      return JSON.stringify({
        ok: true,
        memories: memories.map(m => ({
          content: m.content,
          category: m.category,
          createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : m.createdAt,
          relevance: m.relevanceScore,
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "recall failed";
      emit("tool.recall_memories.error", { error: msg });
      return JSON.stringify({ ok: false, error: msg });
    }
  },

  store_memory: async (args, { runId, emit }) => {
    const content = String(args.content ?? "");
    const type = (typeof args.type === "string" ? args.type : "observation") as "pattern" | "observation" | "insight" | "decision_context";
    const category = typeof args.category === "string" ? args.category : undefined;
    if (!content) return JSON.stringify({ ok: false, error: "content required" });
    emit("tool.store_memory.start", { type, category });
    try {
      const m = await storeMemory(type, content, { runId }, { runId, category: category as Parameters<typeof storeMemory>[3] extends infer T ? T extends { category?: infer C } ? C : never : never });
      emit("tool.store_memory.complete", { id: m.id });
      return JSON.stringify({ ok: true, id: m.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "store failed";
      emit("tool.store_memory.error", { error: msg });
      return JSON.stringify({ ok: false, error: msg });
    }
  },

  finish: async (args, { emit }) => {
    const summary = String(args.summary ?? "");
    emit("tool.finish", { summary });
    return JSON.stringify({ ok: true, finished: true, summary });
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Latest top-level enrichment_runs run id helper — exported for callers
// that want to query the row directly (e.g. UI or follow-up scripts).
// ─────────────────────────────────────────────────────────────────────────
export async function getLatestRunRow() {
  const [latest] = await db
    .select()
    .from(sql`enrichment_runs`)
    .orderBy(desc(sql`enrichment_runs.id`))
    .limit(1);
  return latest;
}
