/**
 * CVI Autonomous Agent — AgentKit implementation.
 *
 * Translates the LangGraph StateGraph in `services/agent/graph.ts` to
 * a procedural orchestration that uses AgentKit's `anthropic()` model +
 * `createAgent` + `createNetwork` primitives. The 9 phases run in the
 * same fixed sequence the StateGraph compiled to:
 *
 *   evaluate → recall → decide → research? → compute → reflect →
 *     memorize → generateContent → finalize
 *
 * Why procedural rather than a Network with a phase router: every phase
 * except `memorize`'s optional prior-refinement step is deterministic
 * orchestration over DB rows + tool invocations. The LangGraph nodes
 * never delegated tool-selection to an LLM — they called tools directly
 * (e.g. `perplexityResearchTool.invoke(...)` inside `researchNode`).
 * Wrapping deterministic code in "Agents" with no LLM call adds
 * indirection without changing observable behavior. The ONE place an
 * LLM is actually consulted — refining the `industry_priors` block when
 * contradictions surface in `memorize` — is implemented as a real
 * single-agent AgentKit Network so the migration is genuinely on AgentKit
 * primitives (not just on top of the raw Anthropic SDK).
 *
 * Output shape: identical to `runAgent` (the LangGraph entrypoint). The
 * Inngest kill-switch in `inngest/functions/agents.ts` can flip between
 * implementations at runtime via `USE_LANGGRAPH_CVI=1`.
 *
 * Letta agent name `cvi-autonomous-agent` is preserved (see AGENT_REGISTRY).
 */
import { createAgent, createNetwork, anthropic } from "@inngest/agent-kit";
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
} from "./agent/memory";
import { emitAgentEvent } from "./agent/events";
import { getTuning } from "./agent-tuning";
import { putAgentPriorBlock, appendAgentArchive, searchAgentArchive } from "./agent/store";
import { reflectOnFindings, type ResearchFinding } from "./agent/reflect";
import {
  perplexityResearchTool,
  computeCVITool,
  generateCsuitePerspectivesTool,
  generateCaseStudyContentTool,
  generateInsightsTool,
  generateLeaderboardTool,
  generateWhitePapersTool,
  generateOntologyTool,
} from "./agent/tools";
import { maybeStepRun } from "../inngest/step-context";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";

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

const STALE_THRESHOLD_DAYS = 7;
const HIGH_VOLATILITY_THRESHOLD = 0.1;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const DEFAULT_MAX_RESEARCH_PER_RUN = 6;

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

// ── AgentKit network for the one true LLM step (prior refinement) ──────
// A single-agent Network. The agent has no tools — it just consumes the
// prompt and returns refined `industry_priors` text. Output is read off
// the AgentResult and persisted via putAgentPriorBlock.
const priorsRefinementAgent = createAgent({
  name: "cvi-priors-refinement",
  description:
    "Refines the CVI agent's industry_priors block when reflection surfaces contradictions or many refinements.",
  system: "You are the CVI agent's priors-refinement step. Given the current industry_priors and a summary of this cycle's contradictions, return either the FULL revised industry_priors text (principles, not transcript) or the literal string 'no update' if nothing material changed. Be concise — total length under 6000 chars.",
  model: anthropic({
    model: HAIKU_MODEL,
    defaultParameters: { max_tokens: 2000, temperature: 0.2 },
  }),
});

const priorsRefinementNetwork = createNetwork({
  name: "cvi-priors-refinement-network",
  agents: [priorsRefinementAgent],
  maxIter: 1,
});

async function refinePriorsViaAgentKit(prompt: string): Promise<string> {
  const run = await priorsRefinementNetwork.run(prompt);
  const results = run.state.results;
  const lastResult = results.length > 0 ? results[results.length - 1] : undefined;
  if (!lastResult) return "";
  let text = "";
  for (const msg of lastResult.output) {
    if (msg.type === "text" && msg.role === "assistant") {
      if (typeof msg.content === "string") {
        text += msg.content;
      } else {
        for (const part of msg.content) text += part.text;
      }
    }
  }
  return text;
}

// ── Phase 1: evaluate ──────────────────────────────────────────────────
async function evaluatePhase(): Promise<{ targets: CapabilityTarget[]; cviBeforeIndex: number | null }> {
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

// ── Phase 2: recall ────────────────────────────────────────────────────
async function recallPhase(
  runId: number,
  trigger: string,
  targets: CapabilityTarget[],
): Promise<{ recalledMemories: AgentMemory[]; lettaArchivalSnippets: string[] }> {
  emitAgentEvent({ type: "phase", phase: "recalling", message: "Recalling institutional memory..." });

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
  console.log(`[CviAgentKit] Recall: ${patterns.length}P + ${insights.length}I + ${observations.length}O + ${decisions.length}D → ${deduped.length} unique`);

  const archivalSnippets: string[] = [];
  try {
    const topQueries = targets.slice(0, 5).map(t => `${t.industryName} ${t.capabilityName}`);
    const archivals = await Promise.all(topQueries.map(q => searchAgentArchive(q, 2)));
    for (const list of archivals) for (const p of list) if (p.text) archivalSnippets.push(p.text);
  } catch { /* non-fatal — archival is supplementary */ }

  emitAgentEvent({
    type: "recall_complete",
    patternMemories: patterns.length,
    totalMemories: deduped.length,
    lettaArchivalHits: archivalSnippets.length,
    runId,
  });

  try {
    const top = targets.slice(0, 8).map(t => `${t.industryName}/${t.capabilityName} (p=${t.priority.toFixed(1)})`).join(", ");
    await putAgentPriorBlock("current_focus", `Run #${runId} (${trigger}). Top targets: ${top}.`);
  } catch { /* non-fatal */ }

  return { recalledMemories: deduped, lettaArchivalSnippets: archivalSnippets };
}

// ── Phase 3: decide ────────────────────────────────────────────────────
async function decidePhase(
  targets: CapabilityTarget[],
  recalledMemories: AgentMemory[],
): Promise<{ decisions: AgentDecision[]; memoriesRecalled: number }> {
  emitAgentEvent({
    type: "phase",
    phase: "deciding",
    message: `Evaluating ${targets.length} capabilities against ${recalledMemories.length} recalled memories...`,
  });

  let maxResearchPerRun = DEFAULT_MAX_RESEARCH_PER_RUN;
  try {
    const tuning = await getTuning();
    maxResearchPerRun = tuning.agentPerplexityCap;
  } catch (err) {
    console.warn("[CviAgentKit.decide] failed to read agent_tuning, using default Perplexity cap:", err);
  }

  const decisions: AgentDecision[] = [];
  let researchCount = 0;
  let memoriesUsed = 0;

  for (const target of targets) {
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

    const memories = filterMemoriesForTarget(recalledMemories, target.industryName, target.capabilityName, 3);
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

// ── Phase 4: research ──────────────────────────────────────────────────
async function researchPhase(
  decisions: AgentDecision[],
): Promise<{ researchResults: ResearchFinding[]; perplexityCalls: number }> {
  const toResearch = decisions.filter(d => d.action === "research");
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

      // Unique per-capability step ID — the surrounding loop iterates over
      // multiple capabilities, so reusing a bare "research-perplexity" name
      // triggers Inngest's AUTOMATIC_PARALLEL_INDEXING warning. The
      // capabilityId is stable across replay so memoization still works.
      const resultStr = await maybeStepRun(
        `research-perplexity-cap-${decision.capabilityId}`,
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

// ── Phase 5: compute ───────────────────────────────────────────────────
async function computePhase(
  researchResults: ResearchFinding[],
  cviBeforeIndex: number | null,
): Promise<{ cviAfterIndex: number | null; error: string | null }> {
  if (researchResults.length === 0) {
    emitAgentEvent({ type: "phase", phase: "skipped_compute", message: "No new research — skipping CVI recomputation" });
    return { cviAfterIndex: cviBeforeIndex, error: null };
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
        previousIndex: cviBeforeIndex,
        delta: cviBeforeIndex ? result.overallIndex - cviBeforeIndex : null,
      });
      return { cviAfterIndex: result.overallIndex, error: null };
    }
    return { cviAfterIndex: null, error: result.error };
  } catch (err) {
    return { cviAfterIndex: null, error: err instanceof Error ? err.message : "Computation failed" };
  }
}

// ── Phase 6: reflect ───────────────────────────────────────────────────
async function reflectPhase(
  runId: number,
  researchResults: ResearchFinding[],
): Promise<{
  reflection: { added: number; updated: number; contradictions: number; priorsUpdated: boolean } | null;
  memoriesStored: number;
}> {
  if (researchResults.length === 0) {
    return { reflection: { added: 0, updated: 0, contradictions: 0, priorsUpdated: false }, memoriesStored: 0 };
  }
  const result = await reflectOnFindings(runId, researchResults);
  return {
    reflection: { added: result.added, updated: result.updated, contradictions: result.contradictions, priorsUpdated: result.prirorsUpdated },
    memoriesStored: result.added + result.updated + result.contradictions,
  };
}

// ── Phase 7: memorize ──────────────────────────────────────────────────
async function memorizePhase(args: {
  runId: number;
  trigger: string;
  researchResults: ResearchFinding[];
  decisions: AgentDecision[];
  cviBeforeIndex: number | null;
  cviAfterIndex: number | null;
  reflection: { added: number; updated: number; contradictions: number; priorsUpdated: boolean } | null;
  memoriesStored: number;
}): Promise<{ memoriesStored: number }> {
  emitAgentEvent({ type: "tool_call", tool: "store_memory", message: "Recording cycle summary..." });

  let stored = args.memoriesStored;

  if (args.researchResults.length > 0 || args.decisions.length > 0) {
    const researchCount = args.decisions.filter(d => d.action === "research").length;
    const skipCount = args.decisions.filter(d => d.action === "skip").length;
    const memoryCount = args.decisions.filter(d => d.action === "use_memory").length;
    const industries = [...new Set(args.decisions.filter(d => d.action === "research").map(d => d.industryName))];

    const cycleSummary =
      `CVI Cycle #${args.runId} (${args.trigger}): researched ${researchCount}, skipped ${skipCount}, ` +
      `used memory for ${memoryCount}. Industries touched: ${industries.join(", ") || "none"}. ` +
      `CVI ${args.cviBeforeIndex?.toFixed(1) ?? "n/a"} → ${args.cviAfterIndex?.toFixed(1) ?? "n/a"}. ` +
      `Reflection: +${args.reflection?.added ?? 0} added, ${args.reflection?.updated ?? 0} refined, ${args.reflection?.contradictions ?? 0} contradictions.`;

    try {
      await storeMemory(
        "decision_context",
        cycleSummary,
        {
          trigger: args.trigger,
          researchCount,
          skipCount,
          memoryCount,
          industries,
          cviDelta: (args.cviAfterIndex || 0) - (args.cviBeforeIndex || 0),
        },
        {
          category: "decision",
          runId: args.runId,
          context: `The CVI agent just finished its #${args.runId} research cycle. Summarize the outcome in durable, queryable terms so future cycles can recall and reason about what was learned, what was skipped, and how the index moved.`,
        },
      );
      stored++;
    } catch (err) {
      console.log("[CviAgentKit.memorize] decision_context store failed:", err instanceof Error ? err.message : err);
    }

    try {
      await appendAgentArchive(`[cycle #${args.runId}] ${cycleSummary}`, { runId: args.runId, kind: "cycle_summary" });
    } catch { /* non-fatal */ }

    // Prior refinement — the one true LLM step in the CVI cycle. Identical
    // semantics to the LangGraph version's ChatAnthropic call, but routed
    // through an AgentKit single-agent Network so this implementation has
    // no remaining LangChain surface.
    const contradictionCount = args.reflection?.contradictions ?? 0;
    const refinedCount = args.reflection?.updated ?? 0;
    if (contradictionCount > 0 || refinedCount >= 3) {
      try {
        const touchedIndustries = industries.slice(0, 4).join(", ") || "none specified";
        const { getAgentPriorBlock } = await import("./agent/store");
        const currentPriors = (await getAgentPriorBlock("industry_priors")) ?? "(no priors recorded yet)";
        const prompt =
          `Cycle #${args.runId} just finished. Reflection found ` +
          `${contradictionCount} contradiction${contradictionCount === 1 ? "" : "s"} and ` +
          `${refinedCount} refinement${refinedCount === 1 ? "" : "s"} across: ${touchedIndustries}.\n\n` +
          `CURRENT industry_priors:\n${currentPriors}\n\n` +
          `If any of the findings above meaningfully change what you believe about an industry's ` +
          `capability dynamics, return the FULL revised industry_priors text (principles, not transcript). ` +
          `If nothing material changed, return EXACTLY the string "no update" and nothing else. ` +
          `Be concise — total length under 6000 chars.`;

        const text = await maybeStepRun("decide-llm", () => refinePriorsViaAgentKit(prompt));
        const trimmed = text.trim();
        if (trimmed && trimmed.toLowerCase() !== "no update") {
          await putAgentPriorBlock("industry_priors", trimmed, {
            updatedReason: "memorize_node_contradiction_feedback",
            sourceRunId: args.runId,
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

// ── Phase 8: generateContent ───────────────────────────────────────────
async function generateContentPhase(): Promise<void> {
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
}

// ── Phase 9: finalize ──────────────────────────────────────────────────
async function finalizePhase(args: {
  runId: number;
  targets: CapabilityTarget[];
  decisions: AgentDecision[];
  perplexityCalls: number;
  memoriesRecalled: number;
  memoriesStored: number;
  reflection: { added: number; updated: number; contradictions: number; priorsUpdated: boolean } | null;
  cviBeforeIndex: number | null;
  cviAfterIndex: number | null;
  error: string | null;
}): Promise<void> {
  const researchDecisions = args.decisions.filter(d => d.action === "research").length;
  const skipDecisions = args.decisions.filter(d => d.action === "skip").length;

  await db.update(agentRunsTable)
    .set({
      status: args.error ? "failed" : "completed",
      industriesEvaluated: new Set(args.targets.map(t => t.industryId)).size,
      capabilitiesResearched: researchDecisions,
      capabilitiesSkipped: skipDecisions,
      perplexityCalls: args.perplexityCalls,
      memoriesRecalled: args.memoriesRecalled,
      memoriesStored: args.memoriesStored,
      decisions: args.decisions.map(d => ({
        capabilityId: d.capabilityId,
        industryId: String(d.industryId),
        action: d.action,
        reason: d.reason,
        timestamp: d.timestamp,
      })),
      cviBeforeIndex: args.cviBeforeIndex,
      cviAfterIndex: args.cviAfterIndex,
      errorMessage: args.error,
      completedAt: new Date(),
    })
    .where(eq(agentRunsTable.id, args.runId));

  emitAgentEvent({
    type: "cycle_complete",
    runId: args.runId,
    researched: researchDecisions,
    skipped: skipDecisions,
    perplexityCalls: args.perplexityCalls,
    memoriesRecalled: args.memoriesRecalled,
    memoriesStored: args.memoriesStored,
    reflection: args.reflection,
    cviIndex: args.cviAfterIndex,
    mem0Connected: !!process.env.MEM0_API_KEY,
  });
}

/**
 * Run one CVI autonomous cycle via AgentKit. Output shape matches the
 * legacy `runAgent` (services/agent/graph.ts) verbatim so the Inngest
 * kill-switch in `inngest/functions/agents.ts` can route to either
 * implementation transparently via `USE_LANGGRAPH_CVI=1`.
 */
export async function runCviAgentAgentKit(trigger: string = "scheduled"): Promise<{
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
    // Phase 1: evaluate
    const { targets, cviBeforeIndex } = await evaluatePhase();
    // Phase 2: recall
    const { recalledMemories } = await recallPhase(run.id, trigger, targets);
    // Phase 3: decide
    const { decisions, memoriesRecalled } = await decidePhase(targets, recalledMemories);
    // Phase 4: research (conditional — skipped when no decisions need it)
    const needsResearch = decisions.some(d => d.action === "research");
    const { researchResults, perplexityCalls } = needsResearch
      ? await researchPhase(decisions)
      : { researchResults: [] as ResearchFinding[], perplexityCalls: 0 };
    // Phase 5: compute
    const { cviAfterIndex, error } = await computePhase(researchResults, cviBeforeIndex);
    // Phase 6: reflect
    const { reflection, memoriesStored: reflectMemories } = await reflectPhase(run.id, researchResults);
    // Phase 7: memorize
    const { memoriesStored } = await memorizePhase({
      runId: run.id,
      trigger,
      researchResults,
      decisions,
      cviBeforeIndex,
      cviAfterIndex,
      reflection,
      memoriesStored: reflectMemories,
    });
    // Phase 8: generate downstream content
    await generateContentPhase();
    // Phase 9: finalize
    await finalizePhase({
      runId: run.id,
      targets,
      decisions,
      perplexityCalls,
      memoriesRecalled,
      memoriesStored,
      reflection,
      cviBeforeIndex,
      cviAfterIndex,
      error,
    });

    return {
      runId: run.id,
      researched: decisions.filter(d => d.action === "research").length,
      skipped: decisions.filter(d => d.action === "skip").length,
      perplexityCalls,
      cviBeforeIndex,
      cviAfterIndex,
      memoriesRecalled,
      memoriesStored,
      reflection,
      error,
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
