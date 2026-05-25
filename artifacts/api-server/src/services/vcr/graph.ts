/**
 * VCR (Virtual Capability Engineer) — cycle pipeline.
 *
 * Linear 7-step research cycle for a client assessment:
 *   plan → decompose → research → critique → persist → askFollowups → summarize
 *
 * Each step invokes specific LLM tools (`glmReasonTool`,
 * `perplexityDeepResearchTool`, `synthesizeFindingTool`, etc.) directly —
 * there is no autonomous tool selection by an LLM, so this pipeline
 * runs cleanly as procedural code.
 *
 * Migrated off LangGraph 2026-05-25 (Phase 10 Category A). The previous
 * StateGraph was used purely as a procedural sequencer; the tool calls
 * still happen inside each step exactly as before.
 */
import { db } from "@workspace/db";
import {
  vcrAssessmentsTable,
  vcrCyclesTable,
  vcrQuestionsTable,
  vcrResearchItemsTable,
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
  parseJsonWithRepair,
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

interface CycleContext {
  assessmentId: number;
  cycleId: number;
  cycleNumber: number;
  totalCycles: number;
  clientName: string;
  industryName: string;
  valueCase: string;
  campaignObjective: string;
  priorCycleSummaries: string[];
  answeredQuestions: string;
  allPriorQuestions: string;
}

const MAX_QUERIES_PER_CYCLE = 4;

async function planCycleObjectiveStep(ctx: CycleContext): Promise<{ cycleObjective: string; toolCalls: number }> {
  await db.update(vcrCyclesTable).set({ status: "planning", startedAt: new Date() }).where(eq(vcrCyclesTable.id, ctx.cycleId));
  const prompt = `You are the Virtual Capability Engineer running cycle ${ctx.cycleNumber} of ${ctx.totalCycles} for client ${ctx.clientName} (${ctx.industryName}).

Campaign objective: ${ctx.campaignObjective || "(none set)"}
Client value case: ${ctx.valueCase}

Prior cycle summaries (do NOT repeat work):
${ctx.priorCycleSummaries.length ? ctx.priorCycleSummaries.map((s, i) => `Cycle ${i + 1}: ${s}`).join("\n\n") : "(none — this is cycle 1)"}

Recent client answers:
${ctx.answeredQuestions || "(none yet)"}

Define a SHARP objective for this cycle. It should advance the campaign by tackling something not yet covered, ideally building on prior findings or open client answers. One paragraph, max 100 words.`;
  const out = await glmReasonTool.invoke({ prompt, maxTokens: 600 });
  return { cycleObjective: out.trim(), toolCalls: 1 };
}

async function decomposeStep(ctx: CycleContext, cycleObjective: string): Promise<{ researchPlan: PlannedQuery[]; toolCalls: number; errors: string[] }> {
  const prompt = `You are the VCR planning research for cycle ${ctx.cycleNumber}.
Cycle objective: ${cycleObjective}
Client: ${ctx.clientName} (${ctx.industryName})
Value case: ${ctx.valueCase}

Decompose the objective into ${MAX_QUERIES_PER_CYCLE} precise web research queries. Each query must demand specific numbers, named examples, and 2024-2026 data. Mix of kinds across: capability_gap, opportunity, recommendation, risk, insight, benchmark.

Return ONLY JSON: { "queries": [ { "kind": "...", "title": "...", "query": "specific question to ask Perplexity sonar-deep-research", "recencyHint": "optional" } ] }`;
  const out = await glmReasonTool.invoke({ prompt, maxTokens: 1500, jsonMode: true });
  const parsed = await parseJsonWithRepair<{ queries: PlannedQuery[] }>(out, {
    label: "decompose",
    schemaHint: `{ "queries": [ { "kind": string, "title": string, "query": string, "recencyHint": string? } ] }`,
  });
  const plan = (parsed?.queries ?? []).slice(0, MAX_QUERIES_PER_CYCLE);
  if (plan.length === 0) {
    return { researchPlan: [], toolCalls: 1, errors: ["decompose: no queries produced (LLM output unparseable even after repair retry)"] };
  }
  await db.update(vcrCyclesTable).set({ status: "researching" }).where(eq(vcrCyclesTable.id, ctx.cycleId));
  return { researchPlan: plan, toolCalls: 1, errors: [] };
}

async function researchStep(researchPlan: PlannedQuery[], cycleNumber: number): Promise<{ rawFindings: RawFinding[]; toolCalls: number; errors: string[] }> {
  const findings: RawFinding[] = [];
  const errors: string[] = [];
  let calls = 0;
  for (const p of researchPlan) {
    try {
      // Cost control: only the FIRST cycle gets sonar-deep-research for breadth.
      // Subsequent cycles use sonar-pro (5-10x cheaper) since they're refining known gaps.
      const tier = cycleNumber === 1 ? "deep" : "pro";
      const raw = await perplexityDeepResearchTool.invoke({ query: p.query, recencyHint: p.recencyHint, tier });
      calls++;
      // perplexityDeepResearchTool always returns JSON.stringify of a known
      // shape, but we still guard with extractJSON so a future tool refactor
      // (or a thrown-error string leaking through) can't crash the cycle.
      const parsed = extractJSON<{ success: boolean; content?: string; sources?: { url: string; title: string }[]; model?: string; error?: string }>(raw);
      if (!parsed) {
        errors.push(`research [${p.title}]: research tool returned unparseable wire payload`);
        continue;
      }
      if (!parsed.success || !parsed.content) {
        errors.push(`research [${p.title}]: ${parsed.error ?? "empty"}`);
        continue;
      }
      findings.push({ kind: p.kind, title: p.title, research: parsed.content, sources: parsed.sources ?? [], model: parsed.model ?? "perplexity" });
    } catch (e) {
      errors.push(`research [${p.title}]: ${e instanceof Error ? e.message : "fail"}`);
    }
  }
  return { rawFindings: findings, toolCalls: calls, errors };
}

async function critiqueAndSynthesizeStep(
  ctx: CycleContext,
  rawFindings: RawFinding[],
): Promise<{ validated: ValidatedFinding[]; toolCalls: number; errors: string[] }> {
  await db.update(vcrCyclesTable).set({ status: "critiquing" }).where(eq(vcrCyclesTable.id, ctx.cycleId));
  const validated: ValidatedFinding[] = [];
  const errors: string[] = [];
  let calls = 0;
  const priorContext = ctx.priorCycleSummaries.slice(-2).join("\n\n");
  for (const f of rawFindings) {
    try {
      const synthRaw = await synthesizeFindingTool.invoke({
        kind: f.kind,
        title: f.title,
        clientContext: `${ctx.clientName} (${ctx.industryName}). Value case: ${ctx.valueCase.slice(0, 600)}`,
        research: f.research,
        prior: priorContext,
      });
      calls++;
      // synthesizeFindingTool already runs JSON repair internally; the wire
      // payload is JSON.stringify of either the parsed object or the stub
      // fallback, so a plain JSON.parse here is safe. Guard with extractJSON
      // anyway so a future tool change can't crash the cycle.
      const synth = (extractJSON<{ title: string; summary: string; body: string; confidence: number }>(synthRaw)
        ?? await parseJsonWithRepair<{ title: string; summary: string; body: string; confidence: number }>(synthRaw, { label: "synth-wire" }));
      if (!synth || !synth.summary || !synth.body) { errors.push(`synthesize [${f.title}]: empty or unparseable after repair`); continue; }
      const valRaw = await crossValidateTool.invoke({ claim: synth.body, sources: f.research });
      calls++;
      const validation = (extractJSON<ValidatedFinding["validation"]>(valRaw)
        ?? await parseJsonWithRepair<ValidatedFinding["validation"]>(valRaw, { label: "validate-wire" })
        ?? { supported: false, supportingEvidence: [], contradictions: ["validation parse failed"], unsupportedLeaps: [], evidenceCount: f.sources.length, crossValidated: false, confidence: 0.4 });
      validated.push({ ...f, synthesis: synth, validation });
    } catch (e) {
      errors.push(`critique [${f.title}]: ${e instanceof Error ? e.message : "fail"}`);
    }
  }
  await db.update(vcrCyclesTable).set({ status: "synthesizing" }).where(eq(vcrCyclesTable.id, ctx.cycleId));
  return { validated, toolCalls: calls, errors };
}

async function persistFindingsStep(
  ctx: CycleContext,
  validated: ValidatedFinding[],
): Promise<void> {
  for (const v of validated) {
    await db.insert(vcrResearchItemsTable).values({
      assessmentId: ctx.assessmentId,
      cycleId: ctx.cycleId,
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
  }
}

async function askFollowupsStep(
  ctx: CycleContext,
  validated: ValidatedFinding[],
): Promise<{ newQuestions: NewQuestion[]; toolCalls: number }> {
  if (validated.length === 0) return { newQuestions: [], toolCalls: 0 };
  const basedOn = validated.map(v => `[${v.kind}] ${v.synthesis.title}: ${v.synthesis.summary}\nGaps: ${(v.validation.unsupportedLeaps ?? []).join(" | ") || "none"}`).join("\n\n");
  const raw = await proposeFollowupQuestionTool.invoke({
    basedOn,
    clientContext: `${ctx.clientName} (${ctx.industryName}). ${ctx.valueCase.slice(0, 400)}`,
    alreadyAsked: ctx.allPriorQuestions || "(none)",
  });
  const parsedQs = (extractJSON<unknown>(raw)
    ?? await parseJsonWithRepair<unknown>(raw, { label: "followups-wire", schemaHint: `[ { "question": string, "rationale": string, "priority": number } ]` }));
  // Defensive: the model occasionally repairs into { questions: [...] } even
  // though the wire shape is a bare array. Accept both.
  const qs: NewQuestion[] = Array.isArray(parsedQs)
    ? (parsedQs as NewQuestion[])
    : (parsedQs && typeof parsedQs === "object" && Array.isArray((parsedQs as { questions?: unknown }).questions))
      ? ((parsedQs as { questions: NewQuestion[] }).questions)
      : [];
  const filtered = qs.filter(q => q && typeof q.question === "string" && q.question.length > 8).slice(0, 5);
  if (filtered.length > 0) {
    await db.insert(vcrQuestionsTable).values(filtered.map((q, i) => ({
      assessmentId: ctx.assessmentId,
      cycleId: ctx.cycleId,
      question: q.question,
      rationale: q.rationale,
      priority: Math.max(1, Math.min(5, q.priority ?? 3)),
      status: "pending",
      displayOrder: 1000 + ctx.cycleNumber * 10 + i,
    })));
  }
  return { newQuestions: filtered, toolCalls: 1 };
}

async function summarizeCycleStep(args: {
  ctx: CycleContext;
  cycleObjective: string;
  validated: ValidatedFinding[];
  newQuestions: NewQuestion[];
  errors: string[];
  toolCallsSoFar: number;
}): Promise<{ cycleSummary: string; toolCalls: number }> {
  const { ctx, cycleObjective, validated, newQuestions, errors, toolCallsSoFar } = args;
  const summaryPrompt = `Write a 3-5 sentence executive summary of cycle ${ctx.cycleNumber}: what was investigated, what we learned, what is still uncertain, and what we will ask the client next. Be concrete.

Objective: ${cycleObjective}
Findings: ${validated.map(v => `- [${v.kind}] ${v.synthesis.title}: ${v.synthesis.summary}`).join("\n")}
New client questions: ${newQuestions.map(q => `- ${q.question}`).join("\n") || "(none)"}
Errors: ${errors.length ? errors.join("; ") : "none"}`;
  const summary = (await glmReasonTool.invoke({ prompt: summaryPrompt, maxTokens: 700 })).trim();

  await db.update(vcrCyclesTable).set({
    status: "completed",
    completedAt: new Date(),
    summary,
    itemsCreated: validated.length,
    questionsCreated: newQuestions.length,
    toolCalls: toolCallsSoFar + 1,
    errors,
    objective: cycleObjective,
  }).where(eq(vcrCyclesTable.id, ctx.cycleId));

  await db.update(vcrAssessmentsTable).set({
    currentCycle: ctx.cycleNumber,
    status: ctx.cycleNumber >= ctx.totalCycles ? "review" : "active",
    updatedAt: new Date(),
  }).where(eq(vcrAssessmentsTable.id, ctx.assessmentId));

  return { cycleSummary: summary, toolCalls: 1 };
}

export async function runCycle(assessmentId: number, cycleId: number): Promise<{ itemsCreated: number; questionsCreated: number; summary: string; errors: string[]; toolCalls: number }> {
  const [a] = await db.select().from(vcrAssessmentsTable).where(eq(vcrAssessmentsTable.id, assessmentId));
  if (!a) throw new Error("Assessment not found");
  const [cyc] = await db.select().from(vcrCyclesTable).where(eq(vcrCyclesTable.id, cycleId));
  if (!cyc) throw new Error("Cycle not found");

  let industryName = "general";
  if (a.industryId) {
    const [ind] = await db.select().from(industriesTable).where(eq(industriesTable.id, a.industryId));
    if (ind) industryName = ind.name;
  }

  const priorCycles = await db.select().from(vcrCyclesTable)
    .where(and(eq(vcrCyclesTable.assessmentId, assessmentId), inArray(vcrCyclesTable.status, ["completed"])))
    .orderBy(asc(vcrCyclesTable.cycleNumber));
  const priorSummaries = priorCycles.map(c => c.summary || "").filter(Boolean);

  const allQs = await db.select().from(vcrQuestionsTable).where(eq(vcrQuestionsTable.assessmentId, assessmentId)).orderBy(desc(vcrQuestionsTable.askedAt));
  const answered = allQs.filter(q => q.answer && q.answer.trim().length > 0).map(q => `Q: ${q.question}\nA: ${q.answer}`).join("\n\n");
  const allText = allQs.map(q => `- ${q.question}`).join("\n");

  const ctx: CycleContext = {
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
  };

  let toolCalls = 0;
  const errors: string[] = [];

  const { cycleObjective, toolCalls: planCalls } = await planCycleObjectiveStep(ctx);
  toolCalls += planCalls;

  const { researchPlan, toolCalls: decomposeCalls, errors: decomposeErrors } = await decomposeStep(ctx, cycleObjective);
  toolCalls += decomposeCalls;
  errors.push(...decomposeErrors);

  const { rawFindings, toolCalls: researchCalls, errors: researchErrors } = await researchStep(researchPlan, cyc.cycleNumber);
  toolCalls += researchCalls;
  errors.push(...researchErrors);

  const { validated, toolCalls: critiqueCalls, errors: critiqueErrors } = await critiqueAndSynthesizeStep(ctx, rawFindings);
  toolCalls += critiqueCalls;
  errors.push(...critiqueErrors);

  await persistFindingsStep(ctx, validated);

  const { newQuestions, toolCalls: followupCalls } = await askFollowupsStep(ctx, validated);
  toolCalls += followupCalls;

  const { cycleSummary, toolCalls: summarizeCalls } = await summarizeCycleStep({
    ctx,
    cycleObjective,
    validated,
    newQuestions,
    errors,
    toolCallsSoFar: toolCalls,
  });
  toolCalls += summarizeCalls;

  return {
    itemsCreated: validated.length,
    questionsCreated: newQuestions.length,
    summary: cycleSummary,
    errors,
    toolCalls,
  };
}
