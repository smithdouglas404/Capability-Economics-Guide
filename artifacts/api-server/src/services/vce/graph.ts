import { StateGraph, Annotation, END, START } from "@langchain/langgraph";
import { db } from "@workspace/db";
import {
  vceAssessmentsTable,
  vceCyclesTable,
  vceQuestionsTable,
  vceResearchItemsTable,
  industriesTable,
} from "@workspace/db";
import { eq, asc, desc, and, inArray } from "drizzle-orm";
import {
  glmReasonTool,
  perplexityDeepResearchTool,
  crossValidateTool,
  synthesizeFindingTool,
  proposeFollowupQuestionTool,
  extractJSON,
} from "./tools";

interface PlannedQuery {
  kind: string;
  title: string;
  query: string;
  recencyHint?: string;
}

interface RawFinding {
  kind: string;
  title: string;
  research: string;
  sources: { url: string; title: string }[];
  model: string;
}

interface ValidatedFinding extends RawFinding {
  validation: {
    supported: boolean;
    supportingEvidence: string[];
    contradictions: string[];
    unsupportedLeaps: string[];
    evidenceCount: number;
    crossValidated: boolean;
    confidence: number;
  };
  synthesis: {
    title: string;
    summary: string;
    body: string;
    confidence: number;
  };
}

interface NewQuestion {
  question: string;
  rationale: string;
  priority: number;
}

const VCEState = Annotation.Root({
  assessmentId: Annotation<number>,
  cycleId: Annotation<number>,
  cycleNumber: Annotation<number>,
  totalCycles: Annotation<number>,
  clientName: Annotation<string>,
  industryName: Annotation<string>,
  valueCase: Annotation<string>,
  campaignObjective: Annotation<string>,
  priorCycleSummaries: Annotation<string[]>,
  answeredQuestions: Annotation<string>,
  allPriorQuestions: Annotation<string>,
  cycleObjective: Annotation<string>,
  researchPlan: Annotation<PlannedQuery[]>,
  rawFindings: Annotation<RawFinding[]>,
  validated: Annotation<ValidatedFinding[]>,
  newQuestions: Annotation<NewQuestion[]>,
  cycleSummary: Annotation<string>,
  toolCalls: Annotation<number>,
  errors: Annotation<string[]>,
});
type S = typeof VCEState.State;

const MAX_QUERIES_PER_CYCLE = 4;

async function planCycleObjective(state: S): Promise<Partial<S>> {
  await db.update(vceCyclesTable).set({ status: "planning", startedAt: new Date() }).where(eq(vceCyclesTable.id, state.cycleId));
  const prompt = `You are the Virtual Capability Engineer running cycle ${state.cycleNumber} of ${state.totalCycles} for client ${state.clientName} (${state.industryName}).

Campaign objective: ${state.campaignObjective || "(none set)"}
Client value case: ${state.valueCase}

Prior cycle summaries (do NOT repeat work):
${state.priorCycleSummaries.length ? state.priorCycleSummaries.map((s, i) => `Cycle ${i + 1}: ${s}`).join("\n\n") : "(none — this is cycle 1)"}

Recent client answers:
${state.answeredQuestions || "(none yet)"}

Define a SHARP objective for this cycle. It should advance the campaign by tackling something not yet covered, ideally building on prior findings or open client answers. One paragraph, max 100 words.`;
  const out = await glmReasonTool.invoke({ prompt, maxTokens: 600 });
  return { cycleObjective: out.trim(), toolCalls: state.toolCalls + 1 };
}

async function decomposeNode(state: S): Promise<Partial<S>> {
  const prompt = `You are the VCE planning research for cycle ${state.cycleNumber}.
Cycle objective: ${state.cycleObjective}
Client: ${state.clientName} (${state.industryName})
Value case: ${state.valueCase}

Decompose the objective into ${MAX_QUERIES_PER_CYCLE} precise web research queries. Each query must demand specific numbers, named examples, and 2024-2026 data. Mix of kinds across: capability_gap, opportunity, recommendation, risk, insight, benchmark.

Return ONLY JSON: { "queries": [ { "kind": "...", "title": "...", "query": "specific question to ask Perplexity sonar-deep-research", "recencyHint": "optional" } ] }`;
  const out = await glmReasonTool.invoke({ prompt, maxTokens: 1500, jsonMode: true });
  const parsed = extractJSON<{ queries: PlannedQuery[] }>(out);
  const plan = (parsed?.queries ?? []).slice(0, MAX_QUERIES_PER_CYCLE);
  if (plan.length === 0) return { researchPlan: [], errors: [...state.errors, "decompose: no queries produced"], toolCalls: state.toolCalls + 1 };
  await db.update(vceCyclesTable).set({ status: "researching" }).where(eq(vceCyclesTable.id, state.cycleId));
  return { researchPlan: plan, toolCalls: state.toolCalls + 1 };
}

async function researchNode(state: S): Promise<Partial<S>> {
  const findings: RawFinding[] = [];
  const errors: string[] = [];
  let calls = 0;
  for (const p of state.researchPlan) {
    try {
      const raw = await perplexityDeepResearchTool.invoke({ query: p.query, recencyHint: p.recencyHint });
      calls++;
      const parsed = JSON.parse(raw) as { success: boolean; content?: string; sources?: { url: string; title: string }[]; model?: string; error?: string };
      if (!parsed.success || !parsed.content) {
        errors.push(`research [${p.title}]: ${parsed.error ?? "empty"}`);
        continue;
      }
      findings.push({ kind: p.kind, title: p.title, research: parsed.content, sources: parsed.sources ?? [], model: parsed.model ?? "perplexity" });
    } catch (e) {
      errors.push(`research [${p.title}]: ${e instanceof Error ? e.message : "fail"}`);
    }
  }
  return { rawFindings: findings, toolCalls: state.toolCalls + calls, errors: [...state.errors, ...errors] };
}

async function critiqueAndSynthesizeNode(state: S): Promise<Partial<S>> {
  await db.update(vceCyclesTable).set({ status: "critiquing" }).where(eq(vceCyclesTable.id, state.cycleId));
  const validated: ValidatedFinding[] = [];
  const errors: string[] = [];
  let calls = 0;
  const priorContext = state.priorCycleSummaries.slice(-2).join("\n\n");
  for (const f of state.rawFindings) {
    try {
      const synthRaw = await synthesizeFindingTool.invoke({
        kind: f.kind,
        title: f.title,
        clientContext: `${state.clientName} (${state.industryName}). Value case: ${state.valueCase.slice(0, 600)}`,
        research: f.research,
        prior: priorContext,
      });
      calls++;
      const synth = JSON.parse(synthRaw) as { title: string; summary: string; body: string; confidence: number };
      if (!synth.summary || !synth.body) { errors.push(`synthesize [${f.title}]: empty`); continue; }
      const valRaw = await crossValidateTool.invoke({ claim: synth.body, sources: f.research });
      calls++;
      const validation = JSON.parse(valRaw) as ValidatedFinding["validation"];
      validated.push({ ...f, synthesis: synth, validation });
    } catch (e) {
      errors.push(`critique [${f.title}]: ${e instanceof Error ? e.message : "fail"}`);
    }
  }
  await db.update(vceCyclesTable).set({ status: "synthesizing" }).where(eq(vceCyclesTable.id, state.cycleId));
  return { validated, toolCalls: state.toolCalls + calls, errors: [...state.errors, ...errors] };
}

async function persistFindingsNode(state: S): Promise<Partial<S>> {
  let count = 0;
  for (const v of state.validated) {
    await db.insert(vceResearchItemsTable).values({
      assessmentId: state.assessmentId,
      cycleId: state.cycleId,
      kind: v.kind,
      title: v.synthesis.title || v.title,
      summary: v.synthesis.summary,
      body: v.synthesis.body,
      sources: v.sources,
      evidenceCount: v.validation.evidenceCount ?? v.sources.length,
      crossValidated: v.validation.crossValidated ?? false,
      contradictions: v.validation.contradictions ?? [],
      confidenceScore: Math.max(0, Math.min(1, (v.synthesis.confidence ?? 0.7) * 0.5 + (v.validation.confidence ?? 0.7) * 0.5)),
      status: "pending",
      includeInReport: true,
    });
    count++;
  }
  return { /* itemsCreated tracked at finalize */ } as Partial<S> & { _items?: number };
}

async function askFollowupsNode(state: S): Promise<Partial<S>> {
  if (state.validated.length === 0) return { newQuestions: [] };
  const basedOn = state.validated.map(v => `[${v.kind}] ${v.synthesis.title}: ${v.synthesis.summary}\nGaps: ${(v.validation.unsupportedLeaps ?? []).join(" | ") || "none"}`).join("\n\n");
  const raw = await proposeFollowupQuestionTool.invoke({
    basedOn,
    clientContext: `${state.clientName} (${state.industryName}). ${state.valueCase.slice(0, 400)}`,
    alreadyAsked: state.allPriorQuestions || "(none)",
  });
  const qs = JSON.parse(raw) as NewQuestion[];
  const filtered = (qs ?? []).filter(q => q.question && q.question.length > 8).slice(0, 5);
  if (filtered.length > 0) {
    await db.insert(vceQuestionsTable).values(filtered.map((q, i) => ({
      assessmentId: state.assessmentId,
      cycleId: state.cycleId,
      question: q.question,
      rationale: q.rationale,
      priority: Math.max(1, Math.min(5, q.priority ?? 3)),
      status: "pending",
      displayOrder: 1000 + state.cycleNumber * 10 + i,
    })));
  }
  return { newQuestions: filtered, toolCalls: state.toolCalls + 1 };
}

async function summarizeCycleNode(state: S): Promise<Partial<S>> {
  const summaryPrompt = `Write a 3-5 sentence executive summary of cycle ${state.cycleNumber}: what was investigated, what we learned, what is still uncertain, and what we will ask the client next. Be concrete.

Objective: ${state.cycleObjective}
Findings: ${state.validated.map(v => `- [${v.kind}] ${v.synthesis.title}: ${v.synthesis.summary}`).join("\n")}
New client questions: ${state.newQuestions.map(q => `- ${q.question}`).join("\n") || "(none)"}
Errors: ${state.errors.length ? state.errors.join("; ") : "none"}`;
  const summary = (await glmReasonTool.invoke({ prompt: summaryPrompt, maxTokens: 700 })).trim();

  await db.update(vceCyclesTable).set({
    status: "completed",
    completedAt: new Date(),
    summary,
    itemsCreated: state.validated.length,
    questionsCreated: state.newQuestions.length,
    toolCalls: state.toolCalls + 1,
    errors: state.errors,
    objective: state.cycleObjective,
  }).where(eq(vceCyclesTable.id, state.cycleId));

  await db.update(vceAssessmentsTable).set({
    currentCycle: state.cycleNumber,
    status: state.cycleNumber >= state.totalCycles ? "review" : "active",
    updatedAt: new Date(),
  }).where(eq(vceAssessmentsTable.id, state.assessmentId));

  return { cycleSummary: summary, toolCalls: state.toolCalls + 1 };
}

const workflow = new StateGraph(VCEState)
  .addNode("plan", planCycleObjective)
  .addNode("decompose", decomposeNode)
  .addNode("research", researchNode)
  .addNode("critique", critiqueAndSynthesizeNode)
  .addNode("persist", persistFindingsNode)
  .addNode("askFollowups", askFollowupsNode)
  .addNode("summarize", summarizeCycleNode)
  .addEdge(START, "plan")
  .addEdge("plan", "decompose")
  .addEdge("decompose", "research")
  .addEdge("research", "critique")
  .addEdge("critique", "persist")
  .addEdge("persist", "askFollowups")
  .addEdge("askFollowups", "summarize")
  .addEdge("summarize", END);

export const vceCycleGraph = workflow.compile();

export async function runCycle(assessmentId: number, cycleId: number): Promise<{ itemsCreated: number; questionsCreated: number; summary: string; errors: string[]; toolCalls: number }> {
  const [a] = await db.select().from(vceAssessmentsTable).where(eq(vceAssessmentsTable.id, assessmentId));
  if (!a) throw new Error("Assessment not found");
  const [cyc] = await db.select().from(vceCyclesTable).where(eq(vceCyclesTable.id, cycleId));
  if (!cyc) throw new Error("Cycle not found");

  let industryName = "general";
  if (a.industryId) {
    const [ind] = await db.select().from(industriesTable).where(eq(industriesTable.id, a.industryId));
    if (ind) industryName = ind.name;
  }

  const priorCycles = await db.select().from(vceCyclesTable)
    .where(and(eq(vceCyclesTable.assessmentId, assessmentId), inArray(vceCyclesTable.status, ["completed"])))
    .orderBy(asc(vceCyclesTable.cycleNumber));
  const priorSummaries = priorCycles.map(c => c.summary || "").filter(Boolean);

  const allQs = await db.select().from(vceQuestionsTable).where(eq(vceQuestionsTable.assessmentId, assessmentId)).orderBy(desc(vceQuestionsTable.askedAt));
  const answered = allQs.filter(q => q.answer && q.answer.trim().length > 0).map(q => `Q: ${q.question}\nA: ${q.answer}`).join("\n\n");
  const allText = allQs.map(q => `- ${q.question}`).join("\n");

  const result = await vceCycleGraph.invoke({
    assessmentId,
    cycleId,
    cycleNumber: cyc.cycleNumber,
    totalCycles: a.totalCycles,
    clientName: a.clientName,
    industryName,
    valueCase: a.valueCase,
    campaignObjective: a.objective ?? "",
    priorCycleSummaries: priorSummaries,
    answeredQuestions: answered,
    allPriorQuestions: allText,
    cycleObjective: "",
    researchPlan: [],
    rawFindings: [],
    validated: [],
    newQuestions: [],
    cycleSummary: "",
    toolCalls: 0,
    errors: [],
  });

  return {
    itemsCreated: result.validated.length,
    questionsCreated: result.newQuestions.length,
    summary: result.cycleSummary,
    errors: result.errors,
    toolCalls: result.toolCalls,
  };
}
