/**
 * PE Partner — Weekly Diligence Cycle
 *
 * The first persona-driven LangGraph workflow. Fires once per week for the
 * PE Partner persona (Marcus Chen). Models the actual weekly cycle a PE
 * investor runs: scan the universe → identify high-EVaR movers →
 * investigate the top 3 → publish IC-ready findings.
 *
 * Graph shape:
 *
 *     start
 *       │
 *   browseTopEvarCaps         ← read capability_alpha for industries he covers
 *       │
 *   scoreFindings             ← rank by revenueExposureMm × marginStructurePct
 *       │                         and pick top-3 with enough budget headroom
 *       │
 *   forEachCap.assess         ← for each pick: assess the most-exposed ref org
 *       │
 *   forEachCap.deepDive       ← Perplexity + Sonnet writeup on the capability
 *       │
 *   forEachCap.publish?       ← if findings are material AND budget allows,
 *       │                         publish a "PE diligence note" marketplace listing
 *       │
 *      end
 *
 * Each node checks budget before issuing any paid call and short-circuits
 * with status='budget_exhausted' if remaining cap < estimated step cost.
 */
import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { db, capabilityAlphaTable, capabilitiesTable, industriesTable, organizationsTable, type Bot } from "@workspace/db";
import { eq, desc, and, inArray, like, sql } from "drizzle-orm";
import { runAssessmentAction } from "../actions/assessment";
import { runDeepDiveAction } from "../actions/deep-dive";
import { runMarketplaceListAction } from "../actions/marketplace";
import { logger } from "../../../lib/logger";
import type { WorkflowDefinition, WorkflowResult, WorkflowRunContext } from "./types";

// ── Persona-specific tuning constants ──────────────────────────────────
const PE_INDUSTRIES = ["banking", "insurance"]; // PE Partner Marcus Chen's coverage
const TOP_CAPS_TO_SCAN = 20;
const TOP_CAPS_TO_INVESTIGATE = 3;
const MIN_REMAINING_BUDGET_FOR_FULL_CYCLE_CENTS = 400; // ~$4 to do 3 assessments + 3 deep-dives + 3 listings
const ASSESSMENT_ESTIMATE_CENTS = 15;
const DEEP_DIVE_ESTIMATE_CENTS = 50;
const LISTING_ESTIMATE_CENTS = 5;

// ── State annotation ───────────────────────────────────────────────────
interface ScoredCap {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  revenueExposureMm: number | null;
  marginPct: number | null;
  evarScore: number; // rev × margin proxy
}

const PEDiligenceState = Annotation.Root({
  botId: Annotation<number>,
  scannedCaps: Annotation<ScoredCap[]>({
    reducer: (_x, y) => y,
    default: () => [],
  }),
  selectedCaps: Annotation<ScoredCap[]>({
    reducer: (_x, y) => y,
    default: () => [],
  }),
  assessmentResults: Annotation<Array<{ capabilityId: number; ok: boolean; costCents: number; error?: string }>>({
    reducer: (x, y) => [...x, ...y],
    default: () => [],
  }),
  deepDiveResults: Annotation<Array<{ capabilityId: number; annotationId?: number; ok: boolean; costCents: number; error?: string }>>({
    reducer: (x, y) => [...x, ...y],
    default: () => [],
  }),
  marketplaceListings: Annotation<Array<{ capabilityId: number; listingId?: number; ok: boolean; costCents: number; error?: string }>>({
    reducer: (x, y) => [...x, ...y],
    default: () => [],
  }),
  totalCostCents: Annotation<number>({
    reducer: (x, y) => x + y,
    default: () => 0,
  }),
  errors: Annotation<string[]>({
    reducer: (x, y) => [...x, ...y],
    default: () => [],
  }),
  budgetExhausted: Annotation<boolean>({
    reducer: (_x, y) => y,
    default: () => false,
  }),
});

type PEState = typeof PEDiligenceState.State;

// ── Nodes ──────────────────────────────────────────────────────────────

/**
 * Node 1: browseTopEvarCaps
 * Query capability_alpha for caps in PE-covered industries, rank by a
 * coarse EVaR proxy (revenueExposureMm × marginStructurePct), return top 20.
 * Free — no LLM call.
 */
function browseNode(ctx: WorkflowRunContext) {
  return async (state: PEState): Promise<Partial<PEState>> => {
    const t0 = Date.now();
    const rows = await db
      .select({
        capabilityId: capabilityAlphaTable.capabilityId,
        capabilityName: capabilitiesTable.name,
        industryId: capabilityAlphaTable.industryId,
        industryName: industriesTable.name,
        revenueExposureMm: capabilityAlphaTable.revenueExposureMm,
        marginPct: capabilityAlphaTable.marginStructurePct,
      })
      .from(capabilityAlphaTable)
      .innerJoin(capabilitiesTable, eq(capabilityAlphaTable.capabilityId, capabilitiesTable.id))
      .innerJoin(industriesTable, eq(capabilityAlphaTable.industryId, industriesTable.id))
      .where(inArray(industriesTable.slug, PE_INDUSTRIES))
      .orderBy(desc(sql`COALESCE(${capabilityAlphaTable.revenueExposureMm}, 0) * COALESCE(${capabilityAlphaTable.marginStructurePct}, 0)`))
      .limit(TOP_CAPS_TO_SCAN);

    const scored: ScoredCap[] = rows.map((r) => ({
      capabilityId: r.capabilityId,
      capabilityName: r.capabilityName,
      industryId: r.industryId,
      industryName: r.industryName,
      revenueExposureMm: r.revenueExposureMm,
      marginPct: r.marginPct,
      evarScore: (r.revenueExposureMm ?? 0) * (r.marginPct ?? 0) / 100,
    }));

    await ctx.recordStep({
      stepName: "browseTopEvarCaps",
      stepIndex: 0,
      status: "ok",
      costCents: 0,
      durationMs: Date.now() - t0,
      payload: { scannedCount: scored.length, industries: PE_INDUSTRIES },
    });
    return { scannedCaps: scored };
  };
}

/**
 * Node 2: scoreFindings
 * Pick the top-N by EVaR proxy, filtered to only caps with non-null
 * revenue exposure (caps without revenue data aren't actionable for
 * PE diligence). Also checks initial budget — if insufficient for a
 * full cycle, abort here.
 */
function scoreNode(ctx: WorkflowRunContext) {
  return async (state: PEState): Promise<Partial<PEState>> => {
    const t0 = Date.now();
    if (state.scannedCaps.length === 0) {
      await ctx.recordStep({
        stepName: "scoreFindings",
        stepIndex: 1,
        status: "no_op",
        costCents: 0,
        durationMs: Date.now() - t0,
        payload: { reason: "no scanned caps" },
      });
      return { selectedCaps: [] };
    }

    const sufficient = await ctx.hasBudgetFor(MIN_REMAINING_BUDGET_FOR_FULL_CYCLE_CENTS);
    if (!sufficient) {
      await ctx.recordStep({
        stepName: "scoreFindings",
        stepIndex: 1,
        status: "skipped_budget",
        costCents: 0,
        durationMs: Date.now() - t0,
        payload: { required: MIN_REMAINING_BUDGET_FOR_FULL_CYCLE_CENTS },
      });
      return { budgetExhausted: true, selectedCaps: [] };
    }

    const candidates = state.scannedCaps
      .filter((c) => c.revenueExposureMm !== null && c.marginPct !== null)
      .slice(0, TOP_CAPS_TO_INVESTIGATE);

    await ctx.recordStep({
      stepName: "scoreFindings",
      stepIndex: 1,
      status: "ok",
      costCents: 0,
      durationMs: Date.now() - t0,
      payload: {
        selectedCount: candidates.length,
        selected: candidates.map((c) => ({ id: c.capabilityId, name: c.capabilityName, evar: c.evarScore })),
      },
    });
    return { selectedCaps: candidates };
  };
}

/**
 * Node 3: forEachCap.assess
 * For each selected cap, run an assessment via the existing
 * `runAssessmentAction`. Sequential to keep cost predictable; bots are
 * not throughput-critical so parallelism here is not worth the budget-
 * accounting complexity.
 */
function assessNode(ctx: WorkflowRunContext) {
  return async (state: PEState): Promise<Partial<PEState>> => {
    if (state.budgetExhausted || !ctx.bot) return { assessmentResults: [] };
    const t0 = Date.now();
    const results: PEState["assessmentResults"] = [];
    let stepCost = 0;
    for (const cap of state.selectedCaps) {
      if (!(await ctx.hasBudgetFor(ASSESSMENT_ESTIMATE_CENTS))) {
        results.push({ capabilityId: cap.capabilityId, ok: false, costCents: 0, error: "budget exhausted mid-loop" });
        continue;
      }
      const r = await runAssessmentAction(ctx.bot);
      stepCost += r.costCents;
      results.push({ capabilityId: cap.capabilityId, ok: r.ok, costCents: r.costCents, error: r.error });
    }
    await ctx.recordStep({
      stepName: "forEach.assess",
      stepIndex: 2,
      status: results.every((r) => r.ok) ? "ok" : "error",
      costCents: stepCost,
      durationMs: Date.now() - t0,
      payload: { count: results.length, oks: results.filter((r) => r.ok).length },
    });
    return { assessmentResults: results, totalCostCents: stepCost };
  };
}

/**
 * Node 4: forEachCap.deepDive
 * Per-cap deep dive — the highest-cost step. Re-checks budget before each.
 */
function deepDiveNode(ctx: WorkflowRunContext) {
  return async (state: PEState): Promise<Partial<PEState>> => {
    if (state.budgetExhausted || !ctx.bot) return { deepDiveResults: [] };
    const t0 = Date.now();
    const results: PEState["deepDiveResults"] = [];
    let stepCost = 0;
    for (const cap of state.selectedCaps) {
      if (!(await ctx.hasBudgetFor(DEEP_DIVE_ESTIMATE_CENTS))) {
        results.push({ capabilityId: cap.capabilityId, ok: false, costCents: 0, error: "budget exhausted mid-loop" });
        continue;
      }
      const r = await runDeepDiveAction(ctx.bot);
      stepCost += r.costCents;
      results.push({ capabilityId: cap.capabilityId, ok: r.ok, costCents: r.costCents, error: r.error });
    }
    await ctx.recordStep({
      stepName: "forEach.deepDive",
      stepIndex: 3,
      status: results.every((r) => r.ok) ? "ok" : "error",
      costCents: stepCost,
      durationMs: Date.now() - t0,
      payload: { count: results.length, oks: results.filter((r) => r.ok).length },
    });
    return { deepDiveResults: results, totalCostCents: stepCost };
  };
}

/**
 * Node 5: forEachCap.maybePublishListing
 * If the deep-dive succeeded AND budget remains, publish a marketplace
 * listing with the PE diligence framing.
 */
function publishNode(ctx: WorkflowRunContext) {
  return async (state: PEState): Promise<Partial<PEState>> => {
    if (state.budgetExhausted || !ctx.bot) return { marketplaceListings: [] };
    const t0 = Date.now();
    const results: PEState["marketplaceListings"] = [];
    let stepCost = 0;
    const successfulDeepDives = state.deepDiveResults.filter((r) => r.ok);
    for (const dd of successfulDeepDives) {
      if (!(await ctx.hasBudgetFor(LISTING_ESTIMATE_CENTS))) {
        results.push({ capabilityId: dd.capabilityId, ok: false, costCents: 0, error: "budget exhausted mid-loop" });
        continue;
      }
      const r = await runMarketplaceListAction(ctx.bot);
      stepCost += r.costCents;
      results.push({ capabilityId: dd.capabilityId, listingId: r.listingId, ok: r.ok, costCents: r.costCents, error: r.error });
    }
    await ctx.recordStep({
      stepName: "forEach.publishListing",
      stepIndex: 4,
      status: results.every((r) => r.ok) ? "ok" : "error",
      costCents: stepCost,
      durationMs: Date.now() - t0,
      payload: { count: results.length, oks: results.filter((r) => r.ok).length },
    });
    return { marketplaceListings: results, totalCostCents: stepCost };
  };
}

// ── Graph wiring ───────────────────────────────────────────────────────

function buildGraph(ctx: WorkflowRunContext) {
  const graph = new StateGraph(PEDiligenceState)
    .addNode("browse", browseNode(ctx))
    .addNode("score", scoreNode(ctx))
    .addNode("assess", assessNode(ctx))
    .addNode("deepDive", deepDiveNode(ctx))
    .addNode("publish", publishNode(ctx))
    .addEdge(START, "browse")
    .addEdge("browse", "score")
    .addConditionalEdges("score", (state) => state.budgetExhausted ? END : "assess")
    .addEdge("assess", "deepDive")
    .addEdge("deepDive", "publish")
    .addEdge("publish", END);

  return graph.compile();
}

// ── Public definition ──────────────────────────────────────────────────

export const peWeeklyDiligenceWorkflow: WorkflowDefinition = {
  key: "pe-weekly-diligence",
  label: "PE Partner — Weekly Diligence Cycle",
  appliesToPersonas: ["pe_partner"],
  cadence: "weekly",
  scope: "per-bot",
  description:
    "Scans high-EVaR capabilities in PE-covered industries (banking, insurance), picks the top 3 by revenue exposure × margin, then runs assessment + deep-dive + marketplace-listing on each. Models the weekly cycle a real PE Partner runs: universe scan → triage → investigate → publish IC-ready findings.",
  estimatedCostCents: 250, // ~$2.50 worst case (3 × [assess 15c + deep-dive 50c + listing 5c] + browse 0c + safety)

  async run(ctx: WorkflowRunContext): Promise<WorkflowResult> {
    if (!ctx.bot) {
      return {
        status: "failed",
        state: {},
        artifactIds: {},
        totalCostCents: 0,
        errorMessage: "pe-weekly-diligence requires a bot context (per-bot scope)",
      };
    }

    const graph = buildGraph(ctx);
    try {
      const finalState = await graph.invoke({ botId: ctx.bot.id });

      const status: WorkflowResult["status"] =
        finalState.budgetExhausted ? "budget_exhausted" :
        finalState.errors.length > 0 ? "failed" :
        "completed";

      const artifactIds: Record<string, number[]> = {
        marketplaceListings: finalState.marketplaceListings
          .filter((l) => l.ok && l.listingId !== undefined)
          .map((l) => l.listingId as number),
      };

      return {
        status,
        state: finalState as unknown as Record<string, unknown>,
        artifactIds,
        totalCostCents: finalState.totalCostCents,
        errorMessage: finalState.errors[0],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ workflowKey: "pe-weekly-diligence", err: msg }, "[pe-diligence] graph invoke failed");
      return {
        status: "failed",
        state: {},
        artifactIds: {},
        totalCostCents: 0,
        errorMessage: msg,
      };
    }
  },
};
