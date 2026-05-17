/**
 * Marketplace listings ↔ Dify Knowledge Base sync.
 *
 * Marketplace listings live in Postgres as the source of truth
 * (`marketplace_listings` table). When a listing is approved (and on
 * subsequent edits / archives) we mirror its searchable content into
 * Dify's Knowledge Base named `marketplace-listings` so buyers can
 * semantically search via Dify's retrieval API.
 *
 * What gets indexed (per listing):
 *   - title
 *   - description
 *   - type ("report" | "dataset" | "template" | "service")
 *   - seller display name
 *   - tags (joined with commas)
 *
 * What does NOT get indexed (yet):
 *   - the uploaded file content (PDF / dataset / template body). The current
 *     wiring sends only metadata + description; document-content indexing
 *     can be added later by streaming the file from storage to Dify's
 *     /create-by-file endpoint. Out of scope for the initial cut because
 *     marketplace files are gated behind purchase entitlements, and we
 *     need a product decision about whether to index gated content.
 *
 * All writes graceful-degrade: if Dify is offline or DIFY_MARKETPLACE_DATASET_ID
 * isn't set, the upsert/remove is a logged no-op. The marketplace approval
 * flow itself never fails because of a Dify error.
 */

import pino from "pino";
import { db } from "@workspace/db";
import { marketplaceListingsTable, marketplaceSellersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  createDocumentByText,
  updateDocumentByText,
  deleteDocument,
  findDocumentByListingId,
  isDifyAvailable,
  getMarketplaceDatasetId,
} from "./client";

const logger = pino({ name: "dify-sync" });

/**
 * Build the text body that gets embedded in Dify. Concatenates the
 * listing's searchable fields so the embedding captures intent across
 * type / title / description / seller / tags.
 */
function buildListingText(args: {
  title: string;
  description: string;
  type: string;
  sellerName: string | null;
  tags: string[];
}): string {
  const sellerLine = args.sellerName ? `Seller: ${args.sellerName}` : "";
  const tagsLine = args.tags.length > 0 ? `Tags: ${args.tags.join(", ")}` : "";
  return [
    `Type: ${args.type}`,
    `Title: ${args.title}`,
    sellerLine,
    tagsLine,
    "",
    args.description,
  ].filter(Boolean).join("\n");
}

/**
 * Idempotent upsert: if a document for this listing exists, update its
 * text; else create a new one. Looks up existing docs by
 * metadata.listing_id (stamped on create).
 */
export async function upsertMarketplaceListingToDify(listingId: number): Promise<void> {
  if (!isDifyAvailable()) {
    logger.debug({ listingId }, "[dify-sync] Dify not configured — skipping upsert");
    return;
  }
  const datasetId = getMarketplaceDatasetId();
  if (!datasetId) {
    logger.warn({ listingId }, "[dify-sync] DIFY_MARKETPLACE_DATASET_ID unset — skipping upsert (run scripts/dify-marketplace-bootstrap once to provision the KB)");
    return;
  }

  try {
    // Pull the listing + its seller name in one shot.
    const [row] = await db
      .select({
        listing: marketplaceListingsTable,
        sellerName: marketplaceSellersTable.displayName,
      })
      .from(marketplaceListingsTable)
      .leftJoin(
        marketplaceSellersTable,
        eq(marketplaceListingsTable.sellerId, marketplaceSellersTable.id),
      )
      .where(eq(marketplaceListingsTable.id, listingId))
      .limit(1);

    if (!row) {
      logger.warn({ listingId }, "[dify-sync] listing not found in DB — skipping");
      return;
    }
    const { listing, sellerName } = row;

    // Only index approved listings. Drafts / pending_review / rejected /
    // archived shouldn't be searchable by buyers. Callers should explicitly
    // call removeMarketplaceListingFromDify on archive/reject; this guard
    // is the safety net.
    if (listing.status !== "approved") {
      logger.debug({ listingId, status: listing.status }, "[dify-sync] listing not approved — removing instead");
      await removeMarketplaceListingFromDify(listingId);
      return;
    }

    const tags = ((listing.tags as string[] | null) ?? []).filter(Boolean);
    const text = buildListingText({
      title: listing.title,
      description: listing.description,
      type: listing.type,
      sellerName: sellerName,
      tags,
    });

    const docName = `listing-${listing.id}-${listing.title.slice(0, 80)}`;
    const metadata = {
      listing_id: listing.id,
      seller_id: listing.sellerId,
      type: listing.type,
      status: listing.status,
      tags,
      price_cents: listing.priceCents,
    };

    // Look up existing — update vs create.
    const existing = await findDocumentByListingId(datasetId, listingId);
    if (existing) {
      await updateDocumentByText(datasetId, existing.id, docName, text);
      logger.info({ listingId, difyDocId: existing.id }, "[dify-sync] updated existing document");
    } else {
      const created = await createDocumentByText(datasetId, docName, text, metadata);
      logger.info({ listingId, difyDocId: created.document.id }, "[dify-sync] created new document");
    }
  } catch (err) {
    // Graceful-degrade: log + swallow. Marketplace approval still commits;
    // worst case the listing is keyword-searchable but not RAG-searchable
    // until the next periodic backfill.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), listingId },
      "[dify-sync] upsert failed (non-fatal)",
    );
  }
}

/**
 * Remove a listing's Dify document. Called when a listing is
 * archived / rejected / has its approval revoked.
 */
export async function removeMarketplaceListingFromDify(listingId: number): Promise<void> {
  if (!isDifyAvailable()) return;
  const datasetId = getMarketplaceDatasetId();
  if (!datasetId) return;

  try {
    const existing = await findDocumentByListingId(datasetId, listingId);
    if (!existing) {
      logger.debug({ listingId }, "[dify-sync] no document to remove");
      return;
    }
    await deleteDocument(datasetId, existing.id);
    logger.info({ listingId, difyDocId: existing.id }, "[dify-sync] removed document");
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), listingId },
      "[dify-sync] remove failed (non-fatal)",
    );
  }
}
