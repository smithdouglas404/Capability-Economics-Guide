import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityEconomicsTable,
  industriesTable,
} from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { z } from "zod/v4";
import { enqueueEnrichmentJob, getQueuePositionFor } from "../services/alpha/queue";
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

async function enqueueDraftEnrichment(capabilityId: number, industryId: number, revisionGuidance?: string) {
  await enqueueEnrichmentJob(
    "alpha",
    { industryId, limitCapabilities: 1, limitEdges: 0 },
    { capabilityId, industryId },
  );
  await enqueueEnrichmentJob(
    "detail",
    { capabilityId, force: true, revisionGuidance },
    { capabilityId, industryId },
  );
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
  await enqueueDraftEnrichment(cap.id, industryId);
  res.status(202).json({ id: cap.id, status: "pending_review", message: "Capability drafted; enrichment queued (~60-90s once it starts)." });
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

  const withQueue = await Promise.all(
    rows.map(async (r) => {
      const pos = await getQueuePositionFor(r.id);
      return {
        ...r,
        enrichmentReady: r.summaryNarrative != null,
        hasEconomics: r.hasEconomics != null,
        queueStatus: pos?.status ?? "idle",
        queueAhead: pos?.ahead ?? 0,
      };
    }),
  );
  res.json(withQueue);
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
  await enqueueDraftEnrichment(id, cap.industryId, lastReviewerComment);
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

  await enqueueEnrichmentJob(
    "detail",
    { capabilityId: id, force: true, revisionGuidance: comment },
    { capabilityId: id, industryId: cap.industryId },
  );

  res.json({ ok: true, status: "revising", message: "Comment queued. New draft will appear once the worker reaches it." });
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
