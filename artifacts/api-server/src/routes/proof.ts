import { Router, type IRouter } from "express";
import { getProofBacktest } from "../services/proof";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Public proof endpoint — backed by a 1h in-memory cache so unauthenticated
 * visitors don't trigger re-runs of the backtest harness. Used by the
 * marketing /proof gallery. Honors a `?force=1` query string to bypass the
 * cache (still no auth required; the harness is read-only).
 */
router.get("/proof/backtest", async (req, res) => {
  const force = req.query.force === "1" || req.query.force === "true";
  try {
    const summary = await getProofBacktest(force);
    res.set("Cache-Control", "public, max-age=600");
    res.json(summary);
  } catch (err) {
    logger.error({ err }, "[proof] backtest failed");
    res.status(500).json({ error: "Proof backtest failed", message: (err as Error).message });
  }
});

export default router;
