/**
 * Admin tunables — operator-facing dashboard for pausing, slowing, and
 * resuming every autonomous agent + system-level setting that controls
 * runtime cost.
 *
 *   GET  /api/admin/tunables
 *     Full snapshot — every agent's current schedule + defaults + cost
 *     impact, plus system-wide tuning (LLM kill switch, perplexity cap,
 *     bot budget defaults). Use this as the "what is normal vs current"
 *     view from the admin UI.
 *
 *   POST /api/admin/tunables/agents/:agentName/pause
 *     Set agent_schedules.enabled = false for one agent. Agent stops
 *     running on the next cron tick.
 *
 *   POST /api/admin/tunables/agents/:agentName/resume
 *     Set agent_schedules.enabled = true AND clear lastRunAt so the
 *     agent runs on the next tick instead of waiting out a stale
 *     interval.
 *
 *   POST /api/admin/tunables/agents/:agentName/schedule
 *     body: { "intervalSeconds": number }  (60s min, 30d max)
 *     Change the agent's cadence. Useful to slow an agent down during
 *     a heavy data-gathering phase without fully pausing it.
 *
 *   POST /api/admin/tunables/agents/bulk/pause
 *     body: { "agents"?: string[] }   (omit "agents" to pause all 8)
 *
 *   POST /api/admin/tunables/agents/bulk/resume
 *     body: { "agents"?: string[] }
 *
 *   POST /api/admin/tunables/reset-defaults
 *     body: { "scope"?: "agents" | "tuning" | "all" }   (default "all")
 *     Restores either agent_schedules, agent_tuning, or both back to
 *     the codebase-defined defaults in admin-tunables-catalog.ts.
 *
 *   PATCH /api/admin/tunables/system
 *     body: { "llmEnabled"?: boolean,
 *             "agentPerplexityCap"?: number,
 *             "routineIntervalHours"?: number,
 *             "detailBackfillLimit"?: number,
 *             "defaultBotBudgetUsdCap"?: number }
 *     Update one or more system-wide knobs. All fields optional.
 *
 * Every route requires x-admin-key (or ADMIN_AUTH_BYPASS=1 in dev).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  AGENT_DEFAULTS,
  isKnownAgent,
  snapshotAllAgents,
  snapshotSystem,
  setAgentInterval,
  pauseAgents,
  resumeAgents,
  resetAgentsToDefaults,
} from "../services/admin-tunables-catalog";
import { saveTuning, TUNING_DEFAULTS } from "../services/agent-tuning";
import { setFlag } from "../services/system-flags";

const router: IRouter = Router();

// ── GET full snapshot ──────────────────────────────────────────────────
router.get("/admin/tunables", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [agents, system] = await Promise.all([snapshotAllAgents(), snapshotSystem()]);
    const monthlyAtCurrent = agents.reduce((s, a) => s + a.estimatedMonthlyCostUsdAtCurrentCadence, 0);
    const monthlyAtDefault = agents.reduce((s, a) => s + a.estimatedMonthlyCostUsdAtDefaultCadence, 0);
    res.json({
      agents,
      system,
      summary: {
        totalMonthlyCostUsdAtCurrentCadence: Math.round(monthlyAtCurrent * 100) / 100,
        totalMonthlyCostUsdAtDefaultCadence: Math.round(monthlyAtDefault * 100) / 100,
        totalMonthlyCostDeltaUsd: Math.round((monthlyAtCurrent - monthlyAtDefault) * 100) / 100,
        countEnabled: agents.filter((a) => a.enabled).length,
        countPaused: agents.filter((a) => !a.enabled).length,
        anyOffDefault: agents.some(
          (a) => a.enabled !== a.defaultEnabled || a.intervalSeconds !== a.defaultIntervalSeconds,
        ),
      },
      docs: {
        defaultsLocation: "artifacts/api-server/src/services/admin-tunables-catalog.ts",
        perCycleCostsLocation: "artifacts/api-server/src/services/agent/scheduling.ts PER_CYCLE_COST_USD",
        bulkActions: [
          "POST /api/admin/tunables/agents/bulk/pause   { agents?: string[] }",
          "POST /api/admin/tunables/agents/bulk/resume  { agents?: string[] }",
          "POST /api/admin/tunables/reset-defaults      { scope?: 'agents'|'tuning'|'all' }",
        ],
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "snapshot failed" });
  }
});

// ── Per-agent pause / resume / schedule ─────────────────────────────────
router.post("/admin/tunables/agents/:agentName/pause", requireAdmin, async (req: Request, res: Response) => {
  const agentName = String(req.params.agentName);
  if (!isKnownAgent(agentName)) {
    res.status(404).json({ error: `Unknown agent: ${agentName}` });
    return;
  }
  try {
    const r = await pauseAgents([agentName]);
    res.json({ ok: true, paused: r.paused });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "pause failed" });
  }
});

router.post("/admin/tunables/agents/:agentName/resume", requireAdmin, async (req: Request, res: Response) => {
  const agentName = String(req.params.agentName);
  if (!isKnownAgent(agentName)) {
    res.status(404).json({ error: `Unknown agent: ${agentName}` });
    return;
  }
  try {
    const r = await resumeAgents([agentName]);
    res.json({ ok: true, resumed: r.resumed });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "resume failed" });
  }
});

const ScheduleBody = z.object({
  intervalSeconds: z.number().int().min(60).max(30 * 24 * 60 * 60),
});

router.post("/admin/tunables/agents/:agentName/schedule", requireAdmin, async (req: Request, res: Response) => {
  const agentName = String(req.params.agentName);
  if (!isKnownAgent(agentName)) {
    res.status(404).json({ error: `Unknown agent: ${agentName}` });
    return;
  }
  const parsed = ScheduleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  try {
    await setAgentInterval(agentName, parsed.data.intervalSeconds);
    res.json({ ok: true, agentName, intervalSeconds: parsed.data.intervalSeconds });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "schedule update failed" });
  }
});

// ── Bulk pause / resume ────────────────────────────────────────────────
const BulkBody = z.object({
  agents: z.array(z.string()).optional(),
});

router.post("/admin/tunables/agents/bulk/pause", requireAdmin, async (req: Request, res: Response) => {
  const parsed = BulkBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const targets = parsed.data.agents ?? AGENT_DEFAULTS.map((a) => a.shortName);
  try {
    const r = await pauseAgents(targets);
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "bulk pause failed" });
  }
});

router.post("/admin/tunables/agents/bulk/resume", requireAdmin, async (req: Request, res: Response) => {
  const parsed = BulkBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const targets = parsed.data.agents ?? AGENT_DEFAULTS.map((a) => a.shortName);
  try {
    const r = await resumeAgents(targets);
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "bulk resume failed" });
  }
});

// ── Reset everything to catalog defaults ───────────────────────────────
const ResetBody = z.object({
  scope: z.enum(["agents", "tuning", "all"]).optional(),
});

router.post("/admin/tunables/reset-defaults", requireAdmin, async (req: Request, res: Response) => {
  const parsed = ResetBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const scope = parsed.data.scope ?? "all";
  const result: Record<string, unknown> = { ok: true, scope };
  try {
    if (scope === "agents" || scope === "all") {
      result.agents = await resetAgentsToDefaults();
    }
    if (scope === "tuning" || scope === "all") {
      await saveTuning({
        routineIntervalHours: TUNING_DEFAULTS.routineIntervalHours,
        detailBackfillLimit: TUNING_DEFAULTS.detailBackfillLimit,
        agentPerplexityCap: TUNING_DEFAULTS.agentPerplexityCap,
        defaultBotBudgetUsdCap: TUNING_DEFAULTS.defaultBotBudgetUsdCap,
        updatedBy: "admin-reset",
      });
      result.tuning = TUNING_DEFAULTS;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "reset failed" });
  }
});

// ── System-wide patch ──────────────────────────────────────────────────
const SystemPatch = z.object({
  llmEnabled: z.boolean().optional(),
  routineIntervalHours: z.number().min(0.25).max(720).optional(),
  detailBackfillLimit: z.number().int().min(0).max(500).optional(),
  agentPerplexityCap: z.number().int().min(0).max(100).optional(),
  defaultBotBudgetUsdCap: z.number().min(0).max(10000).optional(),
});

router.patch("/admin/tunables/system", requireAdmin, async (req: Request, res: Response) => {
  const parsed = SystemPatch.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const { llmEnabled, ...tuningPatch } = parsed.data;
  try {
    if (llmEnabled !== undefined) {
      await setFlag("llm_enabled", llmEnabled ? "true" : "false", req.headers["x-admin-key"] ? "admin-api" : "system");
    }
    if (Object.keys(tuningPatch).length > 0) {
      await saveTuning({ ...tuningPatch, updatedBy: "admin-api" });
    }
    const system = await snapshotSystem();
    res.json({ ok: true, system });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "system update failed" });
  }
});

export default router;
