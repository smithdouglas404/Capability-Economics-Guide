import { Router, type IRouter } from "express";
import multer from "multer";
import { db, marketplaceListingsTable, marketplaceSellersTable } from "@workspace/db";
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { getAuth } from "@clerk/express";
import { saveUpload, readFile } from "../services/marketplace-storage";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAdminAction } from "../services/audit-log";
import { logger } from "../lib/logger";
import { sendListingApprovedEmail, sendListingRejectedEmail } from "../services/email";
import { getClerkUserSummary } from "../services/clerk-user";

const router: IRouter = Router();

// 50MB upload cap — large enough for thorough PDF reports.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

async function getSellerForCurrentUser(userId: string) {
  const [seller] = await db.select().from(marketplaceSellersTable).where(eq(marketplaceSellersTable.userId, userId));
  return seller ?? null;
}

// ───────────────────── Public browse ─────────────────────

/** Public listings browse — only approved, non-archived. Featured first. */
router.get("/marketplace/listings", async (_req, res) => {
  const rows = await db
    .select({
      id: marketplaceListingsTable.id,
      sellerId: marketplaceListingsTable.sellerId,
      sellerName: marketplaceSellersTable.displayName,
      sellerTier: marketplaceSellersTable.tier,
      sellerUserId: marketplaceSellersTable.userId,
      type: marketplaceListingsTable.type,
      title: marketplaceListingsTable.title,
      description: marketplaceListingsTable.description,
      priceCents: marketplaceListingsTable.priceCents,
      coverImageUrl: marketplaceListingsTable.coverImageUrl,
      tags: marketplaceListingsTable.tags,
      featured: marketplaceListingsTable.featured,
      featuredUntil: marketplaceListingsTable.featuredUntil,
      approvedAt: marketplaceListingsTable.approvedAt,
    })
    .from(marketplaceListingsTable)
    .leftJoin(marketplaceSellersTable, eq(marketplaceListingsTable.sellerId, marketplaceSellersTable.id))
    .where(and(
      eq(marketplaceListingsTable.status, "approved"),
      or(
        isNull(marketplaceListingsTable.expiresAt),
        gt(marketplaceListingsTable.expiresAt, sql`now()`),
      ),
    ))
    .orderBy(desc(marketplaceListingsTable.featured), desc(marketplaceListingsTable.approvedAt));
  // Honor featuredUntil at read time so the response never reports a listing
  // as featured past its cutoff — the nightly sweep also clears it, but this
  // is the safety net.
  const now = Date.now();
  const projected = rows.map(r => ({
    ...r,
    featured: r.featured && (!r.featuredUntil || r.featuredUntil.getTime() > now),
  }));
  res.json({ listings: projected });
});

/** Detail for a single public listing (approved) or any listing the caller owns. */
router.get("/marketplace/listings/:id", async (req, res) => {
  const auth = getAuth(req);
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [row] = await db
    .select({
      listing: marketplaceListingsTable,
      seller: marketplaceSellersTable,
    })
    .from(marketplaceListingsTable)
    .leftJoin(marketplaceSellersTable, eq(marketplaceListingsTable.sellerId, marketplaceSellersTable.id))
    .where(eq(marketplaceListingsTable.id, id));
  if (!row?.listing) { res.status(404).json({ error: "not found" }); return; }

  const isOwner = auth.userId && row.seller?.userId === auth.userId;
  const isExpired = row.listing.expiresAt && row.listing.expiresAt.getTime() < Date.now();
  if ((row.listing.status !== "approved" || isExpired) && !isOwner) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ listing: row.listing, seller: row.seller });
});

// ───────────────────── Seller-facing CRUD ─────────────────────

router.get("/marketplace/my-listings", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const seller = await getSellerForCurrentUser(auth.userId);
  if (!seller) { res.json({ listings: [] }); return; }
  const rows = await db
    .select()
    .from(marketplaceListingsTable)
    .where(eq(marketplaceListingsTable.sellerId, seller.id))
    .orderBy(desc(marketplaceListingsTable.createdAt));
  res.json({ listings: rows });
});

const CreateListingBody = z.object({
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(5000),
  priceCents: z.number().int().min(100).max(100_000_00), // $1 – $100,000
  type: z.enum(["report", "dataset", "template", "service"]).default("report"),
  tags: z.array(z.string().min(1).max(40)).max(10).default([]),
});

router.post("/marketplace/listings", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const seller = await getSellerForCurrentUser(auth.userId);
  if (!seller) { res.status(403).json({ error: "Complete seller onboarding first", hint: "POST /api/marketplace/sellers/onboard" }); return; }
  const parsed = CreateListingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [created] = await db.insert(marketplaceListingsTable).values({
    sellerId: seller.id,
    type: parsed.data.type,
    title: parsed.data.title,
    description: parsed.data.description,
    priceCents: parsed.data.priceCents,
    tags: parsed.data.tags,
    status: "draft",
  }).returning();
  res.status(201).json({ listing: created });
});

const UpdateListingBody = CreateListingBody.partial();

router.patch("/marketplace/listings/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const seller = await getSellerForCurrentUser(auth.userId);
  if (!seller) { res.status(403).json({ error: "Not a seller" }); return; }
  const [existing] = await db.select().from(marketplaceListingsTable).where(eq(marketplaceListingsTable.id, id));
  if (!existing || existing.sellerId !== seller.id) { res.status(404).json({ error: "not found" }); return; }
  if (existing.status === "approved") { res.status(409).json({ error: "Archive the listing to edit it — approved listings are locked" }); return; }
  const parsed = UpdateListingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [updated] = await db.update(marketplaceListingsTable).set({
    ...parsed.data,
    status: existing.status === "rejected" ? "draft" : existing.status, // edit-after-reject puts it back to draft
    rejectionReason: existing.status === "rejected" ? null : existing.rejectionReason,
    updatedAt: new Date(),
  }).where(eq(marketplaceListingsTable.id, id)).returning();
  res.json({ listing: updated });
});

/**
 * Upload the actual report file for a listing. Called separately from create
 * so the form doesn't have to send everything in one multipart request.
 */
router.post("/marketplace/listings/:id/file", upload.single("file"), async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const seller = await getSellerForCurrentUser(auth.userId);
  if (!seller) { res.status(403).json({ error: "Not a seller" }); return; }
  const [existing] = await db.select().from(marketplaceListingsTable).where(eq(marketplaceListingsTable.id, id));
  if (!existing || existing.sellerId !== seller.id) { res.status(404).json({ error: "not found" }); return; }
  if (!req.file) { res.status(400).json({ error: "No file uploaded (field name must be 'file')" }); return; }
  if (req.file.mimetype !== "application/pdf") { res.status(400).json({ error: "Only PDF files are accepted for reports" }); return; }

  try {
    const { key, size } = await saveUpload(req.file.buffer, req.file.originalname);
    const [updated] = await db.update(marketplaceListingsTable).set({
      fileKey: key,
      fileSizeBytes: size,
      fileOriginalName: req.file.originalname,
      updatedAt: new Date(),
    }).where(eq(marketplaceListingsTable.id, id)).returning();
    res.json({ listing: updated });
  } catch (err) {
    logger.error({ err, listingId: id }, "[marketplace] upload failed");
    res.status(500).json({ error: "Upload failed", message: (err as Error).message });
  }
});

/** Upload a free preview PDF for a listing — downloadable without purchase. */
router.post("/marketplace/listings/:id/preview-file", upload.single("file"), async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const seller = await getSellerForCurrentUser(auth.userId);
  if (!seller) { res.status(403).json({ error: "Not a seller" }); return; }
  const [existing] = await db.select().from(marketplaceListingsTable).where(eq(marketplaceListingsTable.id, id));
  if (!existing || existing.sellerId !== seller.id) { res.status(404).json({ error: "not found" }); return; }
  if (!req.file) { res.status(400).json({ error: "No file uploaded (field name must be 'file')" }); return; }
  if (req.file.mimetype !== "application/pdf") { res.status(400).json({ error: "Only PDF files are accepted for previews" }); return; }
  // Previews capped at 5MB — they're teaser pages, not the full report.
  if (req.file.size > 5 * 1024 * 1024) { res.status(413).json({ error: "Preview must be under 5 MB" }); return; }

  try {
    const { key, size } = await saveUpload(req.file.buffer, `preview-${req.file.originalname}`);
    const [updated] = await db.update(marketplaceListingsTable).set({
      previewFileKey: key,
      previewFileSizeBytes: size,
      updatedAt: new Date(),
    }).where(eq(marketplaceListingsTable.id, id)).returning();
    res.json({ listing: updated });
  } catch (err) {
    logger.error({ err, listingId: id }, "[marketplace] preview upload failed");
    res.status(500).json({ error: "Upload failed", message: (err as Error).message });
  }
});

/** Public preview download — no auth, no entitlement check, no watermark. */
router.get("/marketplace/listings/:id/preview.pdf", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(marketplaceListingsTable).where(eq(marketplaceListingsTable.id, id));
  if (!existing || existing.status !== "approved" || !existing.previewFileKey) {
    res.status(404).json({ error: "No preview available" });
    return;
  }
  try {
    const buf = await readFile(existing.previewFileKey);
    const safeTitle = existing.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 60) || "preview";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${safeTitle}-preview.pdf"`);
    res.send(buf);
  } catch (err) {
    logger.error({ err, listingId: id }, "[marketplace] preview download failed");
    res.status(500).json({ error: "Preview download failed" });
  }
});

router.post("/marketplace/listings/:id/submit", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const seller = await getSellerForCurrentUser(auth.userId);
  if (!seller) { res.status(403).json({ error: "Not a seller" }); return; }
  const [existing] = await db.select().from(marketplaceListingsTable).where(eq(marketplaceListingsTable.id, id));
  if (!existing || existing.sellerId !== seller.id) { res.status(404).json({ error: "not found" }); return; }
  if (!existing.fileKey) { res.status(400).json({ error: "Upload a PDF before submitting for review" }); return; }
  if (existing.status !== "draft" && existing.status !== "rejected") {
    res.status(409).json({ error: `Cannot submit from ${existing.status} state` });
    return;
  }
  const [updated] = await db.update(marketplaceListingsTable).set({
    status: "pending_review",
    rejectionReason: null,
    updatedAt: new Date(),
  }).where(eq(marketplaceListingsTable.id, id)).returning();
  res.json({ listing: updated });
});

/** Seller archives an approved listing (hides from browse). */
router.post("/marketplace/listings/:id/archive", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const seller = await getSellerForCurrentUser(auth.userId);
  if (!seller) { res.status(403).json({ error: "Not a seller" }); return; }
  const [existing] = await db.select().from(marketplaceListingsTable).where(eq(marketplaceListingsTable.id, id));
  if (!existing || existing.sellerId !== seller.id) { res.status(404).json({ error: "not found" }); return; }
  const [updated] = await db.update(marketplaceListingsTable).set({
    status: "archived",
    updatedAt: new Date(),
  }).where(eq(marketplaceListingsTable.id, id)).returning();
  res.json({ listing: updated });
});

// ───────────────────── Admin moderation ─────────────────────

router.get("/admin/marketplace/listings/pending", requireAdmin, async (_req, res) => {
  const rows = await db
    .select({
      listing: marketplaceListingsTable,
      seller: marketplaceSellersTable,
    })
    .from(marketplaceListingsTable)
    .leftJoin(marketplaceSellersTable, eq(marketplaceListingsTable.sellerId, marketplaceSellersTable.id))
    .where(or(
      eq(marketplaceListingsTable.status, "pending_review"),
      eq(marketplaceListingsTable.status, "rejected"),
    ))
    .orderBy(desc(marketplaceListingsTable.updatedAt));
  res.json({ listings: rows });
});

async function notifySeller(listingId: number, kind: "approved" | "rejected", reason?: string): Promise<void> {
  try {
    const [row] = await db
      .select({ listing: marketplaceListingsTable, seller: marketplaceSellersTable })
      .from(marketplaceListingsTable)
      .leftJoin(marketplaceSellersTable, eq(marketplaceListingsTable.sellerId, marketplaceSellersTable.id))
      .where(eq(marketplaceListingsTable.id, listingId));
    if (!row?.seller) return;
    const clerk = await getClerkUserSummary(row.seller.userId);
    const to = clerk.email ?? row.seller.email;
    if (!to) return;
    if (kind === "approved") {
      void sendListingApprovedEmail({ to, name: clerk.displayName, listingTitle: row.listing.title });
    } else {
      void sendListingRejectedEmail({ to, name: clerk.displayName, listingTitle: row.listing.title, reason: reason ?? "Does not meet publishing guidelines" });
    }
  } catch (err) {
    logger.warn({ err, listingId }, "[marketplace] seller notification failed");
  }
}

router.post("/admin/marketplace/listings/:id/approve", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [existing] = await db.select().from(marketplaceListingsTable).where(eq(marketplaceListingsTable.id, id));
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  await db.update(marketplaceListingsTable).set({
    status: "approved",
    approvedAt: new Date(),
    approvedBy: "admin",
    rejectionReason: null,
    updatedAt: new Date(),
  }).where(eq(marketplaceListingsTable.id, id));
  await logAdminAction(req, { action: "tier.update", targetType: "marketplace_listing", targetId: id, details: { title: existing.title, approval: "approved" } });
  void notifySeller(id, "approved");
  res.json({ ok: true });
});

const FeatureBody = z.object({
  featured: z.boolean(),
  // ISO-8601 datetime; when featured=true and no until is provided we default to 30 days.
  featuredUntil: z.string().datetime().nullable().optional(),
});

router.post("/admin/marketplace/listings/:id/feature", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const parsed = FeatureBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const [existing] = await db.select().from(marketplaceListingsTable).where(eq(marketplaceListingsTable.id, id));
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  let featuredUntil: Date | null = null;
  if (parsed.data.featured) {
    featuredUntil = parsed.data.featuredUntil
      ? new Date(parsed.data.featuredUntil)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  const [updated] = await db.update(marketplaceListingsTable).set({
    featured: parsed.data.featured,
    featuredUntil,
    updatedAt: new Date(),
  }).where(eq(marketplaceListingsTable.id, id)).returning();
  await logAdminAction(req, {
    action: "tier.update",
    targetType: "marketplace_listing",
    targetId: id,
    details: { feature: parsed.data.featured, featuredUntil: featuredUntil?.toISOString() ?? null, title: existing.title },
  });
  res.json({ listing: updated });
});

router.post("/admin/marketplace/seed-reports", requireAdmin, async (req, res) => {
  try {
    const { seedMarketplaceReports } = await import("../services/marketplace-seed");
    const summary = await seedMarketplaceReports();
    await logAdminAction(req, {
      action: "tier.update",
      targetType: "marketplace_listing",
      targetId: "seed",
      details: { ...summary, op: "seed_reports" },
    });
    res.json({ ok: true, ...summary });
  } catch (err) {
    logger.error({ err }, "[marketplace] seed failed");
    res.status(500).json({ error: "Seed failed", message: (err as Error).message });
  }
});

router.post("/admin/marketplace/listings/:id/reject", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const reason = (req.body?.reason as string | undefined) ?? "Does not meet publishing guidelines";
  const [existing] = await db.select().from(marketplaceListingsTable).where(eq(marketplaceListingsTable.id, id));
  if (!existing) { res.status(404).json({ error: "not found" }); return; }
  await db.update(marketplaceListingsTable).set({
    status: "rejected",
    rejectionReason: reason,
    updatedAt: new Date(),
  }).where(eq(marketplaceListingsTable.id, id));
  await logAdminAction(req, { action: "tier.update", targetType: "marketplace_listing", targetId: id, details: { title: existing.title, approval: "rejected", reason } });
  void notifySeller(id, "rejected", reason);
  res.json({ ok: true });
});

export default router;
