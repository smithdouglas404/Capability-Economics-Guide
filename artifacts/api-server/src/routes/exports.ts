/**
 * /exports — point-in-time CSV / Parquet snapshots of canned CE datasets.
 *
 * Tier policy:
 *   - CSV: Briefing tier or higher (any paid tier; export is part of the
 *          baseline subscriber benefit).
 *   - Parquet: Platform tier only (priced into the Data License tier).
 *
 * Every download is recorded in admin_audit_log (action data.export.{csv|parquet})
 * with the snapshotId so we can reconstruct who pulled what and when.
 */

import { Router, type IRouter } from "express";
import { requireTier } from "../middlewares/requireTier";
import { requireTierOrCredits } from "../middlewares/requireTierOrCredits";
import { logAdminAction } from "../services/audit-log";
import { buildCsvExport, buildParquetExport, listDatasets, DATASETS, type DatasetId } from "../services/exports";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/exports/datasets", (_req, res) => {
  res.json({ datasets: listDatasets() });
});

function isDatasetId(s: string): s is DatasetId {
  return Object.prototype.hasOwnProperty.call(DATASETS, s);
}

router.get("/exports/:dataset.csv", requireTierOrCredits("briefing", "RESEARCH_QUERY"), async (req, res) => {
  const id = String(req.params.dataset);
  if (!isDatasetId(id)) { res.status(404).json({ error: "Unknown dataset" }); return; }
  try {
    const out = await buildCsvExport(id);
    void logAdminAction(req, {
      action: "data.export.csv",
      targetType: "export.dataset",
      targetId: id,
      details: { snapshotId: out.snapshotId, rowCount: out.rowCount, format: "csv" },
    });
    res.setHeader("Content-Type", out.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
    res.setHeader("X-Snapshot-Id", out.snapshotId);
    res.send(out.body);
  } catch (err) {
    logger.error({ err, dataset: id }, "[exports] csv build failed");
    res.status(500).json({ error: "Export failed" });
  }
});

router.get("/exports/:dataset.parquet", requireTier("platform"), async (req, res) => {
  const id = String(req.params.dataset);
  if (!isDatasetId(id)) { res.status(404).json({ error: "Unknown dataset" }); return; }
  try {
    const out = await buildParquetExport(id);
    void logAdminAction(req, {
      action: "data.export.parquet",
      targetType: "export.dataset",
      targetId: id,
      details: { snapshotId: out.snapshotId, rowCount: out.rowCount, format: "parquet" },
    });
    res.setHeader("Content-Type", out.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${out.filename}"`);
    res.setHeader("X-Snapshot-Id", out.snapshotId);
    res.send(out.body);
  } catch (err) {
    logger.error({ err, dataset: id }, "[exports] parquet build failed");
    res.status(500).json({ error: "Export failed" });
  }
});

export default router;
