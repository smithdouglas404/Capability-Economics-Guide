/**
 * Macro Event Agent — AgentKit implementation.
 *
 * Mirrors the LangGraph implementation in `macro-event-agent.ts` 1:1 — same
 * tools, same system prompt, same Haiku model tier. Built on
 * `@inngest/agent-kit`'s Network + Agent + createTool primitives instead
 * of LangChain `tool()` + `createAgent`.
 *
 * The LEGACY Letta agent name stays `cvi-macro-event-agent` (see
 * AGENT_REGISTRY) so accumulated memory + identity continuity holds across
 * the migration. Mem0 + Letta calls go through the existing
 * `services/agent/memory.ts` + `services/agent/store.ts` modules — the
 * handler bodies below call the EXACT SAME underlying business-logic
 * functions as the LangGraph version, so observable behavior is identical.
 *
 * Tools are intentionally re-declared with AgentKit's `createTool` (not
 * reused from `macro-event-agent.ts`) because AgentKit's `Tool.Any` shape
 * differs from LangChain's `DynamicStructuredTool`.
 */
import { createAgent, createNetwork, createTool, anthropic } from "@inngest/agent-kit";
import { z } from "zod";
import { runEdgarRssTick } from "./edgar/rss-watcher";
import { listActiveEvents } from "./macro-events";
import { ensureSharedStoreReady, getSharedStore, NS } from "./agent/store";
import { recallMemories, storeMemory } from "./agent/memory";
import type { AgentRunResult } from "./agent/agentkit-shared";

// Identity preserved from the now-deleted legacy macro-event-agent.ts.
// Same string is in AGENT_REGISTRY → maps to Letta agent cvi-macro-event-agent.
export const MACRO_EVENT_AGENT_NAME = "macro-event-agent";

// Same model tier the LangGraph version uses ("haiku" in base-agent.ts maps
// to claude-haiku-4-5-20251001).
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// Same system prompt verbatim from macro-event-agent.ts.
const SYSTEM_PROMPT = `You are the Macro Event Agent inside the Inflexcvi platform. Your job each cycle:

1. Poll EDGAR (poll_edgar_rss) so any new SEC filings are ingested into the platform.
2. Look at active macro events (list_active_macro_events) — these are the events the platform is currently tracking with their severity, direction, and decay windows.
3. Identify what's MOST important right now — high-severity events, things that changed since last cycle, items with broad industry exposure.
4. Publish a digest (publish_macro_event_digest) so downstream agents (especially the Disruption Agent) can bias their work toward the most relevant context.

Be selective — the digest is read every cycle by every other agent, so include only what genuinely matters. Skip the digest entirely if nothing has changed materially since the last cycle (return "no new digest needed" in your final answer).

Cost discipline: this runs on Haiku. Don't ruminate. One pass through tools, then a single digest write or skip.`;

const pollEdgarTool = createTool({
  name: "poll_edgar_rss",
  description:
    "Poll the SEC EDGAR current-filings RSS feed for new filings that mention tracked capabilities. Returns counts: fetched, matched, inserted, errors, durationMs.",
  parameters: z.object({}).strict(),
  handler: async () => {
    const r = await runEdgarRssTick();
    return JSON.stringify({
      fetched: r.fetched,
      matched: r.matched,
      inserted: r.inserted,
      errors: r.errors.length,
      durationMs: r.durationMs,
    });
  },
});

const listActiveEventsTool = createTool({
  name: "list_active_macro_events",
  description:
    "List currently-active macro events (war, regulation, tech_shift, economic, disaster, other) with severity, direction, decay window, and affected industry IDs. Returns the 25 most-recent.",
  parameters: z.object({}).strict(),
  handler: async () => {
    const events = await listActiveEvents();
    return JSON.stringify(events.slice(0, 25).map(e => ({
      id: e.id,
      title: e.title,
      eventType: e.eventType,
      severity: e.severity,
      direction: e.sentimentDirection,
      startedAt: e.startedAt instanceof Date ? e.startedAt.toISOString() : e.startedAt,
      decayDays: e.decayDays,
      affectedIndustryIds: (e.affectedIndustryIds ?? []) as number[],
    })));
  },
});

const publishMacroDigestTool = createTool({
  name: "publish_macro_event_digest",
  description:
    "Publish a summary of the most important active macro events to the shared store under NS.macroEvents(). Other agents (Disruption Agent) read this to bias their work. Include 2-3 sentences highlighting what changed in the last cycle and the top 3-5 event IDs.",
  parameters: z.object({
    summary: z.string().describe("2-3 sentence rollup of what's most important right now."),
    topEventIds: z.array(z.number()).describe("IDs of the most-impactful active events (from list_active_macro_events)."),
    severity: z.enum(["low", "moderate", "high", "extreme"]).describe("Overall severity tier across the published events."),
  }).strict(),
  handler: async ({ summary, topEventIds, severity }) => {
    await ensureSharedStoreReady();
    const key = `digest-${new Date().toISOString()}`;
    await getSharedStore().put(NS.macroEvents(), key, {
      summary,
      topEventIds,
      severity,
      publishedAt: new Date().toISOString(),
      publishedBy: MACRO_EVENT_AGENT_NAME,
    });
    return JSON.stringify({ ok: true, key });
  },
});

// ── Memory context (Mem0 patterns + prior block + synthesis brief) ─────
// The LangGraph path builds this in services/agent/base-agent.ts and
// prepends it to the system prompt. We mirror the same behavior here so
// the agent's reasoning is grounded in the same accumulated evidence.

async function buildMemoryContext(): Promise<string> {
  const contextParts: string[] = [];
  const recallTopic = MACRO_EVENT_AGENT_NAME.replace(/-/g, " ");

  try {
    const memories = await recallMemories(
      recallTopic,
      undefined,
      5,
      { category: "pattern", agentName: MACRO_EVENT_AGENT_NAME, criteria: "relevance" },
    );
    if (memories.length > 0) {
      const memLines = memories
        .map(m => `  - ${m.content.substring(0, 200)}`)
        .join("\n");
      contextParts.push(`RELEVANT PATTERNS FROM YOUR MEMORY:\n${memLines}`);
    }
  } catch { /* non-fatal */ }

  try {
    const sharedMemories = await recallMemories(
      recallTopic,
      undefined,
      3,
      { category: "pattern", criteria: "relevance" },
    );
    if (sharedMemories.length > 0) {
      const memLines = sharedMemories
        .map(m => `  - ${m.content.substring(0, 200)}`)
        .join("\n");
      contextParts.push(`INSTITUTIONAL PATTERNS (shared across all agents):\n${memLines}`);
    }
  } catch { /* non-fatal */ }

  try {
    const { getAgentPriorBlock } = await import("./agent/store");
    const priorBlock = await getAgentPriorBlock("industry_priors", MACRO_EVENT_AGENT_NAME);
    if (priorBlock && typeof priorBlock === "string" && priorBlock.length > 20) {
      contextParts.push(`YOUR ACCUMULATED BELIEFS (from past cycles):\n${priorBlock.substring(0, 800)}`);
    }
  } catch { /* non-fatal */ }

  try {
    await ensureSharedStoreReady();
    const synthItems = await getSharedStore().search(
      NS.sharedKnowledge("synthesis_brief"),
      { limit: 1 },
    );
    if (synthItems.length > 0) {
      const brief = (synthItems[0].value as { brief?: string }).brief;
      if (brief) {
        contextParts.push(`LATEST CROSS-AGENT SYNTHESIS BRIEF:\n${brief.substring(0, 600)}`);
      }
    }
  } catch { /* non-fatal */ }

  if (contextParts.length === 0) return "";
  return `\n\n--- MEMORY CONTEXT (use this to ground your work in accumulated evidence) ---\n${contextParts.join("\n\n")}\n--- END MEMORY CONTEXT ---`;
}

async function writePostRunMemory(output: string): Promise<void> {
  if (!output || output.length < 50) return;
  const summary = output.substring(0, 400);
  await storeMemory(
    "observation",
    `[${MACRO_EVENT_AGENT_NAME}] ${summary}`,
    { source: MACRO_EVENT_AGENT_NAME, agentRun: true },
    { category: "agent_run_summary", agentName: MACRO_EVENT_AGENT_NAME },
  ).catch(() => {});
}

/**
 * Run one macro-event cycle via AgentKit. Returns the same AgentRunResult
 * shape as `runMacroEventAgent` so the Inngest function in
 * inngest/functions/agents.ts can route to either implementation
 * transparently via the USE_LANGGRAPH_MACRO_EVENT kill switch.
 */
export async function runMacroEventAgentAgentKit(): Promise<AgentRunResult> {
  const start = Date.now();
  const memoryContext = await buildMemoryContext();
  const graphContext = await (await import("./agent/build-graph-context")).buildGraphContext();

  const agent = createAgent({
    name: MACRO_EVENT_AGENT_NAME,
    description: "Polls EDGAR + sweeps active macro events; publishes a digest for downstream agents.",
    system: SYSTEM_PROMPT + memoryContext + graphContext,
    model: anthropic({
      model: HAIKU_MODEL,
      defaultParameters: {
        max_tokens: 1500,
        temperature: 0.2,
      },
    }),
    tools: [pollEdgarTool, listActiveEventsTool, publishMacroDigestTool],
  });

  const network = createNetwork({
    name: "macro-event-agentkit-network",
    agents: [agent],
    maxIter: 6,
  });

  try {
    const run = await network.run("Run your routine macro-event cycle now.");
    const results = run.state.results;
    const lastResult = results.length > 0 ? results[results.length - 1] : undefined;

    let outputText = "";
    if (lastResult) {
      for (const msg of lastResult.output) {
        if (msg.type === "text" && msg.role === "assistant") {
          if (typeof msg.content === "string") {
            outputText += msg.content;
          } else {
            for (const part of msg.content) outputText += part.text;
          }
        }
      }
    }

    const toolCallCount = results.reduce((sum, r) => sum + r.toolCalls.length, 0);
    const durationMs = Date.now() - start;
    console.log(`[macro-event-agent-agentkit] cycle complete: tools=${toolCallCount} duration=${durationMs}ms`);

    writePostRunMemory(outputText).catch(() => {});

    return { output: outputText, toolCallCount, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[macro-event-agent-agentkit] cycle errored after ${durationMs}ms: ${message}`);
    return { output: `ERROR: ${message}`, toolCallCount: 0, durationMs };
  }
}
