import { Router, type IRouter } from "express";
import { runScreener, type ScreenerFilters } from "../services/screener";

const router: IRouter = Router();

/**
 * GET /api/screener — multi-parameter company filter. All query params optional.
 * Returns { rows, count, filters }. Public read; sorted server-side by composite desc.
 */
router.get("/screener", async (req, res) => {
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
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  };

  try {
    const rows = await runScreener(filters);
    res.json({ rows, count: rows.length, filters });
  } catch (err) {
    res.status(500).json({ error: "Screener query failed", message: (err as Error).message });
  }
});

export default router;
