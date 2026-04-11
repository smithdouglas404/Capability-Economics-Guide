import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { agentRunsTable, agentMemoriesTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import {
  triggerManualRun,
  getSchedulerStatus,
  startScheduler,
  stopScheduler,
  addSSEClient,
  getConnectedClients,
  getMemoryStats,
  getAllMemories,
  allTools,
  getLettaStatus,
} from "../services/agent";

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
        ceiBeforeIndex: latestRun.ceiBeforeIndex,
        ceiAfterIndex: latestRun.ceiAfterIndex,
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

router.post("/agent/trigger", async (_req, res) => {
  try {
    const result = await triggerManualRun();
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(409).json({ error: message });
  }
});

router.post("/agent/scheduler/start", async (req, res) => {
  const raw = Number(req.body?.intervalMinutes) || 30;
  const intervalMinutes = Math.max(5, Math.min(1440, raw));
  startScheduler(intervalMinutes * 60 * 1000);
  res.json({ status: "started", intervalMinutes });
});

router.post("/agent/scheduler/stop", async (_req, res) => {
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
      ceiBeforeIndex: r.ceiBeforeIndex,
      ceiAfterIndex: r.ceiAfterIndex,
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

router.get("/agent/tools", (_req, res) => {
  res.json({
    tools: allTools.map(t => ({
      name: t.name,
      description: t.description,
    })),
    integrations: {
      mem0: { connected: !!process.env.MEM0_API_KEY, provider: "mem0-cloud" },
      langchain: { version: "core", tools: allTools.length },
      langgraph: { nodes: ["evaluate", "decide", "research", "compute", "memorize", "finalize"] },
      perplexity: { connected: !!process.env.PERPLEXITY_API_KEY },
      letta: getLettaStatus(),
    },
  });
});

export default router;
