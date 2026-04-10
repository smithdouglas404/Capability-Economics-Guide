import { Router, type IRouter } from "express";
import { computeCEI, getCEICurrent, getCEIHistory, CEI_METHODOLOGY } from "../services/cei-engine";
import { triangulateCapability } from "../services/triangulation";
import { db } from "@workspace/db";
import { industriesTable, capabilitiesTable, ceiComponentsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

const refreshRateLimit = new Map<string, number>();
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

router.get("/cei/current", async (_req, res) => {
  try {
    let result = await getCEICurrent();

    if (!result) {
      result = await computeCEI();
    }

    res.json(result);
  } catch (err: unknown) {
    console.error("CEI current failed:", err);
    res.status(500).json({ error: "Failed to get CEI data" });
  }
});

router.get("/cei/history", async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const history = await getCEIHistory(limit);
    res.json(history);
  } catch (err: unknown) {
    console.error("CEI history failed:", err);
    res.status(500).json({ error: "Failed to get CEI history" });
  }
});

router.post("/cei/refresh", async (req, res) => {
  const clientIp = req.ip || "unknown";
  const lastRefresh = refreshRateLimit.get(clientIp);
  if (lastRefresh && Date.now() - lastRefresh < REFRESH_COOLDOWN_MS) {
    const waitSecs = Math.ceil((REFRESH_COOLDOWN_MS - (Date.now() - lastRefresh)) / 1000);
    res.status(429).json({ error: `Rate limited. Try again in ${waitSecs}s.` });
    return;
  }

  refreshRateLimit.set(clientIp, Date.now());

  try {
    const industryId = Number(req.body.industryId);
    if (industryId && !isNaN(industryId)) {
      const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId));
      if (!industry) {
        res.status(404).json({ error: "Industry not found" });
        return;
      }

      const caps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId));
      const sample = caps.slice(0, 3);

      const triangulations = [];
      for (const cap of sample) {
        const result = await triangulateCapability(industry.name, cap.name, industryId, cap.id);
        triangulations.push(result);
      }

      const cei = await computeCEI();
      res.json({ cei, triangulations });
    } else {
      const cei = await computeCEI();
      res.json({ cei, triangulations: [] });
    }
  } catch (err: unknown) {
    console.error("CEI refresh failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: "CEI refresh failed", details: message });
  }
});

router.get("/cei/methodology", async (_req, res) => {
  res.json({ methodology: CEI_METHODOLOGY, version: "1.0" });
});

router.get("/cei/components", async (req, res) => {
  try {
    const industryId = Number(req.query.industryId);
    let components;
    if (industryId && !isNaN(industryId)) {
      components = await db.select().from(ceiComponentsTable)
        .where(eq(ceiComponentsTable.industryId, industryId))
        .orderBy(desc(ceiComponentsTable.consensusScore));
    } else {
      components = await db.select().from(ceiComponentsTable)
        .orderBy(desc(ceiComponentsTable.consensusScore));
    }
    res.json(components);
  } catch (err: unknown) {
    console.error("CEI components failed:", err);
    res.status(500).json({ error: "Failed to get CEI components" });
  }
});

export default router;
