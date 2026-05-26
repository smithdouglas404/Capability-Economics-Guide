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
    if (!r.ok) return { ok: false, error: r.error ?? "query failed" };
    // queryCypher unwraps the FalkorDB driver's 3-row block centrally, so
    // r.rows is `Array<Record<string, unknown>>` with the actual records.
    // An empty array is a legitimate "0" answer (no rows for a count(*) is
    // unusual — Cypher always returns one row — but we tolerate it).
    const first = r.rows?.[0];
    const raw = first && typeof first === "object" ? (first as Record<string, unknown>).count : 0;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return { ok: false, error: `count was not a finite number (got ${JSON.stringify(raw)})` };
    }
    return { ok: true, count: n };
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

  const allResults: CountResult[] = [
    ...labelResults.map(([, v]) => v),
    ...relResults.map(([, v]) => v),
  ];
  const partialFailure = allResults.some((r) => !r.ok);

  res.json({
    graphitiConfigured: true,
    graphitiEnabled: isGraphitiEnabled(),
    partialFailure,
    nodes: Object.fromEntries(labelResults),
    relationships: Object.fromEntries(relResults),
    checkedAt: new Date().toISOString(),
  });
});

export default router;
