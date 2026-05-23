/**
 * Upload-analysis route — Move 6 of the strategic UX overhaul.
 *
 *   POST /api/upload-analysis           multipart file → full extract+match+report
 *   POST /api/upload-analysis/text      text body → same (no file storage needed)
 *   GET  /api/upload-analysis/:id       fetch a prior run by id (auth-scoped)
 *   GET  /api/upload-analysis           list user's runs
 *
 * The free tier caps uploads at 3/month per signed-in user. Hard cap enforced
 * in createAnalysis below. Auth is via Clerk; anonymous users hit a 401 — we
 * need a user_id to scope the rate limit and the "your past analyses" list.
 */
import { Router, type IRouter } from "express";
import multer from "multer";
import { getAuth } from "@clerk/express";
import { db, uploadedAnalysesTable } from "@workspace/db";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import {
  extractTextFromFile,
  extractClaims,
  matchCapabilities,
  composeReport,
  composeReportStream,
  buildReportAppendix,
} from "../services/upload-analysis";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Multer with in-memory storage. We don't persist files — only the extracted
// text + structured claims + report. Cap at 8MB (PDFs of business plans are
// typically 1-3MB; pitch decks 3-6MB; anything over 8MB is probably the user
// uploading the wrong thing).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const FREE_TIER_MONTHLY_CAP = 3;

async function countUploadsThisMonth(userId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(uploadedAnalysesTable)
    .where(and(
      eq(uploadedAnalysesTable.userId, userId),
      gte(uploadedAnalysesTable.createdAt, monthStart),
    ));
  return row?.n ?? 0;
}

interface CreateAnalysisArgs {
  userId: string;
  filename: string;
  fileType: "pdf" | "docx" | "txt" | "paste";
  fileSizeBytes: number;
  extractedText: string;
}

async function runAnalysisPipeline(args: CreateAnalysisArgs): Promise<{ id: number; report: string; reportError?: string }> {
  // Insert a row up-front so the user can navigate back even if a later
  // stage fails (status reflects the failure point).
  const [inserted] = await db
    .insert(uploadedAnalysesTable)
    .values({
      userId: args.userId,
      filename: args.filename,
      fileType: args.fileType,
      fileSizeBytes: args.fileSizeBytes,
      extractedText: args.extractedText.slice(0, 50_000),
      status: "extracting",
    })
    .returning();
  const id = inserted.id;

  try {
    const claims = await extractClaims(args.extractedText);
    // claims is a structured object, not an array — wrap it so the jsonb column
    // (typed as unknown[] for backwards-compat with future multi-claim runs)
    // accepts it without TS complaint. Stored under a single-element array.
    await db.update(uploadedAnalysesTable).set({
      claims: [claims] as unknown[],
      status: "matching",
    }).where(eq(uploadedAnalysesTable.id, id));

    const matches = await matchCapabilities(claims.claimedCapabilities, claims.industrySector);
    const report = await composeReport({ claims, matches });

    await db.update(uploadedAnalysesTable).set({
      report: { markdown: report, matches, claims },
      status: "complete",
      completedAt: new Date(),
    }).where(eq(uploadedAnalysesTable.id, id));

    return { id, report };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(uploadedAnalysesTable).set({
      status: "failed",
      errorMessage: msg.slice(0, 1000),
      completedAt: new Date(),
    }).where(eq(uploadedAnalysesTable.id, id));
    throw err;
  }
}

// ── Routes ──────────────────────────────────────────────────────────────

router.post("/upload-analysis", upload.single("file"), async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Sign in to upload" }); return; }

    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

    const usedThisMonth = await countUploadsThisMonth(auth.userId);
    if (usedThisMonth >= FREE_TIER_MONTHLY_CAP) {
      res.status(429).json({ error: `Free tier limit reached (${FREE_TIER_MONTHLY_CAP}/month).` });
      return;
    }

    const text = await extractTextFromFile(req.file.buffer, req.file.mimetype);
    if (!text || text.trim().length < 100) {
      res.status(400).json({ error: "Could not extract meaningful text from the file (too short or unparseable). Try a different file or paste the text directly." });
      return;
    }

    const result = await runAnalysisPipeline({
      userId: auth.userId,
      filename: req.file.originalname,
      fileType: req.file.mimetype.includes("pdf") ? "pdf" : req.file.mimetype.includes("officedocument") ? "docx" : "txt",
      fileSizeBytes: req.file.size,
      extractedText: text,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "[upload-analysis] failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "analysis failed" });
  }
});

/**
 * Plain-text variant for the "paste your plan" path — saves the multipart
 * complexity when the user just wants to try the feature without uploading.
 */
router.post("/upload-analysis/text", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Sign in to analyze" }); return; }

    const text = typeof req.body?.text === "string" ? req.body.text : "";
    const title = typeof req.body?.title === "string" ? req.body.title.slice(0, 200) : "Pasted text";
    if (text.trim().length < 100) {
      res.status(400).json({ error: "Paste at least 100 characters." });
      return;
    }

    const usedThisMonth = await countUploadsThisMonth(auth.userId);
    if (usedThisMonth >= FREE_TIER_MONTHLY_CAP) {
      res.status(429).json({ error: `Free tier limit reached (${FREE_TIER_MONTHLY_CAP}/month).` });
      return;
    }

    const result = await runAnalysisPipeline({
      userId: auth.userId,
      filename: title,
      fileType: "paste",
      fileSizeBytes: Buffer.byteLength(text, "utf-8"),
      extractedText: text,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err }, "[upload-analysis/text] failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "analysis failed" });
  }
});

/**
 * Streaming text variant — runs extract + match synchronously, then streams
 * the composed Markdown report token-by-token via the Vercel AI SDK's
 * useCompletion protocol. Frontend renders progressively (ChatGPT-style)
 * which makes the SDK presence visible instead of hidden behind a fake
 * progress bar. The static capability-match table is appended after the
 * model stream finishes — the table is deterministic data, no value in
 * burning tokens on it.
 */
router.post("/upload-analysis/text-stream", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }

    // useCompletion sends { prompt, title? } in the body by default.
    const text = typeof req.body?.prompt === "string" ? req.body.prompt : typeof req.body?.text === "string" ? req.body.text : "";
    const title = typeof req.body?.title === "string" ? req.body.title.slice(0, 200) : "Pasted text";
    if (text.trim().length < 100) { res.status(400).json({ error: "Paste at least 100 characters." }); return; }

    const usedThisMonth = await countUploadsThisMonth(auth.userId);
    if (usedThisMonth >= FREE_TIER_MONTHLY_CAP) {
      res.status(429).json({ error: `Free tier limit reached (${FREE_TIER_MONTHLY_CAP}/month).` });
      return;
    }

    // Insert the row up-front; status flips through extracting/matching/streaming
    // so the user can refresh /upload-analysis later and see how far it got
    // even if the connection drops mid-stream.
    const [inserted] = await db.insert(uploadedAnalysesTable).values({
      userId: auth.userId,
      filename: title,
      fileType: "paste",
      fileSizeBytes: Buffer.byteLength(text, "utf-8"),
      extractedText: text.slice(0, 50_000),
      status: "extracting",
    }).returning();

    const claims = await extractClaims(text);
    await db.update(uploadedAnalysesTable).set({
      claims: [claims] as unknown[],
      status: "matching",
    }).where(eq(uploadedAnalysesTable.id, inserted.id));

    const matches = await matchCapabilities(claims.claimedCapabilities, claims.industrySector);
    await db.update(uploadedAnalysesTable).set({
      status: "complete",
    }).where(eq(uploadedAnalysesTable.id, inserted.id));

    // Now stream the markdown body. composeReportStream returns a
    // StreamTextResult from the Vercel AI SDK. We pipe it directly to
    // the response using the AI SDK's data-stream protocol — useCompletion
    // on the client parses it transparently.
    const stream = composeReportStream({ claims, matches });

    // Append the static table after the model stream ends. We can't
    // do this inside pipeDataStreamToResponse easily, so we manually
    // pipe and then write the appendix as a final delta chunk.
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("X-Analysis-Id", String(inserted.id));

    // Stream the text deltas directly — useCompletion accepts plain text
    // streaming via the `streamProtocol: "text"` option on the client.
    let composed = "";
    for await (const chunk of stream.textStream) {
      composed += chunk;
      res.write(chunk);
    }
    const appendix = "\n\n" + buildReportAppendix(matches);
    composed += appendix;
    res.write(appendix);
    res.end();

    // Persist the final composed report so it appears in the history list
    // and can be re-rendered on detail navigation.
    await db.update(uploadedAnalysesTable).set({
      report: { markdown: composed, matches, claims },
      completedAt: new Date(),
    }).where(eq(uploadedAnalysesTable.id, inserted.id));
  } catch (err) {
    logger.error({ err }, "[upload-analysis/text-stream] failed");
    if (!res.headersSent) {
      res.status(500).json({ error: err instanceof Error ? err.message : "analysis failed" });
    } else {
      res.end();
    }
  }
});

// Public anonymized count — used by the /upload page's social-proof tile
// ("12 similar uploads from peers"). No auth, no row-level data, just the
// total across all users. Cheap COUNT(*) on a small table.
router.get("/upload-analyses/count", async (_req, res) => {
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(uploadedAnalysesTable);
    res.json({ count: row?.n ?? 0 });
  } catch (err) {
    logger.warn({ err }, "upload-analyses count failed");
    res.json({ count: 0 });
  }
});

router.get("/upload-analysis/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [row] = await db.select().from(uploadedAnalysesTable).where(and(
    eq(uploadedAnalysesTable.id, id),
    eq(uploadedAnalysesTable.userId, auth.userId),
  )).limit(1);
  if (!row) { res.status(404).json({ error: "not found" }); return; }
  res.json({ analysis: row });
});

router.get("/upload-analysis", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const rows = await db
    .select({
      id: uploadedAnalysesTable.id,
      filename: uploadedAnalysesTable.filename,
      fileType: uploadedAnalysesTable.fileType,
      status: uploadedAnalysesTable.status,
      createdAt: uploadedAnalysesTable.createdAt,
      completedAt: uploadedAnalysesTable.completedAt,
    })
    .from(uploadedAnalysesTable)
    .where(eq(uploadedAnalysesTable.userId, auth.userId))
    .orderBy(desc(uploadedAnalysesTable.createdAt))
    .limit(50);
  res.json({ analyses: rows, monthlyUsage: { used: await countUploadsThisMonth(auth.userId), cap: FREE_TIER_MONTHLY_CAP } });
});

export default router;
