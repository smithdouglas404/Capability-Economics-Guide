/**
 * Phase 2 — persona-specific weekly/monthly cycles for the remaining four
 * personas (VC, Insurance, Healthcare, Energy). All follow the same
 * shape as `pe-weekly-diligence.ts` but with persona-tuned industry
 * coverage, cadence, and emphasis on different action types.
 *
 * Each workflow exports a `WorkflowDefinition`; they share a generic
 * orchestrator defined below to keep the file DRY. The differences
 * between personas are encoded in `PersonaCycleConfig`.
 *
 * Migrated off LangGraph 2026-05-25 (Phase 10 Category A). The
 * StateGraph was being used as a 3-step procedural sequencer with an
 * early-exit on budget exhaustion; AgentKit / LangGraph add no value
 * here. The action helpers themselves (`runAssessmentAction`, etc.)
 * encapsulate any LLM work — the workflow nodes are pure orchestration.
 */
import { db, capabilityAlphaTable, capabilitiesTable, industriesTable } from "@workspace/db";
import { eq, desc, inArray, sql } from "drizzle-orm";
import { runAssessmentAction } from "../actions/assessment";
import { runDeepDiveAction } from "../actions/deep-dive";
import { runMarketplaceListAction } from "../actions/marketplace";
import { runCommentAction } from "../actions/comment";
import { logger } from "../../../lib/logger";
import type { WorkflowDefinition, WorkflowResult, WorkflowRunContext, WorkflowCadence } from "./types";

interface PersonaCycleConfig {
  key: string;
  label: string;
  personaKey: string;
  industrySlugs: string[];
  cadence: WorkflowCadence;
  /** Sort caps by this projection. "evar" = revenue × margin; "commoditization" = velocity desc; "halflife" = halfLife asc (fastest decay first). */
  rankBy: "evar" | "commoditization" | "halflife";
  topN: number;
  /** Which downstream actions to chain after the browse+score. */
  actions: Array<"comment" | "assess" | "deepDive" | "listing">;
  description: string;
  estimatedCostCents: number;
}

interface CycleCap {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  rankSignal: number;
}

interface ActionResult {
  capabilityId: number;
  action: string;
  ok: boolean;
  costCents: number;
  artifactId?: number;
  error?: string;
}

function rankExpression(rankBy: PersonaCycleConfig["rankBy"]) {
  switch (rankBy) {
    case "evar":
      return desc(sql`COALESCE(${capabilityAlphaTable.revenueExposureMm}, 0) * COALESCE(${capabilityAlphaTable.marginStructurePct}, 0)`);
    case "commoditization":
      return desc(sql`COALESCE(${capabilityAlphaTable.commoditizationVelocity}, 0)`);
    case "halflife":
      // Lower half-life = faster decay = higher rank.
      return sql`COALESCE(${capabilityAlphaTable.halfLifeMonths}, 999) ASC`;
  }
}

function rankSignalProjection(rankBy: PersonaCycleConfig["rankBy"]) {
  switch (rankBy) {
    case "evar":
      return sql<number>`COALESCE(${capabilityAlphaTable.revenueExposureMm}, 0) * COALESCE(${capabilityAlphaTable.marginStructurePct}, 0) / 100`;
    case "commoditization":
      return sql<number>`COALESCE(${capabilityAlphaTable.commoditizationVelocity}, 0)`;
    case "halflife":
      return sql<number>`COALESCE(${capabilityAlphaTable.halfLifeMonths}, 0)`;
  }
}

async function browseStep(cfg: PersonaCycleConfig, ctx: WorkflowRunContext): Promise<CycleCap[]> {
  const t0 = Date.now();
  const rows = await db
    .select({
      capabilityId: capabilityAlphaTable.capabilityId,
      capabilityName: capabilitiesTable.name,
      industryId: capabilityAlphaTable.industryId,
      industryName: industriesTable.name,
      rankSignal: rankSignalProjection(cfg.rankBy),
    })
    .from(capabilityAlphaTable)
    .innerJoin(capabilitiesTable, eq(capabilityAlphaTable.capabilityId, capabilitiesTable.id))
    .innerJoin(industriesTable, eq(capabilityAlphaTable.industryId, industriesTable.id))
    .where(inArray(industriesTable.slug, cfg.industrySlugs))
    .orderBy(rankExpression(cfg.rankBy))
    .limit(cfg.topN * 2);
  await ctx.recordStep({
    stepName: "browse",
    stepIndex: 0,
    status: "ok",
    costCents: 0,
    durationMs: Date.now() - t0,
    payload: { count: rows.length, rankBy: cfg.rankBy },
  });
  return rows;
}

async function scoreStep(
  cfg: PersonaCycleConfig,
  ctx: WorkflowRunContext,
  scannedCaps: CycleCap[],
): Promise<{ selectedCaps: CycleCap[]; budgetExhausted: boolean }> {
  const t0 = Date.now();
  const selected = scannedCaps.slice(0, cfg.topN);
  const required = cfg.estimatedCostCents;
  const sufficient = await ctx.hasBudgetFor(required);
  if (!sufficient) {
    await ctx.recordStep({
      stepName: "score",
      stepIndex: 1,
      status: "skipped_budget",
      costCents: 0,
      durationMs: Date.now() - t0,
      payload: { required },
    });
    return { selectedCaps: [], budgetExhausted: true };
  }
  await ctx.recordStep({
    stepName: "score",
    stepIndex: 1,
    status: "ok",
    costCents: 0,
    durationMs: Date.now() - t0,
    payload: { selected: selected.map((c) => ({ id: c.capabilityId, name: c.capabilityName, signal: c.rankSignal })) },
  });
  return { selectedCaps: selected, budgetExhausted: false };
}

async function runActionsStep(
  cfg: PersonaCycleConfig,
  ctx: WorkflowRunContext,
  selectedCaps: CycleCap[],
): Promise<{ actionResults: ActionResult[]; totalCostCents: number }> {
  if (!ctx.bot) return { actionResults: [], totalCostCents: 0 };
  const t0 = Date.now();
  const results: ActionResult[] = [];
  let stepCost = 0;

  for (const cap of selectedCaps) {
    for (const action of cfg.actions) {
      // Per-action estimates; conservative.
      const estCost = action === "deepDive" ? 50 : action === "assess" ? 15 : 5;
      if (!(await ctx.hasBudgetFor(estCost))) {
        results.push({ capabilityId: cap.capabilityId, action, ok: false, costCents: 0, error: "budget exhausted mid-loop" });
        continue;
      }
      let r: { ok: boolean; costCents: number; error?: string; listingId?: number };
      switch (action) {
        case "comment":     r = await runCommentAction(ctx.bot); break;
        case "assess":      r = await runAssessmentAction(ctx.bot); break;
        case "deepDive":    r = await runDeepDiveAction(ctx.bot); break;
        case "listing":     r = await runMarketplaceListAction(ctx.bot); break;
      }
      stepCost += r.costCents;
      results.push({
        capabilityId: cap.capabilityId,
        action,
        ok: r.ok,
        costCents: r.costCents,
        artifactId: r.listingId,
        error: r.error,
      });
    }
  }

  await ctx.recordStep({
    stepName: "runActions",
    stepIndex: 2,
    status: results.every((r) => r.ok) ? "ok" : "error",
    costCents: stepCost,
    durationMs: Date.now() - t0,
    payload: {
      total: results.length,
      oks: results.filter((r) => r.ok).length,
      byAction: cfg.actions.reduce<Record<string, number>>((acc, a) => {
        acc[a] = results.filter((r) => r.action === a && r.ok).length;
        return acc;
      }, {}),
    },
  });
  return { actionResults: results, totalCostCents: stepCost };
}

function buildDefinition(cfg: PersonaCycleConfig): WorkflowDefinition {
  return {
    key: cfg.key,
    label: cfg.label,
    appliesToPersonas: [cfg.personaKey],
    cadence: cfg.cadence,
    scope: "per-bot",
    description: cfg.description,
    estimatedCostCents: cfg.estimatedCostCents,
    async run(ctx: WorkflowRunContext): Promise<WorkflowResult> {
      if (!ctx.bot) {
        return { status: "failed", state: {}, artifactIds: {}, totalCostCents: 0, errorMessage: `${cfg.key} requires bot` };
      }
      try {
        const scannedCaps = await browseStep(cfg, ctx);
        const { selectedCaps, budgetExhausted } = await scoreStep(cfg, ctx, scannedCaps);
        const { actionResults, totalCostCents } = budgetExhausted
          ? { actionResults: [] as ActionResult[], totalCostCents: 0 }
          : await runActionsStep(cfg, ctx, selectedCaps);

        const status: WorkflowResult["status"] =
          budgetExhausted ? "budget_exhausted" :
          actionResults.length > 0 && actionResults.every((r) => !r.ok) ? "failed" :
          "completed";
        const artifactIds: Record<string, number[]> = {
          listings: actionResults
            .filter((r) => r.action === "listing" && r.ok && r.artifactId)
            .map((r) => r.artifactId as number),
        };
        return {
          status,
          state: { scannedCaps, selectedCaps, actionResults, totalCostCents, budgetExhausted },
          artifactIds,
          totalCostCents,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ workflowKey: cfg.key, err: msg }, "[persona-cycle] failed");
        return { status: "failed", state: {}, artifactIds: {}, totalCostCents: 0, errorMessage: msg };
      }
    },
  };
}

// ── Workflow definitions (one per remaining persona) ───────────────────

export const vcThesisBuildWorkflow = buildDefinition({
  key: "vc-thesis-build",
  label: "VC Associate — Weekly Thesis Build",
  personaKey: "vc_associate",
  industrySlugs: ["technology"],
  cadence: "weekly",
  rankBy: "commoditization",
  topN: 2,
  actions: ["assess", "deepDive", "listing"],
  description:
    "Picks the 1-2 emerging-quadrant tech capabilities with the highest commoditization velocity (i.e., the fastest-moving plays), then deep-dives each and publishes a thesis brief annotation tagged for VC consumption.",
  estimatedCostCents: 200,
});

export const insuranceCapabilityReviewWorkflow = buildDefinition({
  key: "insurance-capability-review",
  label: "Insurance Domain Lead — Bi-Weekly Capability Review",
  personaKey: "insurance_lead",
  industrySlugs: ["insurance"],
  cadence: "bi-weekly",
  rankBy: "evar",
  topN: 3,
  actions: ["comment", "assess", "deepDive"],
  description:
    "Bi-weekly comparison of top-EVaR insurance capabilities against a rotating reference org (Progressive → Allstate → MetLife → Allianz). Comments on Fragility flags, assesses the rotation org, and deep-dives the one with the widest gap.",
  estimatedCostCents: 250,
});

export const healthcareOrgComparisonWorkflow = buildDefinition({
  key: "healthcare-org-comparison",
  label: "Healthcare Operator — Weekly Org Comparison",
  personaKey: "healthcare_operator",
  industrySlugs: ["healthcare"],
  cadence: "weekly",
  rankBy: "evar",
  topN: 2,
  actions: ["comment", "assess", "deepDive"],
  description:
    "Weekly assessment of one healthcare reference org with a peer-cohort comparison annotation. Focuses on clinical-workforce, revenue-cycle, and patient-experience capabilities. Outputs a comparative annotation per cap with industry-cohort context.",
  estimatedCostCents: 200,
});

export const energyQuarterlyAuditWorkflow = buildDefinition({
  key: "energy-quarterly-audit",
  label: "Energy Strategist — Quarterly Deep Audit",
  personaKey: "energy_strategist",
  industrySlugs: ["energy"],
  cadence: "quarterly",
  rankBy: "halflife",
  topN: 1,
  actions: ["deepDive"],
  description:
    "One very deep dive per quarter on the energy capability with the shortest half-life (fastest decay = biggest shift in the period). Persona-aligned with the lowest cadence among bots; the Energy Strategist is patient-and-deep, not high-frequency.",
  estimatedCostCents: 80,
});
