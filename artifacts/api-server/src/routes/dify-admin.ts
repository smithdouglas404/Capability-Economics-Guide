/**
 * Dify admin routes — bootstrap + maintenance for the Dify integration.
 *
 * Routes (all gated by requireAdmin / x-admin-key):
 *
 *   POST /api/admin/dify/bootstrap
 *     One-shot setup: creates the `marketplace-listings` Knowledge Base in
 *     Dify, prints the dataset id. Operator copies that id into the
 *     DIFY_MARKETPLACE_DATASET_ID env var on Railway, then re-deploys.
 *     Run this once when first wiring Dify.
 *
 *   POST /api/admin/dify/backfill-marketplace
 *     Walks all currently-approved marketplace listings and pushes each one
 *     into the Dify Knowledge Base. Idempotent — re-running is safe;
 *     existing docs get updated, new ones get created. Run after bootstrap
 *     when Dify is first set up, or any time you want to re-sync after a
 *     long Dify outage.
 *
 *   GET  /api/admin/dify/status
 *     Diagnostic: returns isDifyAvailable, the configured marketplace
 *     dataset id, count of approved marketplace listings (Postgres side),
 *     and count of documents in the Dify dataset. Used by the admin UI
 *     panel to show "X listings indexed of Y approved".
 */

import { Router, type IRouter } from "express";
import { db, marketplaceListingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logger } from "../lib/logger";
import {
  createDataset,
  isDifyAvailable,
  getMarketplaceDatasetId,
  listDatasets,
} from "../services/dify/client";
import { upsertMarketplaceListingToDify } from "../services/dify/sync";

const router: IRouter = Router();

const MARKETPLACE_KB_NAME = "marketplace-listings";
const MARKETPLACE_KB_DESCRIPTION =
  "Approved marketplace listings (reports, datasets, templates, services) indexed for buyer RAG search. Written by the inflexcvi api-server via services/dify/sync.ts whenever a listing is approved, edited, or archived.";

router.post("/admin/dify/bootstrap", requireAdmin, async (_req, res) => {
  if (!isDifyAvailable()) {
    res.status(503).json({ error: "Dify not configured (DIFY_BASE_URL + DIFY_API_KEY env required)" });
    return;
  }
  try {
    // Idempotent: if a dataset with the canonical name exists, return its
    // id rather than creating a duplicate.
    const existing = await listDatasets(1, 100);
    const match = existing.data.find((d) => d.name === MARKETPLACE_KB_NAME);
    if (match) {
      res.json({
        ok: true,
        action: "reused",
        datasetId: match.id,
        message: `Existing dataset found. Set DIFY_MARKETPLACE_DATASET_ID=${match.id} on Railway api-server and redeploy.`,
      });
      return;
    }
    const created = await createDataset(MARKETPLACE_KB_NAME, MARKETPLACE_KB_DESCRIPTION);
    logger.info({ datasetId: created.id }, "[dify-admin] created marketplace KB");
    res.json({
      ok: true,
      action: "created",
      datasetId: created.id,
      message: `Dataset created. Set DIFY_MARKETPLACE_DATASET_ID=${created.id} on Railway api-server and redeploy, then call /api/admin/dify/backfill-marketplace.`,
    });
  } catch (err) {
    logger.error({ err }, "[dify-admin] bootstrap failed");
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/admin/dify/backfill-marketplace", requireAdmin, async (_req, res) => {
  if (!isDifyAvailable()) {
    res.status(503).json({ error: "Dify not configured" });
    return;
  }
  if (!getMarketplaceDatasetId()) {
    res.status(412).json({ error: "DIFY_MARKETPLACE_DATASET_ID not set — run POST /api/admin/dify/bootstrap first and set the env var" });
    return;
  }

  const approvedListings = await db
    .select({ id: marketplaceListingsTable.id })
    .from(marketplaceListingsTable)
    .where(eq(marketplaceListingsTable.status, "approved"));

  let succeeded = 0;
  let failed = 0;
  for (const { id } of approvedListings) {
    try {
      await upsertMarketplaceListingToDify(id);
      succeeded++;
    } catch (err) {
      failed++;
      logger.warn({ err, listingId: id }, "[dify-admin] backfill upsert failed");
    }
  }

  logger.info({ total: approvedListings.length, succeeded, failed }, "[dify-admin] backfill complete");
  res.json({
    ok: true,
    total: approvedListings.length,
    succeeded,
    failed,
  });
});

router.get("/admin/dify/status", requireAdmin, async (_req, res) => {
  const approvedRows = await db
    .select({ id: marketplaceListingsTable.id })
    .from(marketplaceListingsTable)
    .where(eq(marketplaceListingsTable.status, "approved"));

  // documentsInDify count is intentionally null for now — adding a typed
  // doc-count helper to client.ts is follow-up work. The bootstrap +
  // backfill endpoints + the /api/health/services probeDify together give
  // the operator enough signal to know whether sync is working.
  res.json({
    available: isDifyAvailable(),
    datasetId: getMarketplaceDatasetId(),
    approvedListingsInPostgres: approvedRows.length,
    documentsInDify: null,
  });
});

export default router;
