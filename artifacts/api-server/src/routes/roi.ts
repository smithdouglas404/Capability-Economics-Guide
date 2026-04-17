import { Router } from "express";
import { db } from "@workspace/db";
import { roiRecordsTable, capabilitiesTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";

const router = Router();

// List ROI records for a session
router.get("/roi/records", async (req, res) => {
  try {
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
    if (!token) { res.json([]); return; }

    const rows = await db.select({
      record: roiRecordsTable,
      capabilityName: capabilitiesTable.name,
    })
      .from(roiRecordsTable)
      .leftJoin(capabilitiesTable, eq(roiRecordsTable.capabilityId, capabilitiesTable.id))
      .where(eq(roiRecordsTable.sessionToken, token))
      .orderBy(roiRecordsTable.quarter);

    res.json(rows.map((r) => ({ ...r.record, capabilityName: r.capabilityName })));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Add ROI record
router.post("/roi/records", async (req, res) => {
  try {
    const { sessionToken, capabilityId, quarter, spendUsdK, revenueImpactUsdK, efficiencyGainPct, maturityBefore, maturityAfter, notes } = req.body;

    const [record] = await db.insert(roiRecordsTable).values({
      sessionToken,
      capabilityId,
      quarter,
      spendUsdK,
      revenueImpactUsdK,
      efficiencyGainPct,
      maturityBefore,
      maturityAfter,
      notes,
    }).returning();

    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get ROI summary (projected vs actual)
router.get("/roi/summary", async (req, res) => {
  try {
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
    if (!token) { res.json({ totalSpend: 0, totalRevenue: 0, avgEfficiency: 0, capabilities: [] }); return; }

    const rows = await db.select({
      record: roiRecordsTable,
      capabilityName: capabilitiesTable.name,
    })
      .from(roiRecordsTable)
      .leftJoin(capabilitiesTable, eq(roiRecordsTable.capabilityId, capabilitiesTable.id))
      .where(eq(roiRecordsTable.sessionToken, token));

    const totalSpend = rows.reduce((s, r) => s + (r.record.spendUsdK ?? 0), 0);
    const totalRevenue = rows.reduce((s, r) => s + (r.record.revenueImpactUsdK ?? 0), 0);
    const efficiencies = rows.filter((r) => r.record.efficiencyGainPct != null);
    const avgEfficiency = efficiencies.length
      ? efficiencies.reduce((s, r) => s + (r.record.efficiencyGainPct ?? 0), 0) / efficiencies.length
      : 0;

    // Group by capability
    const byCap = new Map<number, { name: string; spend: number; revenue: number; records: number; maturityDelta: number }>();
    for (const r of rows) {
      const existing = byCap.get(r.record.capabilityId) ?? { name: r.capabilityName ?? "", spend: 0, revenue: 0, records: 0, maturityDelta: 0 };
      existing.spend += r.record.spendUsdK ?? 0;
      existing.revenue += r.record.revenueImpactUsdK ?? 0;
      existing.records++;
      if (r.record.maturityAfter != null && r.record.maturityBefore != null) {
        existing.maturityDelta += r.record.maturityAfter - r.record.maturityBefore;
      }
      byCap.set(r.record.capabilityId, existing);
    }

    res.json({
      totalSpendK: Math.round(totalSpend),
      totalRevenueK: Math.round(totalRevenue),
      netRoiPct: totalSpend > 0 ? Math.round((totalRevenue - totalSpend) / totalSpend * 100) : 0,
      avgEfficiencyPct: Math.round(avgEfficiency * 10) / 10,
      quarters: [...new Set(rows.map((r) => r.record.quarter))].sort(),
      capabilities: [...byCap.entries()].map(([id, v]) => ({
        capabilityId: id,
        capabilityName: v.name,
        totalSpendK: Math.round(v.spend),
        totalRevenueK: Math.round(v.revenue),
        roi: v.spend > 0 ? Math.round((v.revenue - v.spend) / v.spend * 100) : 0,
        maturityDelta: Math.round(v.maturityDelta * 10) / 10,
        records: v.records,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Delete ROI record
router.delete("/roi/records/:id", async (req, res) => {
  try {
    await db.delete(roiRecordsTable).where(eq(roiRecordsTable.id, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
