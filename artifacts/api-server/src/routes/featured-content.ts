import { Router, type IRouter } from "express";
import { db, featuredContentSlotsTable, caseStudiesTable, industriesTable } from "@workspace/db";
import { and, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAdminAction } from "../services/audit-log";

const router: IRouter = Router();

// ───────────────────── Public: resolve the currently-active content for a slot ─────────────────────

type ResolvedCaseStudy = {
  type: "case_study";
  slotKey: string;
  slotId: number;
  content: {
    id: number;
    industrySlug: string;
    industryName: string;
    title: string;
    executiveSummary: string;
    generatedAt: Date | string;
  };
};

/**
 * Resolve a slot to a concrete content payload. Pick the highest-priority
 * row that's currently inside its time window. Ties broken by newest update.
 */
async function resolveSlot(slotKey: string): Promise<ResolvedCaseStudy | null> {
  const now = new Date();
  const [slot] = await db
    .select()
    .from(featuredContentSlotsTable)
    .where(and(
      eq(featuredContentSlotsTable.slotKey, slotKey),
      or(isNull(featuredContentSlotsTable.startsAt), lte(featuredContentSlotsTable.startsAt, now))!,
      or(isNull(featuredContentSlotsTable.endsAt), gt(featuredContentSlotsTable.endsAt, now))!,
    ))
    .orderBy(desc(featuredContentSlotsTable.priority), desc(featuredContentSlotsTable.updatedAt))
    .limit(1);

  if (!slot) return null;

  if (slot.contentType === "case_study") {
    const [cs] = await db
      .select({
        id: caseStudiesTable.id,
        title: caseStudiesTable.title,
        executiveSummary: caseStudiesTable.executiveSummary,
        generatedAt: caseStudiesTable.generatedAt,
        industrySlug: industriesTable.slug,
        industryName: industriesTable.name,
      })
      .from(caseStudiesTable)
      .innerJoin(industriesTable, eq(industriesTable.id, caseStudiesTable.industryId))
      .where(eq(caseStudiesTable.id, slot.contentId));
    if (!cs) return null;
    return { type: "case_study", slotKey, slotId: slot.id, content: cs };
  }

  // Future content types drop in here.
  return null;
}

/**
 * Public endpoint: the homepage (and anywhere else that wants to honour the
 * schedule) calls this for each slot name it renders. Falls back to the
 * newest case study when no active slot exists.
 */
router.get("/featured-content/:slotKey", async (req, res) => {
  const slotKey = String(req.params.slotKey);
  const resolved = await resolveSlot(slotKey);
  if (resolved) {
    res.json({ source: "slot", ...resolved });
    return;
  }

  // Fallback: newest case study so the homepage is never empty.
  const [fallback] = await db
    .select({
      id: caseStudiesTable.id,
      title: caseStudiesTable.title,
      executiveSummary: caseStudiesTable.executiveSummary,
      generatedAt: caseStudiesTable.generatedAt,
      industrySlug: industriesTable.slug,
      industryName: industriesTable.name,
    })
    .from(caseStudiesTable)
    .innerJoin(industriesTable, eq(industriesTable.id, caseStudiesTable.industryId))
    .orderBy(desc(caseStudiesTable.generatedAt))
    .limit(1);

  if (fallback) {
    res.json({ source: "fallback", type: "case_study", slotKey, slotId: null, content: fallback });
    return;
  }

  res.json({ source: "empty", type: null, slotKey, slotId: null, content: null });
});

// ───────────────────── Admin: list / create / update / delete ─────────────────────

/** List every placement grouped by slot so the admin table can show the schedule per slot. */
router.get("/admin/featured-content", requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      slot: featuredContentSlotsTable,
      caseStudyTitle: caseStudiesTable.title,
      industrySlug: industriesTable.slug,
      industryName: industriesTable.name,
    })
    .from(featuredContentSlotsTable)
    .leftJoin(caseStudiesTable, eq(caseStudiesTable.id, featuredContentSlotsTable.contentId))
    .leftJoin(industriesTable, eq(industriesTable.id, caseStudiesTable.industryId))
    .orderBy(featuredContentSlotsTable.slotKey, desc(featuredContentSlotsTable.priority), desc(featuredContentSlotsTable.updatedAt));
  res.json({ placements: rows });
});

const DateStringOrNull = z.union([z.string().datetime(), z.null(), z.literal("")]).transform(v => (v && v !== "" ? new Date(v) : null));

const CreateBody = z.object({
  slotKey: z.string().min(1).max(80),
  contentType: z.enum(["case_study"]).default("case_study"),
  contentId: z.number().int().positive(),
  startsAt: DateStringOrNull.optional(),
  endsAt: DateStringOrNull.optional(),
  priority: z.number().int().min(-1000).max(1000).default(0),
  note: z.string().max(200).optional(),
});

router.post("/admin/featured-content", requireAdmin, async (req, res) => {
  const parsed = CreateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [created] = await db.insert(featuredContentSlotsTable).values({
    slotKey: parsed.data.slotKey,
    contentType: parsed.data.contentType,
    contentId: parsed.data.contentId,
    startsAt: parsed.data.startsAt ?? null,
    endsAt: parsed.data.endsAt ?? null,
    priority: parsed.data.priority,
    note: parsed.data.note ?? null,
  }).returning();
  await logAdminAction(req, {
    action: "tier.update",
    targetType: "featured_content_slot",
    targetId: created!.id,
    details: { slotKey: parsed.data.slotKey, contentType: parsed.data.contentType, contentId: parsed.data.contentId },
  });
  res.status(201).json({ placement: created });
});

const UpdateBody = CreateBody.partial();

router.patch("/admin/featured-content/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const parsed = UpdateBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [updated] = await db.update(featuredContentSlotsTable).set({
    ...parsed.data,
    updatedAt: new Date(),
  }).where(eq(featuredContentSlotsTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "not found" }); return; }
  res.json({ placement: updated });
});

router.delete("/admin/featured-content/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  await db.delete(featuredContentSlotsTable).where(eq(featuredContentSlotsTable.id, id));
  res.json({ ok: true });
});

export default router;

// Keep the 'sql' import referenced in case drizzle strips unused imports from bundles.
void sql;
