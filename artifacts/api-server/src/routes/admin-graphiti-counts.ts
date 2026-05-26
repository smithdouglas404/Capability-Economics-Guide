/**
 * Admin read path — Graphiti+FalkorDB node/edge counts.
 *
 *   GET /api/admin/graphiti/counts
 *     Returns the canonical population counts for the labels + relationship
 *     types this stack expects to see. The existing `graphiti_mcp` health
 *     probe only checks that the MCP server responds — it does NOT verify
 *     the graph has data. Empty :Capability mirror, in particular, is the
 *     class of bug that motivated the cascade-fallback fix (see
 *     services/agent/capabilityGraphSync.ts:cypherCascadeImpacted): the
 *     reader paths silently fall back to Postgres when the graph is empty,
 *     but operators had no way to spot the empty state ahead of time. This
 *     route is that visibility surface.
 *
 *   Reports `graphitiEnabled` so operators can quickly see whether the
 *   USE_GRAPHITI_WORLD_MODEL flag is on alongside the live counts.
 *
 *   Returns 503 when Graphiti is not configured (graceful-degrade pattern —
 *   matches `/api/health/services` semantics for unconfigured backends).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { isGraphitiAvailable, isGraphitiEnabled, queryCypher } from "../lib/graphiti-client";

const router: IRouter = Router();

interface CountResult {
  ok: boolean;
  count?: number;
  error?: string;
}

async function countQuery(cypher: string): Promise<CountResult> {
  try {
    const r = await queryCypher({ cypher });
    if (!r.ok || !r.rows) return { ok: false, error: r.error ?? "no rows" };
    // Graphiti's query_cypher returns rows shaped like:
    //   [{"row": [{"count": N}]}, {"row": ["count"]}, {"row": null}]
    // i.e. a header row + a separator row mixed in with the data row.
    // We pick the first row whose `row[0]` is an object with a `count` key.
    for (const row of r.rows) {
      const inner = (row as { row?: unknown[] }).row?.[0];
      if (inner && typeof inner === "object" && "count" in (inner as Record<string, unknown>)) {
        return { ok: true, count: Number((inner as { count: number }).count) };
      }
    }
    return { ok: false, error: "no count row found" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "query failed" };
  }
}

router.get("/admin/graphiti/counts", requireAdmin, async (_req: Request, res: Response) => {
  if (!isGraphitiAvailable()) {
    res.status(503).json({
      graphitiConfigured: false,
      graphitiEnabled: false,
      error: "GRAPHITI_MCP_URL or GRAPHITI_MCP_API_KEY not set",
    });
    return;
  }

  const labels = ["Capability", "Entity", "Episodic"];
  const relationships = ["DEPENDS_ON", "CO_OCCURS_WITH", "MENTIONS", "RELATES_TO"];

  const [labelResults, relResults] = await Promise.all([
    Promise.all(labels.map(async (l) => [l, await countQuery(`MATCH (n:\`${l}\`) RETURN count(n) AS count`)] as const)),
    Promise.all(relationships.map(async (r) => [r, await countQuery(`MATCH ()-[r:\`${r}\`]->() RETURN count(r) AS count`)] as const)),
  ]);

  res.json({
    graphitiConfigured: true,
    graphitiEnabled: isGraphitiEnabled(),
    nodes: Object.fromEntries(labelResults),
    relationships: Object.fromEntries(relResults),
    checkedAt: new Date().toISOString(),
  });
});

export default router;
