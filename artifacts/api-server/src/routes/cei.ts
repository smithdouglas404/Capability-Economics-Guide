import { Router, type IRouter } from "express";
import { computeCEI, getCEICurrent, getCEIHistory, CEI_METHODOLOGY } from "../services/cei-engine";
import { triangulateCapability, getStaleCapabilities } from "../services/triangulation";
import { triggerRotationNow } from "../services/agent/scheduler";
import { db } from "@workspace/db";
import { industriesTable, capabilitiesTable, ceiComponentsTable, sourceTriangulationsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

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

router.post("/cei/refresh", requireAdmin, async (req, res) => {
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

router.get("/cei/freshness", async (_req, res) => {
  try {
    const caps = await db.select().from(capabilitiesTable);
    const industries = await db.select().from(industriesTable);
    const indMap = new Map(industries.map(i => [i.id, i.name]));

    const triRows = await db.select({
      capabilityId: sourceTriangulationsTable.capabilityId,
      sourceLabel: sourceTriangulationsTable.sourceLabel,
      queriedAt: sourceTriangulationsTable.queriedAt,
    }).from(sourceTriangulationsTable);

    const lastByCap = new Map<number, { lastAt: Date; sources: Set<string> }>();
    for (const t of triRows) {
      const e = lastByCap.get(t.capabilityId);
      if (!e) {
        lastByCap.set(t.capabilityId, { lastAt: t.queriedAt, sources: new Set([t.sourceLabel]) });
      } else {
        e.sources.add(t.sourceLabel);
        if (t.queriedAt > e.lastAt) e.lastAt = t.queriedAt;
      }
    }

    const components = await db.select().from(ceiComponentsTable);
    const compByCap = new Map(components.map(c => [c.capabilityId, c]));

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    const items = caps.map(c => {
      const tri = lastByCap.get(c.id);
      const comp = compByCap.get(c.id);
      const lastAt = tri?.lastAt ?? null;
      const ageHours = lastAt ? (now - lastAt.getTime()) / (60 * 60 * 1000) : null;
      return {
        capabilityId: c.id,
        capability: c.name,
        industry: indMap.get(c.industryId) ?? "Unknown",
        industryId: c.industryId,
        lastTriangulatedAt: lastAt?.toISOString() ?? null,
        ageHours: ageHours !== null ? Math.round(ageHours * 10) / 10 : null,
        sourceCount: tri?.sources.size ?? 0,
        consensusScore: comp?.consensusScore ?? null,
        confidence: comp?.confidence ?? null,
        velocity: comp?.velocity ?? null,
      };
    });

    items.sort((a, b) => {
      const aT = a.lastTriangulatedAt ? new Date(a.lastTriangulatedAt).getTime() : 0;
      const bT = b.lastTriangulatedAt ? new Date(b.lastTriangulatedAt).getTime() : 0;
      return aT - bT;
    });

    const summary = {
      total: items.length,
      refreshedLast24h: items.filter(i => i.lastTriangulatedAt && (now - new Date(i.lastTriangulatedAt).getTime()) < DAY).length,
      refreshedLast7d: items.filter(i => i.lastTriangulatedAt && (now - new Date(i.lastTriangulatedAt).getTime()) < 7 * DAY).length,
      stale7dPlus: items.filter(i => !i.lastTriangulatedAt || (now - new Date(i.lastTriangulatedAt).getTime()) >= 7 * DAY).length,
      neverRefreshed: items.filter(i => !i.lastTriangulatedAt).length,
    };

    res.json({
      summary,
      formula: {
        marketSentiment: "marketSentiment = 50 + avgVelocity × 100  (so a sentiment of 50.0 ⇒ avgVelocity ≈ 0 ⇒ no fresh evidence is moving any score)",
        consensusScore: "Bayesian posterior of 4 source perspectives against prior μ=50, σ²=1500",
        velocity: "EMA of (newScore - prevScore)/100 with decay α=0.7",
      },
      capabilities: items,
    });
  } catch (err) {
    console.error("CEI freshness failed:", err);
    res.status(500).json({ error: "Failed to compute freshness" });
  }
});

router.post("/cei/rotate", requireAdmin, async (req, res) => {
  try {
    const limit = req.body?.limit ? Number(req.body.limit) : undefined;
    const industryId = req.body?.industryId ? Number(req.body.industryId) : undefined;
    const result = await triggerRotationNow(limit, industryId);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

router.get("/cei/stale", async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const stale = await getStaleCapabilities(limit);
  res.json(stale);
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
