import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  ceiComponentsTable,
  ceiSnapshotsTable,
  agentRunsTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { triangulateCapability } from "../triangulation";
import { computeCEI } from "../cei-engine";
import { recallMemories, storeMemory } from "./memory";
import { emitAgentEvent } from "./events";

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
  decisions: Annotation<AgentDecision[]>,
  researchResults: Annotation<Array<{ capabilityName: string; newScore: number; confidence: number }>>,
  memoriesRecalled: Annotation<number>,
  memoriesStored: Annotation<number>,
  perplexityCalls: Annotation<number>,
  ceiBeforeIndex: Annotation<number | null>,
  ceiAfterIndex: Annotation<number | null>,
  error: Annotation<string | null>,
});

type AgentStateType = typeof AgentState.State;

const STALE_THRESHOLD_DAYS = 7;
const HIGH_VOLATILITY_THRESHOLD = 0.1;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const MAX_RESEARCH_PER_RUN = 6;

async function evaluateNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  emitAgentEvent({ type: "phase", phase: "evaluating", message: "Scanning industries and capabilities..." });

  const industries = await db.select().from(industriesTable);
  const allCaps = await db.select().from(capabilitiesTable);
  const components = await db.select().from(ceiComponentsTable);
  const [latestSnapshot] = await db.select().from(ceiSnapshotsTable)
    .orderBy(desc(ceiSnapshotsTable.snapshotAt)).limit(1);

  const compMap = new Map<string, typeof components[0]>();
  for (const c of components) {
    compMap.set(`${c.industryId}-${c.capabilityId}`, c);
  }

  const now = Date.now();
  const targets: CapabilityTarget[] = [];

  for (const industry of industries) {
    const caps = allCaps.filter(c => c.industryId === industry.id);
    for (const cap of caps) {
      const comp = compMap.get(`${industry.id}-${cap.id}`);
      const updatedAt = comp?.updatedAt?.getTime() || 0;
      const staleDays = (now - updatedAt) / (1000 * 60 * 60 * 24);

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

  return {
    targets,
    ceiBeforeIndex: latestSnapshot?.overallIndex || null,
  };
}

async function decideNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  emitAgentEvent({ type: "phase", phase: "deciding", message: `Evaluating ${state.targets.length} capabilities...` });

  const decisions: AgentDecision[] = [];
  let researchCount = 0;
  let memoriesRecalled = 0;

  for (const target of state.targets) {
    if (researchCount >= MAX_RESEARCH_PER_RUN) {
      decisions.push({
        capabilityId: target.capabilityId,
        industryId: target.industryId,
        industryName: target.industryName,
        capabilityName: target.capabilityName,
        action: "skip",
        reason: `Max research limit (${MAX_RESEARCH_PER_RUN}) reached for this run`,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    const memories = await recallMemories(
      `${target.industryName} ${target.capabilityName} trend pattern`,
      "pattern",
      3,
    );
    memoriesRecalled += memories.length;

    const hasRecentPattern = memories.some(m => {
      const age = (Date.now() - m.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      return age < 14 && m.relevanceScore > 0.5;
    });

    if (target.priority < 1 && target.confidence > 0.7 && !hasHighVolatility(target)) {
      decisions.push({
        capabilityId: target.capabilityId,
        industryId: target.industryId,
        industryName: target.industryName,
        capabilityName: target.capabilityName,
        action: "skip",
        reason: `Fresh data (${target.staleDays}d old), high confidence (${target.confidence}), stable velocity`,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    if (hasRecentPattern && target.confidence > 0.5 && target.staleDays < STALE_THRESHOLD_DAYS * 2) {
      decisions.push({
        capabilityId: target.capabilityId,
        industryId: target.industryId,
        industryName: target.industryName,
        capabilityName: target.capabilityName,
        action: "use_memory",
        reason: `Recent memory pattern found (${memories.length} relevant), data only ${target.staleDays}d old`,
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

  return { decisions, memoriesRecalled };
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

  const results: Array<{ capabilityName: string; newScore: number; confidence: number }> = [];
  let calls = 0;

  for (const decision of toResearch) {
    try {
      emitAgentEvent({
        type: "research",
        capability: decision.capabilityName,
        industry: decision.industryName,
      });

      const result = await triangulateCapability(
        decision.industryName,
        decision.capabilityName,
        decision.industryId,
        decision.capabilityId,
      );

      results.push({
        capabilityName: result.capabilityName,
        newScore: result.consensusScore,
        confidence: result.confidence,
      });
      calls++;
    } catch (err) {
      console.error(`Research failed for ${decision.capabilityName}:`, err);
      emitAgentEvent({
        type: "error",
        message: `Research failed for ${decision.capabilityName}: ${err instanceof Error ? err.message : "unknown"}`,
      });
    }
  }

  return { researchResults: results, perplexityCalls: calls };
}

async function computeNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const researchCount = state.researchResults.length;
  if (researchCount === 0) {
    emitAgentEvent({ type: "phase", phase: "skipped_compute", message: "No new research — skipping CEI recomputation" });
    return { ceiAfterIndex: state.ceiBeforeIndex };
  }

  emitAgentEvent({ type: "phase", phase: "computing", message: "Recomputing CEI index..." });

  try {
    const result = await computeCEI();
    emitAgentEvent({
      type: "cei_updated",
      overallIndex: result.overallIndex,
      previousIndex: state.ceiBeforeIndex,
    });
    return { ceiAfterIndex: result.overallIndex };
  } catch (err) {
    console.error("CEI computation failed:", err);
    return { error: err instanceof Error ? err.message : "Computation failed" };
  }
}

async function memorizeNode(state: AgentStateType): Promise<Partial<AgentStateType>> {
  emitAgentEvent({ type: "phase", phase: "memorizing", message: "Storing learned patterns..." });

  let stored = 0;

  if (state.researchResults.length > 0) {
    const avgScore = state.researchResults.reduce((s, r) => s + r.newScore, 0) / state.researchResults.length;
    const avgConfidence = state.researchResults.reduce((s, r) => s + r.confidence, 0) / state.researchResults.length;

    const industries = [...new Set(state.decisions.filter(d => d.action === "research").map(d => d.industryName))];

    await storeMemory("observation", 
      `Research cycle completed: ${state.researchResults.length} capabilities updated. ` +
      `Average score: ${avgScore.toFixed(1)}, average confidence: ${avgConfidence.toFixed(2)}. ` +
      `Industries: ${industries.join(", ")}. ` +
      `CEI moved from ${state.ceiBeforeIndex} to ${state.ceiAfterIndex}.`,
      {
        researchCount: state.researchResults.length,
        avgScore,
        avgConfidence,
        ceiDelta: (state.ceiAfterIndex || 0) - (state.ceiBeforeIndex || 0),
        industries,
      },
    );
    stored++;

    for (const result of state.researchResults) {
      if (result.confidence > 0.8) {
        await storeMemory("pattern",
          `${result.capabilityName} scored ${result.newScore.toFixed(1)} with high confidence (${result.confidence.toFixed(2)})`,
          { capabilityName: result.capabilityName, score: result.newScore, confidence: result.confidence },
        );
        stored++;
      }
    }
  }

  const skipCount = state.decisions.filter(d => d.action === "skip").length;
  const memoryCount = state.decisions.filter(d => d.action === "use_memory").length;
  if (skipCount > 0 || memoryCount > 0) {
    await storeMemory("decision_context",
      `Decision summary: ${state.decisions.filter(d => d.action === "research").length} researched, ` +
      `${skipCount} skipped, ${memoryCount} used memory. ` +
      `Trigger: ${state.trigger}.`,
      { trigger: state.trigger, skipCount, memoryCount },
    );
    stored++;
  }

  return { memoriesStored: stored };
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
      ceiBeforeIndex: state.ceiBeforeIndex,
      ceiAfterIndex: state.ceiAfterIndex,
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
    ceiIndex: state.ceiAfterIndex,
  });

  return {};
}

function shouldResearch(state: AgentStateType): "research" | "compute" {
  const hasResearch = state.decisions.some(d => d.action === "research");
  return hasResearch ? "research" : "compute";
}

const workflow = new StateGraph(AgentState)
  .addNode("evaluate", evaluateNode)
  .addNode("decide", decideNode)
  .addNode("research", researchNode)
  .addNode("compute", computeNode)
  .addNode("memorize", memorizeNode)
  .addNode("finalize", finalizeNode)
  .addEdge(START, "evaluate")
  .addEdge("evaluate", "decide")
  .addConditionalEdges("decide", shouldResearch, {
    research: "research",
    compute: "compute",
  })
  .addEdge("research", "compute")
  .addEdge("compute", "memorize")
  .addEdge("memorize", "finalize")
  .addEdge("finalize", END);

export const agentGraph = workflow.compile();

export async function runAgent(trigger: string = "scheduled"): Promise<{
  runId: number;
  researched: number;
  skipped: number;
  perplexityCalls: number;
  ceiBeforeIndex: number | null;
  ceiAfterIndex: number | null;
  memoriesRecalled: number;
  memoriesStored: number;
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
      decisions: [],
      researchResults: [],
      memoriesRecalled: 0,
      memoriesStored: 0,
      perplexityCalls: 0,
      ceiBeforeIndex: null,
      ceiAfterIndex: null,
      error: null,
    });

    return {
      runId: run.id,
      researched: result.decisions.filter((d: AgentDecision) => d.action === "research").length,
      skipped: result.decisions.filter((d: AgentDecision) => d.action === "skip").length,
      perplexityCalls: result.perplexityCalls,
      ceiBeforeIndex: result.ceiBeforeIndex,
      ceiAfterIndex: result.ceiAfterIndex,
      memoriesRecalled: result.memoriesRecalled,
      memoriesStored: result.memoriesStored,
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
