/**
 * Enrichment LangGraph — single agentic orchestrator that replaces the two
 * legacy pipelines (services/enrichment/index.ts + services/alpha/enrich.ts).
 *
 * Architecture:
 *   START → load → recall → [per industry: classify → valueChain → companies → alpha → detail]
 *         → reflect → memorize → finalize → END
 *
 * Reuses the existing agent infrastructure:
 *   - Mem0 + local-DB memory (services/agent/memory)
 *   - Letta blocks for persistent agent context (services/agent/letta)
 *   - SSE event stream for live admin UI (services/agent/events)
 *   - agentMemoriesTable + agentRunsTable for audit trail
 *
 * Per-node SSE events let the admin page render the live graph state
 * (which node is running, per-cap progress, errors) instead of a stale
 * "Run History" row that only updates at completion.
 */

import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  enrichmentRunsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  storeMemory,
  recallMemoriesBatch,
  type AgentMemory,
} from "../agent/memory";
import { lettaArchivalInsert, lettaUpdateBlock } from "../agent/letta";
import { emitAgentEvent } from "../agent/events";
import { logger } from "../../lib/logger";

// ── Per-industry sub-result (one entry per industry processed in this run) ──
type IndustryResult = {
  industryId: number;
  industryName: string;
  capabilityIds: number[];
  status: "pending" | "running" | "done" | "failed";
  currentNode: string;
  classified: number;
  valueChainStages: number;
  companiesProfiled: number;
  companiesMapped: number;
  alphaEnriched: number;
  detailEnriched: number;
  errors: string[];
};

const newIndustryResult = (id: number, name: string, capIds: number[] = []): IndustryResult => ({
  industryId: id,
  industryName: name,
  capabilityIds: capIds,
  status: "pending",
  currentNode: "queued",
  classified: 0,
  valueChainStages: 0,
  companiesProfiled: 0,
  companiesMapped: 0,
  alphaEnriched: 0,
  detailEnriched: 0,
  errors: [],
});

// ── Graph state shape ──
const EnrichmentState = Annotation.Root({
  runId: Annotation<number>({ default: () => 0, reducer: (_, n) => n }),
  trigger: Annotation<"scheduled" | "manual" | "rerun">({ default: () => "scheduled", reducer: (_, n) => n }),
  // Optional scoping — single-cap rerun or industry-scoped manual trigger
  targetCapabilityIds: Annotation<number[] | null>({ default: () => null, reducer: (_, n) => n }),
  targetIndustryIds: Annotation<number[] | null>({ default: () => null, reducer: (_, n) => n }),

  // Loaded by the `load` node
  industries: Annotation<Array<{ id: number; name: string; slug: string }>>({
    default: () => [],
    reducer: (_, n) => n,
  }),

  // Per-industry progress (keyed by industryId, updated by each per-industry node)
  perIndustry: Annotation<Record<number, IndustryResult>>({
    default: () => ({}),
    reducer: (prev, next) => ({ ...prev, ...next }),
  }),

  // Memories recalled at start of run; node implementations can filter per industry
  memories: Annotation<AgentMemory[]>({ default: () => [], reducer: (_, n) => n }),

  // Aggregate counters
  perplexityCalls: Annotation<number>({ default: () => 0, reducer: (a, b) => a + b }),
  glmCalls: Annotation<number>({ default: () => 0, reducer: (a, b) => a + b }),
  memoriesStored: Annotation<number>({ default: () => 0, reducer: (a, b) => a + b }),

  errors: Annotation<string[]>({ default: () => [], reducer: (a, b) => [...a, ...b] }),
  startedAt: Annotation<string>({ default: () => new Date().toISOString(), reducer: (_, n) => n }),
});

type State = typeof EnrichmentState.State;

// Helper to update one industry's result (immutable — returns the partial state to merge)
function updateIndustry(
  state: State,
  industryId: number,
  patch: Partial<IndustryResult>,
): { perIndustry: Record<number, IndustryResult> } {
  const existing = state.perIndustry[industryId] ?? newIndustryResult(industryId, "?");
  return { perIndustry: { [industryId]: { ...existing, ...patch } } };
}

function emit(node: string, runId: number, payload: Record<string, unknown> = {}) {
  emitAgentEvent({
    type: `enrichment.${node}`,
    runId,
    timestamp: new Date().toISOString(),
    ...payload,
  } as unknown as Parameters<typeof emitAgentEvent>[0]);
}

// ── Node: load — figure out what to enrich ──
async function loadNode(state: State): Promise<Partial<State>> {
  emit("load.start", state.runId);

  // Resolve target industries
  const industries = state.targetIndustryIds
    ? await db.select().from(industriesTable).where(inArray(industriesTable.id, state.targetIndustryIds))
    : await db.select().from(industriesTable);

  // Resolve target capabilities per industry
  const allCaps = state.targetCapabilityIds
    ? await db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, state.targetCapabilityIds))
    : await db.select().from(capabilitiesTable);

  const perIndustry: Record<number, IndustryResult> = {};
  for (const ind of industries) {
    const caps = allCaps.filter((c) => c.industryId === ind.id).map((c) => c.id);
    perIndustry[ind.id] = newIndustryResult(ind.id, ind.name, caps);
  }

  emit("load.complete", state.runId, { industries: industries.length, capabilities: allCaps.length });

  return {
    industries: industries.map((i) => ({ id: i.id, name: i.name, slug: i.slug })),
    perIndustry,
  };
}

// ── Node: recall — pull learned patterns from prior runs ──
async function recallNode(state: State): Promise<Partial<State>> {
  emit("recall.start", state.runId);
  let memories: AgentMemory[] = [];
  try {
    memories = await recallMemoriesBatch("pattern", 50);
  } catch (err) {
    logger.warn({ err }, "[enrichment-graph] recall failed; continuing without memories");
  }
  emit("recall.complete", state.runId, { memoriesRecalled: memories.length });
  return { memories };
}

// ── Node: per-industry orchestration (sequential) ──
// Each industry runs through 5 sub-stages. State updates emit per-cap events.
async function perIndustryNode(state: State): Promise<Partial<State>> {
  // Lazy-imported to avoid pulling the legacy modules into the graph file's
  // import cycle while we incrementally migrate. After the legacy code is
  // deleted (T37), these become normal imports.
  const legacyEnrichment = await import("./index");
  const legacyAlpha = await import("../alpha/enrich");

  let aggregatePerIndustry: Record<number, IndustryResult> = {};

  for (const industry of state.industries) {
    const industryResult = state.perIndustry[industry.id] ?? newIndustryResult(industry.id, industry.name);
    const industryCaps = await db
      .select()
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.industryId, industry.id));
    const capList = industryCaps.map((c) => ({ id: c.id, name: c.name, benchmarkScore: c.benchmarkScore }));

    const result: IndustryResult = { ...industryResult, status: "running" };
    aggregatePerIndustry = { ...aggregatePerIndustry, [industry.id]: result };

    // Stage 1 — classify quadrants (CE side)
    result.currentNode = "classify_quadrant";
    emit("industry.classify_quadrant.start", state.runId, { industryId: industry.id, industryName: industry.name });
    try {
      const r = await legacyEnrichment.enrichCapabilityQuadrants(industry.id, industry.name, capList, state.runId);
      result.classified += r.classified;
      result.errors.push(...r.errors);
    } catch (e) {
      result.errors.push(`classify_quadrant ${industry.name}: ${e}`);
    }
    emit("industry.classify_quadrant.complete", state.runId, { industryId: industry.id, classified: result.classified });

    // Stage 2 — value chain stages
    result.currentNode = "map_value_chain";
    emit("industry.map_value_chain.start", state.runId, { industryId: industry.id });
    try {
      const r = await legacyEnrichment.enrichValueChainStages(industry.id, industry.name, capList, state.runId);
      result.valueChainStages += r.created;
      result.errors.push(...r.errors);
    } catch (e) {
      result.errors.push(`map_value_chain ${industry.name}: ${e}`);
    }
    emit("industry.map_value_chain.complete", state.runId, { industryId: industry.id, stages: result.valueChainStages });

    // Stage 3 — company profiles + mappings
    result.currentNode = "discover_companies";
    emit("industry.discover_companies.start", state.runId, { industryId: industry.id });
    try {
      const r = await legacyEnrichment.enrichCompanyProfiles(industry.id, industry.name, capList, state.runId);
      result.companiesProfiled += r.profiled;
      result.companiesMapped += r.mapped;
      result.errors.push(...r.errors);
    } catch (e) {
      result.errors.push(`discover_companies ${industry.name}: ${e}`);
    }
    emit("industry.discover_companies.complete", state.runId, { industryId: industry.id, profiled: result.companiesProfiled, mapped: result.companiesMapped });

    // Stage 4 — economics alpha (TAM/EVaR/half-life + Street consensus quadrant)
    result.currentNode = "economics_alpha";
    emit("industry.economics_alpha.start", state.runId, { industryId: industry.id });
    try {
      const r = await legacyAlpha.runAlphaEnrichment({ industryId: industry.id });
      result.alphaEnriched += r.capabilitiesEnriched;
      result.errors.push(...r.errors);
    } catch (e) {
      result.errors.push(`economics_alpha ${industry.name}: ${e}`);
    }
    emit("industry.economics_alpha.complete", state.runId, { industryId: industry.id, enriched: result.alphaEnriched });

    // Stage 5 — economics detail (narrative columns the UI reads)
    result.currentNode = "economics_detail";
    emit("industry.economics_detail.start", state.runId, { industryId: industry.id });
    try {
      const r = await legacyAlpha.runDetailEnrichment({ force: false });
      result.detailEnriched += r.enriched;
      result.errors.push(...r.errors);
    } catch (e) {
      result.errors.push(`economics_detail ${industry.name}: ${e}`);
    }
    emit("industry.economics_detail.complete", state.runId, { industryId: industry.id, enriched: result.detailEnriched });

    result.status = result.errors.length > 0 ? "failed" : "done";
    result.currentNode = "done";
    aggregatePerIndustry = { ...aggregatePerIndustry, [industry.id]: { ...result } };
    emit("industry.complete", state.runId, { industryId: industry.id, result });
  }

  return { perIndustry: aggregatePerIndustry };
}

// ── Node: reflect — look for patterns across the industries we just enriched ──
async function reflectNode(state: State): Promise<Partial<State>> {
  emit("reflect.start", state.runId);
  // Lightweight reflection — count totals, identify which industries had
  // failures vs successes. The agent's own reflection logic could be plugged
  // in here later for cross-run pattern recognition.
  const totals = Object.values(state.perIndustry).reduce(
    (acc, r) => ({
      classified: acc.classified + r.classified,
      valueChain: acc.valueChain + r.valueChainStages,
      profiled: acc.profiled + r.companiesProfiled,
      mapped: acc.mapped + r.companiesMapped,
      alpha: acc.alpha + r.alphaEnriched,
      detail: acc.detail + r.detailEnriched,
      failed: acc.failed + (r.status === "failed" ? 1 : 0),
    }),
    { classified: 0, valueChain: 0, profiled: 0, mapped: 0, alpha: 0, detail: 0, failed: 0 },
  );
  emit("reflect.complete", state.runId, totals);
  return {};
}

// ── Node: memorize — store learned patterns + update Letta context ──
async function memorizeNode(state: State): Promise<Partial<State>> {
  emit("memorize.start", state.runId);
  let stored = 0;
  for (const result of Object.values(state.perIndustry)) {
    if (result.status !== "done") continue;
    try {
      await storeMemory(
        "observation",
        `Enriched ${result.industryName}: ${result.classified} quadrants, ${result.valueChainStages} value-chain stages, ${result.companiesProfiled} companies, ${result.alphaEnriched} economics rows, ${result.detailEnriched} narrative rows.`,
        {
          industryId: result.industryId,
          industryName: result.industryName,
          runId: state.runId,
        },
        { category: "industry_trend", runId: state.runId },
      );
      stored++;
    } catch (err) {
      logger.warn({ err, industryId: result.industryId }, "[enrichment-graph] memorize failed for industry");
    }
  }
  // Update Letta's persistent context with this run's summary
  try {
    const summary = Object.values(state.perIndustry)
      .map((r) => `${r.industryName}: ${r.alphaEnriched}+${r.detailEnriched} caps, ${r.errors.length} errors`)
      .join("; ");
    await lettaUpdateBlock("research_strategy", `Last enrichment run #${state.runId}: ${summary.slice(0, 1500)}`);
    await lettaArchivalInsert(`Enrichment cycle ${state.runId} completed: ${summary.slice(0, 1500)}`);
  } catch (err) {
    logger.warn({ err }, "[enrichment-graph] Letta update failed");
  }
  emit("memorize.complete", state.runId, { memoriesStored: stored });
  return { memoriesStored: stored };
}

// ── Node: finalize — close out the enrichment_runs row ──
async function finalizeNode(state: State): Promise<Partial<State>> {
  const totals = Object.values(state.perIndustry).reduce(
    (acc, r) => ({
      classified: acc.classified + r.classified,
      valueChain: acc.valueChain + r.valueChainStages,
      profiled: acc.profiled + r.companiesProfiled,
      mapped: acc.mapped + r.companiesMapped,
    }),
    { classified: 0, valueChain: 0, profiled: 0, mapped: 0 },
  );
  const allErrors = Object.values(state.perIndustry).flatMap((r) => r.errors);
  const status = allErrors.length === 0 ? "completed" : "completed_with_errors";
  try {
    await db.update(enrichmentRunsTable).set({
      completedAt: new Date(),
      quadrantsClassified: totals.classified,
      valueChainStagesCreated: totals.valueChain,
      companiesProfiled: totals.profiled,
      companyMappingsCreated: totals.mapped,
      durationMs: Date.now() - new Date(state.startedAt).getTime(),
      errors: allErrors.length > 0 ? allErrors : null,
      status,
    }).where(eq(enrichmentRunsTable.id, state.runId));
  } catch (err) {
    logger.error({ err, runId: state.runId }, "[enrichment-graph] finalize failed to update run record");
  }
  emit("finalize.complete", state.runId, { ...totals, status });
  return {};
}

// ── Compile the graph ──
const workflow = new StateGraph(EnrichmentState)
  .addNode("load", loadNode)
  .addNode("recall", recallNode)
  .addNode("per_industry", perIndustryNode)
  .addNode("reflect", reflectNode)
  .addNode("memorize", memorizeNode)
  .addNode("finalize", finalizeNode)
  .addEdge(START, "load")
  .addEdge("load", "recall")
  .addEdge("recall", "per_industry")
  .addEdge("per_industry", "reflect")
  .addEdge("reflect", "memorize")
  .addEdge("memorize", "finalize")
  .addEdge("finalize", END);

export const enrichmentGraph = workflow.compile();

// ── Public entry point ──
export async function runEnrichmentGraph(opts: {
  trigger?: "scheduled" | "manual" | "rerun";
  targetCapabilityIds?: number[];
  targetIndustryIds?: number[];
} = {}): Promise<{ runId: number; perIndustry: Record<number, IndustryResult>; errors: string[] }> {
  // Insert a run record up front so the admin UI can render "running" state
  const [runRecord] = await db.insert(enrichmentRunsTable).values({
    status: "running",
  }).returning({ id: enrichmentRunsTable.id });

  emit("run.start", runRecord.id, { trigger: opts.trigger ?? "scheduled" });

  try {
    const result = await enrichmentGraph.invoke({
      runId: runRecord.id,
      trigger: opts.trigger ?? "scheduled",
      targetCapabilityIds: opts.targetCapabilityIds ?? null,
      targetIndustryIds: opts.targetIndustryIds ?? null,
    });
    return {
      runId: runRecord.id,
      perIndustry: result.perIndustry,
      errors: Object.values(result.perIndustry).flatMap((r) => r.errors),
    };
  } catch (err) {
    // Boot cleanup at index.ts will mark this row "interrupted" if we never
    // reach finalize. Surface the error for the caller too.
    logger.error({ err, runId: runRecord.id }, "[enrichment-graph] fatal");
    throw err;
  }
}
