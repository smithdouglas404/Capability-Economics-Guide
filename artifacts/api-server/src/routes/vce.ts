import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  vceAssessmentsTable,
  vceQuestionsTable,
  vceResearchItemsTable,
} from "@workspace/db";
import { eq, desc, asc, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { generateIntakeQuestions, runResearch, finalizeAssessment } from "../services/vce/index";

const router = Router();

const createSchema = z.object({
  clientName: z.string().min(2).max(120),
  industryId: z.number().int().positive().optional(),
  valueCase: z.string().min(40, "Value case must be at least 40 characters"),
  valueCaseSource: z.enum(["typed", "uploaded", "voice_transcript"]).default("typed"),
});

router.post("/vce/assessments", async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  try {
    const [created] = await db.insert(vceAssessmentsTable).values({
      clientName: parsed.data.clientName,
      industryId: parsed.data.industryId ?? null,
      valueCase: parsed.data.valueCase,
      valueCaseSource: parsed.data.valueCaseSource,
      status: "intake",
    }).returning();
    // Auto-generate intake questions in the same call
    try { await generateIntakeQuestions(created.id); }
    catch (e) {
      res.status(201).json({ assessment: created, warning: `Created but intake questions failed: ${e instanceof Error ? e.message : "unknown"}` });
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
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Query failed" });
  }
});

router.get("/vce/assessments/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [assessment] = await db.select().from(vceAssessmentsTable).where(eq(vceAssessmentsTable.id, id));
    if (!assessment) { res.status(404).json({ error: "Not found" }); return; }
    const questions = await db.select().from(vceQuestionsTable).where(eq(vceQuestionsTable.assessmentId, id)).orderBy(asc(vceQuestionsTable.displayOrder));
    const items = await db.select().from(vceResearchItemsTable).where(eq(vceResearchItemsTable.assessmentId, id)).orderBy(desc(vceResearchItemsTable.createdAt));
    res.json({ assessment, questions, researchItems: items });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Query failed" });
  }
});

const answerSchema = z.object({
  answers: z.array(z.object({
    questionId: z.number().int().positive(),
    answer: z.string().max(4000),
  })).min(1),
});

router.post("/vce/assessments/:id/answer", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Validation failed", issues: parsed.error.issues }); return; }
  try {
    const ids = parsed.data.answers.map(a => a.questionId);
    const existing = await db.select({ id: vceQuestionsTable.id, assessmentId: vceQuestionsTable.assessmentId }).from(vceQuestionsTable).where(inArray(vceQuestionsTable.id, ids));
    const allMine = existing.every(q => q.assessmentId === id);
    if (!allMine) { res.status(400).json({ error: "Question id mismatch with assessment" }); return; }
    for (const a of parsed.data.answers) {
      await db.update(vceQuestionsTable).set({ answer: a.answer, answeredAt: new Date() }).where(eq(vceQuestionsTable.id, a.questionId));
    }
    await db.update(vceAssessmentsTable).set({ updatedAt: new Date() }).where(eq(vceAssessmentsTable.id, id));
    res.json({ updated: parsed.data.answers.length });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Update failed" });
  }
});

router.post("/vce/assessments/:id/research", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const result = await runResearch(id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Research failed" });
  }
});

router.post("/vce/assessments/:id/finalize", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const report = await finalizeAssessment(id);
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Finalize failed" });
  }
});

router.get("/vce/inbox", async (_req: Request, res: Response) => {
  try {
    const rows = await db.select({
      id: vceResearchItemsTable.id,
      assessmentId: vceResearchItemsTable.assessmentId,
      kind: vceResearchItemsTable.kind,
      title: vceResearchItemsTable.title,
      summary: vceResearchItemsTable.summary,
      confidenceScore: vceResearchItemsTable.confidenceScore,
      status: vceResearchItemsTable.status,
      createdAt: vceResearchItemsTable.createdAt,
      clientName: vceAssessmentsTable.clientName,
    })
      .from(vceResearchItemsTable)
      .innerJoin(vceAssessmentsTable, eq(vceAssessmentsTable.id, vceResearchItemsTable.assessmentId))
      .where(eq(vceResearchItemsTable.status, "pending"))
      .orderBy(desc(vceResearchItemsTable.createdAt));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Inbox query failed" });
  }
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
  const id = parseInt(req.params.id);
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
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Update failed" });
  }
});

router.delete("/vce/assessments/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(vceAssessmentsTable).where(eq(vceAssessmentsTable.id, id));
    res.json({ deleted: id });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Delete failed" });
  }
});

export default router;
