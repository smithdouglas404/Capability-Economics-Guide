/**
 * Admin read — structural choke-points on the :Capability graph.
 *
 *   GET /api/admin/graphiti/chokepoints?k=15
 *     Returns the top-k capabilities by Betweenness Centrality on the
 *     :Capability / :DEPENDS_ON subgraph. Betweenness Centrality
 *     measures how often a node sits on the shortest path between
 *     other pairs of nodes — high BC nodes are "if this fails, lots
 *     of routes are stranded" structural bottlenecks.
 *
 *     Falls back to a simpler in-degree count (incoming :DEPENDS_ON
 *     edges) when the algorithm is unavailable or the graph is too
 *     sparse for BC to produce meaningful values.
 *
 *     Both metrics are derived from the live FalkorDB graph — same
 *     source-of-truth that powers the cascade endpoint. Admin-only.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { isGraphitiAvailable, isGraphitiEnabled, queryCypher } from "../lib/graphiti-client";

const router: IRouter = Router();

interface RankedCap {
  pgId: number;
  name: string;
  metric: number;
}

router.get("/admin/graphiti/chokepoints", requireAdmin, async (req: Request, res: Response) => {
  if (!isGraphitiAvailable()) {
    res.status(503).json({ graphitiConfigured: false, error: "GRAPHITI_MCP_URL or GRAPHITI_MCP_API_KEY not set" });
    return;
  }
  const k = Math.max(1, Math.min(50, Number(req.query.k ?? 15)));

  // Try Betweenness Centrality first. FalkorDB's algo.betweennessCentrality
  // signature differs across versions — we attempt the typed-config form,
  // then fall back to a positional form, then fall back to in-degree.
  let metricName = "betweennessCentrality";
  let rows: RankedCap[] = [];
  try {
    const bc = await queryCypher({
      cypher:
        "CALL algo.betweennessCentrality({nodeLabels:['Capability'], relationshipTypes:['DEPENDS_ON']}) " +
        "YIELD node, score RETURN node.pgId AS pgId, node.name AS name, score AS metric ORDER BY score DESC LIMIT $k",
      params: { k },
    });
    if (bc.ok && bc.rows && bc.rows.length > 0) {
      rows = bc.rows
        .map((r) => ({ pgId: Number(r.pgId), name: String(r.name ?? ""), metric: Number(r.metric) }))
        .filter((r) => Number.isFinite(r.pgId) && Number.isFinite(r.metric));
    }
  } catch {
    /* fall through to in-degree */
  }

  if (rows.length === 0) {
    // In-degree fallback: count :DEPENDS_ON edges incoming to each cap.
    // "In-degree" here = how many other caps depend on this one. High
    // in-degree caps are the "hub" caps; not as nuanced as betweenness
    // but still a useful structural signal when the graph is sparse.
    metricName = "inDegreeDependedOnBy";
    const fallback = await queryCypher({
      cypher:
        "MATCH (n:Capability)<-[r:DEPENDS_ON]-() " +
        "WITH n, count(r) AS deg ORDER BY deg DESC LIMIT $k " +
        "RETURN n.pgId AS pgId, n.name AS name, deg AS metric",
      params: { k },
    });
    if (fallback.ok && fallback.rows) {
      rows = fallback.rows
        .map((r) => ({ pgId: Number(r.pgId), name: String(r.name ?? ""), metric: Number(r.metric) }))
        .filter((r) => Number.isFinite(r.pgId) && Number.isFinite(r.metric));
    }
  }

  res.json({
    graphitiConfigured: true,
    graphitiEnabled: isGraphitiEnabled(),
    metric: metricName,
    k,
    chokepoints: rows,
    docs: {
      betweennessCentralityMeaning:
        "How often this cap sits on the shortest path between other caps. High BC = bottleneck. Sparse graphs may produce flat scores.",
      inDegreeMeaning:
        "How many other caps directly depend on this one. Easy structural hub signal even on small graphs.",
    },
  });
});

export default router;
