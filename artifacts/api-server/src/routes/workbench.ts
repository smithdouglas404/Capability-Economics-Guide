/**
 * Workbench (Kanban) routes — boards, cards, insights.
 *
 * All routes require a Clerk session. Access is gated on the board's
 * (clerkUserId = me) OR (clerkOrgId IN myClerkOrgs). The ideation insight
 * generation reuses services/ideation.ts and caches results per
 * (cardId, cacheKey) so the same Claude call is never billed twice.
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  workbenchBoardsTable,
  workbenchCardsTable,
  workbenchCardInsightsTable,
  capabilitiesTable,
  ceiComponentsTable,
  industriesTable,
} from "@workspace/db";
import { and, eq, inArray, or, sql, desc, asc } from "drizzle-orm";
import { requireSession } from "../middlewares/requireSession";
import { getUserClerkOrgIds } from "../services/org-access";
import { deriveLifecycleStage } from "../services/lifecycle";
import { runIdeation, ideationCacheKey, type IdeationKind } from "../services/ideation";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use("/workbench", requireSession());

const LANES = ["scan", "frame", "ideate", "validate", "launch"] as const;

async function loadBoardForAccess(req: Parameters<Parameters<typeof router.get>[1]>[0], boardId: number) {
  const [board] = await db.select().from(workbenchBoardsTable).where(eq(workbenchBoardsTable.id, boardId));
  if (!board) return { board: null, allowed: false, write: false } as const;
  const auth = getAuth(req);
  const me = auth?.userId;
  if (!me) return { board, allowed: false, write: false } as const;
  if (board.clerkUserId === me) return { board, allowed: true, write: true } as const;
  if (board.clerkOrgId) {
    const myOrgs = await getUserClerkOrgIds(req);
    if (myOrgs.includes(board.clerkOrgId)) return { board, allowed: true, write: true } as const;
  }
  return { board, allowed: false, write: false } as const;
}

// ───────────────────── Boards ─────────────────────

router.get("/workbench/boards", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const myOrgs = await getUserClerkOrgIds(req);
  const rows = await db
    .select({
      id: workbenchBoardsTable.id,
      clerkUserId: workbenchBoardsTable.clerkUserId,
      clerkOrgId: workbenchBoardsTable.clerkOrgId,
      name: workbenchBoardsTable.name,
      description: workbenchBoardsTable.description,
      pinned: workbenchBoardsTable.pinned,
      createdAt: workbenchBoardsTable.createdAt,
      updatedAt: workbenchBoardsTable.updatedAt,
      cardCount: sql<number>`(SELECT COUNT(*) FROM ${workbenchCardsTable} WHERE ${workbenchCardsTable.boardId} = ${workbenchBoardsTable.id})::int`,
    })
    .from(workbenchBoardsTable)
    .where(or(
      eq(workbenchBoardsTable.clerkUserId, auth.userId),
      myOrgs.length > 0 ? inArray(workbenchBoardsTable.clerkOrgId, myOrgs) : sql`FALSE`,
    ))
    .orderBy(desc(workbenchBoardsTable.pinned), desc(workbenchBoardsTable.updatedAt));
  res.json({
    boards: rows.map(r => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      ownerType: r.clerkOrgId ? "team" as const : "personal" as const,
      isMine: r.clerkUserId === auth.userId,
    })),
  });
});

const CreateBoardBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});

router.post("/workbench/boards", async (req, res) => {
  const auth = getAuth(req);
  if (!auth?.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CreateBoardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const [created] = await db.insert(workbenchBoardsTable).values({
    clerkUserId: auth.userId,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
  }).returning();
  res.status(201).json({ board: { ...created, createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString() } });
});

const UpdateBoardBody = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  pinned: z.boolean().optional(),
});

router.patch("/workbench/boards/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "bad id" }); return; }
  const access = await loadBoardForAccess(req, id);
  if (!access.allowed || !access.board) { res.status(access.board ? 403 : 404).json({ error: access.board ? "Forbidden" : "Not found" }); return; }
  const parsed = UpdateBoardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const updates: Partial<typeof workbenchBoardsTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.pinned !== undefined) updates.pinned = parsed.data.pinned ? new Date().toISOString() : null;
  const [updated] = await db.update(workbenchBoardsTable).set(updates).where(eq(workbenchBoardsTable.id, id)).returning();
  res.json({ board: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() } });
});

router.delete("/workbench/boards/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "bad id" }); return; }
  const access = await loadBoardForAccess(req, id);
  if (!access.allowed || !access.board) { res.status(access.board ? 403 : 404).json({ error: access.board ? "Forbidden" : "Not found" }); return; }
  // Only the owner (not a team member) can delete.
  const auth = getAuth(req);
  if (access.board.clerkUserId !== auth?.userId) {
    res.status(403).json({ error: "Only the board owner can delete" });
    return;
  }
  await db.delete(workbenchBoardsTable).where(eq(workbenchBoardsTable.id, id));
  res.status(204).send();
});

const ShareBoardBody = z.object({
  clerkOrgId: z.string().regex(/^org_/).nullable(),
});

router.post("/workbench/boards/:id/share", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "bad id" }); return; }
  const access = await loadBoardForAccess(req, id);
  if (!access.allowed || !access.board) { res.status(access.board ? 403 : 404).json({ error: access.board ? "Forbidden" : "Not found" }); return; }
  const auth = getAuth(req);
  if (access.board.clerkUserId !== auth?.userId) {
    res.status(403).json({ error: "Only the owner can share or unshare" });
    return;
  }
  const parsed = ShareBoardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  if (parsed.data.clerkOrgId) {
    const myOrgs = await getUserClerkOrgIds(req);
    if (!myOrgs.includes(parsed.data.clerkOrgId)) {
      res.status(403).json({ error: "You are not a member of that Clerk organization" });
      return;
    }
  }
  const [updated] = await db.update(workbenchBoardsTable).set({
    clerkOrgId: parsed.data.clerkOrgId,
    updatedAt: new Date(),
  }).where(eq(workbenchBoardsTable.id, id)).returning();
  res.json({ board: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() } });
});

// ───────────────────── Board detail (board + cards + insights) ─────────────────────

router.get("/workbench/boards/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "bad id" }); return; }
  const access = await loadBoardForAccess(req, id);
  if (!access.allowed || !access.board) { res.status(access.board ? 403 : 404).json({ error: access.board ? "Forbidden" : "Not found" }); return; }

  const cards = await db.select().from(workbenchCardsTable).where(eq(workbenchCardsTable.boardId, id)).orderBy(asc(workbenchCardsTable.lane), asc(workbenchCardsTable.position));
  const capIds = Array.from(new Set(cards.map(c => c.capabilityId)));

  const [caps, components, industries] = await Promise.all([
    capIds.length > 0 ? db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, capIds)) : Promise.resolve([]),
    capIds.length > 0 ? db.select().from(ceiComponentsTable).where(inArray(ceiComponentsTable.capabilityId, capIds)) : Promise.resolve([]),
    db.select().from(industriesTable),
  ]);
  const capById = new Map(caps.map(c => [c.id, c]));
  const compById = new Map(components.map(c => [c.capabilityId, c]));
  const indById = new Map(industries.map(i => [i.id, i]));

  const cardIds = cards.map(c => c.id);
  const insights = cardIds.length > 0
    ? await db.select().from(workbenchCardInsightsTable).where(inArray(workbenchCardInsightsTable.cardId, cardIds)).orderBy(desc(workbenchCardInsightsTable.generatedAt))
    : [];
  const insightsByCard = new Map<number, typeof insights>();
  for (const ins of insights) {
    const arr = insightsByCard.get(ins.cardId) ?? [];
    arr.push(ins);
    insightsByCard.set(ins.cardId, arr);
  }

  const projected = cards.map(card => {
    const cap = capById.get(card.capabilityId);
    const comp = compById.get(card.capabilityId);
    const ind = cap ? indById.get(cap.industryId) : undefined;
    return {
      id: card.id,
      boardId: card.boardId,
      capabilityId: card.capabilityId,
      lane: card.lane,
      position: card.position,
      notes: card.notes,
      createdBy: card.createdBy,
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
      capability: cap ? {
        id: cap.id,
        name: cap.name,
        slug: cap.slug,
        description: cap.description,
        industryId: cap.industryId,
        industryName: ind?.name ?? "Unknown",
        lifecycleStage: deriveLifecycleStage({
          consensusScore: comp?.consensusScore ?? null,
          velocity: comp?.velocity ?? null,
          benchmarkScore: cap.benchmarkScore,
        }),
        consensusScore: comp?.consensusScore ?? null,
        velocity: comp?.velocity ?? null,
        ciLow: comp?.ciLow ?? null,
        ciHigh: comp?.ciHigh ?? null,
      } : null,
      insights: (insightsByCard.get(card.id) ?? []).map(ins => ({
        id: ins.id,
        kind: ins.kind,
        body: ins.body,
        bullets: ins.bullets,
        modelUsed: ins.modelUsed,
        userPrompt: ins.userPrompt,
        targetIndustryName: ins.targetIndustryName,
        targetMarketDescription: ins.targetMarketDescription,
        generatedBy: ins.generatedBy,
        generatedAt: ins.generatedAt.toISOString(),
      })),
    };
  });

  res.json({
    board: {
      ...access.board,
      createdAt: access.board.createdAt.toISOString(),
      updatedAt: access.board.updatedAt.toISOString(),
      isMine: access.board.clerkUserId === getAuth(req)?.userId,
      ownerType: access.board.clerkOrgId ? "team" as const : "personal" as const,
    },
    cards: projected,
  });
});

// ───────────────────── Cards ─────────────────────

const CreateCardBody = z.object({
  capabilityId: z.number().int().positive(),
  lane: z.enum(LANES).default("scan"),
  notes: z.string().max(4000).optional(),
});

router.post("/workbench/boards/:boardId/cards", async (req, res) => {
  const boardId = Number(req.params.boardId);
  if (!Number.isInteger(boardId) || boardId <= 0) { res.status(400).json({ error: "bad board id" }); return; }
  const access = await loadBoardForAccess(req, boardId);
  if (!access.allowed || !access.board) { res.status(access.board ? 403 : 404).json({ error: access.board ? "Forbidden" : "Not found" }); return; }
  const auth = getAuth(req);
  const parsed = CreateCardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const [cap] = await db.select({ id: capabilitiesTable.id }).from(capabilitiesTable).where(eq(capabilitiesTable.id, parsed.data.capabilityId));
  if (!cap) { res.status(400).json({ error: "Capability not found" }); return; }
  // Position = max(position in lane) + 1
  const [{ maxPos }] = await db
    .select({ maxPos: sql<number>`COALESCE(MAX(${workbenchCardsTable.position}), -1)::int` })
    .from(workbenchCardsTable)
    .where(and(eq(workbenchCardsTable.boardId, boardId), eq(workbenchCardsTable.lane, parsed.data.lane)));
  try {
    const [created] = await db.insert(workbenchCardsTable).values({
      boardId,
      capabilityId: parsed.data.capabilityId,
      lane: parsed.data.lane,
      position: (maxPos ?? -1) + 1,
      notes: parsed.data.notes ?? null,
      createdBy: auth!.userId!,
    }).returning();
    res.status(201).json({ card: { ...created, createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString() } });
  } catch (err) {
    // Unique constraint: capability already on this board.
    if ((err as Error).message?.includes("workbench_cards_board_cap_unique")) {
      res.status(409).json({ error: "Capability already on this board" });
      return;
    }
    throw err;
  }
});

const UpdateCardBody = z.object({
  lane: z.enum(LANES).optional(),
  position: z.number().int().min(0).optional(),
  notes: z.string().max(4000).nullable().optional(),
});

router.patch("/workbench/cards/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "bad id" }); return; }
  const [card] = await db.select().from(workbenchCardsTable).where(eq(workbenchCardsTable.id, id));
  if (!card) { res.status(404).json({ error: "Not found" }); return; }
  const access = await loadBoardForAccess(req, card.boardId);
  if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  const parsed = UpdateCardBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  const updates: Partial<typeof workbenchCardsTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.lane !== undefined) updates.lane = parsed.data.lane;
  if (parsed.data.position !== undefined) updates.position = parsed.data.position;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
  const [updated] = await db.update(workbenchCardsTable).set(updates).where(eq(workbenchCardsTable.id, id)).returning();
  res.json({ card: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() } });
});

router.delete("/workbench/cards/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "bad id" }); return; }
  const [card] = await db.select().from(workbenchCardsTable).where(eq(workbenchCardsTable.id, id));
  if (!card) { res.status(404).json({ error: "Not found" }); return; }
  const access = await loadBoardForAccess(req, card.boardId);
  if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(workbenchCardsTable).where(eq(workbenchCardsTable.id, id));
  res.status(204).send();
});

// ───────────────────── Insights (Claude generation per card) ─────────────────────

const GenerateInsightBody = z.object({
  kind: z.enum([
    "generate_applications",
    "find_analogues",
    "critique_idea",
    "what_to_invent",
    "lifecycle_outlook",
  ]),
  userPrompt: z.string().max(2000).optional(),
  targetIndustryName: z.string().max(120).optional(),
  targetMarketDescription: z.string().max(2000).optional(),
  force: z.boolean().optional(),
});

router.post("/workbench/cards/:id/insights", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "bad id" }); return; }
  const [card] = await db.select().from(workbenchCardsTable).where(eq(workbenchCardsTable.id, id));
  if (!card) { res.status(404).json({ error: "Not found" }); return; }
  const access = await loadBoardForAccess(req, card.boardId);
  if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  const auth = getAuth(req);
  const parsed = GenerateInsightBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }

  const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, card.capabilityId));
  if (!cap) { res.status(404).json({ error: "Capability not found" }); return; }
  const [comp] = await db.select().from(ceiComponentsTable).where(eq(ceiComponentsTable.capabilityId, cap.id));
  const [ind] = await db.select().from(industriesTable).where(eq(industriesTable.id, cap.industryId));

  const ctx = {
    capabilityName: cap.name,
    capabilityDescription: cap.description,
    industryName: ind?.name ?? "Unknown",
    lifecycleStage: deriveLifecycleStage({
      consensusScore: comp?.consensusScore ?? null,
      velocity: comp?.velocity ?? null,
      benchmarkScore: cap.benchmarkScore,
    }),
    consensusScore: comp?.consensusScore ?? null,
    velocity: comp?.velocity ?? null,
    userPrompt: parsed.data.userPrompt,
    targetIndustryName: parsed.data.targetIndustryName,
    targetMarketDescription: parsed.data.targetMarketDescription,
  };

  const cacheKey = ideationCacheKey(parsed.data.kind as IdeationKind, ctx);

  if (!parsed.data.force) {
    const [existing] = await db
      .select()
      .from(workbenchCardInsightsTable)
      .where(and(eq(workbenchCardInsightsTable.cardId, id), eq(workbenchCardInsightsTable.cacheKey, cacheKey)));
    if (existing) {
      res.json({
        insight: { ...existing, generatedAt: existing.generatedAt.toISOString() },
        cached: true,
      });
      return;
    }
  }

  try {
    const result = await runIdeation(parsed.data.kind as IdeationKind, ctx);
    // Upsert — force=true overwrites the previous cache entry.
    const existing = await db
      .select({ id: workbenchCardInsightsTable.id })
      .from(workbenchCardInsightsTable)
      .where(and(eq(workbenchCardInsightsTable.cardId, id), eq(workbenchCardInsightsTable.cacheKey, cacheKey)));
    let saved: typeof workbenchCardInsightsTable.$inferSelect;
    if (existing.length > 0) {
      const [u] = await db.update(workbenchCardInsightsTable).set({
        body: result.text,
        bullets: result.bullets,
        modelUsed: result.modelUsed,
        fallbackCount: result.fallbackCount,
        userPrompt: parsed.data.userPrompt ?? null,
        targetIndustryName: parsed.data.targetIndustryName ?? null,
        targetMarketDescription: parsed.data.targetMarketDescription ?? null,
        generatedBy: auth!.userId!,
        generatedAt: new Date(),
      }).where(eq(workbenchCardInsightsTable.id, existing[0].id)).returning();
      saved = u;
    } else {
      const [n] = await db.insert(workbenchCardInsightsTable).values({
        cardId: id,
        kind: parsed.data.kind,
        cacheKey,
        body: result.text,
        bullets: result.bullets,
        modelUsed: result.modelUsed,
        fallbackCount: result.fallbackCount,
        userPrompt: parsed.data.userPrompt ?? null,
        targetIndustryName: parsed.data.targetIndustryName ?? null,
        targetMarketDescription: parsed.data.targetMarketDescription ?? null,
        generatedBy: auth!.userId!,
      }).returning();
      saved = n;
    }
    res.json({ insight: { ...saved, generatedAt: saved.generatedAt.toISOString() }, cached: false });
  } catch (err) {
    logger.error({ err, cardId: id, kind: parsed.data.kind }, "workbench insight generation failed");
    res.status(500).json({ error: "Generation failed", message: (err as Error).message });
  }
});

// ───────────────────── Export board to marketplace ─────────────────────

const ExportBody = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().min(10).max(5000),
  priceCents: z.number().int().min(100).max(100_000_00),
  type: z.enum(["report", "dataset", "template"]).default("report"),
  tags: z.array(z.string().max(40)).max(10).default([]),
  executiveSummary: z.string().max(4000).optional(),
});

/**
 * One-click: turn a workbench board into a draft marketplace listing.
 * Renders the board (capabilities + Claude insights) to a PDF, uploads it
 * to the marketplace storage backend, and creates a `draft` listing pointing
 * at the file. The seller still needs to submit it for admin review via
 * the existing /marketplace/listings/:id/submit endpoint — we intentionally
 * stop short of auto-submission so the seller can review the export before
 * publishing.
 */
router.post("/workbench/boards/:id/export-to-marketplace", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "bad id" }); return; }
  const access = await loadBoardForAccess(req, id);
  if (!access.allowed || !access.board) { res.status(access.board ? 403 : 404).json({ error: access.board ? "Forbidden" : "Not found" }); return; }
  const auth = getAuth(req);
  const parsed = ExportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }

  // Caller must be an onboarded seller — otherwise we don't have anywhere to
  // attach the listing. The error message points at the onboarding flow.
  const { marketplaceSellersTable, marketplaceListingsTable } = await import("@workspace/db");
  const [seller] = await db.select().from(marketplaceSellersTable).where(eq(marketplaceSellersTable.userId, auth!.userId!));
  if (!seller) {
    res.status(409).json({
      error: "Not a seller yet",
      message: "Start Stripe Connect onboarding before exporting a board",
      onboardingPath: "/marketplace/sell",
    });
    return;
  }

  // Render the board to PDF.
  let fileKey: string;
  let fileSize: number;
  let pageCount: number;
  let cardCount: number;
  try {
    const { renderBoardPdf } = await import("../services/workbench-export");
    const { saveUpload } = await import("../services/marketplace-storage");
    const userDisplay = seller.displayName ?? "Capability Economics Workbench analyst";
    const { buffer, pageCount: pc, cardCount: cc } = await renderBoardPdf({
      boardId: id,
      title: parsed.data.title,
      authorName: userDisplay,
      executiveSummary: parsed.data.executiveSummary,
    });
    const originalName = `${(parsed.data.title ?? access.board.name).replace(/[^a-z0-9]+/gi, "-").slice(0, 60) || "workbench-export"}.pdf`;
    const saved = await saveUpload(buffer, originalName);
    fileKey = saved.key;
    fileSize = saved.size;
    pageCount = pc;
    cardCount = cc;
  } catch (err) {
    logger.error({ err, boardId: id }, "[workbench-export] PDF generation failed");
    res.status(500).json({ error: "Export failed", message: (err as Error).message });
    return;
  }

  if (cardCount === 0) {
    res.status(422).json({ error: "Board has no cards — add at least one capability before exporting" });
    return;
  }

  const finalTitle = parsed.data.title ?? `${access.board.name} — workbench export`;
  const [listing] = await db.insert(marketplaceListingsTable).values({
    sellerId: seller.id,
    type: parsed.data.type,
    title: finalTitle,
    description: parsed.data.description,
    priceCents: parsed.data.priceCents,
    tags: parsed.data.tags,
    fileKey,
    fileSizeBytes: fileSize,
    fileOriginalName: `${finalTitle.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.pdf`,
    status: "draft",
  }).returning();

  res.status(201).json({
    listing: {
      id: listing.id,
      status: listing.status,
      pageCount,
      cardCount,
    },
    nextStep: {
      previewUrl: `/marketplace/listings/${listing.id}`,
      submitUrl: `/api/marketplace/listings/${listing.id}/submit`,
      message: "Listing created as draft. Review it on the marketplace, then POST submit to send for admin approval.",
    },
  });
});

router.delete("/workbench/insights/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "bad id" }); return; }
  const [ins] = await db.select().from(workbenchCardInsightsTable).where(eq(workbenchCardInsightsTable.id, id));
  if (!ins) { res.status(404).json({ error: "Not found" }); return; }
  const [card] = await db.select().from(workbenchCardsTable).where(eq(workbenchCardsTable.id, ins.cardId));
  if (!card) { res.status(404).json({ error: "Not found" }); return; }
  const access = await loadBoardForAccess(req, card.boardId);
  if (!access.allowed) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(workbenchCardInsightsTable).where(eq(workbenchCardInsightsTable.id, id));
  res.status(204).send();
});

export default router;
