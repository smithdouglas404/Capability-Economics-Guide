import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityEconomicsTable,
  industriesTable,
} from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { z } from "zod/v4";
import { runAlphaEnrichment, runDetailEnrichment } from "../services/alpha/enrich";
import type { Request, Response, NextFunction } from "express";

const router: IRouter = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (process.env.NODE_ENV !== "production") { next(); return; }
  const expected = process.env.ADMIN_API_KEY;
  const provided = req.headers["x-admin-key"];
  if (!expected || typeof provided !== "string" || provided !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.use(requireAdmin);


function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

async function setEnrichment(capabilityId: number, status: string, stage: string | null, error: string | null) {
  await db.update(capabilitiesTable).set({
    enrichmentStatus: status,
    enrichmentStage: stage,
    enrichmentError: error,
    enrichmentUpdatedAt: new Date(),
  }).where(eq(capabilitiesTable.id, capabilityId));
}

async function withLockRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 30, delayMs = 5000): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return { ok: true, value: await fn() };
    } catch (e) {
      const msg = String(e);
      if (msg.includes("already in progress")) {
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      console.error(`[review:${label}] failed:`, msg.slice(0, 200));
      return { ok: false, error: msg.slice(0, 300) };
    }
  }
  const giveUp = `gave up after ${maxAttempts} attempts (lock held)`;
  console.error(`[review:${label}] ${giveUp}`);
  return { ok: false, error: giveUp };
}

async function enrichDraftBackground(capabilityId: number, industryId: number, revisionGuidance?: string) {
  await setEnrichment(capabilityId, "running", "alpha", null);
  const alphaRes = await withLockRetry("alpha", () => runAlphaEnrichment({ industryId, limitCapabilities: 1, limitEdges: 0 }));
  if (!alphaRes.ok) {
    await setEnrichment(capabilityId, "failed", "alpha", `alpha: ${alphaRes.error}`);
    return;
  }
  await setEnrichment(capabilityId, "running", "detail", null);
  const detailRes = await withLockRetry("detail", () => runDetailEnrichment({ capabilityId, force: true, revisionGuidance }));
  if (!detailRes.ok) {
    await setEnrichment(capabilityId, "failed", "detail", `detail: ${detailRes.error}`);
    return;
  }
  const detailErrors = detailRes.value.errors ?? [];
  if (detailRes.value.enriched === 0 && detailErrors.length > 0) {
    await setEnrichment(capabilityId, "failed", "detail", `detail: ${detailErrors[0].slice(0, 300)}`);
    return;
  }
  await setEnrichment(capabilityId, "ready", "done", null);
}

const DraftBody = z.object({
  name: z.string().min(2).max(120),
  industryId: z.number().int().positive(),
  description: z.string().min(10).max(2000),
  traditionalView: z.string().min(5).max(1000).optional(),
  economicView: z.string().min(5).max(1000).optional(),
});

router.post("/review/draft", async (req, res) => {
  const parsed = DraftBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const { name, industryId, description, traditionalView, economicView } = parsed.data;
  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId));
  if (!industry) { res.status(404).json({ error: "Industry not found" }); return; }
  const [cap] = await db.insert(capabilitiesTable).values({
    industryId,
    name,
    slug: slugify(name) + "-" + Date.now().toString(36),
    description,
    traditionalView: traditionalView ?? `Treated as a checklist IT function rather than an economic capability.`,
    economicView: economicView ?? `A measurable, compounding capability that drives margin, defensibility, and option value.`,
    benchmarkScore: 50,
    reviewStatus: "pending_review",
    submittedBy: "admin_form",
    revisionCount: 0,
    reviewNotes: [],
    enrichmentStatus: "running",
    enrichmentStage: "alpha",
    enrichmentUpdatedAt: new Date(),
  }).returning();
  void enrichDraftBackground(cap.id, industryId);
  res.status(202).json({ id: cap.id, status: "pending_review", message: "Capability drafted; enrichment running in background (~60-90s)." });
});

router.get("/review/queue", async (_req, res) => {
  const rows = await db
    .select({
      id: capabilitiesTable.id,
      name: capabilitiesTable.name,
      industryId: capabilitiesTable.industryId,
      industryName: industriesTable.name,
      submittedBy: capabilitiesTable.submittedBy,
      revisionCount: capabilitiesTable.revisionCount,
      createdAt: capabilitiesTable.createdAt,
      reviewNotes: capabilitiesTable.reviewNotes,
      summaryNarrative: capabilityEconomicsTable.summaryNarrative,
      hasEconomics: capabilityEconomicsTable.id,
      enrichmentStatus: capabilitiesTable.enrichmentStatus,
      enrichmentStage: capabilitiesTable.enrichmentStage,
      enrichmentError: capabilitiesTable.enrichmentError,
      enrichmentUpdatedAt: capabilitiesTable.enrichmentUpdatedAt,
    })
    .from(capabilitiesTable)
    .innerJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId))
    .leftJoin(capabilityEconomicsTable, eq(capabilityEconomicsTable.capabilityId, capabilitiesTable.id))
    .where(eq(capabilitiesTable.reviewStatus, "pending_review"));
  res.json(rows.map(r => ({
    ...r,
    enrichmentReady: r.summaryNarrative != null,
    hasEconomics: r.hasEconomics != null,
  })));
});

router.post("/review/:id/retry", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, id));
  if (!cap) { res.status(404).json({ error: "not found" }); return; }
  if (cap.reviewStatus !== "pending_review") { res.status(409).json({ error: `cap is ${cap.reviewStatus}` }); return; }
  if (cap.enrichmentStatus === "running") { res.status(409).json({ error: "enrichment already running" }); return; }

  const lastReviewerComment = ((cap.reviewNotes ?? []) as Array<{ role: string; comment: string }>)
    .filter(n => n.role === "reviewer" && n.comment && n.comment !== "Approved.")
    .slice(-1)[0]?.comment;

  await setEnrichment(id, "running", "alpha", null);
  void enrichDraftBackground(id, cap.industryId, lastReviewerComment);
  res.status(202).json({ ok: true, status: "running", message: "Enrichment retried." });
});

router.post("/review/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, id));
  if (!cap) { res.status(404).json({ error: "not found" }); return; }
  if (cap.reviewStatus !== "pending_review") { res.status(409).json({ error: `cap is ${cap.reviewStatus}` }); return; }
  const notes = (cap.reviewNotes ?? []) as Array<{ role: "reviewer" | "system"; comment: string; ts: string }>;
  notes.push({ role: "reviewer", comment: "Approved.", ts: new Date().toISOString() });
  const updated = await db.update(capabilitiesTable)
    .set({ reviewStatus: "approved", reviewNotes: notes })
    .where(and(eq(capabilitiesTable.id, id), eq(capabilitiesTable.reviewStatus, "pending_review")))
    .returning({ id: capabilitiesTable.id });
  if (updated.length === 0) { res.status(409).json({ error: "status changed concurrently" }); return; }
  res.json({ ok: true, status: "approved" });
});

const RejectBody = z.object({ comment: z.string().trim().max(2000).optional() });

router.post("/review/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const parsed = RejectBody.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "bad body" }); return; }
  const comment = (parsed.data.comment ?? "").trim();
  const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, id));
  if (!cap) { res.status(404).json({ error: "not found" }); return; }
  if (cap.reviewStatus !== "pending_review") { res.status(409).json({ error: `cap is ${cap.reviewStatus}` }); return; }

  if (!comment) {
    const deleted = await db.delete(capabilitiesTable)
      .where(and(eq(capabilitiesTable.id, id), eq(capabilitiesTable.reviewStatus, "pending_review")))
      .returning({ id: capabilitiesTable.id });
    if (deleted.length === 0) { res.status(409).json({ error: "status changed concurrently" }); return; }
    res.json({ ok: true, status: "deleted", message: "Capability rejected with no comment — terminated." });
    return;
  }

  const notes = (cap.reviewNotes ?? []) as Array<{ role: "reviewer" | "system"; comment: string; ts: string }>;
  notes.push({ role: "reviewer", comment, ts: new Date().toISOString() });
  notes.push({ role: "system", comment: "Revision in progress — narrative will be regenerated.", ts: new Date().toISOString() });
  const updated = await db.update(capabilitiesTable).set({
    reviewNotes: notes,
    revisionCount: sql`${capabilitiesTable.revisionCount} + 1`,
    enrichmentStatus: "running",
    enrichmentStage: "detail",
    enrichmentError: null,
    enrichmentUpdatedAt: new Date(),
  }).where(and(eq(capabilitiesTable.id, id), eq(capabilitiesTable.reviewStatus, "pending_review")))
    .returning({ id: capabilitiesTable.id });
  if (updated.length === 0) { res.status(409).json({ error: "status changed concurrently" }); return; }

  void (async () => {
    const r = await withLockRetry("revision", () => runDetailEnrichment({ capabilityId: id, force: true, revisionGuidance: comment }));
    if (!r.ok) {
      await setEnrichment(id, "failed", "detail", `revision: ${r.error}`);
      return;
    }
    const errs = r.value.errors ?? [];
    if (r.value.enriched === 0 && errs.length > 0) {
      await setEnrichment(id, "failed", "detail", `revision: ${errs[0].slice(0, 300)}`);
      return;
    }
    await setEnrichment(id, "ready", "done", null);
  })();

  res.json({ ok: true, status: "revising", message: "Comment sent back to LLM. New draft will appear in queue in ~60s." });
});

router.get("/review/:id/notes", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [cap] = await db.select({
    id: capabilitiesTable.id,
    name: capabilitiesTable.name,
    reviewStatus: capabilitiesTable.reviewStatus,
    reviewNotes: capabilitiesTable.reviewNotes,
    revisionCount: capabilitiesTable.revisionCount,
  }).from(capabilitiesTable).where(eq(capabilitiesTable.id, id));
  if (!cap) { res.status(404).json({ error: "not found" }); return; }
  res.json(cap);
});

export default router;
