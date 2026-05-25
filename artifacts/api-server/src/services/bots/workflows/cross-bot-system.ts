/**
 * Phase 3 — System-wide cross-bot workflows.
 *
 * These workflows do NOT belong to any single bot. They run on the
 * scheduler's cadence, read across all bot activity, and write to
 * system-level tables (capability_annotations with a "multi-bot signal"
 * tag, agent_tuning for bias adjustments). The runner passes `bot=null`
 * and skips per-bot budget guards — instead each workflow self-budgets
 * (via the `estimatedCostCents` field, enforced by the scheduler).
 *
 * Migrated off LangGraph 2026-05-25 (Phase 10 Category A). Both
 * workflows here are pure SQL + arithmetic — no LLM gate to wrap, so a
 * plain procedural sequence is the right shape. `ctx.recordStep` calls
 * preserved verbatim so the admin step-timeline view is unchanged.
 */
import {
  db,
  botActionsTable,
  botsTable,
  capabilityAnnotationsTable,
  capabilitiesTable,
  organizationCapabilitiesTable,
  cviComponentsTable,
} from "@workspace/db";
import { eq, sql, inArray } from "drizzle-orm";
import { logger } from "../../../lib/logger";
import type { WorkflowDefinition, WorkflowResult, WorkflowRunContext } from "./types";

// ── Workflow 1: Cross-Bot Consensus Map ────────────────────────────────
//
// Once per week, scan the past 7 days of bot comments/annotations grouped
// by capabilityId. Any capability where ≥3 distinct bots independently
// produced an artifact is flagged with a "multi-bot signal" annotation
// surfaced in the HITL queue.

interface ConsensusCap {
  capabilityId: number;
  capabilityName: string;
  botCount: number;
  artifactCount: number;
}

const MIN_BOT_THRESHOLD = 3;

async function consensusAggregateStep(ctx: WorkflowRunContext): Promise<ConsensusCap[]> {
  const t0 = Date.now();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  // Count distinct bots per capability across recent bot_actions.
  // payload->>'capabilityId' is the convention used by the
  // assessment/deep-dive/comment actions when writing rows.
  const rows = await db.execute<{ capability_id: number; bot_count: number; artifact_count: number }>(sql`
    SELECT
      (payload->>'capabilityId')::int AS capability_id,
      COUNT(DISTINCT bot_id) AS bot_count,
      COUNT(*) AS artifact_count
    FROM ${botActionsTable}
    WHERE started_at >= ${since}
      AND payload ? 'capabilityId'
      AND ok = true
    GROUP BY (payload->>'capabilityId')::int
    HAVING COUNT(DISTINCT bot_id) >= ${MIN_BOT_THRESHOLD}
    ORDER BY bot_count DESC, artifact_count DESC
    LIMIT 25
  `);
  const aggregated: ConsensusCap[] = [];
  if (rows.rows.length > 0) {
    const capIds = rows.rows.map((r) => Number(r.capability_id)).filter((n) => !Number.isNaN(n));
    const nameRows = capIds.length > 0
      ? await db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name })
          .from(capabilitiesTable)
          .where(inArray(capabilitiesTable.id, capIds))
      : [];
    const nameById = new Map(nameRows.map((r) => [r.id, r.name]));
    for (const r of rows.rows) {
      const id = Number(r.capability_id);
      aggregated.push({
        capabilityId: id,
        capabilityName: nameById.get(id) ?? `cap-${id}`,
        botCount: Number(r.bot_count),
        artifactCount: Number(r.artifact_count),
      });
    }
  }
  await ctx.recordStep({
    stepName: "aggregate",
    stepIndex: 0,
    status: "ok",
    costCents: 0,
    durationMs: Date.now() - t0,
    payload: { capsFound: aggregated.length, threshold: MIN_BOT_THRESHOLD },
  });
  return aggregated;
}

async function consensusAnnotateStep(ctx: WorkflowRunContext, multiBotCaps: ConsensusCap[]): Promise<number[]> {
  const t0 = Date.now();
  const created: number[] = [];
  for (const cap of multiBotCaps) {
    const [row] = await db.insert(capabilityAnnotationsTable).values({
      capabilityId: cap.capabilityId,
      userId: "system:cross-bot-consensus-map",
      userDisplayName: "Multi-bot signal",
      kind: "note",
      body: `Cross-bot consensus: ${cap.botCount} distinct bots produced artifacts on "${cap.capabilityName}" in the past 7 days. This is a multi-bot signal — multiple personas independently surfaced this capability as material. Recommended for human review.`,
    }).returning({ id: capabilityAnnotationsTable.id });
    if (row) created.push(row.id);
  }
  await ctx.recordStep({
    stepName: "annotate",
    stepIndex: 1,
    status: "ok",
    costCents: 0,
    durationMs: Date.now() - t0,
    payload: { created: created.length },
  });
  return created;
}

export const crossBotConsensusMapWorkflow: WorkflowDefinition = {
  key: "cross-bot-consensus-map",
  label: "Cross-Bot Consensus Map (System)",
  appliesToPersonas: [],
  cadence: "weekly",
  scope: "system-wide",
  description:
    "Once per week, aggregates the past 7 days of bot activity by capability. Any capability where ≥3 distinct bots independently produced an artifact is flagged with a 'multi-bot signal' annotation, surfacing it for HITL review. Uses no LLM — pure aggregation + annotation insert.",
  estimatedCostCents: 0,
  async run(ctx: WorkflowRunContext): Promise<WorkflowResult> {
    try {
      const multiBotCaps = await consensusAggregateStep(ctx);
      const annotationsCreated = await consensusAnnotateStep(ctx, multiBotCaps);
      return {
        status: "completed",
        state: {
          capCountsByCap: multiBotCaps,
          multiBotCaps,
          annotationsCreated,
          totalCostCents: 0,
        },
        artifactIds: { annotations: annotationsCreated },
        totalCostCents: 0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ workflowKey: "cross-bot-consensus-map", err: msg }, "[consensus-map] failed");
      return { status: "failed", state: {}, artifactIds: {}, totalCostCents: 0, errorMessage: msg };
    }
  },
};

// ── Workflow 2: Bot-to-CVI Calibration ─────────────────────────────────
//
// Monthly: for each bot, compare its assessment maturity_score values
// against the live CVI component for the same (capability, industry).
// Bots whose Pearson correlation with CVI is < 0.6 get their
// behavioral biases auto-nudged (a flag on the bot row that the weekly
// prompt optimizer reads on its next pass).

interface BotCorrelation {
  botId: number;
  personaKey: string;
  correlation: number;
  n: number;
}

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? 0 : num / den;
}

const CORRELATION_FLOOR = 0.6;

async function calibrationComputeCorrelations(ctx: WorkflowRunContext): Promise<BotCorrelation[]> {
  const t0 = Date.now();
  const bots = await db.select().from(botsTable).where(eq(botsTable.status, "active"));
  const perBot: BotCorrelation[] = [];
  for (const bot of bots) {
    // Each bot's organizations table row was tagged with sessionToken
    // 'bot_sess_*' at provisioning. Find its org id, then pull its
    // capability mappings.
    const rows = await db.select({
      capabilityId: organizationCapabilitiesTable.capabilityId,
      maturityScore: organizationCapabilitiesTable.maturityScore,
    })
      .from(organizationCapabilitiesTable)
      .innerJoin(botsTable, eq(botsTable.id, bot.id))
      // Bot-to-org linkage isn't on a direct FK; we infer via clerk_user_id
      // matching the bot's synthetic id. For correlation purposes, we
      // accept "any maturity score this bot wrote".
      .innerJoin(sql`(SELECT id FROM organizations WHERE session_token LIKE ${'%' + bot.personaKey + '%'} LIMIT 1) as bot_org`, sql`bot_org.id = ${organizationCapabilitiesTable.organizationId}`)
      .limit(200);
    if (rows.length < 3) continue;
    const capIds = rows.map((r) => r.capabilityId);
    const cviRows = await db.select({
      capabilityId: cviComponentsTable.capabilityId,
      score: cviComponentsTable.consensusScore,
    })
      .from(cviComponentsTable)
      .where(inArray(cviComponentsTable.capabilityId, capIds));
    const cviByCap = new Map(cviRows.map((r) => [r.capabilityId, r.score]));
    const paired = rows
      .map((r) => ({ bot: r.maturityScore, cvi: cviByCap.get(r.capabilityId) }))
      .filter((p): p is { bot: number; cvi: number } => typeof p.cvi === "number");
    if (paired.length < 3) continue;
    const corr = pearson(paired.map((p) => p.bot), paired.map((p) => p.cvi));
    perBot.push({ botId: bot.id, personaKey: bot.personaKey, correlation: corr, n: paired.length });
  }
  await ctx.recordStep({
    stepName: "computeCorrelations",
    stepIndex: 0,
    status: "ok",
    costCents: 0,
    durationMs: Date.now() - t0,
    payload: { botsEvaluated: perBot.length },
  });
  return perBot;
}

async function calibrationFlagDivergent(ctx: WorkflowRunContext, perBot: BotCorrelation[]): Promise<number[]> {
  const t0 = Date.now();
  const flagged = perBot
    .filter((p) => p.correlation < CORRELATION_FLOOR)
    .map((p) => p.botId);
  // No DB write here yet — the weekly prompt optimizer reads the
  // bot_workflow_runs table on its next pass and applies the flags.
  // This keeps the calibration workflow side-effect-light.
  await ctx.recordStep({
    stepName: "flagDivergent",
    stepIndex: 1,
    status: "ok",
    costCents: 0,
    durationMs: Date.now() - t0,
    payload: { flaggedBotIds: flagged, floor: CORRELATION_FLOOR },
  });
  return flagged;
}

export const botToCviCalibrationWorkflow: WorkflowDefinition = {
  key: "bot-to-cvi-calibration",
  label: "Bot-to-CVI Calibration (System)",
  appliesToPersonas: [],
  cadence: "monthly",
  scope: "system-wide",
  description:
    "Monthly: for each active bot, compute the Pearson correlation between its assessment maturity scores and the live CVI engine's posterior means. Bots whose correlation < 0.6 are flagged for the weekly prompt optimizer to consider on its next pass. No LLM cost — pure SQL + arithmetic.",
  estimatedCostCents: 0,
  async run(ctx: WorkflowRunContext): Promise<WorkflowResult> {
    try {
      const perBotCorrelations = await calibrationComputeCorrelations(ctx);
      const flaggedBotIds = await calibrationFlagDivergent(ctx, perBotCorrelations);
      return {
        status: "completed",
        state: { perBotCorrelations, flaggedBotIds },
        artifactIds: {},
        totalCostCents: 0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ workflowKey: "bot-to-cvi-calibration", err: msg }, "[bot-cvi-cal] failed");
      return { status: "failed", state: {}, artifactIds: {}, totalCostCents: 0, errorMessage: msg };
    }
  },
};
