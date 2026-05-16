/**
 * Macro Event Agent — wraps services/macro-events.ts and
 * services/edgar/rss-watcher.ts. Polls SEC filings + sweeps existing
 * macro events, identifies high-impact items, and publishes summaries
 * to the shared store under NS.macroEvents() for other agents (the
 * Disruption Agent in particular) to consume.
 *
 * Architecture: autonomous, no supervisor. Runs on its own cron in
 * scheduler.ts. Reads/writes via PostgresStore (Phase 1.8 forward path).
 *
 * Per Master Action Plan Phase 1.9 Step 3 / agent #4.
 */
import { tool } from "langchain";
import { z } from "zod/v4";
import { runEdgarRssTick } from "./edgar/rss-watcher";
import { listActiveEvents } from "./macro-events";
import { runReactAgent } from "./agent/base-agent";
import { ensureSharedStoreReady, getSharedStore, NS } from "./agent/store";

export const MACRO_EVENT_AGENT_NAME = "macro-event-agent";

// ── Tools ───────────────────────────────────────────────────────────────

const pollEdgarTool = tool(
  async () => {
    const r = await runEdgarRssTick();
    return JSON.stringify({
      fetched: r.fetched,
      matched: r.matched,
      inserted: r.inserted,
      errors: r.errors.length,
      durationMs: r.durationMs,
    });
  },
  {
    name: "poll_edgar_rss",
    description: "Poll the SEC EDGAR current-filings RSS feed for new filings that mention tracked capabilities. Returns counts: fetched, matched, inserted, errors, durationMs.",
    schema: z.object({}).strict(),
  },
);

const listActiveEventsTool = tool(
  async () => {
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
  {
    name: "list_active_macro_events",
    description: "List currently-active macro events (war, regulation, tech_shift, economic, disaster, other) with severity, direction, decay window, and affected industry IDs. Returns the 25 most-recent.",
    schema: z.object({}).strict(),
  },
);

const publishMacroDigestTool = tool(
  async ({ summary, topEventIds, severity }) => {
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
  {
    name: "publish_macro_event_digest",
    description: "Publish a summary of the most important active macro events to the shared store under NS.macroEvents(). Other agents (Disruption Agent) read this to bias their work. Include 2-3 sentences highlighting what changed in the last cycle and the top 3-5 event IDs.",
    schema: z.object({
      summary: z.string().describe("2-3 sentence rollup of what's most important right now."),
      topEventIds: z.array(z.number()).describe("IDs of the most-impactful active events (from list_active_macro_events)."),
      severity: z.enum(["low", "moderate", "high", "extreme"]).describe("Overall severity tier across the published events."),
    }).strict(),
  },
);

const TOOLS = [pollEdgarTool, listActiveEventsTool, publishMacroDigestTool];

const SYSTEM_PROMPT = `You are the Macro Event Agent inside the Inflexcvi platform. Your job each cycle:

1. Poll EDGAR (poll_edgar_rss) so any new SEC filings are ingested into the platform.
2. Look at active macro events (list_active_macro_events) — these are the events the platform is currently tracking with their severity, direction, and decay windows.
3. Identify what's MOST important right now — high-severity events, things that changed since last cycle, items with broad industry exposure.
4. Publish a digest (publish_macro_event_digest) so downstream agents (especially the Disruption Agent) can bias their work toward the most relevant context.

Be selective — the digest is read every cycle by every other agent, so include only what genuinely matters. Skip the digest entirely if nothing has changed materially since the last cycle (return "no new digest needed" in your final answer).

Cost discipline: this runs on Haiku. Don't ruminate. One pass through tools, then a single digest write or skip.`;

/**
 * Single agent invocation. Called from scheduler.ts on a cron.
 */
export async function runMacroEventAgent(): Promise<{ output: string; toolCallCount: number; durationMs: number }> {
  const result = await runReactAgent(
    {
      agentName: MACRO_EVENT_AGENT_NAME,
      systemPrompt: SYSTEM_PROMPT,
      tools: TOOLS,
      modelTier: "haiku",
      temperature: 0.2,
      maxTokens: 1500,
    },
    "Run your routine macro-event cycle now.",
  );
  console.log(`[macro-event-agent] cycle complete: tools=${result.toolCallCount} duration=${result.durationMs}ms`);
  return result;
}
