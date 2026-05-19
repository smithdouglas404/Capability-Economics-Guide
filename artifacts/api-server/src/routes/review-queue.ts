/**
 * Review queue endpoints — admin UI for approving/rejecting content
 * that used to be hardcoded into seed scripts.
 *
 * Two surfaces:
 *   - Regulations: each row in regulations_proposed represents either a
 *     net-new regulation an admin should approve, or an edit to an
 *     existing one (sharing the same shortCode).
 *   - Requirements: each row in regulation_requirements_proposed maps
 *     an existing live regulation to an existing live capability with
 *     a maturity threshold + article citation.
 *
 * Promote semantics:
 *   - Regulation approve → INSERT INTO regulations; UPDATE proposed row
 *     reviewStatus='approved', promotedToLiveId=newRow.id.
 *   - Requirement approve → INSERT INTO regulation_capability_requirements
 *     (uses the existing (regulationId, capabilityId) unique upsert);
 *     UPDATE proposed row reviewStatus='approved', reviewedBy/At set.
 *   - Reject → UPDATE proposed row reviewStatus='rejected', reason captured.
 *     Live tables untouched.
 *
 * Auth: requireReviewer (signed-in Clerk user OR ADMIN_API_KEY break-glass).
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  regulationsTable,
  regulationsProposedTable,
  regulationCapabilityRequirementsTable,
  regulationRequirementsProposedTable,
} from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireReviewer } from "../middlewares/requireReviewer";

const router = Router();
router.use("/admin/review-queue", requireReviewer());

// ── LIST ────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/review-queue/regulations?status=pending
 * Lists regulation proposals. Default status filter is 'pending'.
 * Pass status=all to see approved/rejected too.
 */
router.get("/admin/review-queue/regulations", async (req, res) => {
  try {
    const statusFilter = typeof req.query.status === "string" ? req.query.status : "pending";
    const rows = statusFilter === "all"
      ? await db.select().from(regulationsProposedTable).orderBy(desc(regulationsProposedTable.proposedAt))
      : await db.select().from(regulationsProposedTable)
          .where(eq(regulationsProposedTable.reviewStatus, statusFilter))
          .orderBy(desc(regulationsProposedTable.proposedAt));
    res.json({ rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /api/admin/review-queue/requirements?status=pending
 * Lists requirement proposals — joins to regulation + capability for
 * display labels.
 */
router.get("/admin/review-queue/requirements", async (req, res) => {
  try {
    const statusFilter = typeof req.query.status === "string" ? req.query.status : "pending";
    const rows = statusFilter === "all"
      ? await db.select().from(regulationRequirementsProposedTable).orderBy(desc(regulationRequirementsProposedTable.proposedAt))
      : await db.select().from(regulationRequirementsProposedTable)
          .where(eq(regulationRequirementsProposedTable.reviewStatus, statusFilter))
          .orderBy(desc(regulationRequirementsProposedTable.proposedAt));
    res.json({ rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── APPROVE ──────────────────────────────────────────────────────────────

/**
 * POST /api/admin/review-queue/regulations/:id/approve
 * Body: { edits?: Partial<RegulationProposed> }
 * Applies optional edits to the proposed row, then promotes it to the
 * live regulations table. If a regulation with that shortCode already
 * exists, the existing row is UPDATED (idempotent) rather than duplicated.
 */
router.post("/admin/review-queue/regulations/:id/approve", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const reviewer = (req as { reviewer?: { displayName?: string; userId?: string } }).reviewer;
    const reviewedBy = reviewer?.displayName ?? reviewer?.userId ?? "unknown";

    const [proposed] = await db.select().from(regulationsProposedTable).where(eq(regulationsProposedTable.id, id));
    if (!proposed) {
      res.status(404).json({ error: "Proposed regulation not found" });
      return;
    }
    if (proposed.reviewStatus !== "pending" && proposed.reviewStatus !== "needs-edit") {
      res.status(409).json({ error: `Already ${proposed.reviewStatus}; cannot re-approve` });
      return;
    }

    // Optional inline edits to the proposed content before promotion
    const edits = (req.body?.edits ?? {}) as Partial<typeof proposed>;
    const merged = { ...proposed, ...edits };

    // Idempotent promote: if shortCode exists, update; else insert
    const [existingLive] = await db.select().from(regulationsTable).where(eq(regulationsTable.shortCode, merged.shortCode));
    let liveId: number;
    if (existingLive) {
      await db.update(regulationsTable).set({
        name: merged.name,
        description: merged.description,
        jurisdiction: merged.jurisdiction,
        effectiveDate: merged.effectiveDate,
        industries: merged.industries,
      }).where(eq(regulationsTable.id, existingLive.id));
      liveId = existingLive.id;
    } else {
      const [inserted] = await db.insert(regulationsTable).values({
        name: merged.name,
        shortCode: merged.shortCode,
        description: merged.description,
        jurisdiction: merged.jurisdiction,
        effectiveDate: merged.effectiveDate,
        industries: merged.industries,
      }).returning();
      liveId = inserted.id;
    }

    await db.update(regulationsProposedTable).set({
      reviewStatus: "approved",
      reviewedBy,
      reviewedAt: new Date(),
      promotedToLiveId: liveId,
      // Persist any inline edits the approver made
      name: merged.name,
      description: merged.description,
      jurisdiction: merged.jurisdiction,
      effectiveDate: merged.effectiveDate,
      industries: merged.industries,
    }).where(eq(regulationsProposedTable.id, id));

    res.json({ ok: true, liveId, action: existingLive ? "updated-existing-live" : "inserted-new-live" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * POST /api/admin/review-queue/requirements/:id/approve
 * Promotes a requirement proposal to the live
 * regulation_capability_requirements table (upsert on the existing
 * (regulationId, capabilityId) unique index).
 */
router.post("/admin/review-queue/requirements/:id/approve", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const reviewer = (req as { reviewer?: { displayName?: string; userId?: string } }).reviewer;
    const reviewedBy = reviewer?.displayName ?? reviewer?.userId ?? "unknown";

    const [proposed] = await db.select().from(regulationRequirementsProposedTable).where(eq(regulationRequirementsProposedTable.id, id));
    if (!proposed) {
      res.status(404).json({ error: "Proposed requirement not found" });
      return;
    }
    if (proposed.reviewStatus !== "pending" && proposed.reviewStatus !== "needs-edit") {
      res.status(409).json({ error: `Already ${proposed.reviewStatus}; cannot re-approve` });
      return;
    }

    const edits = (req.body?.edits ?? {}) as Partial<typeof proposed>;
    const merged = { ...proposed, ...edits };

    // Upsert against the (regulationId, capabilityId) unique index
    const [existing] = await db.select().from(regulationCapabilityRequirementsTable).where(
      and(
        eq(regulationCapabilityRequirementsTable.regulationId, merged.regulationId),
        eq(regulationCapabilityRequirementsTable.capabilityId, merged.capabilityId),
      ),
    );
    if (existing) {
      await db.update(regulationCapabilityRequirementsTable).set({
        requiredMaturity: merged.requiredMaturity,
        priority: merged.priority,
        evidenceNotes: merged.evidenceNotes,
        article: merged.article,
      }).where(eq(regulationCapabilityRequirementsTable.id, existing.id));
    } else {
      await db.insert(regulationCapabilityRequirementsTable).values({
        regulationId: merged.regulationId,
        capabilityId: merged.capabilityId,
        requiredMaturity: merged.requiredMaturity,
        priority: merged.priority,
        evidenceNotes: merged.evidenceNotes,
        article: merged.article,
      });
    }

    await db.update(regulationRequirementsProposedTable).set({
      reviewStatus: "approved",
      reviewedBy,
      reviewedAt: new Date(),
      requiredMaturity: merged.requiredMaturity,
      priority: merged.priority,
      evidenceNotes: merged.evidenceNotes,
      article: merged.article,
    }).where(eq(regulationRequirementsProposedTable.id, id));

    res.json({ ok: true, action: existing ? "updated-existing-live" : "inserted-new-live" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── REJECT ──────────────────────────────────────────────────────────────

router.post("/admin/review-queue/regulations/:id/reject", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
    const reviewer = (req as { reviewer?: { displayName?: string; userId?: string } }).reviewer;
    const reviewedBy = reviewer?.displayName ?? reviewer?.userId ?? "unknown";
    await db.update(regulationsProposedTable).set({
      reviewStatus: "rejected",
      reviewerNotes: reason,
      reviewedBy,
      reviewedAt: new Date(),
    }).where(eq(regulationsProposedTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/admin/review-queue/requirements/:id/reject", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
    const reviewer = (req as { reviewer?: { displayName?: string; userId?: string } }).reviewer;
    const reviewedBy = reviewer?.displayName ?? reviewer?.userId ?? "unknown";
    await db.update(regulationRequirementsProposedTable).set({
      reviewStatus: "rejected",
      reviewerNotes: reason,
      reviewedBy,
      reviewedAt: new Date(),
    }).where(eq(regulationRequirementsProposedTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── ONE-SHOT MIGRATION: demote all live rows to proposed ─────────────────
//
// POST /api/admin/review-queue/_demote-all-live
//
// Used once at cutover to move pre-existing live regulations + their
// requirements into the proposed queue for a curated re-approval pass.
// Each live row becomes a pending proposal with
// proposedBy='retroactive-import', sourceCitation captures the original
// row id. The live row is then deleted.
//
// Transactional: if either insert or delete fails, the whole pass aborts.
// Idempotent: if a retroactive-import proposal already exists for a given
// (shortCode | regulation+capability), the live row is just deleted; no
// duplicate proposal is created.

router.post("/admin/review-queue/_demote-all-live", async (req, res) => {
  try {
    const reviewer = (req as { reviewer?: { displayName?: string; userId?: string } }).reviewer;
    const initiatedBy = reviewer?.displayName ?? reviewer?.userId ?? "unknown";
    const dryRun = req.body?.dryRun === true;

    let regsCount = 0, reqsCount = 0, skipped = 0;

    await db.transaction(async (tx) => {
      // Snapshot all live rows first
      const liveRegs = await tx.select().from(regulationsTable);
      const liveReqs = await tx.select().from(regulationCapabilityRequirementsTable);

      // Existing retroactive proposals (idempotency check)
      const existingProposalRegs = await tx.select().from(regulationsProposedTable);
      const existingProposalReqs = await tx.select().from(regulationRequirementsProposedTable);
      const proposalRegKey = new Set(existingProposalRegs
        .filter(p => p.proposedBy === "retroactive-import")
        .map(p => p.shortCode));
      const proposalReqKey = new Set(existingProposalReqs
        .filter(p => p.proposedBy === "retroactive-import")
        .map(p => `${p.regulationId}:${p.capabilityId}`));

      // 1) Move regulations
      for (const r of liveRegs) {
        if (!proposalRegKey.has(r.shortCode)) {
          if (!dryRun) {
            await tx.insert(regulationsProposedTable).values({
              name: r.name,
              shortCode: r.shortCode,
              description: r.description,
              jurisdiction: r.jurisdiction,
              effectiveDate: r.effectiveDate,
              industries: r.industries,
              proposedBy: "retroactive-import",
              sourceCitation: `Demoted from live regulations.id=${r.id} on ${new Date().toISOString()} by ${initiatedBy}`,
              verificationNotes: "Pre-cutover live row demoted for curated re-approval.",
            });
          }
          regsCount++;
        } else {
          skipped++;
        }
      }

      // 2) Move requirements
      for (const q of liveReqs) {
        const key = `${q.regulationId}:${q.capabilityId}`;
        if (!proposalReqKey.has(key)) {
          if (!dryRun) {
            await tx.insert(regulationRequirementsProposedTable).values({
              regulationId: q.regulationId,
              capabilityId: q.capabilityId,
              requiredMaturity: q.requiredMaturity,
              priority: q.priority,
              evidenceNotes: q.evidenceNotes,
              article: q.article,
              proposedBy: "retroactive-import",
              sourceCitation: `Demoted from live regulation_capability_requirements.id=${q.id} on ${new Date().toISOString()} by ${initiatedBy}`,
              verificationNotes: "Pre-cutover live row demoted for curated re-approval.",
            });
          }
          reqsCount++;
        } else {
          skipped++;
        }
      }

      // 3) Wipe live tables (requirements first due to FK)
      if (!dryRun) {
        await tx.delete(regulationCapabilityRequirementsTable);
        await tx.delete(regulationsTable);
      }
    });

    res.json({
      ok: true,
      dryRun,
      demoted: { regulations: regsCount, requirements: reqsCount, skipped },
      message: dryRun
        ? `Would demote ${regsCount} regulations and ${reqsCount} requirements (no changes made)`
        : `Demoted ${regsCount} regulations and ${reqsCount} requirements. Live tables now empty; queue ready for curated approval at /admin/review-queue.`,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── COUNT (lightweight badge for nav) ────────────────────────────────────

router.get("/admin/review-queue/_counts", async (_req, res) => {
  try {
    const regs = await db.select().from(regulationsProposedTable).where(eq(regulationsProposedTable.reviewStatus, "pending"));
    const reqs = await db.select().from(regulationRequirementsProposedTable).where(eq(regulationRequirementsProposedTable.reviewStatus, "pending"));
    res.json({ regulations: regs.length, requirements: reqs.length, total: regs.length + reqs.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
