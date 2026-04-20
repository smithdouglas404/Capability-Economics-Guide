import { Router, type IRouter } from "express";
import multer from "multer";
import { db, marketplaceListingsTable, marketplaceSellersTable } from "@workspace/db";
import { and, desc, eq, or } from "drizzle-orm";
import { z } from "zod/v4";
import { getAuth } from "@clerk/express";
import { saveUpload } from "../services/marketplace-storage";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logAdminAction } from "../services/audit-log";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// 50MB upload cap — large enough for thorough PDF reports.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

async function getSellerForCurrentUser(userId: string) {
  const [seller] = await db.select().from(marketplaceSellersTable).where(eq(marketplaceSellersTable.userId, userId));
  return seller ?? null;
}

// ───────────────────── Public browse ─────────────────────

/** Public listings browse — only approved, non-archived. */
router.get("/marketplace/listings", async (_req, res) => {
  const rows = await db
    .select({
      id: marketplaceListingsTable.id,
      sellerId: marketplaceListingsTable.sellerId,
      sellerName: marketplaceSellersTable.displayName,
      type: marketplaceListingsTable.type,
      title: marketplaceListingsTable.title,
      description: marketplaceListingsTable.description,
      priceCents: marketplaceListingsTable.priceCents,
      coverImageUrl: marketplaceListingsTable.coverImageUrl,
      tags: marketplaceListingsTable.tags,
      approvedAt: marketplaceListingsTable.approvedAt,
    })
    .from(marketplaceListingsTable)
    .leftJoin(marketplaceSellersTable, eq(marketplaceListingsTable.sellerId, marketplaceSellersTable.id))
    .where(eq(marketplaceListingsTable.status, "approved"))
    .orderBy(desc(marketplaceListingsTable.approvedAt));
  res.json({ listings: rows });
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
  if (row.listing.status !== "approved" && !isOwner) {
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
  type: z.enum(["report", "service", "template"]).default("report"),
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
  res.json({ ok: true });
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
  res.json({ ok: true });
});

export default router;
