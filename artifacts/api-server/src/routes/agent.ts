import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  agentRunsTable,
  agentMemoriesTable,
  agentProposalsTable,
  economicRulesTable,
  capabilitiesTable,
  industriesTable,
  cviComponentsTable,
  dvxComponentsTable,
  sourceTriangulationsTable,
} from "@workspace/db";
import { and, desc, eq, or, ilike, lt, gte, inArray } from "drizzle-orm";
import { recallMemories, type MemoryCategory } from "../services/agent/memory";
import { applyProposal, SUPPORTED_PROPOSAL_TYPES } from "../services/agent/proposal-appliers";
import { syncEconomicRulesToLetta } from "../services/agent/economic-rules-sync";
import {
  getSchedulerStatus,
  startScheduler,
  stopScheduler,
  addSSEClient,
  getConnectedClients,
  getMemoryStats,
  getAllMemories,
  allTools,
  getLettaStatus,
  getGraphStats,
  getLastConsolidation,
  runConsolidation,
  lettaReadBlock,
  lettaReadAllBlocks,
  getAllAgentPriorBlocks,
} from "../services/agent";
import { consolidationRunsTable } from "@workspace/db";
import { generateOntologyTool } from "../services/agent/tools";
import { requireAdmin } from "../middlewares/requireAdmin";
import { modelFor, generateObject } from "../services/workflows/models";
import { z } from "zod";

const router: IRouter = Router();

router.get("/agent/status", async (_req, res) => {
  try {
    const scheduler = getSchedulerStatus();
    const [latestRun] = await db.select().from(agentRunsTable)
      .orderBy(desc(agentRunsTable.startedAt)).limit(1);

    const memStats = await getMemoryStats();

    res.json({
      scheduler,
      latestRun: latestRun ? {
        id: latestRun.id,
        status: latestRun.status,
        trigger: latestRun.trigger,
        industriesEvaluated: latestRun.industriesEvaluated,
        capabilitiesResearched: latestRun.capabilitiesResearched,
        capabilitiesSkipped: latestRun.capabilitiesSkipped,
        perplexityCalls: latestRun.perplexityCalls,
        memoriesRecalled: latestRun.memoriesRecalled,
        memoriesStored: latestRun.memoriesStored,
        cviBeforeIndex: latestRun.cviBeforeIndex,
        cviAfterIndex: latestRun.cviAfterIndex,
        startedAt: latestRun.startedAt.toISOString(),
        completedAt: latestRun.completedAt?.toISOString() || null,
        errorMessage: latestRun.errorMessage,
      } : null,
      memory: memStats,
      connectedClients: getConnectedClients(),
    });
  } catch (err) {
    console.error("Agent status failed:", err);
    res.status(500).json({ error: "Failed to get agent status" });
  }
});

router.post("/agent/scheduler/start", requireAdmin, async (_req, res) => {
  startScheduler();
  res.json({ status: "started" });
});

router.post("/agent/scheduler/stop", requireAdmin, async (_req, res) => {
  stopScheduler();
  res.json({ status: "stopped" });
});

router.get("/agent/history", async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const runs = await db.select().from(agentRunsTable)
      .orderBy(desc(agentRunsTable.startedAt))
      .limit(limit);

    res.json(runs.map(r => ({
      id: r.id,
      status: r.status,
      trigger: r.trigger,
      industriesEvaluated: r.industriesEvaluated,
      capabilitiesResearched: r.capabilitiesResearched,
      capabilitiesSkipped: r.capabilitiesSkipped,
      perplexityCalls: r.perplexityCalls,
      memoriesRecalled: r.memoriesRecalled,
      memoriesStored: r.memoriesStored,
      cviBeforeIndex: r.cviBeforeIndex,
      cviAfterIndex: r.cviAfterIndex,
      decisions: r.decisions,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() || null,
      errorMessage: r.errorMessage,
    })));
  } catch (err) {
    console.error("Agent history failed:", err);
    res.status(500).json({ error: "Failed to get agent history" });
  }
});

router.get("/agent/events", (req, res) => {
  addSSEClient(res);
});

// ---------------------------------------------------------------------------
// /agent/runs/aggregates — per-agent KPI strip data for /agent-radar.
//
// Returns success-rate / avg-duration / last-error / 24h-run-count grouped by
// `trigger` (which is the closest thing to an "agent label" the table has —
// `routine`/`autonomous`/`world_scan`/`rotation`/`startup`/`rerun` etc).
// Each trigger becomes one row in the KPI strip. Cheap query: one SELECT
// over the last 24h slice of agent_runs.
// ---------------------------------------------------------------------------
router.get("/agent/runs/aggregates", async (_req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db.select().from(agentRunsTable)
      .where(gte(agentRunsTable.startedAt, since))
      .orderBy(desc(agentRunsTable.startedAt));

    // Group by trigger and compute success rate, avg duration, last error.
    const byAgent = new Map<string, {
      runs: number;
      completed: number;
      failed: number;
      totalDurationMs: number;
      lastErrorAt: string | null;
      lastRunAt: string | null;
    }>();

    for (const r of rows) {
      const agent = r.trigger || "scheduled";
      const a = byAgent.get(agent) ?? { runs: 0, completed: 0, failed: 0, totalDurationMs: 0, lastErrorAt: null, lastRunAt: null };
      a.runs += 1;
      if (r.status === "completed") a.completed += 1;
      if (r.status === "failed" || r.errorMessage) a.failed += 1;
      if (r.completedAt) a.totalDurationMs += r.completedAt.getTime() - r.startedAt.getTime();
      if (r.errorMessage && !a.lastErrorAt) a.lastErrorAt = r.startedAt.toISOString();
      if (!a.lastRunAt) a.lastRunAt = r.startedAt.toISOString();
      byAgent.set(agent, a);
    }

    const aggregates = Array.from(byAgent.entries()).map(([agent, a]) => ({
      agent,
      runs24h: a.runs,
      successRate: a.runs > 0 ? Math.round((a.completed / a.runs) * 100) : 0,
      failedCount: a.failed,
      avgDurationMs: a.completed > 0 ? Math.round(a.totalDurationMs / a.completed) : 0,
      lastErrorAt: a.lastErrorAt,
      lastRunAt: a.lastRunAt,
    })).sort((a, b) => b.runs24h - a.runs24h);

    res.json({ since: since.toISOString(), aggregates });
  } catch (err) {
    console.error("Agent runs aggregates failed:", err);
    res.status(500).json({ error: "Failed to compute aggregates" });
  }
});

// ---------------------------------------------------------------------------
// /agent/runs/replay — historical event replay for the scrubber.
//
// Returns a virtual event stream synthesized from `agent_runs` records since
// the given timestamp (defaults to 60min ago). Each run yields up to 4
// pseudo-events: run_started, decide_complete, cvi_updated, and either
// run_completed or run_failed. The shape matches the live SSE event types
// so the same renderer can reuse them.
// ---------------------------------------------------------------------------
router.get("/agent/runs/replay", async (req, res) => {
  try {
    const sinceParam = typeof req.query.since === "string" ? req.query.since : "";
    const sinceDate = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 60 * 60 * 1000);
    if (!Number.isFinite(sinceDate.getTime())) {
      res.status(400).json({ error: "invalid `since` ISO timestamp" });
      return;
    }

    const runs = await db.select().from(agentRunsTable)
      .where(gte(agentRunsTable.startedAt, sinceDate))
      .orderBy(desc(agentRunsTable.startedAt))
      .limit(200);

    type ReplayEvent = {
      type: string;
      timestamp: string;
      runId: number;
      agent: string;
      phase?: string;
      message?: string;
      overallIndex?: number;
      researched?: number;
      skipped?: number;
      error?: string;
    };
    const events: ReplayEvent[] = [];

    for (const r of runs) {
      const agent = r.trigger || "scheduled";
      events.push({
        type: "run_started",
        timestamp: r.startedAt.toISOString(),
        runId: r.id,
        agent,
        message: `Run #${r.id} started (${agent})`,
      });
      if (r.capabilitiesResearched > 0 || r.capabilitiesSkipped > 0) {
        events.push({
          type: "decide_complete",
          timestamp: r.startedAt.toISOString(),
          runId: r.id,
          agent,
          researched: r.capabilitiesResearched,
          skipped: r.capabilitiesSkipped,
        });
      }
      if (r.cviAfterIndex != null) {
        events.push({
          type: "cvi_updated",
          timestamp: (r.completedAt ?? r.startedAt).toISOString(),
          runId: r.id,
          agent,
          overallIndex: r.cviAfterIndex,
        });
      }
      if (r.errorMessage) {
        events.push({
          type: "run_failed",
          timestamp: (r.completedAt ?? r.startedAt).toISOString(),
          runId: r.id,
          agent,
          error: r.errorMessage,
        });
      } else if (r.completedAt) {
        events.push({
          type: "run_completed",
          timestamp: r.completedAt.toISOString(),
          runId: r.id,
          agent,
          message: `Run #${r.id} completed`,
        });
      }
    }

    // Chronological for scrubbing.
    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    res.json({ since: sinceDate.toISOString(), count: events.length, events });
  } catch (err) {
    console.error("Agent runs replay failed:", err);
    res.status(500).json({ error: "Failed to build replay stream" });
  }
});

// `/stream` is the spec'd public name (referenced in docs and the new
// shared `useEventStream` client). Keep `/agent/events` as the legacy alias
// — both fan out to the same SSE bus so existing consumers don't break.
router.get("/agent/events/stream", (req, res) => {
  addSSEClient(res);
});

router.get("/agent/memories", async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const memories = await getAllMemories(limit);

    res.json(memories.map(m => ({
      id: m.id,
      type: m.memoryType,
      content: m.content,
      metadata: m.metadata,
      relevanceScore: m.relevanceScore,
      accessCount: m.accessCount,
      createdAt: m.createdAt.toISOString(),
      source: m.source,
    })));
  } catch (err) {
    console.error("Agent memories failed:", err);
    res.status(500).json({ error: "Failed to get agent memories" });
  }
});

router.post("/agent/run-ontology", requireAdmin, async (_req, res) => {
  try {
    const { db: dbConn, industriesTable } = await import("@workspace/db");
    const industries = await dbConn.select({ slug: industriesTable.slug, name: industriesTable.name }).from(industriesTable);
    const results: Record<string, unknown> = {};
    for (const industry of industries) {
      try {
        const raw = await generateOntologyTool.invoke({ industrySlug: industry.slug });
        results[industry.slug] = JSON.parse(raw);
      } catch (err) {
        results[industry.slug] = { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    res.json({ results });
  } catch (err) {
    console.error("[run-ontology] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/agent/model-compare", async (req, res) => {
  const industrySlug = (req.query.industry as string) || "healthcare";
  try {
    const { db: dbConn, industriesTable, capabilitiesTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const mod = await import("@workspace/integrations-anthropic-ai");
    const client = mod.anthropic;

    const [industry] = await dbConn.select().from(industriesTable).where(eq(industriesTable.slug, industrySlug));
    if (!industry) { res.status(404).json({ error: "Industry not found" }); return; }

    const caps = await dbConn.select({ name: capabilitiesTable.name, slug: capabilitiesTable.slug })
      .from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industry.id));

    const prompt = `You are a capability economics ontologist. Generate 4 capability relationship examples for the ${industry.name} industry.

Available capabilities:
${caps.map(c => `- ${c.name} (slug: ${c.slug})`).join("\n")}

Return JSON of the form { "relationships": [4 entries] } where each entry has:
{
  "sourceSlug": "slug",
  "targetSlug": "slug",
  "relationshipType": "enables|depends_on|competes_with|substitutes",
  "strength": "strong|moderate|weak",
  "description": "Precise 1-sentence explanation with real-world strategic context",
  "industryInsight": "Why this relationship specifically matters for ${industry.name} performance and ROI"
}

Be specific, strategic, and grounded in real ${industry.name} industry dynamics. No generic responses.`;

    const RelSchema = z.object({
      sourceSlug: z.string(),
      targetSlug: z.string(),
      relationshipType: z.enum(["enables", "depends_on", "competes_with", "substitutes"]),
      strength: z.enum(["strong", "moderate", "weak"]),
      description: z.string(),
      industryInsight: z.string(),
    });

    const runViaOpenRouter = async (model: string) => {
      const start = Date.now();
      if (!process.env.OPENROUTER_API_KEY) {
        return { model, latencyMs: 0, result: null, rawLength: 0, error: "No OPENROUTER_API_KEY" };
      }
      try {
        const { object } = await generateObject({
          model: modelFor(model),
          schema: z.object({ relationships: z.array(RelSchema) }),
          prompt,
          maxTokens: 1024,
        });
        const result = object.relationships;
        return { model, latencyMs: Date.now() - start, result, rawLength: JSON.stringify(result).length, error: null };
      } catch (err) {
        return { model, latencyMs: Date.now() - start, result: null, rawLength: 0, error: err instanceof Error ? err.message : String(err) };
      }
    };

    const [sonnet, deepseek] = await Promise.all([
      runViaOpenRouter("anthropic/claude-sonnet-4.6"),
      runViaOpenRouter("deepseek/deepseek-chat"),
    ]);

    res.json({ industry: industry.name, models: { sonnet, deepseek } });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/agent/tools", (_req, res) => {
  res.json({
    tools: allTools.map(t => ({
      name: t.name,
      description: t.description,
    })),
    integrations: {
      mem0: {
        connected: !!(process.env.MEM0_BASE_URL && process.env.MEM0_API_KEY),
        // Derive cloud vs self-hosted from the MEM0_BASE_URL hostname rather
        // than hardcoding — same regex memory.ts uses for auth-scheme
        // selection. After the 2026-05-17 cutover, prod is Mem0 Cloud.
        provider: /(^|\/\/|\.)mem0\.ai(\/|$|:)/i.test(process.env.MEM0_BASE_URL ?? "")
          ? "mem0-cloud"
          : "mem0-self-hosted",
        host: process.env.MEM0_BASE_URL ?? null,
      },
      langchain: { version: "core", tools: allTools.length },
      langgraph: { nodes: ["evaluate", "recall", "decide", "research", "compute", "reflect", "memorize", "generateContent", "finalize"] },
      perplexity: { connected: !!process.env.PERPLEXITY_API_KEY },
      letta: getLettaStatus(),
    },
  });
});

router.get("/agent/memory/stats", async (_req, res) => {
  try {
    const [memStats, graphStats, lastConsolidation] = await Promise.all([
      getMemoryStats(),
      getGraphStats(),
      getLastConsolidation(),
    ]);
    // Forward path: read agent priors from PostgresStore.
    // The legacy Letta block read is retained below so we report both
    // sources while Phase 1.8 migration is in flight. Once Letta is
    // deleted in Step 6 the lettaBlocks branch goes away.
    let storeBlocks: Record<string, { length: number; preview: string } | null> = {};
    try {
      const labels = ["persona", "industry_priors", "research_strategy", "current_focus", "economic_rules", "project_focus", "market_context"];
      const all = await getAllAgentPriorBlocks(labels);
      for (const [label, v] of Object.entries(all)) {
        storeBlocks[label] = v ? { length: v.length, preview: v.slice(0, 240) } : null;
      }
    } catch {
      // storePing in /api/health/services covers the failure case; if
      // the store is down here we just return empty blocks.
    }

    let lettaBlocks: Record<string, { length: number; preview: string } | null> = {};
    const lettaStatus = getLettaStatus();
    if (lettaStatus.connected) {
      try {
        const all = await lettaReadAllBlocks();
        for (const [label, v] of Object.entries(all)) {
          lettaBlocks[label] = v ? { length: v.length, preview: v.slice(0, 240) } : null;
        }
      } catch {
        // helper already swallows individual failures
      }
    }
    res.json({
      memory: memStats,
      graph: graphStats,
      lastConsolidation: lastConsolidation ? {
        id: lastConsolidation.id,
        startedAt: lastConsolidation.startedAt.toISOString(),
        completedAt: lastConsolidation.completedAt?.toISOString() ?? null,
        observationsScanned: lastConsolidation.observationsScanned,
        patternsConsolidated: lastConsolidation.patternsConsolidated,
        redundantDeleted: lastConsolidation.redundantDeleted,
        archivalInserted: lastConsolidation.archivalInserted,
        errorMessage: lastConsolidation.errorMessage,
      } : null,
      letta: { ...lettaStatus, blocks: lettaBlocks },
      sharedStore: { blocks: storeBlocks },
    });
  } catch (err) {
    console.error("[/agent/memory/stats] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "stats failed" });
  }
});

router.post("/agent/memory/consolidate", requireAdmin, async (_req, res) => {
  try {
    const result = await runConsolidation();
    res.json({ status: "ok", result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "consolidate failed" });
  }
});

// History of recent consolidation runs — feeds the admin UI panel
router.get("/agent/consolidation/runs", requireAdmin, async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(50, Math.floor(rawLimit)) : 10;
    const rows = await db.select().from(consolidationRunsTable)
      .orderBy(desc(consolidationRunsTable.startedAt))
      .limit(limit);
    res.json({
      runs: rows.map(r => ({
        id: r.id,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
        durationMs: r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null,
        observationsScanned: r.observationsScanned,
        patternsConsolidated: r.patternsConsolidated,
        redundantDeleted: r.redundantDeleted,
        archivalInserted: r.archivalInserted,
        errorMessage: r.errorMessage,
        status: r.errorMessage ? "failed" : r.completedAt ? "completed" : "running",
      })),
      enabled: (process.env.CONSOLIDATOR_ENABLED ?? "true").toLowerCase() !== "false",
      claudeConfigured: !!process.env.OPENROUTER_API_KEY,
    });
  } catch (err) {
    console.error("[/agent/consolidation/runs] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "list failed" });
  }
});

// ---------------------------------------------------------------------------
// Letta autonomous-tool callback endpoints (/api/agent/tools/*)
//
// These are called BY the Letta server when its agent invokes one of the
// custom tools registered via services/agent/letta-tools.ts. The Letta
// container holds the shared secret in INFLEXCVI_AGENT_TOOL_KEY and sends
// it on every request as X-Agent-Tool-Key. Without these endpoints, the
// Letta agent has no autonomous read access to platform state.
// ---------------------------------------------------------------------------

function requireAgentToolKey(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.INFLEXCVI_AGENT_TOOL_KEY;
  if (!expected) {
    res.status(503).json({
      error: "INFLEXCVI_AGENT_TOOL_KEY not configured on api-server — autonomous tools disabled",
    });
    return;
  }
  const got = req.header("x-agent-tool-key");
  if (!got || got !== expected) {
    res.status(401).json({ error: "invalid or missing X-Agent-Tool-Key" });
    return;
  }
  next();
}

router.get("/agent/tools/capability-state", requireAgentToolKey, async (req, res) => {
  try {
    const industry = String(req.query.industry ?? "").trim();
    const capability = String(req.query.capability ?? "").trim();
    if (!industry || !capability) {
      res.status(400).json({ error: "industry and capability query params are required" });
      return;
    }

    const [ind] = await db.select().from(industriesTable).where(
      or(eq(industriesTable.slug, industry), ilike(industriesTable.name, industry)),
    ).limit(1);
    if (!ind) {
      res.json({ found: false, reason: `no industry matched "${industry}"` });
      return;
    }

    const [cap] = await db.select().from(capabilitiesTable).where(and(
      eq(capabilitiesTable.industryId, ind.id),
      or(eq(capabilitiesTable.slug, capability), ilike(capabilitiesTable.name, capability)),
    )).limit(1);
    if (!cap) {
      res.json({ found: false, reason: `no capability matched "${capability}" in ${ind.name}` });
      return;
    }

    const [cvi] = await db.select().from(cviComponentsTable).where(and(
      eq(cviComponentsTable.capabilityId, cap.id),
      eq(cviComponentsTable.industryId, ind.id),
    )).limit(1);
    const [dvx] = await db.select().from(dvxComponentsTable).where(and(
      eq(dvxComponentsTable.capabilityId, cap.id),
      eq(dvxComponentsTable.industryId, ind.id),
    )).limit(1);

    res.json({
      found: true,
      industry: { id: ind.id, name: ind.name, slug: ind.slug },
      capability: { id: cap.id, name: cap.name, slug: cap.slug },
      cvi: cvi ? {
        score: cvi.consensusScore,
        posteriorVariance: cvi.posteriorVariance,
        ciLow: cvi.ciLow,
        ciHigh: cvi.ciHigh,
        confidence: cvi.confidence,
        velocity: cvi.velocity,
        updatedAt: cvi.updatedAt?.toISOString() ?? null,
      } : null,
      dvx: dvx ? {
        score: dvx.disruptionScore,
        velocity: dvx.velocity,
        monthsToDisplacement: dvx.monthsToDisplacement,
        topDisruptors: dvx.topDisruptors,
        matchedPatternSlug: dvx.matchedPatternSlug,
        updatedAt: dvx.updatedAt?.toISOString() ?? null,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "lookup failed" });
  }
});

router.get("/agent/tools/recall", requireAgentToolKey, async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) {
      res.status(400).json({ error: "q query param is required" });
      return;
    }
    const limit = Math.max(1, Math.min(20, Number(req.query.limit ?? 5) || 5));
    const category = req.query.category ? String(req.query.category) as MemoryCategory : undefined;

    const memories = await recallMemories(q, undefined, limit, category ? { category } : {});
    res.json({
      results: memories.map(m => ({
        content: m.content,
        category: m.category,
        runScope: m.runScope,
        score: m.relevanceScore,
        createdAt: m.createdAt.toISOString(),
        source: m.source,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "recall failed" });
  }
});

router.get("/agent/tools/reflections", requireAgentToolKey, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(20, Number(req.query.limit ?? 5) || 5));
    const runs = await db.select().from(agentRunsTable)
      .orderBy(desc(agentRunsTable.startedAt))
      .limit(limit);
    res.json({
      reflections: runs.map(r => ({
        runId: r.id,
        trigger: r.trigger,
        status: r.status,
        industriesEvaluated: r.industriesEvaluated,
        capabilitiesResearched: r.capabilitiesResearched,
        capabilitiesSkipped: r.capabilitiesSkipped,
        memoriesStored: r.memoriesStored,
        cviBefore: r.cviBeforeIndex,
        cviAfter: r.cviAfterIndex,
        finishedAt: r.completedAt?.toISOString() ?? null,
        durationMs: r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "reflections fetch failed" });
  }
});

// ---------------------------------------------------------------------------
// Agent write-tool callbacks (called BY Letta when its agent invokes
// one of the propose_* tools registered in services/agent/letta-tools.ts).
// Auth: shared X-Agent-Tool-Key header. These ONLY queue proposals into
// agent_proposals; the canonical write happens later when an admin
// approves via /api/admin/agent/proposals/:id/approve below.
// Per plan Phase 1.5.4.
// ---------------------------------------------------------------------------

router.post("/agent/tools/propose-capability-flag", requireAgentToolKey, async (req, res) => {
  try {
    const body = req.body as { capability_id?: number; severity?: string; reason?: string; rationale?: string };
    const capabilityId = Number(body.capability_id);
    const severity = String(body.severity ?? "");
    const reason = String(body.reason ?? "");
    if (!Number.isFinite(capabilityId)) {
      res.status(400).json({ error: "capability_id (numeric) required" });
      return;
    }
    if (!["watch", "concern", "alert"].includes(severity)) {
      res.status(400).json({ error: "severity must be watch | concern | alert" });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: "reason required" });
      return;
    }
    const [row] = await db.insert(agentProposalsTable).values({
      proposalType: "capability_flag",
      targetEntity: `capability:${capabilityId}`,
      payload: { capability_id: capabilityId, severity, reason },
      agentRationale: body.rationale ?? null,
    }).returning();
    res.json({ proposalId: row.id, status: "queued" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "propose failed" });
  }
});

router.post("/agent/tools/propose-economic-rule-change", requireAgentToolKey, async (req, res) => {
  try {
    const body = req.body as { rule_key?: string; new_value?: unknown; rationale?: string };
    const ruleKey = String(body.rule_key ?? "");
    if (!ruleKey) {
      res.status(400).json({ error: "rule_key required" });
      return;
    }
    if (body.new_value === undefined) {
      res.status(400).json({ error: "new_value required" });
      return;
    }
    if (!body.rationale) {
      res.status(400).json({ error: "rationale required for rule changes" });
      return;
    }
    // Pre-validate that the rule key exists — fail at queue time, not
    // apply time, so the agent gets immediate feedback on typos.
    const [existing] = await db.select().from(economicRulesTable).where(eq(economicRulesTable.key, ruleKey)).limit(1);
    if (!existing) {
      res.status(404).json({ error: `unknown rule_key "${ruleKey}"` });
      return;
    }
    const [row] = await db.insert(agentProposalsTable).values({
      proposalType: "economic_rule_change",
      targetEntity: `economic_rule:${ruleKey}`,
      payload: { rule_key: ruleKey, new_value: body.new_value, current_value: existing.value },
      agentRationale: body.rationale,
    }).returning();
    res.json({ proposalId: row.id, status: "queued" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "propose failed" });
  }
});

router.post("/agent/tools/propose-industry-prior-update", requireAgentToolKey, async (req, res) => {
  try {
    const body = req.body as { industry_slug?: string; prior_text?: string; source_runs?: number[]; rationale?: string };
    const industrySlug = String(body.industry_slug ?? "");
    const priorText = String(body.prior_text ?? "");
    if (!industrySlug) {
      res.status(400).json({ error: "industry_slug required" });
      return;
    }
    if (!priorText) {
      res.status(400).json({ error: "prior_text required" });
      return;
    }
    const [row] = await db.insert(agentProposalsTable).values({
      proposalType: "industry_prior_update",
      targetEntity: `industry:${industrySlug}`,
      payload: { industry_slug: industrySlug, prior_text: priorText, source_runs: body.source_runs ?? [] },
      agentRationale: body.rationale ?? null,
    }).returning();
    res.json({ proposalId: row.id, status: "queued" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "propose failed" });
  }
});

// ---------------------------------------------------------------------------
// Admin: review queue + economic-rules CRUD.
// All gated by requireAdmin (x-admin-key header).
// Per plan Phase 1.5.4.
// ---------------------------------------------------------------------------

/**
 * Compute a per-proposal "quality score" so admins can triage the queue
 * highest-quality-first. Composition:
 *   - Source diversity   (40%): distinct source labels behind the proposal.
 *                                Caps at 5 sources for a perfect score.
 *   - Triangulation conf (35%): average source weight on the capability's
 *                                source_triangulations (when the proposal
 *                                targets a capability/industry pair).
 *   - Corroboration      (25%): does the proposal include rationale text and
 *                                more than one source? Encourages the agent
 *                                to surface evidence, not bare-fact updates.
 *
 * Score is 0-100, integer. Higher = more confident the proposal is grounded.
 */
function computeProposalQualityScore(args: {
  payload: Record<string, unknown> | null | undefined;
  rationale: string | null | undefined;
  triangulations: Array<{ sourceLabel: string; weight: number | null }>;
}): { score: number; sourceDiversity: number; triangulationConfidence: number; hasCorroboration: boolean } {
  const payload = args.payload ?? {};
  const rationale = args.rationale ?? "";

  // Pull source labels from payload (.sources / .citations / .evidence) AND
  // from the capability's source_triangulations.
  const fromPayloadSources = new Set<string>();
  const addCandidate = (val: unknown) => {
    if (typeof val === "string" && val.trim().length > 0) fromPayloadSources.add(val.trim());
    if (val && typeof val === "object") {
      if (typeof (val as { label?: unknown }).label === "string") fromPayloadSources.add(String((val as { label?: unknown }).label).trim());
      if (typeof (val as { source?: unknown }).source === "string") fromPayloadSources.add(String((val as { source?: unknown }).source).trim());
      if (typeof (val as { url?: unknown }).url === "string") fromPayloadSources.add(String((val as { url?: unknown }).url).trim());
    }
  };
  for (const key of ["sources", "citations", "evidence", "supportingSources"]) {
    const v = (payload as Record<string, unknown>)[key];
    if (Array.isArray(v)) v.forEach(addCandidate);
    else if (v) addCandidate(v);
  }
  // Union with triangulation labels so the score reflects all available evidence.
  const allSources = new Set<string>(fromPayloadSources);
  for (const t of args.triangulations) allSources.add(t.sourceLabel);

  const distinctSourceCount = allSources.size;
  const sourceDiversityComponent = Math.min(distinctSourceCount, 5) / 5; // 0..1

  // Triangulation confidence — average weight, clamped to [0,1].
  let triangulationConfidence = 0;
  if (args.triangulations.length > 0) {
    const weights = args.triangulations.map(t => Math.min(1, Math.max(0, Number(t.weight ?? 0))));
    triangulationConfidence = weights.reduce((s, w) => s + w, 0) / weights.length;
  }

  // Corroboration — multi-source AND non-trivial rationale.
  const hasCorroboration = distinctSourceCount >= 2 && rationale.trim().length >= 40;

  const score = Math.round(100 * (
    0.40 * sourceDiversityComponent
    + 0.35 * triangulationConfidence
    + 0.25 * (hasCorroboration ? 1 : 0)
  ));

  return {
    score: Math.min(100, Math.max(0, score)),
    sourceDiversity: distinctSourceCount,
    triangulationConfidence: Number(triangulationConfidence.toFixed(2)),
    hasCorroboration,
  };
}

/** Pull `capabilityId` / `industryId` out of a payload's common shapes. */
function extractCapabilityAndIndustry(payload: Record<string, unknown> | null | undefined): { capabilityId: number | null; industryId: number | null } {
  if (!payload) return { capabilityId: null, industryId: null };
  const capCandidate = payload.capabilityId ?? payload.capability_id ?? payload.cap_id;
  const indCandidate = payload.industryId ?? payload.industry_id;
  const cap = typeof capCandidate === "number" ? capCandidate : Number(capCandidate);
  const ind = typeof indCandidate === "number" ? indCandidate : Number(indCandidate);
  return {
    capabilityId: Number.isFinite(cap) && cap > 0 ? cap : null,
    industryId: Number.isFinite(ind) && ind > 0 ? ind : null,
  };
}

router.get("/admin/agent/proposals", requireAdmin, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : "pending";
    const limit = Math.max(1, Math.min(200, Number(req.query.limit ?? 50) || 50));
    // "quality" (default) — highest-quality first; "recent" — fallback for parity with the old behaviour.
    const sort = String(req.query.sort ?? "quality");

    const rows = await db.select().from(agentProposalsTable)
      .where(eq(agentProposalsTable.status, status))
      .orderBy(desc(agentProposalsTable.createdAt))
      .limit(limit);

    // Batch-load triangulations for every capability the queue references so
    // we don't fan out N queries.
    const capIds = Array.from(new Set(
      rows.map(r => extractCapabilityAndIndustry(r.payload as Record<string, unknown> | null).capabilityId)
        .filter((id): id is number => id !== null),
    ));
    const triByCap = new Map<number, Array<{ sourceLabel: string; weight: number | null }>>();
    if (capIds.length > 0) {
      const tris = await db.select({
        capabilityId: sourceTriangulationsTable.capabilityId,
        sourceLabel: sourceTriangulationsTable.sourceLabel,
        weight: sourceTriangulationsTable.weight,
      }).from(sourceTriangulationsTable).where(inArray(sourceTriangulationsTable.capabilityId, capIds));
      for (const t of tris) {
        const arr = triByCap.get(t.capabilityId) ?? [];
        arr.push({ sourceLabel: t.sourceLabel, weight: t.weight });
        triByCap.set(t.capabilityId, arr);
      }
    }

    const enriched = rows.map(r => {
      const { capabilityId } = extractCapabilityAndIndustry(r.payload as Record<string, unknown> | null);
      const triangulations = capabilityId !== null ? (triByCap.get(capabilityId) ?? []) : [];
      const quality = computeProposalQualityScore({
        payload: r.payload as Record<string, unknown> | null,
        rationale: r.agentRationale,
        triangulations,
      });
      return {
        id: r.id,
        agentRunId: r.agentRunId,
        proposalType: r.proposalType,
        targetEntity: r.targetEntity,
        payload: r.payload,
        agentRationale: r.agentRationale,
        status: r.status,
        proposedBy: r.proposedBy,
        reviewedBy: r.reviewedBy,
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
        reviewNotes: r.reviewNotes,
        appliedAt: r.appliedAt?.toISOString() ?? null,
        expiresAt: r.expiresAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        qualityScore: quality.score,
        qualityBreakdown: {
          sourceDiversity: quality.sourceDiversity,
          triangulationConfidence: quality.triangulationConfidence,
          hasCorroboration: quality.hasCorroboration,
        },
      };
    });

    if (sort === "quality") {
      enriched.sort((a, b) => {
        if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }

    res.json({
      status,
      count: enriched.length,
      sort,
      supportedTypes: SUPPORTED_PROPOSAL_TYPES,
      proposals: enriched,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "list failed" });
  }
});

router.post("/admin/agent/proposals/:id/approve", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid proposal id" });
    return;
  }
  try {
    const reviewedBy = (req.header("x-admin-actor") || "admin").slice(0, 120);
    const reviewNotes = (req.body as { reviewNotes?: string })?.reviewNotes ?? null;

    const [proposal] = await db.select().from(agentProposalsTable).where(eq(agentProposalsTable.id, id)).limit(1);
    if (!proposal) {
      res.status(404).json({ error: "proposal not found" });
      return;
    }
    if (proposal.status !== "pending") {
      res.status(409).json({ error: `proposal already ${proposal.status}` });
      return;
    }

    const result = await applyProposal(proposal.proposalType, {
      proposalId: proposal.id,
      payload: proposal.payload,
      reviewedBy,
    });

    await db.update(agentProposalsTable).set({
      status: "applied",
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes,
      appliedAt: result.appliedAt,
    }).where(eq(agentProposalsTable.id, id));

    res.json({ id, status: "applied", summary: result.summary, appliedAt: result.appliedAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "approve failed" });
  }
});

router.post("/admin/agent/proposals/:id/reject", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid proposal id" });
    return;
  }
  try {
    const reviewedBy = (req.header("x-admin-actor") || "admin").slice(0, 120);
    const reviewNotes = (req.body as { reviewNotes?: string })?.reviewNotes;
    if (!reviewNotes) {
      res.status(400).json({ error: "reviewNotes required when rejecting" });
      return;
    }
    const [proposal] = await db.select().from(agentProposalsTable).where(eq(agentProposalsTable.id, id)).limit(1);
    if (!proposal) {
      res.status(404).json({ error: "proposal not found" });
      return;
    }
    if (proposal.status !== "pending") {
      res.status(409).json({ error: `proposal already ${proposal.status}` });
      return;
    }
    await db.update(agentProposalsTable).set({
      status: "rejected",
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes,
    }).where(eq(agentProposalsTable.id, id));
    res.json({ id, status: "rejected" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "reject failed" });
  }
});

// Maintenance endpoint: expire stale pending proposals (ones past
// their 30-day window). Safe to call any time; idempotent.
router.post("/admin/agent/proposals/expire-stale", requireAdmin, async (_req, res) => {
  try {
    const result = await db.update(agentProposalsTable).set({
      status: "expired",
      reviewedAt: new Date(),
      reviewNotes: "Auto-expired (>30 days pending)",
    }).where(and(
      eq(agentProposalsTable.status, "pending"),
      lt(agentProposalsTable.expiresAt, new Date()),
    )).returning({ id: agentProposalsTable.id });
    res.json({ expired: result.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "expire failed" });
  }
});

router.get("/admin/economic-rules", requireAdmin, async (_req, res) => {
  try {
    const rows = await db.select().from(economicRulesTable);
    res.json({
      count: rows.length,
      rules: rows.map(r => ({
        key: r.key,
        value: r.value,
        unit: r.unit,
        description: r.description,
        lastUpdatedBy: r.lastUpdatedBy,
        lastUpdatedAt: r.lastUpdatedAt.toISOString(),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "list failed" });
  }
});

/**
 * POST /admin/economic-rules/preview-impact
 *
 * Given a rule key + proposed new value (or a delta against the current
 * value), return how many cvi_components rows would change classification.
 *
 * For every rule key that maps to a known cvi_components field we report:
 *   - currentValue       : the current rule value
 *   - proposedValue      : value after the slider movement
 *   - delta              : signed proposed - current
 *   - currentlyOver      : rows currently above the current threshold
 *   - currentlyUnder     : rows currently below the current threshold
 *   - enteringWatch      : rows that would newly enter the watch zone
 *                          (cross from "safe" to "concern" under the new threshold)
 *   - leavingWatch       : rows that would newly leave the watch zone
 *   - netDelta           : enteringWatch - leavingWatch
 *
 * For unrecognized keys we still return the currentValue / proposedValue
 * pair so the UI can fall back to a copy-only preview.
 */
const COMPONENT_FIELD_FOR_KEY: Record<string, "consensusScore" | "posteriorVariance" | "economicMultiplier" | "velocity"> = {
  cvi_floor: "consensusScore",
  cvi_ceiling_for_attention: "consensusScore",
  cvi_posterior_variance_max: "posteriorVariance",
  economic_multiplier_min: "economicMultiplier",
  dvx_velocity_band_low: "velocity",
  dvx_velocity_band_high: "velocity",
};
// Direction of the comparison — "below" means rows where value < threshold
// are the ones that enter the watchlist.
const COMPONENT_DIRECTION_FOR_KEY: Record<string, "below" | "above"> = {
  cvi_floor: "below",
  cvi_ceiling_for_attention: "above",
  cvi_posterior_variance_max: "above",
  economic_multiplier_min: "below",
  dvx_velocity_band_low: "below",
  dvx_velocity_band_high: "above",
};

router.post("/admin/economic-rules/preview-impact", requireAdmin, async (req, res) => {
  try {
    const body = req.body as { key?: unknown; proposedValue?: unknown; delta?: unknown };
    const key = typeof body.key === "string" ? body.key : "";
    if (!key) { res.status(400).json({ error: "key is required" }); return; }

    const [rule] = await db.select().from(economicRulesTable).where(eq(economicRulesTable.key, key)).limit(1);
    if (!rule) { res.status(404).json({ error: `unknown rule "${key}"` }); return; }

    const currentValueRaw = rule.value;
    const currentValueNum = typeof currentValueRaw === "number" ? currentValueRaw : Number(currentValueRaw);
    if (!Number.isFinite(currentValueNum)) {
      res.json({
        key,
        currentValue: currentValueRaw,
        proposedValue: body.proposedValue ?? null,
        supported: false,
        message: "Current value is non-numeric; preview is unavailable.",
      });
      return;
    }

    let proposedValueNum: number;
    if (body.proposedValue !== undefined) {
      proposedValueNum = typeof body.proposedValue === "number" ? body.proposedValue : Number(body.proposedValue);
    } else if (body.delta !== undefined) {
      const deltaNum = typeof body.delta === "number" ? body.delta : Number(body.delta);
      proposedValueNum = currentValueNum + deltaNum;
    } else {
      res.status(400).json({ error: "either proposedValue or delta must be supplied" });
      return;
    }
    if (!Number.isFinite(proposedValueNum)) {
      res.status(400).json({ error: "proposedValue / delta could not be coerced to a number" });
      return;
    }

    const field = COMPONENT_FIELD_FOR_KEY[key];
    const direction = COMPONENT_DIRECTION_FOR_KEY[key];
    if (!field || !direction) {
      res.json({
        key,
        currentValue: currentValueNum,
        proposedValue: proposedValueNum,
        delta: proposedValueNum - currentValueNum,
        supported: false,
        message: `Rule "${key}" does not map to a cvi_components field; live impact preview is unavailable.`,
      });
      return;
    }

    // Pull just the field we care about — cvi_components is bounded
    // (one row per cap×industry), so this is small enough to crunch in JS
    // and lets us compute crossings against ANY threshold cheaply.
    const components = await db.select({
      consensusScore: cviComponentsTable.consensusScore,
      posteriorVariance: cviComponentsTable.posteriorVariance,
      economicMultiplier: cviComponentsTable.economicMultiplier,
      velocity: cviComponentsTable.velocity,
    }).from(cviComponentsTable);

    let currentlyOver = 0;
    let currentlyUnder = 0;
    let enteringWatch = 0;
    let leavingWatch = 0;

    for (const c of components) {
      const v = c[field];
      if (v == null || !Number.isFinite(Number(v))) continue;
      const num = Number(v);
      const wasInWatch = direction === "below" ? num < currentValueNum : num > currentValueNum;
      const willBeInWatch = direction === "below" ? num < proposedValueNum : num > proposedValueNum;
      if (num >= currentValueNum) currentlyOver++; else currentlyUnder++;
      if (!wasInWatch && willBeInWatch) enteringWatch++;
      if (wasInWatch && !willBeInWatch) leavingWatch++;
    }

    res.json({
      key,
      field,
      direction,
      supported: true,
      currentValue: currentValueNum,
      proposedValue: proposedValueNum,
      delta: proposedValueNum - currentValueNum,
      totalRows: components.length,
      currentlyOver,
      currentlyUnder,
      enteringWatch,
      leavingWatch,
      netDelta: enteringWatch - leavingWatch,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "preview-impact failed" });
  }
});

router.patch("/admin/economic-rules/:key", requireAdmin, async (req, res) => {
  try {
    const key = String(req.params.key);
    const body = req.body as { value?: unknown; unit?: string; description?: string };
    if (body.value === undefined && body.unit === undefined && body.description === undefined) {
      res.status(400).json({ error: "at least one of value/unit/description required" });
      return;
    }
    const [existing] = await db.select().from(economicRulesTable).where(eq(economicRulesTable.key, key)).limit(1);
    if (!existing) {
      res.status(404).json({ error: `unknown rule "${key}"` });
      return;
    }
    const updatedBy = (req.header("x-admin-actor") || "admin").slice(0, 120);
    await db.update(economicRulesTable).set({
      ...(body.value !== undefined ? { value: body.value } : {}),
      ...(body.unit !== undefined ? { unit: body.unit } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      lastUpdatedBy: updatedBy,
      lastUpdatedAt: new Date(),
    }).where(eq(economicRulesTable.key, key));
    // Push immediately to Letta so the agent sees the new threshold
    // on its next decision step. Non-fatal if sync fails.
    const synced = await syncEconomicRulesToLetta();
    res.json({ key, updated: true, lettaSynced: synced });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "update failed" });
  }
});

export default router;
