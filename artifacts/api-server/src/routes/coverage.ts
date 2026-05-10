import { Router, type IRouter } from "express";
import { getCoverageScorecard, getCoverageAdminExtras } from "../services/coverage";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

router.get("/coverage", async (_req, res) => {
  try {
    const result = await getCoverageScorecard();
    res.set("Cache-Control", "public, max-age=300");
    res.json(result);
  } catch (err) {
    console.error("coverage scorecard failed:", err);
    res.status(500).json({ error: "Failed to compute coverage" });
  }
});

router.get("/admin/coverage", requireAdmin, async (_req, res) => {
  try {
    const [scorecard, extras] = await Promise.all([
      getCoverageScorecard(),
      getCoverageAdminExtras(),
    ]);
    res.json({ ...scorecard, admin: extras });
  } catch (err) {
    console.error("admin coverage failed:", err);
    res.status(500).json({ error: "Failed to compute admin coverage" });
  }
});

export default router;
