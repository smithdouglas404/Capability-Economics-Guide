/**
 * Rolling backtest accuracy endpoint.
 *
 * Reads from the existing backtest_runs history (populated by the harness
 * cron in services/proof) and returns the rolling aggregate accuracy
 * across the last N runs. The UI surfaces this as a compact "our calls
 * hit 73% over the last 90 days" badge across multiple strategic pages.
 *
 * Why it's its own endpoint (vs. extending /proof/backtest):
 *   - /proof/backtest returns the full per-event summary (heavyweight)
 *   - This is intended for ambient display in nav/hero — must be cheap.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { backtestRunsTable } from "@workspace/db";
import { desc, gte } from "drizzle-orm";

const router: IRouter = Router();

router.get("/backtest/rolling", async (req, res) => {
  try {
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 90));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rowsRaw = await db
      .select()
      .from(backtestRunsTable)
      .where(gte(backtestRunsTable.ranAt, since))
      .orderBy(desc(backtestRunsTable.ranAt));

    // Skip rows where the harness ran but scored nothing (no historical events
    // seeded yet, or all cap names failed to match). They're meaningless data
    // points — including them as "0% accuracy" pulls the rolling average down
    // for runs that literally had nothing to be right or wrong about.
    const rows = rowsRaw.filter((r) => r.aggregateScored > 0);

    if (rows.length === 0) {
      // Nothing in the window — fall back to the most recent N runs ever
      const fallbackRaw = await db
        .select()
        .from(backtestRunsTable)
        .orderBy(desc(backtestRunsTable.ranAt))
        .limit(20);
      const fallback = fallbackRaw.filter((r) => r.aggregateScored > 0).slice(0, 10);
      if (fallback.length === 0) {
        res.json({ available: false, windowDays: days });
        return;
      }
      const meanAcc = fallback.reduce((s, r) => s + r.aggregateAccuracy, 0) / fallback.length;
      res.json({
        available: true,
        windowDays: days,
        runs: fallback.length,
        rollingAccuracy: Math.round(meanAcc * 1000) / 10, // % with one decimal
        rolledFromFallback: true,
        latestRunAt: fallback[0]?.ranAt.toISOString() ?? null,
        eventsScored: fallback.reduce((s, r) => s + r.aggregateScored, 0),
      });
      return;
    }

    const meanAcc = rows.reduce((s, r) => s + r.aggregateAccuracy, 0) / rows.length;
    const meanBrier = rows
      .map(r => r.brier)
      .filter((b): b is number => typeof b === "number")
      .reduce((acc, b, _i, arr) => acc + b / arr.length, 0) || null;
    res.json({
      available: true,
      windowDays: days,
      runs: rows.length,
      rollingAccuracy: Math.round(meanAcc * 1000) / 10, // % with one decimal
      brier: meanBrier !== null ? Math.round(meanBrier * 1000) / 1000 : null,
      latestRunAt: rows[0]?.ranAt.toISOString() ?? null,
      eventsScored: rows.reduce((s, r) => s + r.aggregateScored, 0),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
