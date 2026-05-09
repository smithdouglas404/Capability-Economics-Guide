import { db } from "@workspace/db";
import {
  vceAssessmentsTable,
  vceCyclesTable,
  vceQuestionsTable,
  vceResearchItemsTable,
  industriesTable,
} from "@workspace/db";
import { eq, and, asc, inArray } from "drizzle-orm";
import { glmReasonTool, extractJSON } from "./tools";
import { runCycle as graphRunCycle } from "./graph";

// ----- Campaign / intake setup -----

export async function createCampaign(input: {
  clientName: string;
  industryId?: number;
  valueCase: string;
  valueCaseSource: "typed" | "uploaded" | "voice_transcript";
  durationDays?: number;
  totalCycles?: number;
}) {
  const durationDays = input.durationDays ?? 7;
  const totalCycles = input.totalCycles ?? durationDays;
  const start = new Date();
  const end = new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const [created] = await db.insert(vceAssessmentsTable).values({
    clientName: input.clientName,
    industryId: input.industryId ?? null,
    valueCase: input.valueCase,
    valueCaseSource: input.valueCaseSource,
    status: "planning",
    durationDays,
    totalCycles,
    currentCycle: 0,
    scheduledStart: start,
    scheduledEnd: end,
  }).returning();

  // Pre-create N cycle rows in 'scheduled' state, one per day
  const cycleRows = Array.from({ length: totalCycles }).map((_, i) => ({
    assessmentId: created.id,
    cycleNumber: i + 1,
    status: "scheduled" as const,
    scheduledFor: new Date(start.getTime() + i * 24 * 60 * 60 * 1000),
  }));
  await db.insert(vceCyclesTable).values(cycleRows);

  return created;
}

export async function generateIntakeQuestions(assessmentId: number): Promise<number> {
  const [a] = await db.select().from(vceAssessmentsTable).where(eq(vceAssessmentsTable.id, assessmentId));
  if (!a) throw new Error("Assessment not found");

  let industryName = "general";
  if (a.industryId) {
    const [ind] = await db.select().from(industriesTable).where(eq(industriesTable.id, a.industryId));
    if (ind) industryName = ind.name;
  }

  const prompt = `You are a Virtual Capability Engineer beginning a ${a.durationDays}-day research engagement with ${a.clientName} (${industryName}). Read the value case below and generate 5-7 sharp clarifying intake questions a senior partner would ask before the engagement starts. Each question should probe ONE dimension (current state, target outcome, time horizon, risk tolerance, budget, competitive context, success metric, internal capability, etc.) and be answerable in 1-3 sentences. Avoid yes/no.

Also propose a one-paragraph CAMPAIGN OBJECTIVE — what we will set out to learn over the ${a.durationDays} days.

Value case:
"""${a.valueCase}"""

Return ONLY JSON:
{ "objective": "campaign objective paragraph", "questions": [ { "question": "...", "rationale": "...", "priority": 1-5 } ] }`;

  const raw = await glmReasonTool.invoke({ prompt, maxTokens: 2000, jsonMode: true });
  const parsed = extractJSON<{ objective: string; questions: { question: string; rationale: string; priority: number }[] }>(raw);
  if (!parsed?.questions || parsed.questions.length === 0) {
    console.error("[VCE intake] parse failed. Raw:", raw.slice(0, 1500));
    throw new Error("Intake parse failed (GLM returned unparseable output)");
  }

  const rows = parsed.questions.slice(0, 7).map((q, i) => ({
    assessmentId,
    cycleId: null,
    question: q.question,
    rationale: q.rationale ?? null,
    priority: Math.max(1, Math.min(5, q.priority ?? 3)),
    status: "pending" as const,
    displayOrder: i,
  }));
  await db.insert(vceQuestionsTable).values(rows);

  await db.update(vceAssessmentsTable).set({
    objective: parsed.objective ?? null,
    status: "active",
    updatedAt: new Date(),
  }).where(eq(vceAssessmentsTable.id, assessmentId));

  return rows.length;
}

// ----- Cycle execution -----

export async function runNextCycle(assessmentId: number) {
  const [a] = await db.select().from(vceAssessmentsTable).where(eq(vceAssessmentsTable.id, assessmentId));
  if (!a) throw new Error("Assessment not found");
  if (a.status === "finalized" || a.status === "cancelled") throw new Error(`Campaign is ${a.status}`);

  const cycles = await db.select().from(vceCyclesTable).where(eq(vceCyclesTable.assessmentId, assessmentId)).orderBy(asc(vceCyclesTable.cycleNumber));
  const next = cycles.find(c => c.status === "scheduled");
  if (!next) throw new Error("No scheduled cycle remaining. Finalize the campaign or extend it.");

  return await graphRunCycle(assessmentId, next.id);
}

export async function runCycleById(assessmentId: number, cycleId: number) {
  return await graphRunCycle(assessmentId, cycleId);
}

// ----- Final report -----

export async function finalizeAssessment(assessmentId: number) {
  const [a] = await db.select().from(vceAssessmentsTable).where(eq(vceAssessmentsTable.id, assessmentId));
  if (!a) throw new Error("Assessment not found");

  const approved = await db.select().from(vceResearchItemsTable).where(and(
    eq(vceResearchItemsTable.assessmentId, assessmentId),
    eq(vceResearchItemsTable.status, "approved"),
    eq(vceResearchItemsTable.includeInReport, true),
  ));
  if (approved.length === 0) throw new Error("Approve at least one finding before finalizing.");

  let industryName = "general";
  if (a.industryId) {
    const [ind] = await db.select().from(industriesTable).where(eq(industriesTable.id, a.industryId));
    if (ind) industryName = ind.name;
  }

  const cycles = await db.select().from(vceCyclesTable).where(and(
    eq(vceCyclesTable.assessmentId, assessmentId),
    inArray(vceCyclesTable.status, ["completed"]),
  )).orderBy(asc(vceCyclesTable.cycleNumber));
  const cycleNarrative = cycles.map(c => `Cycle ${c.cycleNumber}: ${c.summary || ""}`).filter(Boolean).join("\n\n");

  const findingsBlock = approved.map(a => `[${a.kind.toUpperCase()}] ${a.title}\nSummary: ${a.summary}\nDetail: ${a.body}\nEvidence: ${a.evidenceCount} sources, cross-validated=${a.crossValidated}`).join("\n---\n");

  const prompt = `You are the VCE assembling the final Capability Economics assessment report after a ${a.durationDays}-day research campaign for ${a.clientName} (${industryName}). Use ONLY the approved findings below — do not invent new data.

Campaign objective: ${a.objective || "(none)"}
Value case: ${a.valueCase}

Cycle-by-cycle narrative:
${cycleNarrative}

Approved findings:
${findingsBlock}

Return ONLY valid JSON:
{
  "executiveSummary": "3-5 sentence partner-level summary tying findings to the client's value case",
  "capabilityGaps": [ { "name": "...", "gap": "...", "impact": "..." } ],
  "recommendations": [ { "title": "...", "rationale": "...", "impact": "...", "horizon": "0-6mo|6-18mo|18-36mo" } ],
  "quadrantInsights": { "hot": ["..."], "emerging": ["..."], "cooling": ["..."], "tableStakes": ["..."] },
  "risks": ["..."],
  "nextSteps": ["..."]
}`;
  const raw = await glmReasonTool.invoke({ prompt, maxTokens: 6144, jsonMode: true });
  const report = extractJSON<{
    executiveSummary: string;
    capabilityGaps: { name: string; gap: string; impact: string }[];
    recommendations: { title: string; rationale: string; impact: string; horizon: string }[];
    quadrantInsights: { hot: string[]; emerging: string[]; cooling: string[]; tableStakes: string[] };
    risks: string[];
    nextSteps: string[];
  }>(raw);
  if (!report?.executiveSummary) throw new Error("Final report synthesis failed");

  const finalReport = {
    summary: report.executiveSummary,
    capabilityGaps: report.capabilityGaps,
    recommendations: report.recommendations,
    quadrantInsights: report.quadrantInsights,
    risks: report.risks,
    nextSteps: report.nextSteps,
  };

  await db.update(vceAssessmentsTable).set({
    status: "finalized",
    executiveSummary: report.executiveSummary,
    finalReport,
    updatedAt: new Date(),
  }).where(eq(vceAssessmentsTable.id, assessmentId));

  return report;
}
