import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { businessCasesTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { analyzeBusinessCase } from "../services/business-cases/analyzer";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Submit a business case for analysis. v1 supports a text-paste path
 * (caller posts { title, extractedText }). File-upload + PDF/DOCX
 * extraction is a future commit (pnpm add pdf-parse mammoth).
 *
 * Returns 201 with the new business_case id; analysis runs in the
 * background. Poll GET /api/business-cases/:id for status + result.
 */
router.post("/business-cases", async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

  const body = req.body ?? {};
  if (typeof body.title !== "string" || body.title.length < 3) {
    res.status(400).json({ error: "title required (≥ 3 chars)" });
    return;
  }
  if (typeof body.extractedText !== "string" || body.extractedText.length < 100) {
    res.status(400).json({ error: "extractedText required (≥ 100 chars). Paste the case body or wait for file-extraction to complete." });
    return;
  }

  try {
    const [row] = await db.insert(businessCasesTable).values({
      userId,
      title: body.title.slice(0, 300),
      sourceFilename: typeof body.sourceFilename === "string" ? body.sourceFilename : "pasted-text.txt",
      extractedText: body.extractedText.slice(0, 50_000),
      status: "uploaded",
    }).returning();

    // Fire-and-forget analysis. Failures land in the row's error_message,
    // queryable via GET /api/business-cases/:id.
    analyzeBusinessCase(row.id).catch(err => {
      logger.warn({ err, businessCaseId: row.id }, "[business-cases] background analyze failed");
    });

    res.status(201).json({ id: row.id, status: row.status, createdAt: row.createdAt });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Submission failed" });
  }
});

/**
 * Read a business case (status + analysis when complete). Caller must
 * own the row (clerk userId match).
 */
router.get("/business-cases/:id", async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

  const idRaw = req.params.id;
  const id = parseInt(Array.isArray(idRaw) ? (idRaw[0] ?? "") : idRaw, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [row] = await db.select().from(businessCasesTable).where(and(eq(businessCasesTable.id, id), eq(businessCasesTable.userId, userId))).limit(1);
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  res.json(row);
});

/**
 * List the current user's business cases (latest first).
 */
router.get("/business-cases", async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

  const rows = await db
    .select({
      id: businessCasesTable.id,
      title: businessCasesTable.title,
      sourceFilename: businessCasesTable.sourceFilename,
      status: businessCasesTable.status,
      errorMessage: businessCasesTable.errorMessage,
      createdAt: businessCasesTable.createdAt,
      updatedAt: businessCasesTable.updatedAt,
    })
    .from(businessCasesTable)
    .where(eq(businessCasesTable.userId, userId))
    .orderBy(desc(businessCasesTable.createdAt))
    .limit(50);
  res.json({ businessCases: rows });
});

/**
 * Admin re-trigger of analysis for a specific case. Useful if analysis
 * failed transiently or the analyzer prompt has been tuned.
 */
router.post("/business-cases/:id/reanalyze", async (req, res) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

  const idRaw = req.params.id;
  const id = parseInt(Array.isArray(idRaw) ? (idRaw[0] ?? "") : idRaw, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [row] = await db.select().from(businessCasesTable).where(and(eq(businessCasesTable.id, id), eq(businessCasesTable.userId, userId))).limit(1);
  if (!row) { res.status(404).json({ error: "not found" }); return; }

  await db.update(businessCasesTable).set({ status: "uploaded", errorMessage: null, updatedAt: new Date() }).where(eq(businessCasesTable.id, id));
  analyzeBusinessCase(id).catch(err => {
    logger.warn({ err, businessCaseId: id }, "[business-cases] background reanalyze failed");
  });
  res.json({ ok: true });
});

export default router;
