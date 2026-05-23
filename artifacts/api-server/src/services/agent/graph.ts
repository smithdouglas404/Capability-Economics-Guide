import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  cviComponentsTable,
  cviSnapshotsTable,
  agentRunsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  recallMemoriesBatch,
  filterMemoriesForTarget,
  storeMemory,
  type AgentMemory,
} from "./memory";
import { emitAgentEvent } from "./events";
import { getTuning } from "../agent-tuning";
// Letta Cloud restored (2026-05-17). The store-backed helpers below
// (putAgentPriorBlock etc.) are now a Letta Cloud adapter mirroring
// the same API surface. See store.ts for the adapter implementation.
import { putAgentPriorBlock, appendAgentArchive, searchAgentArchive } from "./store";
import { ChatAnthropic } from "@langchain/anthropic";
import { reflectOnFindings, type ResearchFinding } from "./reflect";
import {
  perplexityResearchTool,
  computeCVITool,
  generateCsuitePerspectivesTool,
  generateCaseStudyContentTool,
  generateInsightsTool,
  generateLeaderboardTool,
  generateWhitePapersTool,
  generateOntologyTool,
} from "./tools";
import { maybeStepRun } from "../../inngest/step-context";

interface CapabilityTarget {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  staleDays: number;
  currentScore: number;
  confidence: number;
  velocity: number;
  priority: number;
}

interface AgentDecision {
  capabilityId: number;
  industryId: number;
  industryName: string;
  capabilityName: string;
  action: "research" | "skip" | "use_memory";
  reason: string;
  timestamp: string;
}

const AgentState = Annotation.Root({
  runId: Annotation<number>,
  trigger: Annotation<string>,
  targets: Annotation<CapabilityTarget[]>,
  recalledMemories: Annotation<AgentMemory[]>,
  lettaArchivalSnippets: Annotation<string[]>,
  decisions: Annotation<AgentDecision[]>,
  researchResults: Annotation<ResearchFinding[]>,
  reflection: Annotation<{ added: number; updated: number; contradictions: number; priorsUpdated: boolean } | null>,
  memoriesRecalled: Annotation<number>,
  memoriesStored: Annotation<number>,
  perplexityCalls: Annotation<number>,
  cviBeforeIndex: Annotation<number | null>,
  cviAfterIndex: Annotation<number | null>,
  error: Annotation<string | null>,
});

type AgentStateType = typeof AgentState.State;

const STALE_THRESHOLD_DAYS = 7;
const HIGH_VOLATILITY_THRESHOLD = 0.1;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
// Default Perplexity-call cap per agent run; overridden by admin-tunable
// agent_tuning.agent_perplexity_cap (read at the top of decideNode below).
const DEFAULT_MAX_RESEARCH_PER_RUN = 6;

async function evaluateNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  emitAgentEvent({ type: "phase", phase: "evaluating", message: "Scanning industries and capabilities..." });

  const industries = await db.select().from(industriesTable);
  const allCaps = await db.select().from(capabilitiesTable);
  const components = await db.select().from(cviComponentsTable);
  const [latestSnapshot] = await db.select().from(cviSnapshotsTable)
    .orderBy(desc(cviSnapshotsTable.snapshotAt)).limit(1);

  const compMap = new Map<string, typeof components[0]>();
  for (const c of components) compMap.set(`${c.industryId}-${c.capabilityId}`, c);

  const now = Date.now();
  const targets: CapabilityTarget[] = [];

  for (const industry of industries) {
    const caps = allCaps.filter(c => c.industryId === industry.id);
    for (const cap of caps) {
      const comp = compMap.get(`${industry.id}-${cap.id}`);
      const updatedAt = comp?.updatedAt?.getTime() || 0;
      const staleDays = (now - updatedAt) / 86400000;

      let priority = 0;
      if (staleDays > STALE_THRESHOLD_DAYS) priority += staleDays / STALE_THRESHOLD_DAYS;
      if (comp && Math.abs(comp.velocity) > HIGH_VOLATILITY_THRESHOLD) priority += 2;
      if (comp && comp.confidence < LOW_CONFIDENCE_THRESHOLD) priority += 3;
      if (!comp) priority += 5;

      targets.push({
        capabilityId: cap.id,
        capabilityName: cap.name,
        industryId: industry.id,
        industryName: industry.name,
        staleDays: Math.round(staleDays * 10) / 10,
        currentScore: comp?.consensusScore || cap.benchmarkScore,
        confidence: comp?.confidence || 0.5,
        velocity: comp?.velocity || 0,
        priority,
      });
    }
  }

  targets.sort((a, b) => b.priority - a.priority);

  emitAgentEvent({
    type: "evaluate_complete",
    totalTargets: targets.length,
    industriesCount: industries.length,
  });

  return { targets, cviBeforeIndex: latestSnapshot?.overallIndex || null };
}

async function recallNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  emitAgentEvent({ type: "phase", phase: "recalling", message: "Recalling institutional memory..." });

  // Pull every memory type that decideNode can act on. Previously only
  // "pattern" was recalled, which made the other 4 types we write
  // (insight, observation, decision_context) and the "validated_pattern"
  // and "contradiction" categories dead-weight at recall time — they sat
  // in Mem0 forever but never influenced a decision.
  //
  // Parallel pull, then merge + dedupe on mem0Id (fall back to id for
  // local-only rows). Per-type cap keeps any one bucket from drowning
  // the others when one category has accumulated more memories.
  const [patterns, insights, observations, decisions] = await Promise.all([
    recallMemoriesBatch("pattern", 60),
    recallMemoriesBatch("insight", 30),
    recallMemoriesBatch("observation", 30),
    recallMemoriesBatch("decision_context", 20),
  ]);
  const merged = [...patterns, ...insights, ...observations, ...decisions];
  const seen = new Set<string>();
  const deduped = merged.filter(m => {
    const key = String(m.mem0Id ?? m.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`[Agent] Recall: ${patterns.length}P + ${insights.length}I + ${observations.length}O + ${decisions.length}D → ${deduped.length} unique`);

  // Also query Letta archival for the targets we're about to consider —
  // cycle summaries written via lettaArchivalInsert at memorize time are
  // a second institutional-memory tier and previously were never read.
  const archivalSnippets: string[] = [];
  try {
    const topQueries = state.targets.slice(0, 5).map(t => `${t.industryName} ${t.capabilityName}`);
    const archivals = await Promise.all(topQueries.map(q => searchAgentArchive(q, 2)));
    for (const list of archivals) for (const p of list) if (p.text) archivalSnippets.push(p.text);
  } catch { /* non-fatal — archival is supplementary */ }

  emitAgentEvent({
    type: "recall_complete",
    patternMemories: patterns.length,
    totalMemories: deduped.length,
    lettaArchivalHits: archivalSnippets.length,
    runId: state.runId,
  });

  // Update Letta current_focus block with the upcoming cycle's intent
  try {
    const top = state.targets.slice(0, 8).map(t => `${t.industryName}/${t.capabilityName} (p=${t.priority.toFixed(1)})`).join(", ");
    await putAgentPriorBlock("current_focus", `Run #${state.runId} (${state.trigger}). Top targets: ${top}.`);
  } catch { /* non-fatal */ }

  return { recalledMemories: deduped, lettaArchivalSnippets: archivalSnippets };
}

async function decideNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  emitAgentEvent({ type: "phase", phase: "deciding", message: `Evaluating ${state.targets.length} capabilities against ${state.recalledMemories.length} recalled memories...` });

  // Read the admin-tunable Perplexity cap once per run. Fall back to the
  // code default if the tuning row / DB is unavailable so the agent still
  // makes progress in degraded conditions.
  let maxResearchPerRun = DEFAULT_MAX_RESEARCH_PER_RUN;
  try {
    const tuning = await getTuning();
    maxResearchPerRun = tuning.agentPerplexityCap;
  } catch (err) {
    console.warn("[Agent.decide] failed to read agent_tuning, using default Perplexity cap:", err);
  }

  const decisions: AgentDecision[] = [];
  let researchCount = 0;
  let memoriesUsed = 0;

  for (const target of state.targets) {
    if (researchCount >= maxResearchPerRun) {
      decisions.push({
        capabilityId: target.capabilityId,
        industryId: target.industryId,
        industryName: target.industryName,
        capabilityName: target.capabilityName,
        action: "skip",
        reason: `Max research limit (${maxResearchPerRun}) reached for this run`,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    const memories = filterMemoriesForTarget(state.recalledMemories, target.industryName, target.capabilityName, 3);
    memoriesUsed += memories.length;

    const hasRecentPattern = memories.some(m => {
      const age = (Date.now() - m.createdAt.getTime()) / 86400000;
      return age < 14 && m.relevanceScore > 0.5;
    });
    const hasValidatedPattern = memories.some(m => m.category === "validated_pattern");

    if (target.priority < 1 && target.confidence > 0.7 && !hasHighVolatility(target)) {
      decisions.push({
        capabilityId: target.capabilityId,
        industryId: target.industryId,
        industryName: target.industryName,
        capabilityName: target.capabilityName,
        action: "skip",
        reason: `Fresh data (${target.staleDays}d), high confidence (${target.confidence}), stable velocity`,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    if ((hasRecentPattern || hasValidatedPattern) && target.confidence > 0.5 && target.staleDays < STALE_THRESHOLD_DAYS * 2) {
      decisions.push({
        capabilityId: target.capabilityId,
        industryId: target.industryId,
        industryName: target.industryName,
        capabilityName: target.capabilityName,
        action: "use_memory",
        reason: `${hasValidatedPattern ? "Validated" : "Recent"} memory found (${memories.length} relevant), data only ${target.staleDays}d old`,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    decisions.push({
      capabilityId: target.capabilityId,
      industryId: target.industryId,
      industryName: target.industryName,
      capabilityName: target.capabilityName,
      action: "research",
      reason: buildResearchReason(target),
      timestamp: new Date().toISOString(),
    });
    researchCount++;
  }

  const r = decisions.filter(d => d.action === "research").length;
  const s = decisions.filter(d => d.action === "skip").length;
  const m = decisions.filter(d => d.action === "use_memory").length;
  emitAgentEvent({ type: "decide_complete", toResearch: r, toSkip: s, toUseMemory: m, memoriesRecalled: memoriesUsed });

  return { decisions, memoriesRecalled: memoriesUsed };
}

function hasHighVolatility(target: CapabilityTarget): boolean {
  return Math.abs(target.velocity) > HIGH_VOLATILITY_THRESHOLD;
}

function buildResearchReason(target: CapabilityTarget): string {
  const reasons: string[] = [];
  if (target.staleDays > STALE_THRESHOLD_DAYS) reasons.push(`stale (${target.staleDays}d)`);
  if (target.confidence < LOW_CONFIDENCE_THRESHOLD) reasons.push(`low confidence (${target.confidence})`);
  if (hasHighVolatility(target)) reasons.push(`high velocity (${target.velocity})`);
  if (target.priority >= 5) reasons.push("no prior data");
  return reasons.length > 0 ? reasons.join(", ") : "scheduled update";
}

async function researchNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const toResearch = state.decisions.filter(d => d.action === "research");
  emitAgentEvent({
    type: "phase",
    phase: "researching",
    message: `Researching ${toResearch.length} capabilities via Perplexity...`,
  });

  const results: ResearchFinding[] = [];
  let calls = 0;

  for (const decision of toResearch) {
    try {
      emitAgentEvent({ type: "tool_call", tool: "perplexity_research", capability: decision.capabilityName, industry: decision.industryName });

      const resultStr = await maybeStepRun(
        "research-perplexity",
        () => perplexityResearchTool.invoke({
          industryName: decision.industryName,
          capabilityName: decision.capabilityName,
          industryId: decision.industryId,
          capabilityId: decision.capabilityId,
        }),
      );

      const result = JSON.parse(resultStr);
      if (result.success) {
        results.push({
          capabilityId: decision.capabilityId,
          capabilityName: result.capabilityName,
          industryId: decision.industryId,
          industryName: decision.industryName,
          newScore: result.consensusScore,
          confidence: result.confidence,
        });
        emitAgentEvent({
          type: "tool_result",
          tool: "perplexity_research",
          capability: result.capabilityName,
          score: result.consensusScore,
          confidence: result.confidence,
          sources: result.sourcesCount,
        });
      } else {
        emitAgentEvent({ type: "tool_error", tool: "perplexity_research", capability: decision.capabilityName, error: result.error });
      }
      calls++;
    } catch (err) {
      console.error(`Research failed for ${decision.capabilityName}:`, err);
      emitAgentEvent({ type: "tool_error", tool: "perplexity_research", capability: decision.capabilityName, error: err instanceof Error ? err.message : "unknown" });
    }
  }

  return { researchResults: results, perplexityCalls: calls };
}

async function computeNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (state.researchResults.length === 0) {
    emitAgentEvent({ type: "phase", phase: "skipped_compute", message: "No new research — skipping CVI recomputation" });
    return { cviAfterIndex: state.cviBeforeIndex };
  }

  emitAgentEvent({ type: "tool_call", tool: "compute_cvi", message: "Recomputing CVI index..." });
  try {
    const resultStr = await maybeStepRun("compute-cvi", () => computeCVITool.invoke({}));
    const result = JSON.parse(resultStr);
    if (result.success) {
      emitAgentEvent({
        type: "tool_result",
        tool: "compute_cvi",
        overallIndex: result.overallIndex,
        previousIndex: state.cviBeforeIndex,
        delta: state.cviBeforeIndex ? result.overallIndex - state.cviBeforeIndex : null,
      });
      return { cviAfterIndex: result.overallIndex };
    }
    return { error: result.error };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Computation failed" };
  }
}

async function reflectNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  if (state.researchResults.length === 0) {
    return { reflection: { added: 0, updated: 0, contradictions: 0, priorsUpdated: false }, memoriesStored: 0 };
  }
  const result = await reflectOnFindings(state.runId, state.researchResults);
  return {
    reflection: { added: result.added, updated: result.updated, contradictions: result.contradictions, priorsUpdated: result.prirorsUpdated },
    memoriesStored: result.added + result.updated + result.contradictions,
  };
}

async function memorizeNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  emitAgentEvent({ type: "tool_call", tool: "store_memory", message: "Recording cycle summary..." });

  let stored = state.memoriesStored;

  // Cycle-level decision-context memory (one per run, scoped to runId)
  if (state.researchResults.length > 0 || state.decisions.length > 0) {
    const researchCount = state.decisions.filter(d => d.action === "research").length;
    const skipCount = state.decisions.filter(d => d.action === "skip").length;
    const memoryCount = state.decisions.filter(d => d.action === "use_memory").length;
    const industries = [...new Set(state.decisions.filter(d => d.action === "research").map(d => d.industryName))];

    const cycleSummary =
      `CVI Cycle #${state.runId} (${state.trigger}): researched ${researchCount}, skipped ${skipCount}, ` +
      `used memory for ${memoryCount}. Industries touched: ${industries.join(", ") || "none"}. ` +
      `CVI ${state.cviBeforeIndex?.toFixed(1) ?? "n/a"} → ${state.cviAfterIndex?.toFixed(1) ?? "n/a"}. ` +
      `Reflection: +${state.reflection?.added ?? 0} added, ${state.reflection?.updated ?? 0} refined, ${state.reflection?.contradictions ?? 0} contradictions.`;

    try {
      await storeMemory(
        "decision_context",
        cycleSummary,
        {
          trigger: state.trigger,
          researchCount,
          skipCount,
          memoryCount,
          industries,
          cviDelta: (state.cviAfterIndex || 0) - (state.cviBeforeIndex || 0),
        },
        {
          category: "decision",
          runId: state.runId,
          context: `The CVI agent just finished its #${state.runId} research cycle. Summarize the outcome in durable, queryable terms so future cycles can recall and reason about what was learned, what was skipped, and how the index moved.`,
        },
      );
      stored++;
    } catch (err) {
      console.log("[memorize] decision_context store failed:", err instanceof Error ? err.message : err);
    }

    // Also push the cycle summary into Letta archival memory for long-term reasoning
    try {
      await appendAgentArchive(`[cycle #${state.runId}] ${cycleSummary}`, { runId: state.runId, kind: "cycle_summary" });
    } catch { /* non-fatal */ }

    // Close the Letta feedback loop: when contradictions surface, prompt
    // the stateful agent to refine its `industry_priors` core block. Without
    // Without Letta there's no agent on the other end to autonomously
    // rewrite the priors block — we do it explicitly here: read the
    // current block from the shared store, ask Haiku to refine given the
    // contradictions, write back. Same outcome as the old lettaSendMessage
    // pattern but transparent and synchronous.
    const contradictionCount = state.reflection?.contradictions ?? 0;
    const refinedCount = state.reflection?.updated ?? 0;
    if (contradictionCount > 0 || refinedCount >= 3) {
      try {
        const touchedIndustries = industries.slice(0, 4).join(", ") || "none specified";
        const { getAgentPriorBlock } = await import("./store");
        const currentPriors = (await getAgentPriorBlock("industry_priors")) ?? "(no priors recorded yet)";
        const prompt =
          `Cycle #${state.runId} just finished. Reflection found ` +
          `${contradictionCount} contradiction${contradictionCount === 1 ? "" : "s"} and ` +
          `${refinedCount} refinement${refinedCount === 1 ? "" : "s"} across: ${touchedIndustries}.\n\n` +
          `CURRENT industry_priors:\n${currentPriors}\n\n` +
          `If any of the findings above meaningfully change what you believe about an industry's ` +
          `capability dynamics, return the FULL revised industry_priors text (principles, not transcript). ` +
          `If nothing material changed, return EXACTLY the string "no update" and nothing else. ` +
          `Be concise — total length under 6000 chars.`;
        const llm = new ChatAnthropic({ model: "claude-haiku-4-5-20251001", temperature: 0.2, maxTokens: 2000 });
        // AIMessage isn't JSON-safe — reduce to a string INSIDE the step so
        // only plain text crosses the Inngest step boundary.
        const text = await maybeStepRun("decide-llm", async () => {
          const res = await llm.invoke(prompt);
          const raw = res.content;
          return Array.isArray(raw)
            ? raw.map(p => (typeof p === "string" ? p : "text" in p && typeof p.text === "string" ? p.text : "")).join("")
            : String(raw);
        });
        const trimmed = text.trim();
        if (trimmed && trimmed.toLowerCase() !== "no update") {
          await putAgentPriorBlock("industry_priors", trimmed, {
            updatedReason: "memorize_node_contradiction_feedback",
            sourceRunId: state.runId,
          });
        }
      } catch { /* non-fatal — agent shouldn't fail a cycle on rewrite hiccup */ }
    }
  }

  emitAgentEvent({
    type: "memorize_complete",
    memoriesStored: stored,
    mem0Connected: !!process.env.MEM0_API_KEY,
  });

  return { memoriesStored: stored };
}

async function generateContentNode(_state: AgentStateType): Promise<Partial<AgentStateType>> {
  emitAgentEvent({ type: "phase", phase: "generating_content", message: "Generating insights, leaderboard, white papers, C-suite perspectives, and case study content..." });

  const industries = await db.select({ slug: industriesTable.slug }).from(industriesTable);
  const industrySlugs = industries.map(i => i.slug);

  for (const slug of industrySlugs) {
    try {
      emitAgentEvent({ type: "tool_call", tool: "generate_insights", industry: slug });
      const r = JSON.parse(await maybeStepRun(
        `finalize-insights-${slug}`,
        () => generateInsightsTool.invoke({ industrySlug: slug }),
      )) as { success: boolean; skipped?: boolean; insightsGenerated?: number };
      emitAgentEvent({ type: "tool_result", tool: "generate_insights", industry: slug, success: r.success, skipped: r.skipped ?? false, generated: r.insightsGenerated ?? 0 });
    } catch (err) { console.error(`[generateContent] Insights ${slug}:`, err); }

    try {
      emitAgentEvent({ type: "tool_call", tool: "generate_leaderboard", industry: slug });
      const r = JSON.parse(await maybeStepRun(
        `finalize-leaderboard-${slug}`,
        () => generateLeaderboardTool.invoke({ industrySlug: slug }),
      )) as { success: boolean; skipped?: boolean; entriesGenerated?: number };
      emitAgentEvent({ type: "tool_result", tool: "generate_leaderboard", industry: slug, success: r.success, skipped: r.skipped ?? false, generated: r.entriesGenerated ?? 0 });
    } catch (err) { console.error(`[generateContent] Leaderboard ${slug}:`, err); }

    try {
      emitAgentEvent({ type: "tool_call", tool: "generate_white_papers", industry: slug });
      const r = JSON.parse(await maybeStepRun(
        `finalize-whitepapers-${slug}`,
        () => generateWhitePapersTool.invoke({ industrySlug: slug }),
      )) as { success: boolean; skipped?: boolean; papersGenerated?: number };
      emitAgentEvent({ type: "tool_result", tool: "generate_white_papers", industry: slug, success: r.success, skipped: r.skipped ?? false, generated: r.papersGenerated ?? 0 });
    } catch (err) { console.error(`[generateContent] White papers ${slug}:`, err); }

    try {
      emitAgentEvent({ type: "tool_call", tool: "generate_ontology", industry: slug });
      const r = JSON.parse(await maybeStepRun(
        `finalize-ontology-${slug}`,
        () => generateOntologyTool.invoke({ industrySlug: slug }),
      )) as { success: boolean; skipped?: boolean; relationshipsGenerated?: number };
      emitAgentEvent({ type: "tool_result", tool: "generate_ontology", industry: slug, success: r.success, skipped: r.skipped ?? false, generated: r.relationshipsGenerated ?? 0 });
    } catch (err) { console.error(`[generateContent] Ontology ${slug}:`, err); }
  }

  try {
    emitAgentEvent({ type: "tool_call", tool: "generate_csuite_perspectives" });
    const r = JSON.parse(await maybeStepRun(
      "finalize-csuite",
      () => generateCsuitePerspectivesTool.invoke({}),
    )) as { success: boolean; generated?: string[]; skipped?: string[] };
    emitAgentEvent({ type: "tool_result", tool: "generate_csuite_perspectives", generated: r.generated?.length ?? 0, skipped: r.skipped?.length ?? 0 });
  } catch (err) { console.error("[generateContent] C-suite:", err); }

  try {
    emitAgentEvent({ type: "tool_call", tool: "generate_case_study", industry: "insurance" });
    const r = JSON.parse(await maybeStepRun(
      "finalize-casestudy-insurance",
      () => generateCaseStudyContentTool.invoke({ industrySlug: "insurance" }),
    )) as { success: boolean; skipped?: boolean };
    emitAgentEvent({ type: "tool_result", tool: "generate_case_study", industry: "insurance", success: r.success, skipped: r.skipped ?? false });
  } catch (err) { console.error("[generateContent] Case study:", err); }

  return {};
}

async function finalizeNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const researchDecisions = state.decisions.filter(d => d.action === "research").length;
  const skipDecisions = state.decisions.filter(d => d.action === "skip").length;

  await db.update(agentRunsTable)
    .set({
      status: state.error ? "failed" : "completed",
      industriesEvaluated: new Set(state.targets.map(t => t.industryId)).size,
      capabilitiesResearched: researchDecisions,
      capabilitiesSkipped: skipDecisions,
      perplexityCalls: state.perplexityCalls,
      memoriesRecalled: state.memoriesRecalled,
      memoriesStored: state.memoriesStored,
      decisions: state.decisions.map(d => ({
        capabilityId: d.capabilityId,
        industryId: String(d.industryId),
        action: d.action,
        reason: d.reason,
        timestamp: d.timestamp,
      })),
      cviBeforeIndex: state.cviBeforeIndex,
      cviAfterIndex: state.cviAfterIndex,
      errorMessage: state.error,
      completedAt: new Date(),
    })
    .where(eq(agentRunsTable.id, state.runId));

  emitAgentEvent({
    type: "cycle_complete",
    runId: state.runId,
    researched: researchDecisions,
    skipped: skipDecisions,
    perplexityCalls: state.perplexityCalls,
    memoriesRecalled: state.memoriesRecalled,
    memoriesStored: state.memoriesStored,
    reflection: state.reflection,
    cviIndex: state.cviAfterIndex,
    mem0Connected: !!process.env.MEM0_API_KEY,
  });

  return {};
}

function shouldResearch(state: AgentStateType): "research" | "compute" {
  return state.decisions.some(d => d.action === "research") ? "research" : "compute";
}

const workflow = new StateGraph(AgentState)
  .addNode("evaluate", evaluateNode)
  .addNode("recall", recallNode)
  .addNode("decide", decideNode)
  .addNode("research", researchNode)
  .addNode("compute", computeNode)
  .addNode("reflect", reflectNode)
  .addNode("memorize", memorizeNode)
  .addNode("generateContent", generateContentNode)
  .addNode("finalize", finalizeNode)
  .addEdge(START, "evaluate")
  .addEdge("evaluate", "recall")
  .addEdge("recall", "decide")
  .addConditionalEdges("decide", shouldResearch, {
    research: "research",
    compute: "compute",
  })
  .addEdge("research", "compute")
  .addEdge("compute", "reflect")
  .addEdge("reflect", "memorize")
  .addEdge("memorize", "generateContent")
  .addEdge("generateContent", "finalize")
  .addEdge("finalize", END);

export const agentGraph = workflow.compile();

export async function runAgent(trigger: string = "scheduled"): Promise<{
  runId: number;
  researched: number;
  skipped: number;
  perplexityCalls: number;
  cviBeforeIndex: number | null;
  cviAfterIndex: number | null;
  memoriesRecalled: number;
  memoriesStored: number;
  reflection: { added: number; updated: number; contradictions: number; priorsUpdated: boolean } | null;
  error: string | null;
}> {
  const [run] = await db.insert(agentRunsTable).values({
    status: "running",
    trigger,
  }).returning();

  emitAgentEvent({ type: "run_started", runId: run.id, trigger });

  try {
    const result = await agentGraph.invoke({
      runId: run.id,
      trigger,
      targets: [],
      recalledMemories: [],
      decisions: [],
      researchResults: [],
      reflection: null,
      memoriesRecalled: 0,
      memoriesStored: 0,
      perplexityCalls: 0,
      cviBeforeIndex: null,
      cviAfterIndex: null,
      error: null,
    });

    return {
      runId: run.id,
      researched: result.decisions.filter((d: AgentDecision) => d.action === "research").length,
      skipped: result.decisions.filter((d: AgentDecision) => d.action === "skip").length,
      perplexityCalls: result.perplexityCalls,
      cviBeforeIndex: result.cviBeforeIndex,
      cviAfterIndex: result.cviAfterIndex,
      memoriesRecalled: result.memoriesRecalled,
      memoriesStored: result.memoriesStored,
      reflection: result.reflection,
      error: result.error,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";
    await db.update(agentRunsTable)
      .set({ status: "failed", errorMessage: errorMsg, completedAt: new Date() })
      .where(eq(agentRunsTable.id, run.id));
    emitAgentEvent({ type: "error", message: errorMsg });
    throw err;
  }
}
