import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityAlphaTable,
  industriesTable,
} from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";
import { z } from "zod/v4";
import { runEnrichmentGraph } from "../services/enrichment/graph";
import { requireReviewer, type Reviewer } from "../middlewares/requireReviewer";
import { decomposeCapability } from "../services/sub-capability-generator";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use("/review", requireReviewer());

function reviewerLabel(r: Reviewer | undefined): string {
  if (!r) return "reviewer";
  return r.displayName || r.email || r.userId;
}


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

// Fire-and-forget: invoke the enrichment agent for a single drafted capability.
// The HTTP handler returns 202 immediately; the agent runs for ~5–7 min in the
// background and writes results to the DB. Reviewer UI polls enrichmentStatus.
function fireDraftEnrichment(capabilityId: number, industryId: number, revisionGuidance?: string): void {
  void (async () => {
    try {
      await runEnrichmentGraph({
        trigger: "rerun",
        targetCapabilityIds: [capabilityId],
        targetIndustryIds: [industryId],
      });
      if (revisionGuidance) {
        logger.info({ capabilityId, revisionGuidance: revisionGuidance.slice(0, 100) }, "[review] draft enrichment with revision guidance — note: agent does not yet thread guidance through; reviewer comment is stored in capability.reviewNotes");
      }
    } catch (err) {
      logger.error({ err, capabilityId }, "[review] draft enrichment agent run failed");
    }
  })();
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
    submittedBy: reviewerLabel(req.reviewer),
    revisionCount: 0,
    reviewNotes: [],
    enrichmentStatus: "running",
    enrichmentStage: "alpha",
    enrichmentUpdatedAt: new Date(),
  }).returning();
  fireDraftEnrichment(cap.id, industryId);
  // Fire-and-forget: notify bot trigger dispatcher so persona bots can evaluate.
  // Imported lazily to avoid pulling the workflows module into the route bundle's hot path.
  import("../services/bots/workflows/triggers").then((m) =>
    m.dispatchBotEvent("capability.added", { capabilityId: cap.id, industrySlug: industry.slug })
  ).catch(() => { /* swallowed — bots are not in the critical path */ });
  res.status(202).json({ id: cap.id, status: "pending_review", message: "Capability drafted; enrichment queued (~60-90s once it starts).", submittedBy: reviewerLabel(req.reviewer) });
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
      summaryNarrative: capabilityAlphaTable.summaryNarrative,
      hasEconomics: capabilityAlphaTable.id,
      enrichmentStatus: capabilitiesTable.enrichmentStatus,
      enrichmentStage: capabilitiesTable.enrichmentStage,
      enrichmentError: capabilitiesTable.enrichmentError,
      enrichmentUpdatedAt: capabilitiesTable.enrichmentUpdatedAt,
    })
    .from(capabilitiesTable)
    .innerJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId))
    .leftJoin(capabilityAlphaTable, eq(capabilityAlphaTable.capabilityId, capabilitiesTable.id))
    .where(eq(capabilitiesTable.reviewStatus, "pending_review"));

  // Without the BullMQ queue, "queue position" no longer exists. Status comes
  // from capability.enrichmentStatus, which the agent updates as it runs.
  const out = rows.map(r => ({
    ...r,
    enrichmentReady: r.summaryNarrative != null,
    hasEconomics: r.hasEconomics != null,
    queueStatus: r.enrichmentStatus === "running" ? "running" : "idle",
    queueAhead: 0,
  }));
  res.json(out);
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
  fireDraftEnrichment(id, cap.industryId, lastReviewerComment);
  res.status(202).json({ ok: true, status: "running", message: "Enrichment retried." });
});

router.post("/review/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, id));
  if (!cap) { res.status(404).json({ error: "not found" }); return; }
  if (cap.reviewStatus !== "pending_review") { res.status(409).json({ error: `cap is ${cap.reviewStatus}` }); return; }
  const notes = (cap.reviewNotes ?? []) as Array<{ role: "reviewer" | "system"; comment: string; ts: string; reviewer?: string }>;
  notes.push({ role: "reviewer", comment: "Approved.", ts: new Date().toISOString(), reviewer: reviewerLabel(req.reviewer) });
  const updated = await db.update(capabilitiesTable)
    .set({ reviewStatus: "approved", reviewNotes: notes })
    .where(and(eq(capabilitiesTable.id, id), eq(capabilitiesTable.reviewStatus, "pending_review")))
    .returning({ id: capabilitiesTable.id });
  if (updated.length === 0) { res.status(409).json({ error: "status changed concurrently" }); return; }
  // Fire-and-forget: every approved capability auto-decomposes into 4-6 factual sub-capabilities.
  // Children get triangulated by the next scheduler rotation (within minutes) for real scores.
  decomposeCapability(id, { count: 5, triangulateNow: false })
    .then(out => console.log(`[review] auto-decomposed cap ${id} → ${out.childIds.length} children`))
    .catch(err => console.warn(`[review] auto-decompose failed for cap ${id}:`, String(err)));
  res.json({ ok: true, status: "approved", subCapabilityDecomposition: "queued" });
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

  const notes = (cap.reviewNotes ?? []) as Array<{ role: "reviewer" | "system"; comment: string; ts: string; reviewer?: string }>;
  notes.push({ role: "reviewer", comment, ts: new Date().toISOString(), reviewer: reviewerLabel(req.reviewer) });
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

  fireDraftEnrichment(id, cap.industryId, comment);

  res.json({ ok: true, status: "revising", message: "Comment queued. New draft will appear once the agent reaches it." });
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
