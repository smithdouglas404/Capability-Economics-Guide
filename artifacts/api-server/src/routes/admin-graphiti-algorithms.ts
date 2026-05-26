/**
 * Admin read path — FalkorDB graph-algorithm snapshot.
 *
 *   GET /api/admin/graphiti/algorithms
 *     Returns top-10 PageRank scores + community-size distribution.
 *     1h in-memory cache (see services/capability-graph-algorithms.ts).
 *
 *   This is the operator-facing view of FalkorDB's built-in graph
 *   algorithms (PageRank, CDLP). The same primitives power the
 *   `systemicImportance` field surfaced on /api/disruption/:capabilityId
 *   responses — this route gives a global view in case an admin wants
 *   to spot-check the top of the leaderboard.
 *
 *   Returns 503 when Graphiti is not configured. Includes an empty
 *   snapshot rather than erroring when the flag is on but the graph is
 *   empty (e.g. pre-backfill) — operators get to see the "n: 0" state.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { isGraphitiAvailable } from "../lib/graphiti-client";
import { getAlgorithmsSnapshot } from "../services/capability-graph-algorithms";

const router: IRouter = Router();

router.get("/admin/graphiti/algorithms", requireAdmin, async (_req: Request, res: Response) => {
  if (!isGraphitiAvailable()) {
    res.status(503).json({
      graphitiConfigured: false,
      error: "GRAPHITI_MCP_URL or GRAPHITI_MCP_API_KEY not set",
    });
    return;
  }
  try {
    const snapshot = await getAlgorithmsSnapshot();
    res.json({ graphitiConfigured: true, ...snapshot });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "snapshot failed" });
  }
});

export default router;
