import { Router } from "express";
import { db } from "@workspace/db";
import {
  tradeSignalsTable,
  capabilityEconomicsTable,
  capabilitiesTable,
  industriesTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

// Get all trade signals
router.get("/trade-signals", async (req, res) => {
  try {
    const rows = await db.select({
      signal: tradeSignalsTable,
      capabilityName: capabilitiesTable.name,
      industryName: industriesTable.name,
    })
      .from(tradeSignalsTable)
      .leftJoin(capabilitiesTable, eq(tradeSignalsTable.capabilityId, capabilitiesTable.id))
      .leftJoin(industriesTable, eq(tradeSignalsTable.industryId, industriesTable.id))
      .orderBy(desc(tradeSignalsTable.createdAt))
      .limit(200);

    res.json(rows.map((r) => ({ ...r.signal, capabilityName: r.capabilityName, industryName: r.industryName })));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get signal performance stats
router.get("/trade-signals/performance", async (req, res) => {
  try {
    const all = await db.select().from(tradeSignalsTable);
    const resolved = all.filter((s) => s.resolved);
    const hits = resolved.filter((s) => s.outcome === "hit");
    const misses = resolved.filter((s) => s.outcome === "miss");
    const active = all.filter((s) => !s.resolved);

    const avgReturn = resolved.length
      ? resolved.reduce((s, r) => s + (r.returnPct ?? 0), 0) / resolved.length
      : 0;

    res.json({
      totalSignals: all.length,
      activeSignals: active.length,
      resolvedSignals: resolved.length,
      hits: hits.length,
      misses: misses.length,
      hitRate: resolved.length ? (hits.length / resolved.length * 100) : 0,
      avgReturnPct: Math.round(avgReturn * 100) / 100,
      longCount: all.filter((s) => s.signal === "long").length,
      shortCount: all.filter((s) => s.signal === "short").length,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Generate signals from current arbitrage data
router.post("/trade-signals/generate", async (req, res) => {
  try {
    const economics = await db.select({
      econ: capabilityEconomicsTable,
      capName: capabilitiesTable.name,
    })
      .from(capabilityEconomicsTable)
      .leftJoin(capabilitiesTable, eq(capabilityEconomicsTable.capabilityId, capabilitiesTable.id));

    const QUAD_MULTIPLES: Record<string, number> = { hot: 15, emerging: 10, table_stakes: 4, cooling: 2, declining: 1 };
    const newSignals: Array<typeof tradeSignalsTable.$inferInsert> = [];

    for (const row of economics) {
      const e = row.econ;
      if (!e.consensusQuadrant || !e.revenueExposureMm) continue;

      const ceMultiple = QUAD_MULTIPLES[e.consensusQuadrant] ?? 4;
      const streetMultiple = QUAD_MULTIPLES["table_stakes"]; // default street assumption
      const ceValue = e.revenueExposureMm * (e.marginStructurePct ?? 30) / 100 * ceMultiple;
      const streetValue = e.revenueExposureMm * (e.marginStructurePct ?? 30) / 100 * streetMultiple;
      const spread = streetValue > 0 ? ((ceValue - streetValue) / streetValue) * 100 : 0;

      if (Math.abs(spread) < 15) continue;

      const signal = spread > 0 ? "long" : "short";
      const strength = Math.min(100, Math.abs(spread));

      newSignals.push({
        capabilityId: e.capabilityId,
        industryId: e.industryId,
        signal,
        strength,
        ceQuadrant: e.consensusQuadrant,
        streetQuadrant: "table_stakes",
        spreadPct: Math.round(spread * 10) / 10,
        rationale: `CE values ${row.capName} as ${e.consensusQuadrant} (${ceMultiple}×) vs street assumption of table_stakes (${streetMultiple}×). Spread: ${spread > 0 ? "+" : ""}${spread.toFixed(1)}%.`,
      });
    }

    if (newSignals.length) {
      await db.insert(tradeSignalsTable).values(newSignals);
    }

    res.json({ generated: newSignals.length });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
