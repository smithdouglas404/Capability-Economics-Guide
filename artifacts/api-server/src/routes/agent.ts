import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  agentRunsTable,
  agentMemoriesTable,
  capabilitiesTable,
  industriesTable,
  cviComponentsTable,
  dvxComponentsTable,
} from "@workspace/db";
import { and, desc, eq, or, ilike } from "drizzle-orm";
import { recallMemories, type MemoryCategory } from "../services/agent/memory";
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
} from "../services/agent";
import { consolidationRunsTable } from "@workspace/db";
import { generateOntologyTool } from "../services/agent/tools";
import { requireAdmin } from "../middlewares/requireAdmin";

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

Return JSON array of 4 relationships:
[{
  "sourceSlug": "slug",
  "targetSlug": "slug",
  "relationshipType": "enables|depends_on|competes_with|substitutes",
  "strength": "strong|moderate|weak",
  "description": "Precise 1-sentence explanation with real-world strategic context",
  "industryInsight": "Why this relationship specifically matters for ${industry.name} performance and ROI"
}]

Be specific, strategic, and grounded in real ${industry.name} industry dynamics. No generic responses.`;

    const runViaOpenRouter = async (model: string) => {
      const start = Date.now();
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) return { model, latencyMs: 0, result: null, rawLength: 0, error: "No OPENROUTER_API_KEY" };
      try {
        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://inflexcvi.ai",
            "X-Title": "Inflexcvi",
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            messages: [{ role: "user", content: prompt }],
          }),
        });
        const data = await resp.json() as { choices?: Array<{ message: { content: string } }>; error?: { message: string } };
        if (data.error) throw new Error(data.error.message);
        const text = data.choices?.[0]?.message?.content ?? "";
        const match = text.match(/\[[\s\S]*\]/);
        const parsed = match ? JSON.parse(match[0]) : null;
        return { model, latencyMs: Date.now() - start, result: parsed, rawLength: text.length, error: null };
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
        provider: "mem0-oss-self-hosted",
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
    let lettaBlocks: Record<string, { length: number; preview: string } | null> = {};
    const lettaStatus = getLettaStatus();
    if (lettaStatus.connected) {
      for (const label of ["persona", "industry_priors", "research_strategy", "current_focus"] as const) {
        try {
          const v = await lettaReadBlock(label);
          lettaBlocks[label] = v ? { length: v.length, preview: v.slice(0, 240) } : null;
        } catch {
          lettaBlocks[label] = null;
        }
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

export default router;
