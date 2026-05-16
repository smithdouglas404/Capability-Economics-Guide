/**
 * Enrichment ReAct agent — a real LangGraph agent loop, not a fixed pipeline.
 *
 * The agent is given a goal (full industry refresh, single-cap rerun, etc.)
 * and a toolbelt that wraps every existing enrichment function (`classify_quadrants`,
 * `map_value_chain`, `discover_companies`, `run_economic_alpha`, `run_economic_detail`,
 * plus query/memory tools). The LLM decides what to call, in what order, and
 * when it's done — `tools.ts` holds the schemas and executors.
 *
 *   agent ──tool_calls?──▶ tools ──▶ agent ──finish?──▶ finalize ──▶ END
 *
 * Public API (`runEnrichmentGraph(opts)`) is unchanged so the per-cap rerun
 * route, admin button, and any cron caller keep working without edits.
 */

import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  capabilityEconomicsTable,
  capabilityQuadrantsTable,
  valueChainStagesTable,
  companyCapabilityProfilesTable,
  enrichmentRunsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../../lib/logger";
import { emitAgentEvent } from "../agent/events";
import { lettaArchivalInsert, lettaUpdateBlock } from "../agent/letta";
import { toolSchemas, toolExecutors } from "./tools";
import { fireFoundrySync } from "../foundry/sync";

// ─── OpenRouter chat with tools ─────────────────────────────────────────────
// OpenAI-compatible request shape; OpenRouter relays tool calling to Anthropic.
type ChatRole = "system" | "user" | "assistant" | "tool";
interface ChatMessage {
  role: ChatRole;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface ChatResponse {
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: ChatMessage["tool_calls"];
    };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

async function chatWithTools(messages: ChatMessage[], opts: { model?: string; maxTokens?: number } = {}): Promise<ChatResponse["choices"][0]["message"]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY required for enrichment agent");
  const model = opts.model ?? "anthropic/claude-sonnet-4.6";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);
  try {
    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://inflexcvi.ai",
        "X-Title": "Inflexcvi",
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 2048,
        messages,
        tools: toolSchemas,
        tool_choice: "auto",
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OpenRouter ${resp.status}: ${text.slice(0, 300)}`);
    }
    const data = (await resp.json()) as ChatResponse;
    if (data.error) throw new Error(`OpenRouter error: ${data.error.message ?? "unknown"}`);
    const choice = data.choices?.[0]?.message;
    if (!choice) throw new Error("OpenRouter returned no choices");
    return choice;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Graph state ────────────────────────────────────────────────────────────
const EnrichmentState = Annotation.Root({
  runId: Annotation<number>({ default: () => 0, reducer: (_, n) => n }),
  trigger: Annotation<"scheduled" | "manual" | "rerun">({
    default: () => "scheduled",
    reducer: (_, n) => n,
  }),
  targetCapabilityIds: Annotation<number[] | null>({ default: () => null, reducer: (_, n) => n }),
  targetIndustryIds: Annotation<number[] | null>({ default: () => null, reducer: (_, n) => n }),

  messages: Annotation<ChatMessage[]>({
    default: () => [],
    reducer: (prev, next) => [...prev, ...next],
  }),

  iterations: Annotation<number>({ default: () => 0, reducer: (a, b) => a + b }),
  finished: Annotation<boolean>({ default: () => false, reducer: (_, n) => n }),
  finishSummary: Annotation<string | null>({ default: () => null, reducer: (_, n) => n }),

  // Aggregate counters fed by the tools — used by finalize to write enrichment_runs
  toolCalls: Annotation<number>({ default: () => 0, reducer: (a, b) => a + b }),
  toolErrors: Annotation<string[]>({ default: () => [], reducer: (a, b) => [...a, ...b] }),
  startedAt: Annotation<string>({ default: () => new Date().toISOString(), reducer: (_, n) => n }),
});

type State = typeof EnrichmentState.State;

const MAX_ITERATIONS = 25; // hard ceiling — agent must finish within this

function emit(node: string, runId: number, payload: Record<string, unknown> = {}) {
  emitAgentEvent({
    type: `enrichment.${node}`,
    runId,
    timestamp: new Date().toISOString(),
    ...payload,
  } as unknown as Parameters<typeof emitAgentEvent>[0]);
}

// ─── System prompt — the agent's brief ──────────────────────────────────────
function buildSystemPrompt(state: State): string {
  const scope: string[] = [];
  if (state.targetCapabilityIds?.length) {
    scope.push(`Specific capability ids: ${state.targetCapabilityIds.join(", ")}.`);
  }
  if (state.targetIndustryIds?.length) {
    scope.push(`Specific industry ids: ${state.targetIndustryIds.join(", ")}.`);
  }
  const scopeBlock = scope.length > 0
    ? `\n\nSCOPE — this run is scoped to:\n${scope.map(s => `- ${s}`).join("\n")}\n`
    : `\n\nSCOPE — full coverage. You decide which industries need work based on \`query_database({queryType:"enrichment_status"})\`.\n`;

  const isPerCapRerun = (state.targetCapabilityIds?.length ?? 0) > 0;

  if (isPerCapRerun) {
    // Per-cap reruns are deterministic — no agent judgement needed. The route
    // has already (a) deleted the existing economics + quadrants rows for the
    // target cap and (b) re-run classify_quadrants synchronously for that one
    // cap. The agent's only remaining job is alpha + detail.
    const capId = state.targetCapabilityIds![0]!;
    const indId = state.targetIndustryIds?.[0];
    const indFragment = indId != null ? `${indId}` : "<the cap's industryId>";
    return `You are the Inflexcvi enrichment agent. The user clicked "Rerun economics" on capability id=${capId}${indId != null ? ` (industry id=${indId})` : ""}. The caller has already (a) deleted the existing capability_economics row, (b) re-run classify_quadrants for this cap so capability_quadrants is fresh.

YOUR JOB IS A FIXED 3-STEP SEQUENCE. DO NOT SKIP, DO NOT REORDER, DO NOT ASK. EXECUTE EXACTLY THIS:

STEP 1 — call run_economic_alpha({"industryId": ${indFragment}, "limitCapabilities": 1}). Repopulates the Street-side economics row (TAM, EVaR inputs, half-life, margin, consensusQuadrant, consensusSummary). limitCapabilities:1 keeps the call to just this cap.

STEP 2 — call run_economic_detail({"capabilityId": ${capId}, "force": true}). Generates the narrative fields (summaryNarrative, traditionalNarrative, economicNarrative, aiNarrative, metricInterpretations, dependencyRationales, roleConsequences, playbook, benchmarkInterpretation, aiSubstitutes).

STEP 3 — call finish({"summary": "<one sentence summarising what was written>"}).

Each tool returns {ok: true, ...} on success or {ok: false, error: "..."} on failure. If any step fails with ok:false, surface the error in finish but still call finish. Do NOT call classify_quadrants (route already did it), query_database, recall_memories, store_memory, map_value_chain, or discover_companies.`;
  }

  return `You are the Inflexcvi enrichment agent. Your job is to keep every capability's economic profile current — quadrants, value-chain stages, leading companies, economic alpha (TAM/EVaR/half-life), and detail narratives (Traditional View, Economic View, Key Metrics, dependencies, playbook).

You have access to the SAME functions the "Rerun economic" button uses. Each function is exposed as a tool. Call them in whatever order makes sense.

GUIDELINES:
1. Start with \`query_database({queryType:"enrichment_status"})\` (optionally scoped to an industryId) to see what's missing.
2. Optionally \`recall_memories\` to check prior-run learnings about industries that have been problematic.
3. For each industry needing work, call the relevant tools. The natural flow when nothing exists is:
   classify_quadrants → map_value_chain → discover_companies → run_economic_alpha → run_economic_detail.
   But you do NOT have to follow that order. If quadrants are fresh, skip them. If only economics is stale, just call run_economic_alpha + run_economic_detail.
4. Each tool returns a JSON result envelope \`{ok, ...}\`. Use the result to decide the next step. If a tool fails, try a different approach or move on; don't loop on the same failing call.
5. When done, optionally \`store_memory\` to record any pattern worth remembering, then call \`finish\` with a summary.
6. Hard cap: ${MAX_ITERATIONS} tool turns per run. Don't dawdle.

You are NOT a chatbot. Always respond with a tool_call until you call \`finish\`.${scopeBlock}`;
}

// ─── agent node ─────────────────────────────────────────────────────────────
async function agentNode(state: State): Promise<Partial<State>> {
  emit("agent.think", state.runId, { iteration: state.iterations });

  // First turn: install the system prompt + an opening user message
  const messages: ChatMessage[] = state.messages.length === 0
    ? [
        { role: "system", content: buildSystemPrompt(state) },
        {
          role: "user",
          content:
            state.trigger === "rerun"
              ? "Rerun enrichment for the scoped capability/industry."
              : state.trigger === "manual"
                ? "Manual enrichment trigger — refresh anything stale."
                : "Scheduled enrichment cycle — keep the catalog current.",
        },
      ]
    : [];

  const allMessages = [...state.messages, ...messages];
  const reply = await chatWithTools(allMessages);

  // Append the assistant message (with any tool_calls) to history
  const assistantMsg: ChatMessage = {
    role: "assistant",
    content: reply.content ?? null,
    tool_calls: reply.tool_calls,
  };

  const calls = reply.tool_calls ?? [];

  // Detect explicit finish — the model called the `finish` tool
  let finished = false;
  let finishSummary: string | null = null;
  for (const call of calls) {
    if (call.function.name === "finish") {
      finished = true;
      try {
        const args = JSON.parse(call.function.arguments) as { summary?: string };
        finishSummary = args.summary ?? null;
      } catch { finishSummary = null; }
    }
  }

  emit("agent.reply", state.runId, {
    iteration: state.iterations,
    toolCallCount: calls.length,
    toolNames: calls.map(c => c.function.name),
    finished,
  });

  return {
    messages: [...messages, assistantMsg],
    iterations: 1,
    finished,
    finishSummary,
  };
}

// ─── tools node ─────────────────────────────────────────────────────────────
async function toolsNode(state: State): Promise<Partial<State>> {
  const lastMsg = state.messages[state.messages.length - 1];
  const calls = lastMsg?.tool_calls ?? [];
  if (calls.length === 0) return {};

  const ctx = {
    runId: state.runId,
    emit: (event: string, payload: Record<string, unknown>) => emit(event, state.runId, payload),
  };

  const toolMessages: ChatMessage[] = [];
  const errors: string[] = [];
  let executed = 0;

  for (const call of calls) {
    const name = call.function.name;
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(call.function.arguments || "{}");
    } catch (err) {
      const msg = `bad JSON args for ${name}: ${err instanceof Error ? err.message : String(err)}`;
      toolMessages.push({ role: "tool", tool_call_id: call.id, name, content: JSON.stringify({ ok: false, error: msg }) });
      errors.push(msg);
      continue;
    }

    const exec = toolExecutors[name];
    if (!exec) {
      const msg = `unknown tool: ${name}`;
      toolMessages.push({ role: "tool", tool_call_id: call.id, name, content: JSON.stringify({ ok: false, error: msg }) });
      errors.push(msg);
      continue;
    }

    try {
      const result = await exec(parsedArgs, ctx);
      toolMessages.push({ role: "tool", tool_call_id: call.id, name, content: result });
      executed++;
      // Surface in-tool errors into the run-level errors list when ok:false
      try {
        const parsed = JSON.parse(result) as { ok?: boolean; error?: string };
        if (parsed.ok === false && parsed.error) errors.push(`[${name}] ${parsed.error}`);
      } catch { /* result wasn't JSON — fine */ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : `tool ${name} threw`;
      logger.error({ err, tool: name }, "[enrichment-agent] tool execution threw");
      toolMessages.push({ role: "tool", tool_call_id: call.id, name, content: JSON.stringify({ ok: false, error: msg }) });
      errors.push(`[${name}] ${msg}`);
    }
  }

  return {
    messages: toolMessages,
    toolCalls: executed,
    toolErrors: errors,
  };
}

// ─── finalize node — close out enrichment_runs ──────────────────────────────
async function finalizeNode(state: State): Promise<Partial<State>> {
  emit("finalize.start", state.runId, { iterations: state.iterations, toolCalls: state.toolCalls });

  // Aggregate the same totals the legacy linear pipeline reported, by reading
  // what's actually in the DB scoped to this runId. The agent may have skipped
  // some stages — those just count zero, which is correct.
  const [quadCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(capabilityQuadrantsTable)
    .where(eq(capabilityQuadrantsTable.runId, state.runId));
  const [vcCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(valueChainStagesTable)
    .where(eq(valueChainStagesTable.runId, state.runId));
  const [companyCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(companyCapabilityProfilesTable)
    .where(eq(companyCapabilityProfilesTable.runId, state.runId));
  const [econCountRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(capabilityEconomicsTable);
  const econCount = Number(econCountRow?.c ?? 0);

  const status = state.toolErrors.length === 0 ? "completed" : "completed_with_errors";

  try {
    await db.update(enrichmentRunsTable).set({
      completedAt: new Date(),
      quadrantsClassified: Number(quadCount?.c ?? 0),
      valueChainStagesCreated: Number(vcCount?.c ?? 0),
      companiesProfiled: Number(companyCount?.c ?? 0),
      durationMs: Date.now() - new Date(state.startedAt).getTime(),
      errors: state.toolErrors.length > 0 ? state.toolErrors.slice(0, 50) : null,
      status,
    }).where(eq(enrichmentRunsTable.id, state.runId));
  } catch (err) {
    logger.error({ err, runId: state.runId }, "[enrichment-agent] finalize failed to update run row");
  }

  // Letta — long-term memory of what this cycle did
  try {
    const summary = state.finishSummary
      ?? `Run #${state.runId} (${state.trigger}): ${state.toolCalls} tool calls, ${state.toolErrors.length} errors`;
    await lettaUpdateBlock("research_strategy", `Last enrichment run #${state.runId}: ${summary.slice(0, 1500)}`);
    await lettaArchivalInsert(`Enrichment cycle ${state.runId}: ${summary.slice(0, 1500)}`);
  } catch { /* non-fatal */ }

  emit("finalize.complete", state.runId, {
    status,
    iterations: state.iterations,
    toolCalls: state.toolCalls,
    quadrantsClassified: Number(quadCount?.c ?? 0),
    valueChainStagesCreated: Number(vcCount?.c ?? 0),
    companiesProfiled: Number(companyCount?.c ?? 0),
    economicsRows: econCount,
    summary: state.finishSummary,
  });

  // Mirror to Foundry — fire-and-forget so this never blocks the agent
  // returning, no-ops if Foundry isn't configured. Concurrency-guarded
  // inside fireFoundrySync.
  fireFoundrySync(`enrichment run ${state.runId} (${state.trigger})`);

  return {};
}

// ─── routing ────────────────────────────────────────────────────────────────
function routeAfterAgent(state: State): "tools" | "finalize" {
  if (state.finished) return "finalize";
  if (state.iterations >= MAX_ITERATIONS) return "finalize";
  const last = state.messages[state.messages.length - 1];
  if (!last?.tool_calls || last.tool_calls.length === 0) return "finalize";
  return "tools";
}

// ─── compile ────────────────────────────────────────────────────────────────
const workflow = new StateGraph(EnrichmentState)
  .addNode("agent", agentNode)
  .addNode("tools", toolsNode)
  .addNode("finalize", finalizeNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", routeAfterAgent, { tools: "tools", finalize: "finalize" })
  .addEdge("tools", "agent")
  .addEdge("finalize", END);

export const enrichmentGraph = workflow.compile();

// ─── public entry ──────────────────────────────────────────────────────────
export async function runEnrichmentGraph(opts: {
  trigger?: "scheduled" | "manual" | "rerun";
  targetCapabilityIds?: number[];
  targetIndustryIds?: number[];
} = {}): Promise<{ runId: number; iterations: number; toolCalls: number; errors: string[]; summary: string | null }> {
  const [runRecord] = await db.insert(enrichmentRunsTable).values({ status: "running" }).returning({ id: enrichmentRunsTable.id });

  emit("run.start", runRecord.id, {
    trigger: opts.trigger ?? "scheduled",
    targetCapabilityIds: opts.targetCapabilityIds ?? null,
    targetIndustryIds: opts.targetIndustryIds ?? null,
  });

  try {
    const result = await enrichmentGraph.invoke(
      {
        runId: runRecord.id,
        trigger: opts.trigger ?? "scheduled",
        targetCapabilityIds: opts.targetCapabilityIds ?? null,
        targetIndustryIds: opts.targetIndustryIds ?? null,
      },
      // Recursion limit higher than MAX_ITERATIONS*2 so the framework doesn't
      // abort before our own iteration cap kicks in. Each iteration = one
      // agent + one tools node = 2 LangGraph steps.
      { recursionLimit: MAX_ITERATIONS * 2 + 10 },
    );
    return {
      runId: runRecord.id,
      iterations: result.iterations,
      toolCalls: result.toolCalls,
      errors: result.toolErrors,
      summary: result.finishSummary,
    };
  } catch (err) {
    logger.error({ err, runId: runRecord.id }, "[enrichment-agent] fatal");
    try {
      await db.update(enrichmentRunsTable).set({
        status: "failed",
        completedAt: new Date(),
        errors: [err instanceof Error ? err.message : String(err)],
      }).where(eq(enrichmentRunsTable.id, runRecord.id));
    } catch { /* best effort */ }
    throw err;
  }
}
