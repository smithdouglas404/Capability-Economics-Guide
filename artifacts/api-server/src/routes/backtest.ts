import { Router, type IRouter } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { listBacktestEvents, runBacktest } from "../services/backtest";

const router: IRouter = Router();

router.use("/admin/backtest", requireAdmin);

/** Curated event catalog — drives the "events to be replayed" list in the UI. */
router.get("/admin/backtest/events", async (_req, res) => {
  const events = await listBacktestEvents();
  res.json({ events });
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
