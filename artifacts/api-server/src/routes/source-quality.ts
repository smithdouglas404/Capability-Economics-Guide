import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, sourceTriangulationsTable } from "@workspace/db";
import { sql, gte } from "drizzle-orm";
import { getSourceQualityAudit, getCapabilityQuality } from "../services/source-quality";
import { requireAdmin } from "../middlewares/requireAdmin";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ListQuery = z.object({
  industryId: z.coerce.number().int().positive().optional(),
  severity: z.enum(["critical", "warning", "ok"]).optional(),
  flag: z.enum([
    "stale",
    "single_source",
    "no_consulting_corroboration",
    "low_confidence",
    "wide_credible_interval",
    "seed_only",
    "no_evidence",
  ]).optional(),
  leafOnly: z.union([z.literal("1"), z.literal("true")]).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
});

router.get("/admin/source-quality", requireAdmin, async (req, res) => {
  try {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid query parameters", details: parsed.error.issues });
      return;
    }
    const audit = await getSourceQualityAudit();
    let rows = audit.capabilities;
    const q = parsed.data;
    if (q.industryId !== undefined) rows = rows.filter(r => r.industryId === q.industryId);
    if (q.severity) rows = rows.filter(r => r.severity === q.severity);
    if (q.flag) rows = rows.filter(r => r.flags.includes(q.flag!));
    if (q.leafOnly === "1" || q.leafOnly === "true") rows = rows.filter(r => r.isLeaf);
    if (q.limit) rows = rows.slice(0, q.limit);

    res.json({
      generatedAt: audit.generatedAt,
      ttlSeconds: audit.ttlSeconds,
      summary: audit.summary,
      capabilities: rows,
    });
  } catch (err) {
    logger.error({ err }, "source-quality audit failed");
    res.status(500).json({ error: "Failed to compute source quality" });
  }
});

/**
 * Aggregate source_triangulations counts for the public /provenance page.
 * Returns total sources, queries in the last 7 days, the most active source
 * label, and a contradiction count (rows whose rawScore deviates > 25 from
 * the per-capability mean in the last 7d — a coarse proxy for "sources that
 * disagree with their peers").
 */
router.get("/source-quality/stats", async (_req, res) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [totalRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sourceTriangulationsTable);

    const [recentRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sourceTriangulationsTable)
      .where(gte(sourceTriangulationsTable.queriedAt, sevenDaysAgo));

    const activeRows = await db
      .select({
        label: sourceTriangulationsTable.sourceLabel,
        n: sql<number>`count(*)::int`,
      })
      .from(sourceTriangulationsTable)
      .where(gte(sourceTriangulationsTable.queriedAt, sevenDaysAgo))
      .groupBy(sourceTriangulationsTable.sourceLabel)
      .orderBy(sql`count(*) desc`)
      .limit(1);

    // "Contradiction": within the last 7d, a row whose rawScore is > 25 away
    // from the mean of all rows on the same capability.
    const contradictedRows = await db.execute(sql`
      with means as (
        select capability_id, avg(raw_score)::float as mu
        from source_triangulations
        where queried_at >= ${sevenDaysAgo}
        group by capability_id
        having count(*) > 1
      )
      select count(*)::int as n
      from source_triangulations s
      join means m on m.capability_id = s.capability_id
      where s.queried_at >= ${sevenDaysAgo}
        and abs(s.raw_score - m.mu) > 25
    `);
    const contradictedLast7d = Number(
      (contradictedRows.rows?.[0] as { n?: number } | undefined)?.n ?? 0,
    );

    res.set("Cache-Control", "public, max-age=300");
    res.json({
      totalSources: Number(totalRow?.n ?? 0),
      queriedLast7d: Number(recentRow?.n ?? 0),
      mostActiveSource: activeRows[0]?.label ?? null,
      mostActiveSourceCount: Number(activeRows[0]?.n ?? 0),
      contradictedLast7d,
    });
  } catch (err) {
    logger.error({ err }, "source-quality stats failed");
    res.status(500).json({ error: "Failed to compute source-quality stats" });
  }
});

router.get("/capabilities/:id/quality", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid capability id" });
    return;
  }
  try {
    const row = await getCapabilityQuality(id);
    if (!row) {
      res.status(404).json({ error: "Capability not found" });
      return;
    }
    res.set("Cache-Control", "public, max-age=300");
    res.json(row);
  } catch (err) {
    logger.error({ err, id }, "capability quality failed");
    res.status(500).json({ error: "Failed to compute capability quality" });
  }
});

export default router;
