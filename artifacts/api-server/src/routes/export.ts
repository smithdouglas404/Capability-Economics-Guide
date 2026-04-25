import { Router, type IRouter } from "express";
import ExcelJS from "exceljs";
import { db } from "@workspace/db";
import {
  ceiComponentsTable,
  capabilitiesTable,
  industriesTable,
  companiesTable,
  companyScoresTable,
  companyCapabilityFingerprintTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { runScreener, type ScreenerFilters } from "../services/screener";

const router: IRouter = Router();

/**
 * Generic XLSX export. The `view` param picks the dataset shape; remaining
 * query params are view-specific filters. Returns a binary XLSX with a
 * downloadable Content-Disposition header.
 *
 * Supported views:
 *   - screener:        company list with composite/moat/velocity (uses runScreener filters)
 *   - comparables:     N companies × M capabilities matrix (companyIds=1,2,3 required)
 *   - cei-components:  ceiComponentsTable dump for an industry (capabilityId, score, velocity, confidence)
 */
router.get("/export/xlsx", async (req, res) => {
  const view = String(req.query.view ?? "");
  if (!view) { res.status(400).json({ error: "Missing view param" }); return; }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Capability Economics";
  wb.created = new Date();

  try {
    if (view === "screener") {
      const filters: ScreenerFilters = {
        industryId: req.query.industryId ? Number(req.query.industryId) : undefined,
        scoreMin: req.query.scoreMin ? Number(req.query.scoreMin) : undefined,
        scoreMax: req.query.scoreMax ? Number(req.query.scoreMax) : undefined,
        moatMin: req.query.moatMin ? Number(req.query.moatMin) : undefined,
        moatMax: req.query.moatMax ? Number(req.query.moatMax) : undefined,
        aiDisruptabilityMax: req.query.aiDisruptabilityMax ? Number(req.query.aiDisruptabilityMax) : undefined,
        coverageMin: req.query.coverageMin ? Number(req.query.coverageMin) : undefined,
        ownership: typeof req.query.ownership === "string" ? req.query.ownership : undefined,
        country: typeof req.query.country === "string" ? req.query.country : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 500,
      };
      const rows = await runScreener(filters);
      const ws = wb.addWorksheet("Screener");
      ws.columns = [
        { header: "Company", key: "name", width: 36 },
        { header: "Industry", key: "industryName", width: 18 },
        { header: "Country", key: "country", width: 14 },
        { header: "Ownership", key: "ownership", width: 14 },
        { header: "Composite", key: "composite", width: 12 },
        { header: "Moat", key: "moatScore", width: 12 },
        { header: "AI Disruptability", key: "aiDisruptability", width: 18 },
        { header: "Coverage", key: "capabilityCoverage", width: 12 },
        { header: "CEI Weighted", key: "ceiWeighted", width: 14 },
      ];
      ws.getRow(1).font = { bold: true };
      rows.forEach((r) => ws.addRow(r));
    } else if (view === "comparables") {
      const ids = String(req.query.companyIds ?? "")
        .split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
      if (ids.length === 0) {
        res.status(400).json({ error: "companyIds=1,2,3 required for comparables" });
        return;
      }
      const companies = await db.select().from(companiesTable).where(inArray(companiesTable.id, ids));
      const fingerprints = await db.select().from(companyCapabilityFingerprintTable).where(inArray(companyCapabilityFingerprintTable.companyId, ids));
      const capIds = Array.from(new Set(fingerprints.map((f) => f.capabilityId)));
      const caps = capIds.length ? await db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, capIds)) : [];
      const ws = wb.addWorksheet("Comparables");
      ws.columns = [
        { header: "Capability", key: "cap", width: 36 },
        ...companies.map((c) => ({ header: c.name, key: `c${c.id}`, width: 18 })),
      ];
      ws.getRow(1).font = { bold: true };
      caps
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((cap) => {
          const row: Record<string, unknown> = { cap: cap.name };
          for (const c of companies) {
            const fp = fingerprints.find((x) => x.companyId === c.id && x.capabilityId === cap.id);
            row[`c${c.id}`] = fp ? fp.weight : "—";
          }
          ws.addRow(row);
        });
    } else if (view === "cei-components") {
      const industryId = req.query.industryId ? Number(req.query.industryId) : undefined;
      const where = industryId ? eq(ceiComponentsTable.industryId, industryId) : undefined;
      const rows = await db.select().from(ceiComponentsTable).where(where).limit(5000);
      const caps = await db.select().from(capabilitiesTable);
      const inds = await db.select().from(industriesTable);
      const capMap = new Map(caps.map((c) => [c.id, c.name]));
      const indMap = new Map(inds.map((i) => [i.id, i.name]));
      const ws = wb.addWorksheet("CEI Components");
      ws.columns = [
        { header: "Capability", key: "capability", width: 36 },
        { header: "Industry", key: "industry", width: 24 },
        { header: "Consensus Score", key: "consensusScore", width: 18 },
        { header: "Velocity", key: "velocity", width: 12 },
        { header: "Confidence", key: "confidence", width: 12 },
        { header: "Economic Multiplier", key: "economicMultiplier", width: 18 },
        { header: "Updated At", key: "updatedAt", width: 24 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const r of rows) {
        ws.addRow({
          capability: capMap.get(r.capabilityId) ?? r.capabilityId,
          industry: indMap.get(r.industryId) ?? r.industryId,
          consensusScore: r.consensusScore,
          velocity: r.velocity,
          confidence: r.confidence,
          economicMultiplier: r.economicMultiplier,
          updatedAt: r.updatedAt,
        });
      }
    } else {
      res.status(400).json({ error: `Unknown view: ${view}`, supported: ["screener", "comparables", "cei-components"] });
      return;
    }

    const buf = await wb.xlsx.writeBuffer();
    const filename = `${view}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(500).json({ error: "Export failed", message: (err as Error).message });
  }
});

export default router;
