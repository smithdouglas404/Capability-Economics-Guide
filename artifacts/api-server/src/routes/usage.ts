import { Router } from "express";
import { getUsageSummary, getRecentCalls, getCsuitePerspectiveStats } from "../services/llm-usage";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

router.use("/usage", requireAdmin);

router.get("/usage/summary", async (req, res) => {
  try {
    const windowHours = Math.max(1, Math.min(720, Number(req.query.windowHours) || 24));
    const summary = await getUsageSummary(windowHours);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/usage/recent", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
    const endpoint = typeof req.query.endpoint === "string" ? req.query.endpoint : undefined;
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const rows = await getRecentCalls(limit, { endpoint, status });
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Per-CXO success/failure rates — lets the admin dashboard show which
// perspective roles are silently failing instead of letting console.error
// be the only signal. Reads llm_usage rows tagged "csuite_perspective:*".
router.get("/usage/csuite", async (req, res) => {
  try {
    const windowHours = Math.max(1, Math.min(720, Number(req.query.windowHours) || 24));
    const stats = await getCsuitePerspectiveStats(windowHours);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
