import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  capabilityAssessmentsTable,
  industriesTable,
  capabilityInsightsTable,
  industryLeaderboardTable,
  industryWhitePapersTable,
  ontologyIndustryAdaptersTable,
  csuitePerspectivesTable,
  caseStudyContentTable,
  agentRunsTable,
  agentMemoriesTable,
} from "@workspace/db";
import { desc, count, gte, sql, eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { backfillAiNarratives } from "../services/alpha/enrich";
import { getTuning, saveTuning, TUNING_DEFAULTS } from "../services/agent-tuning";
import { provisionBot, disableBot, setBotStatus, listBots, listAvailablePersonas } from "../services/bots/provisioning";
import { listPersonas } from "../services/bots/personas";
import { getBotBudgetStatus, getSystemBudgetStatus } from "../services/bots/budget";
import { triggerBotTickNow } from "../services/agent/scheduler";
import { logger as log } from "../lib/logger";

const router: IRouter = Router();

let aiBackfillState: { running: boolean; updated: number; failed: number; total: number; startedAt: string | null; finishedAt: string | null; lastError: string | null } = {
  running: false, updated: 0, failed: 0, total: 0, startedAt: null, finishedAt: null, lastError: null,
};

router.use("/admin", requireAdmin);

router.get("/admin/overview", async (_req, res) => {
  const now = new Date();
  const day = new Date(now.getTime() - 86400000);
  const week = new Date(now.getTime() - 7 * 86400000);
  const month = new Date(now.getTime() - 30 * 86400000);

  const [assessments, agentRuns, memories, openrouterResp] = await Promise.all([
    db.select({
      total: count(),
      completed: sql<number>`count(case when status = 'complete' then 1 end)::int`,
      last24h: sql<number>`count(case when created_at >= ${day.toISOString()} then 1 end)::int`,
      last7d: sql<number>`count(case when created_at >= ${week.toISOString()} then 1 end)::int`,
      last30d: sql<number>`count(case when created_at >= ${month.toISOString()} then 1 end)::int`,
    }).from(capabilityAssessmentsTable),

    db.select({
      total: count(),
      lastRun: sql<string>`max(started_at)`,
    }).from(agentRunsTable),

    db.select({ total: count() }).from(agentMemoriesTable),

    fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    }).then(r => r.json()).catch(() => null),
  ]);

  const costs = (openrouterResp as { data?: { usage_daily: number; usage_weekly: number; usage_monthly: number; usage: number } } | null)?.data ?? null;

  res.json({
    assessments: assessments[0],
    agent: { ...agentRuns[0], memories: memories[0].total },
    costs: costs ? {
      daily: costs.usage_daily,
      weekly: costs.usage_weekly,
      monthly: costs.usage_monthly,
      allTime: costs.usage,
    } : null,
  });
});

router.get("/admin/assessments", async (_req, res) => {
  const rows = await db
    .select({
      sessionId: capabilityAssessmentsTable.sessionId,
      companyName: capabilityAssessmentsTable.companyName,
      industry: capabilityAssessmentsTable.industry,
      opportunity: capabilityAssessmentsTable.opportunity,
      status: capabilityAssessmentsTable.status,
      confidenceScore: capabilityAssessmentsTable.confidenceScore,
      createdAt: capabilityAssessmentsTable.createdAt,
      hasVoice: sql<boolean>`voice_transcript is not null`,
      hasDocument: sql<boolean>`document_text is not null`,
      hasJobPosting: sql<boolean>`job_posting_text is not null`,
    })
    .from(capabilityAssessmentsTable)
    .orderBy(desc(capabilityAssessmentsTable.createdAt))
    .limit(100);

  res.json(rows);
});

router.get("/admin/content", async (_req, res) => {
  const industries = await db.select().from(industriesTable);

  const [insights, leaderboard, whitePapers, ontology, csuite, caseStudy] = await Promise.all([
    db.select({
      industryId: capabilityInsightsTable.industryId,
      latest: sql<string>`max(generated_at)`,
      count: count(),
    }).from(capabilityInsightsTable).groupBy(capabilityInsightsTable.industryId),

    db.select({
      industryId: industryLeaderboardTable.industryId,
      latest: sql<string>`null`,
      count: count(),
    }).from(industryLeaderboardTable).groupBy(industryLeaderboardTable.industryId),

    db.select({
      industryId: industryWhitePapersTable.industryId,
      latest: sql<string>`max(created_at)`,
      count: count(),
    }).from(industryWhitePapersTable).groupBy(industryWhitePapersTable.industryId),

    db.select({
      industryId: ontologyIndustryAdaptersTable.industryId,
      latest: sql<string>`null`,
      count: count(),
    }).from(ontologyIndustryAdaptersTable).groupBy(ontologyIndustryAdaptersTable.industryId),

    db.select({
      count: count(),
      latest: sql<string>`max(generated_at)`,
    }).from(csuitePerspectivesTable),

    db.select({
      industryId: caseStudyContentTable.industryId,
      latest: sql<string>`max(generated_at)`,
      count: count(),
    }).from(caseStudyContentTable).groupBy(caseStudyContentTable.industryId),
  ]);

  const toMap = (rows: { industryId: number | null; latest: string | null; count: number }[]) =>
    Object.fromEntries(rows.filter(r => r.industryId != null).map(r => [r.industryId, { latest: r.latest, count: r.count }]));

  res.json({
    industries,
    content: {
      insights: toMap(insights),
      leaderboard: toMap(leaderboard),
      whitePapers: toMap(whitePapers),
      ontology: toMap(ontology),
      caseStudy: toMap(caseStudy),
      csuite: { latest: csuite[0]?.latest ?? null, count: csuite[0]?.count ?? 0 },
    },
  });
});

router.get("/admin/agent-runs", async (_req, res) => {
  const runs = await db
    .select()
    .from(agentRunsTable)
    .orderBy(desc(agentRunsTable.startedAt))
    .limit(20);

  res.json(runs);
});

router.post("/admin/trigger/:tool", async (req, res) => {
  const { tool } = req.params;
  const { industrySlug } = req.body as { industrySlug?: string };

  const validTools = [
    "generate-insights", "generate-leaderboard", "generate-white-papers",
    "generate-ontology", "generate-csuite", "generate-case-study", "run-agent",
  ];

  if (!validTools.includes(tool)) {
    res.status(400).json({ error: `Unknown tool: ${tool}` });
    return;
  }

  const endpointMap: Record<string, string> = {
    "generate-insights": `/api/agent/run-insights${industrySlug ? `?industry=${industrySlug}` : ""}`,
    "generate-leaderboard": `/api/agent/run-leaderboard${industrySlug ? `?industry=${industrySlug}` : ""}`,
    "generate-white-papers": `/api/agent/run-white-papers${industrySlug ? `?industry=${industrySlug}` : ""}`,
    "generate-ontology": `/api/agent/run-ontology${industrySlug ? `?industry=${industrySlug}` : ""}`,
    "generate-csuite": `/api/agent/run-csuite`,
    "generate-case-study": `/api/agent/run-case-study${industrySlug ? `?industry=${industrySlug}` : ""}`,
    "run-agent": `/api/agent/run`,
  };

  const endpoint = endpointMap[tool];
  res.json({ triggered: true, tool, industrySlug, endpoint });
  fetch(`http://127.0.0.1:${process.env.PORT}${endpoint}`, { method: "POST" }).catch(() => null);
});

router.post("/admin/backfill-ai-narratives", async (req, res) => {
  if (aiBackfillState.running) {
    res.status(409).json({ error: "already running", state: aiBackfillState });
    return;
  }
  const { limit, capabilityIds } = req.body as { limit?: number; capabilityIds?: number[] };
  aiBackfillState = { running: true, updated: 0, failed: 0, total: 0, startedAt: new Date().toISOString(), finishedAt: null, lastError: null };
  res.json({ started: true, state: aiBackfillState });
  (async () => {
    try {
      const result = await backfillAiNarratives({ limit, capabilityIds, concurrency: 2 });
      aiBackfillState = {
        running: false,
        updated: result.updated,
        failed: result.failed,
        total: result.updated + result.failed,
        startedAt: aiBackfillState.startedAt,
        finishedAt: new Date().toISOString(),
        lastError: result.errors[0] ?? null,
      };
      log.info(`[AiBackfill] route done: ${result.updated} updated, ${result.failed} failed in ${(result.durationMs / 1000).toFixed(1)}s`);
    } catch (e) {
      aiBackfillState = {
        ...aiBackfillState,
        running: false,
        finishedAt: new Date().toISOString(),
        lastError: String(e).substring(0, 300),
      };
      log.error(`[AiBackfill] route failed: ${e}`);
    }
  })();
});

router.get("/admin/backfill-ai-narratives/status", (_req, res) => {
  res.json(aiBackfillState);
});

router.get("/admin/models", (_req, res) => {
  res.json([
    { task: "Capability detail (alpha + detail enrichment)", model: "anthropic/claude-sonnet-4.6", reason: "Marquee output — TAM/EVaR + traditional/economic/AI narratives + playbook" },
    { task: "Quadrants / value chain / company profiles", model: "anthropic/claude-sonnet-4.6", reason: "Customer-facing graph data — named vendors, $ figures, sharper synthesis" },
    { task: "C-suite questions + chart dimensions", model: "anthropic/claude-sonnet-4.6", reason: "Provocative, assumption-challenging — paired with Sonnet for scenario/metrics" },
    { task: "C-suite scenario + metrics", model: "anthropic/claude-sonnet-4.6", reason: "Grounded narrative with real numbers" },
    { task: "Case study content + studies route", model: "anthropic/claude-sonnet-4.6", reason: "ROI data, 5-year projections, KPI credibility" },
    { task: "Capability ontology relationships", model: "deepseek/deepseek-chat", reason: "Most precise logical relationship typing" },
    { task: "Assessment clarifying questions", model: "anthropic/claude-sonnet-4.6", reason: "Strategic interrogation, reveals hidden gaps (premium feature)" },
    { task: "Assessment full analysis", model: "anthropic/claude-sonnet-4.6 (8192 tokens)", reason: "Deepest reasoning — roadmap, gaps, competitor scoring (premium feature)" },
    { task: "Investment thesis memo", model: "anthropic/claude-sonnet-4.6", reason: "Premium feature — credit-deducted output" },
    { task: "Dynamic industry generation", model: "anthropic/claude-sonnet-4.6", reason: "One-time discovery, sharper capability decomposition" },
    { task: "VCE (Value Chain Economics) synthesis", model: "anthropic/claude-sonnet-4.6", reason: "Premium feature — capability-economics analysis depth" },
    { task: "Capability insights + alerts", model: "anthropic/claude-haiku-4.5", reason: "Per-capability alerts, runs frequently — speed + cost over depth" },
    { task: "Industry leaderboard", model: "anthropic/claude-haiku-4.5", reason: "Bulk extraction, speed over depth" },
    { task: "White papers", model: "anthropic/claude-haiku-4.5", reason: "Citation-style output, runs every 15 days" },
  ]);
});

router.get("/admin/agent-tuning", async (_req, res) => {
  try {
    const tuning = await getTuning({ fresh: true });
    res.json({ tuning, defaults: TUNING_DEFAULTS });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "failed to read tuning" });
  }
});

router.patch("/admin/agent-tuning", async (req, res) => {
  try {
    const body = req.body ?? {};
    const patch = {
      routineIntervalHours: typeof body.routineIntervalHours === "number" ? body.routineIntervalHours : undefined,
      detailBackfillLimit: typeof body.detailBackfillLimit === "number" ? body.detailBackfillLimit : undefined,
      agentPerplexityCap: typeof body.agentPerplexityCap === "number" ? body.agentPerplexityCap : undefined,
      updatedBy: typeof body.updatedBy === "string" ? body.updatedBy : null,
    };
    const tuning = await saveTuning(patch);
    res.json({ tuning, defaults: TUNING_DEFAULTS });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "failed to save tuning" });
  }
});

// ── Synthetic agent (bot) admin routes ──

router.get("/admin/bots", async (_req, res) => {
  try {
    const [bots, available, system] = await Promise.all([
      listBots(),
      listAvailablePersonas(),
      getSystemBudgetStatus(),
    ]);
    const personas = listPersonas();
    res.json({
      bots,
      availablePersonas: available,
      allPersonas: personas,
      systemBudget: system,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "failed to list bots" });
  }
});

router.post("/admin/bots/provision", async (req, res) => {
  try {
    const body = req.body ?? {};
    if (typeof body.personaKey !== "string") {
      res.status(400).json({ error: "personaKey is required" });
      return;
    }
    const monthlyBudgetUsdCap = typeof body.monthlyBudgetUsdCap === "number" ? body.monthlyBudgetUsdCap : undefined;
    const actorHeader = (req.headers["x-admin-actor"] as string | undefined) ?? "admin";
    const result = await provisionBot({
      personaKey: body.personaKey,
      monthlyBudgetUsdCap,
      provisionedByUserId: actorHeader,
      provisionedByEmail: typeof body.actorEmail === "string" ? body.actorEmail : null,
    });
    res.status(201).json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "provisioning failed";
    const status = msg.includes("already has an active bot") ? 409 : 400;
    res.status(status).json({ error: msg });
  }
});

router.patch("/admin/bots/:id", async (req, res) => {
  try {
    const botId = Number(req.params.id);
    if (!Number.isFinite(botId)) {
      res.status(400).json({ error: "invalid bot id" });
      return;
    }
    const body = req.body ?? {};
    const actorHeader = (req.headers["x-admin-actor"] as string | undefined) ?? "admin";
    const actorEmail = typeof body.actorEmail === "string" ? body.actorEmail : null;
    if (body.status === "disabled") {
      await disableBot(botId, { actorUserId: actorHeader, actorEmail });
    } else if (body.status === "active" || body.status === "paused") {
      await setBotStatus(botId, body.status, { actorUserId: actorHeader, actorEmail });
    } else {
      res.status(400).json({ error: "status must be 'active', 'paused', or 'disabled'" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "update failed" });
  }
});

router.post("/admin/bots/tick", async (_req, res) => {
  try {
    const r = await triggerBotTickNow();
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "tick failed" });
  }
});

router.get("/admin/bots/:id/budget", async (req, res) => {
  try {
    const botId = Number(req.params.id);
    if (!Number.isFinite(botId)) {
      res.status(400).json({ error: "invalid bot id" });
      return;
    }
    const status = await getBotBudgetStatus(botId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "failed to read budget" });
  }
});

export default router;
