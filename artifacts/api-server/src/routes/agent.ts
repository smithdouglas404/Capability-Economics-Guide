import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { agentRunsTable, agentMemoriesTable } from "@workspace/db";
import { desc } from "drizzle-orm";
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
} from "../services/agent";
import { generateOntologyTool } from "../services/agent/tools";

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

router.post("/agent/scheduler/start", async (_req, res) => {
  startScheduler();
  res.json({ status: "started" });
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

router.post("/agent/run-ontology", async (_req, res) => {
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

    const runViaAnthropic = async (model: string) => {
      const start = Date.now();
      try {
        const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
        const resolvedModel = hasOpenRouter ? `anthropic/${model}` : model;
        const message = await client.messages.create({
          model: resolvedModel,
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        });
        const text = message.content[0].type === "text" ? message.content[0].text : "";
        const match = text.match(/\[[\s\S]*\]/);
        const parsed = match ? JSON.parse(match[0]) : null;
        return { model: resolvedModel, latencyMs: Date.now() - start, result: parsed, rawLength: text.length, error: null };
      } catch (err) {
        return { model, latencyMs: Date.now() - start, result: null, rawLength: 0, error: err instanceof Error ? err.message : String(err) };
      }
    };

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
            "HTTP-Referer": "https://capabilityeconomics.com",
            "X-Title": "Capability Economics",
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
      runViaAnthropic("claude-sonnet-4-5"),
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
      mem0: { connected: !!process.env.MEM0_API_KEY, provider: "mem0-cloud" },
      langchain: { version: "core", tools: allTools.length },
      langgraph: { nodes: ["evaluate", "decide", "research", "compute", "memorize", "finalize"] },
      perplexity: { connected: !!process.env.PERPLEXITY_API_KEY },
      letta: getLettaStatus(),
    },
  });
});

export default router;
