/**
 * PE Partner — Weekly Diligence Cycle
 *
 * Fires once per week for the PE Partner persona (Marcus Chen). Models
 * the actual weekly cycle a PE investor runs: scan the universe →
 * identify high-EVaR movers → investigate the top 3 → publish IC-ready
 * findings.
 *
 * Shape:
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
 * Each step checks budget before issuing any paid call and short-circuits
 * with status='budget_exhausted' if remaining cap < estimated step cost.
 *
 * Migrated off LangGraph 2026-05-25 (Phase 10 Category A). The LLM work
 * lives inside the action helpers (`runAssessmentAction`,
 * `runDeepDiveAction`, `runMarketplaceListAction`) — the workflow steps
 * are pure orchestration, so a procedural sequence is the right shape.
 */
import { db, capabilityAlphaTable, capabilitiesTable, industriesTable } from "@workspace/db";
import { eq, desc, inArray, sql } from "drizzle-orm";
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

interface ScoredCap {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  revenueExposureMm: number | null;
  marginPct: number | null;
  evarScore: number; // rev × margin proxy
}

interface AssessmentResult {
  capabilityId: number;
  ok: boolean;
  costCents: number;
  error?: string;
}

interface DeepDiveResult {
  capabilityId: number;
  annotationId?: number;
  ok: boolean;
  costCents: number;
  error?: string;
}

interface MarketplaceListingResult {
  capabilityId: number;
  listingId?: number;
  ok: boolean;
  costCents: number;
  error?: string;
}

/**
 * Step 1: browseTopEvarCaps
 * Query capability_alpha for caps in PE-covered industries, rank by a
 * coarse EVaR proxy (revenueExposureMm × marginStructurePct), return top 20.
 * Free — no LLM call.
 */
async function browseStep(ctx: WorkflowRunContext): Promise<ScoredCap[]> {
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
  return scored;
}

/**
 * Step 2: scoreFindings
 * Pick the top-N by EVaR proxy, filtered to only caps with non-null
 * revenue exposure (caps without revenue data aren't actionable for
 * PE diligence). Also checks initial budget — if insufficient for a
 * full cycle, abort here.
 */
async function scoreStep(
  ctx: WorkflowRunContext,
  scannedCaps: ScoredCap[],
): Promise<{ selectedCaps: ScoredCap[]; budgetExhausted: boolean }> {
  const t0 = Date.now();
  if (scannedCaps.length === 0) {
    await ctx.recordStep({
      stepName: "scoreFindings",
      stepIndex: 1,
      status: "no_op",
      costCents: 0,
      durationMs: Date.now() - t0,
      payload: { reason: "no scanned caps" },
    });
    return { selectedCaps: [], budgetExhausted: false };
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
    return { selectedCaps: [], budgetExhausted: true };
  }

  const candidates = scannedCaps
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
  return { selectedCaps: candidates, budgetExhausted: false };
}

/**
 * Step 3: forEachCap.assess
 * For each selected cap, run an assessment via the existing
 * `runAssessmentAction`. Sequential to keep cost predictable; bots are
 * not throughput-critical so parallelism here is not worth the budget-
 * accounting complexity.
 */
async function assessStep(
  ctx: WorkflowRunContext,
  selectedCaps: ScoredCap[],
): Promise<{ assessmentResults: AssessmentResult[]; stepCost: number }> {
  if (!ctx.bot) return { assessmentResults: [], stepCost: 0 };
  const t0 = Date.now();
  const results: AssessmentResult[] = [];
  let stepCost = 0;
  for (const cap of selectedCaps) {
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
  return { assessmentResults: results, stepCost };
}

/**
 * Step 4: forEachCap.deepDive
 * Per-cap deep dive — the highest-cost step. Re-checks budget before each.
 */
async function deepDiveStep(
  ctx: WorkflowRunContext,
  selectedCaps: ScoredCap[],
): Promise<{ deepDiveResults: DeepDiveResult[]; stepCost: number }> {
  if (!ctx.bot) return { deepDiveResults: [], stepCost: 0 };
  const t0 = Date.now();
  const results: DeepDiveResult[] = [];
  let stepCost = 0;
  for (const cap of selectedCaps) {
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
  return { deepDiveResults: results, stepCost };
}

/**
 * Step 5: forEachCap.maybePublishListing
 * If the deep-dive succeeded AND budget remains, publish a marketplace
 * listing with the PE diligence framing.
 */
async function publishStep(
  ctx: WorkflowRunContext,
  deepDiveResults: DeepDiveResult[],
): Promise<{ marketplaceListings: MarketplaceListingResult[]; stepCost: number }> {
  if (!ctx.bot) return { marketplaceListings: [], stepCost: 0 };
  const t0 = Date.now();
  const results: MarketplaceListingResult[] = [];
  let stepCost = 0;
  const successfulDeepDives = deepDiveResults.filter((r) => r.ok);
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
  return { marketplaceListings: results, stepCost };
}

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

    try {
      const scannedCaps = await browseStep(ctx);
      const { selectedCaps, budgetExhausted } = await scoreStep(ctx, scannedCaps);

      if (budgetExhausted) {
        return {
          status: "budget_exhausted",
          state: { botId: ctx.bot.id, scannedCaps, selectedCaps, budgetExhausted: true, totalCostCents: 0 },
          artifactIds: {},
          totalCostCents: 0,
        };
      }

      const { assessmentResults, stepCost: assessCost } = await assessStep(ctx, selectedCaps);
      const { deepDiveResults, stepCost: deepDiveCost } = await deepDiveStep(ctx, selectedCaps);
      const { marketplaceListings, stepCost: publishCost } = await publishStep(ctx, deepDiveResults);
      const totalCostCents = assessCost + deepDiveCost + publishCost;
      const errors: string[] = [];

      const status: WorkflowResult["status"] = errors.length > 0 ? "failed" : "completed";
      const artifactIds: Record<string, number[]> = {
        marketplaceListings: marketplaceListings
          .filter((l) => l.ok && l.listingId !== undefined)
          .map((l) => l.listingId as number),
      };

      return {
        status,
        state: {
          botId: ctx.bot.id,
          scannedCaps,
          selectedCaps,
          assessmentResults,
          deepDiveResults,
          marketplaceListings,
          totalCostCents,
          errors,
          budgetExhausted: false,
        },
        artifactIds,
        totalCostCents,
        errorMessage: errors[0],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ workflowKey: "pe-weekly-diligence", err: msg }, "[pe-diligence] run failed");
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
