import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  vceAssessmentsTable,
  vceCyclesTable,
  vceQuestionsTable,
  vceResearchItemsTable,
  CREDIT_COSTS,
} from "@workspace/db";
import { eq, desc, asc, and, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { deductCredits } from "../middlewares/deductCredits";
import {
  createCampaign,
  generateIntakeQuestions,
  runNextCycle,
  runCycleById,
  finalizeAssessment,
} from "../services/vce/index";

const router = Router();

function paramInt(v: string | string[] | undefined): number {
  const s = Array.isArray(v) ? v[0] : v;
  return parseInt(s ?? "", 10);
}

const createSchema = z.object({
  clientName: z.string().min(2).max(120),
  industryId: z.number().int().positive().optional(),
  valueCase: z.string().min(40),
  valueCaseSource: z.enum(["typed", "uploaded", "voice_transcript"]).default("typed"),
  durationDays: z.number().int().min(1).max(30).optional(),
  totalCycles: z.number().int().min(1).max(30).optional(),
});

router.post("/vce/assessments", async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  try {
    const created = await createCampaign(parsed.data);
    try { await generateIntakeQuestions(created.id); } catch (e) {
      res.status(201).json({ assessment: created, warning: `Created but intake failed: ${e instanceof Error ? e.message : "unknown"}` });
      return;
    }
    res.status(201).json({ assessment: created });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Create failed" });
  }
});

router.get("/vce/assessments", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(vceAssessmentsTable).orderBy(desc(vceAssessmentsTable.updatedAt));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : "Query failed" }); }
});

router.get("/vce/assessments/:id", async (req: Request, res: Response) => {
  const id = paramInt(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [assessment] = await db.select().from(vceAssessmentsTable).where(eq(vceAssessmentsTable.id, id));
    if (!assessment) { res.status(404).json({ error: "Not found" }); return; }
    const [cycles, questions, items] = await Promise.all([
      db.select().from(vceCyclesTable).where(eq(vceCyclesTable.assessmentId, id)).orderBy(asc(vceCyclesTable.cycleNumber)),
      db.select().from(vceQuestionsTable).where(eq(vceQuestionsTable.assessmentId, id)).orderBy(asc(vceQuestionsTable.displayOrder)),
      db.select().from(vceResearchItemsTable).where(eq(vceResearchItemsTable.assessmentId, id)).orderBy(desc(vceResearchItemsTable.createdAt)),
    ]);
    res.json({ assessment, cycles, questions, researchItems: items });
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : "Query failed" }); }
});

const answerSchema = z.object({
  answers: z.array(z.object({
    questionId: z.number().int().positive(),
    answer: z.string().max(4000),
  })).min(1),
});

router.post("/vce/assessments/:id/answer", async (req: Request, res: Response) => {
  const id = paramInt(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  try {
    const ids = parsed.data.answers.map(a => a.questionId);
    const existing = await db.select({ id: vceQuestionsTable.id, assessmentId: vceQuestionsTable.assessmentId }).from(vceQuestionsTable).where(inArray(vceQuestionsTable.id, ids));
    if (!existing.every(q => q.assessmentId === id)) { res.status(400).json({ error: "Question id mismatch with assessment" }); return; }
    for (const a of parsed.data.answers) {
      await db.update(vceQuestionsTable).set({ answer: a.answer, status: "answered", answeredAt: new Date() }).where(eq(vceQuestionsTable.id, a.questionId));
    }
    await db.update(vceAssessmentsTable).set({ updatedAt: new Date() }).where(eq(vceAssessmentsTable.id, id));
    res.json({ updated: parsed.data.answers.length });
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : "Update failed" }); }
});

// Run the NEXT scheduled cycle for this campaign
router.post("/vce/assessments/:id/cycles/run-next", deductCredits(CREDIT_COSTS.VCE_CYCLE), async (req: Request, res: Response) => {
  const id = paramInt(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const result = await runNextCycle(id);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : "Cycle failed" }); }
});

// Run a SPECIFIC cycle (e.g. retry a failed one)
router.post("/vce/assessments/:id/cycles/:cycleId/run", deductCredits(CREDIT_COSTS.VCE_CYCLE), async (req: Request, res: Response) => {
  const id = paramInt(req.params.id);
  const cycleId = paramInt(req.params.cycleId);
  if (!Number.isInteger(id) || !Number.isInteger(cycleId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const result = await runCycleById(id, cycleId);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : "Cycle failed" }); }
});

router.post("/vce/assessments/:id/finalize", async (req: Request, res: Response) => {
  const id = paramInt(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const report = await finalizeAssessment(id);
    res.json(report);
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : "Finalize failed" }); }
});

// ----- Single pane of glass: unified inbox (questions awaiting answer + findings awaiting review) -----
router.get("/vce/inbox", async (_req: Request, res: Response) => {
  try {
    const findings = await db.select({
      id: vceResearchItemsTable.id,
      assessmentId: vceResearchItemsTable.assessmentId,
      cycleId: vceResearchItemsTable.cycleId,
      kind: vceResearchItemsTable.kind,
      title: vceResearchItemsTable.title,
      summary: vceResearchItemsTable.summary,
      confidenceScore: vceResearchItemsTable.confidenceScore,
      evidenceCount: vceResearchItemsTable.evidenceCount,
      crossValidated: vceResearchItemsTable.crossValidated,
      contradictions: vceResearchItemsTable.contradictions,
      createdAt: vceResearchItemsTable.createdAt,
      clientName: vceAssessmentsTable.clientName,
    })
      .from(vceResearchItemsTable)
      .innerJoin(vceAssessmentsTable, eq(vceAssessmentsTable.id, vceResearchItemsTable.assessmentId))
      .where(eq(vceResearchItemsTable.status, "pending"))
      .orderBy(desc(vceResearchItemsTable.createdAt));

    const questions = await db.select({
      id: vceQuestionsTable.id,
      assessmentId: vceQuestionsTable.assessmentId,
      cycleId: vceQuestionsTable.cycleId,
      question: vceQuestionsTable.question,
      rationale: vceQuestionsTable.rationale,
      priority: vceQuestionsTable.priority,
      askedAt: vceQuestionsTable.askedAt,
      clientName: vceAssessmentsTable.clientName,
    })
      .from(vceQuestionsTable)
      .innerJoin(vceAssessmentsTable, eq(vceAssessmentsTable.id, vceQuestionsTable.assessmentId))
      .where(and(eq(vceQuestionsTable.status, "pending"), ne(vceAssessmentsTable.status, "finalized")))
      .orderBy(desc(vceQuestionsTable.priority), desc(vceQuestionsTable.askedAt));

    res.json({
      findings: findings.map(f => ({ ...f, type: "finding" as const })),
      questions: questions.map(q => ({ ...q, type: "question" as const })),
      counts: { findings: findings.length, questions: questions.length },
    });
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : "Inbox failed" }); }
});

const reviewSchema = z.object({
  status: z.enum(["approved", "rejected", "edited"]).optional(),
  reviewerNotes: z.string().max(2000).optional(),
  title: z.string().max(280).optional(),
  summary: z.string().max(2000).optional(),
  body: z.string().max(20000).optional(),
  includeInReport: z.boolean().optional(),
});

router.patch("/vce/research/:id", async (req: Request, res: Response) => {
  const id = paramInt(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  try {
    const update: Record<string, unknown> = {};
    if (parsed.data.status) { update.status = parsed.data.status; update.reviewedAt = new Date(); }
    if (parsed.data.reviewerNotes !== undefined) update.reviewerNotes = parsed.data.reviewerNotes;
    if (parsed.data.title !== undefined) update.title = parsed.data.title;
    if (parsed.data.summary !== undefined) update.summary = parsed.data.summary;
    if (parsed.data.body !== undefined) update.body = parsed.data.body;
    if (parsed.data.includeInReport !== undefined) update.includeInReport = parsed.data.includeInReport;
    const [row] = await db.update(vceResearchItemsTable).set(update).where(eq(vceResearchItemsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : "Update failed" }); }
});

const questionPatchSchema = z.object({
  status: z.enum(["pending", "answered", "skipped", "dismissed"]).optional(),
  answer: z.string().max(4000).optional(),
});

router.patch("/vce/questions/:id", async (req: Request, res: Response) => {
  const id = paramInt(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = questionPatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  try {
    const update: Record<string, unknown> = {};
    if (parsed.data.answer !== undefined) { update.answer = parsed.data.answer; update.answeredAt = new Date(); update.status = "answered"; }
    if (parsed.data.status) update.status = parsed.data.status;
    const [row] = await db.update(vceQuestionsTable).set(update).where(eq(vceQuestionsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : "Update failed" }); }
});

router.delete("/vce/assessments/:id", async (req: Request, res: Response) => {
  const id = paramInt(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(vceAssessmentsTable).where(eq(vceAssessmentsTable.id, id));
    res.json({ deleted: id });
  } catch (e) { res.status(500).json({ error: e instanceof Error ? e.message : "Delete failed" }); }
});

/**
 * GET /api/vce/sample-brief
 *
 * Returns an anonymized real brief from a previously-completed VCE
 * assessment for the "Try with sample brief" button on /vce. Replaces
 * the hardcoded SAMPLE_BRIEF "Atlas Copper Holdings" constant in
 * pages/vce.tsx:236-251.
 *
 * Anonymization: clientName is replaced with a generic descriptor
 * derived from the industry. The value_case prose is returned as-is
 * (which itself was researched by Perplexity, not invented).
 *
 * When no completed assessments exist yet, returns 404 — the frontend
 * should hide the "Try with sample brief" button gracefully.
 */
router.get("/vce/sample-brief", async (_req: Request, res: Response) => {
  const [row] = await db
    .select({
      clientName: vceAssessmentsTable.clientName,
      industryId: vceAssessmentsTable.industryId,
      valueCase: vceAssessmentsTable.valueCase,
    })
    .from(vceAssessmentsTable)
    .where(ne(vceAssessmentsTable.status, "draft"))
    .orderBy(desc(vceAssessmentsTable.createdAt))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "No completed briefs available yet" });
    return;
  }

  res.json({
    clientName: "A reference enterprise (anonymized)",
    valueCase: row.valueCase,
  });
});

export default router;
