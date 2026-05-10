import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityMetricsTable,
  ceiComponentsTable,
  industriesTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getCEICurrent } from "../services/cei-engine";
import { buildFrameAncestorsCsp } from "../lib/embed-csp";
import { resolveBranding } from "../lib/embed-token";

/**
 * Build the citation list embedded in widget responses. Derived from the
 * triangulation engine's `sourceScores` JSON: each entry already records
 * label, methodology, weight, and queriedAt. We don't fabricate URLs we
 * don't have — partners can click through to capabilityeconomics.com to
 * see the full provenance trail. Capped at 5 to keep payload tiny.
 */
function buildCitations(
  sourceScores: Array<{ sourceLabel: string; weight: number; methodology: string; queriedAt: string }> | null | undefined,
): Array<{ label: string; methodology: string; weight: number; queriedAt: string }> {
  if (!sourceScores || sourceScores.length === 0) return [];
  return [...sourceScores]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map(s => ({
      label: s.sourceLabel,
      methodology: s.methodology,
      weight: Math.round(s.weight * 100) / 100,
      queriedAt: s.queriedAt,
    }));
}

const router: IRouter = Router();

/**
 * Iframe-friendly headers. We don't set X-Frame-Options because it can't
 * express an allowlist; instead we use CSP frame-ancestors via the shared
 * `buildFrameAncestorsCsp` helper (also used by the SPA HTML fallback so
 * the two never drift). Strips X-Frame-Options if a parent middleware
 * (e.g. helmet) set SAMEORIGIN.
 */
function embedFrameHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Content-Security-Policy", buildFrameAncestorsCsp(req.query.domains));
  res.removeHeader("X-Frame-Options");
  res.setHeader("Cache-Control", "public, max-age=120");
  next();
}

router.use("/embed", embedFrameHeaders);

/**
 * Live CEI snapshot for embedding. Tiny payload — overall index, CI,
 * methodology id, timestamp. No industry breakdown to keep widgets light.
 */
router.get("/embed/cei", async (req, res) => {
  try {
    const cei = await getCEICurrent();
    if (!cei) {
      res.status(503).json({ error: "CEI not yet computed" });
      return;
    }
    // CEI is a model-derived rollup, not a per-source aggregate, so its
    // provenance is the engine + the count of contributing industries
    // (each backed by Perplexity-cited GDP weights via industry_gdp_weights).
    const industryCount = Object.keys(cei.industryBreakdowns ?? {}).length;
    const ts = typeof cei.timestamp === "string" ? cei.timestamp : new Date(cei.timestamp).toISOString();
    res.json({
      overallIndex: cei.overallIndex,
      ciLow: cei.overallCiLow,
      ciHigh: cei.overallCiHigh,
      marketSentiment: cei.marketSentiment,
      volatility: cei.volatility,
      timestamp: ts,
      citations: [
        {
          label: `Bayesian triangulation across ${industryCount} industries`,
          methodology: "ce-rollup-v1.1",
          weight: 1.0,
          queriedAt: ts,
        },
        {
          label: "Industry GDP weights (Perplexity-cited)",
          methodology: "industry_gdp_weights",
          weight: 1.0,
          queriedAt: ts,
        },
      ],
      branding: resolveBranding(req.query["token"]),
    });
  } catch (err) {
    console.error("embed cei failed:", err);
    res.status(500).json({ error: "Failed to load CEI" });
  }
});

/**
 * Embeddable capability summary. Only succeeds for capabilities with
 * `publicPreview = true` — anything else returns 404 to avoid leaking
 * gated content via the unauthenticated embed path.
 */
router.get("/embed/capability/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [cap] = await db
    .select({
      id: capabilitiesTable.id,
      slug: capabilitiesTable.slug,
      name: capabilitiesTable.name,
      description: capabilitiesTable.description,
      benchmarkScore: capabilitiesTable.benchmarkScore,
      industryId: capabilitiesTable.industryId,
      industryName: industriesTable.name,
      industrySlug: industriesTable.slug,
      publicPreview: capabilitiesTable.publicPreview,
    })
    .from(capabilitiesTable)
    .innerJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId))
    .where(and(
      eq(capabilitiesTable.id, id),
      eq(capabilitiesTable.publicPreview, true),
      eq(capabilitiesTable.reviewStatus, "approved"),
    ));

  if (!cap) {
    res.status(404).json({ error: "Capability not found or not public" });
    return;
  }

  const [comp] = await db
    .select({
      consensusScore: ceiComponentsTable.consensusScore,
      ciLow: ceiComponentsTable.ciLow,
      ciHigh: ceiComponentsTable.ciHigh,
      velocity: ceiComponentsTable.velocity,
      sourceScores: ceiComponentsTable.sourceScores,
      updatedAt: ceiComponentsTable.updatedAt,
    })
    .from(ceiComponentsTable)
    .where(eq(ceiComponentsTable.capabilityId, id))
    .limit(1);

  res.json({
    id: cap.id,
    slug: cap.slug,
    name: cap.name,
    description: cap.description,
    industry: { id: cap.industryId, name: cap.industryName, slug: cap.industrySlug },
    score: comp?.consensusScore ?? cap.benchmarkScore,
    ciLow: comp?.ciLow ?? null,
    ciHigh: comp?.ciHigh ?? null,
    velocity: comp?.velocity ?? null,
    sourceCount: comp?.sourceScores?.length ?? 0,
    lastUpdatedAt: comp?.updatedAt?.toISOString() ?? null,
    citations: buildCitations(comp?.sourceScores),
    branding: resolveBranding(req.query["token"]),
  });
});

/**
 * Public catalog of curated capabilities for the /explore prospect page.
 * Returns the same shape as the embed endpoint but as a list, so the
 * frontend can render cards without a second roundtrip per capability.
 */
// Curated public catalog is intentionally small (~10) — it's a marketing
// surface, not an open data dump. The seed enforces this on write, and
// this LIMIT enforces it on read so a stray DB edit can't blow the
// catalog up to hundreds of cards.
const EXPLORE_LIMIT = 10;

router.get("/explore/capabilities", async (_req, res) => {
  try {
    const caps = await db
      .select({
        id: capabilitiesTable.id,
        slug: capabilitiesTable.slug,
        name: capabilitiesTable.name,
        description: capabilitiesTable.description,
        benchmarkScore: capabilitiesTable.benchmarkScore,
        industryId: capabilitiesTable.industryId,
        industryName: industriesTable.name,
        industrySlug: industriesTable.slug,
      })
      .from(capabilitiesTable)
      .innerJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId))
      .where(and(
        eq(capabilitiesTable.publicPreview, true),
        eq(capabilitiesTable.reviewStatus, "approved"),
      ))
      // Deterministic order so /explore looks the same across requests
      // and environments. Pagination would push this further, but at 10
      // a stable id-tiebreaker is enough.
      .orderBy(desc(capabilitiesTable.benchmarkScore), capabilitiesTable.id)
      .limit(EXPLORE_LIMIT);

    if (caps.length === 0) {
      res.set("Cache-Control", "public, max-age=120");
      res.json({ capabilities: [] });
      return;
    }

    const components = await db
      .select({
        capabilityId: ceiComponentsTable.capabilityId,
        consensusScore: ceiComponentsTable.consensusScore,
        ciLow: ceiComponentsTable.ciLow,
        ciHigh: ceiComponentsTable.ciHigh,
        velocity: ceiComponentsTable.velocity,
        sourceScores: ceiComponentsTable.sourceScores,
        updatedAt: ceiComponentsTable.updatedAt,
      })
      .from(ceiComponentsTable);
    const byCap = new Map(components.map(c => [c.capabilityId, c]));

    // Pull a couple of representative metrics per capability so the
    // explore card has something concrete to show beyond the headline
    // score (e.g. "% adoption", "automation rate").
    const metrics = await db.select().from(capabilityMetricsTable);
    const metricsByCap = new Map<number, typeof metrics>();
    for (const m of metrics) {
      const list = metricsByCap.get(m.capabilityId) ?? [];
      list.push(m);
      metricsByCap.set(m.capabilityId, list);
    }

    const out = caps.map(c => {
      const comp = byCap.get(c.id);
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        description: c.description,
        industry: { id: c.industryId, name: c.industryName, slug: c.industrySlug },
        score: comp?.consensusScore ?? c.benchmarkScore,
        ciLow: comp?.ciLow ?? null,
        ciHigh: comp?.ciHigh ?? null,
        velocity: comp?.velocity ?? null,
        sourceCount: comp?.sourceScores?.length ?? 0,
        lastUpdatedAt: comp?.updatedAt?.toISOString() ?? null,
        sampleMetrics: (metricsByCap.get(c.id) ?? []).slice(0, 2).map(m => ({
          name: m.name,
          unit: m.unit,
          benchmarkValue: m.benchmarkValue,
        })),
      };
    });

    // Re-sort by live consensus score (more recent than benchmarkScore
    // which only seeds the SQL-level deterministic ordering above).
    out.sort((a, b) => b.score - a.score);
    res.set("Cache-Control", "public, max-age=120");
    res.json({ capabilities: out });
  } catch (err) {
    console.error("explore capabilities failed:", err);
    res.status(500).json({ error: "Failed to load explore capabilities" });
  }
});

export default router;
