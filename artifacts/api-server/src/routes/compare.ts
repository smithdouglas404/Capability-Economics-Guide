/**
 * Side-by-side comparison endpoint. Accepts 2–5 capability ids (comma-separated)
 * and returns the normalized fields each compare-UI cell needs: identity,
 * current CVI posterior, velocity, source count, lifecycle stage, and a small
 * set of metrics. Designed to be fetched once per page load; per-cap data
 * fetches happen server-side in parallel.
 *
 * The shape mirrors what the /capability/:id page consumes so the frontend
 * can reuse types.
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  cviComponentsTable,
  industriesTable,
  capabilityMetricsTable,
  sourceTriangulationsTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { deriveLifecycleStage } from "../services/lifecycle";

const router: IRouter = Router();

const Query = z.object({
  ids: z.string().min(1),
});

router.get("/compare/capabilities", async (req, res) => {
  const parsed = Query.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
    return;
  }
  const ids = parsed.data.ids.split(",").map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0);
  if (ids.length < 2 || ids.length > 5) {
    res.status(400).json({ error: "Provide 2 to 5 capability ids" });
    return;
  }
  const uniqIds = Array.from(new Set(ids));

  const [caps, components, metrics, industries, sourceCountsRaw] = await Promise.all([
    db.select().from(capabilitiesTable).where(inArray(capabilitiesTable.id, uniqIds)),
    db.select().from(cviComponentsTable).where(inArray(cviComponentsTable.capabilityId, uniqIds)),
    db.select().from(capabilityMetricsTable).where(inArray(capabilityMetricsTable.capabilityId, uniqIds)),
    db.select().from(industriesTable),
    db
      .select({
        capabilityId: sourceTriangulationsTable.capabilityId,
        sourceCount: sql<number>`count(distinct ${sourceTriangulationsTable.sourceLabel})::int`,
        maxQueriedAt: sql<Date>`max(${sourceTriangulationsTable.queriedAt})`,
      })
      .from(sourceTriangulationsTable)
      .where(inArray(sourceTriangulationsTable.capabilityId, uniqIds))
      .groupBy(sourceTriangulationsTable.capabilityId),
  ]);

  const indById = new Map(industries.map(i => [i.id, i]));
  const compByCap = new Map(components.map(c => [c.capabilityId, c]));
  const metricsByCap = new Map<number, typeof metrics>();
  for (const m of metrics) {
    const arr = metricsByCap.get(m.capabilityId) ?? [];
    arr.push(m);
    metricsByCap.set(m.capabilityId, arr);
  }
  const sourceCounts = new Map(sourceCountsRaw.map(s => [s.capabilityId, s]));

  const result = uniqIds.map(id => {
    const cap = caps.find(c => c.id === id);
    if (!cap) return { id, missing: true as const };
    const comp = compByCap.get(id);
    const ind = indById.get(cap.industryId);
    const sc = sourceCounts.get(id);
    return {
      id,
      missing: false as const,
      name: cap.name,
      slug: cap.slug,
      description: cap.description,
      industry: { id: cap.industryId, name: ind?.name ?? "Unknown", slug: ind?.slug ?? "" },
      reviewStatus: cap.reviewStatus,
      isLeaf: cap.isLeaf,
      benchmarkScore: cap.benchmarkScore,
      consensusScore: comp?.consensusScore ?? null,
      ciLow: comp?.ciLow ?? null,
      ciHigh: comp?.ciHigh ?? null,
      confidence: comp?.confidence ?? null,
      velocity: comp?.velocity ?? null,
      sourceCount: sc?.sourceCount ?? 0,
      lastQueriedAt: sc?.maxQueriedAt ? new Date(sc.maxQueriedAt).toISOString() : null,
      lifecycleStage: deriveLifecycleStage({
        consensusScore: comp?.consensusScore ?? null,
        velocity: comp?.velocity ?? null,
        benchmarkScore: cap.benchmarkScore,
      }),
      patentCount: cap.patentCount,
      vcCapitalUsd: cap.vcCapitalUsd,
      startupCount: cap.startupCount,
      metrics: (metricsByCap.get(id) ?? []).slice(0, 6).map(m => ({
        name: m.name,
        unit: m.unit,
        benchmarkValue: m.benchmarkValue,
      })),
    };
  });

  res.set("Cache-Control", "public, max-age=120");
  res.json({ entities: result });
});

export default router;
