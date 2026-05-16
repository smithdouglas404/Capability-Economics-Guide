import { Router, type IRouter } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { listBacktestEvents, listBacktestHistory, runBacktest } from "../services/backtest";

const router: IRouter = Router();

router.use("/admin/backtest", requireAdmin);

/** Curated event catalog — drives the "events to be replayed" list in the UI. */
router.get("/admin/backtest/events", async (_req, res) => {
  const events = await listBacktestEvents();
  res.json({ events });
});

/**
 * Persisted run history (oldest → newest, default 20). Lets the UI render the
 * Brier / log-loss trend without re-running the harness.
 */
router.get("/admin/backtest/history", async (req, res) => {
  const limitRaw = Number(req.query.limit);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 20;
  const history = await listBacktestHistory(limit);
  res.json({ history });
});

/**
 * Run the harness end-to-end. Pure read-only against ceiComponents — never
 * touches snapshots or macro_events, so admins can replay as often as they like
 * without polluting the live index.
 */
router.post("/admin/backtest/run", async (_req, res) => {
  try {
    const summary = await runBacktest();
    res.json(summary);
  } catch (err) {
    console.error("[backtest] run failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "backtest failed" });
  }
});

export default router;
