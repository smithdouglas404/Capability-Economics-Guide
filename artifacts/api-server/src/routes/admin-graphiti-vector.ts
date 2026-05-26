/**
 * Admin endpoints for the FalkorDB vector index over :Capability.
 *
 *   POST /api/admin/graphiti/vector/init
 *     Idempotently creates the vector index on (:Capability).embedding
 *     with dimension=1536 + cosine similarity. Safe to call on every
 *     boot or whenever a fresh FalkorDB needs to be re-bootstrapped.
 *     Reports `alreadyExisted` so operators can tell what happened.
 *
 *   POST /api/admin/graphiti/vector/search
 *     body: { "query": "free-text query", "k"?: number }  (k default 10, max 50)
 *     Embeds the query via OpenAI text-embedding-3-small and returns
 *     the top-k closest :Capability nodes by cosine similarity. Returns
 *     an empty list when:
 *       - no embeddings have been written yet (pre-backfill)
 *       - OPENAI_API_KEY is missing
 *       - USE_GRAPHITI_WORLD_MODEL is off
 *     Each result has { pgId, name, score, similarity } where
 *     similarity = 1 - score for the friendlier 0-1 reading.
 *
 *   Both routes require x-admin-key (or ADMIN_AUTH_BYPASS=1 in dev).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireAdmin } from "../middlewares/requireAdmin";
import {
  ensureVectorIndex,
  searchCapabilitiesByText,
  isVectorSearchAvailable,
} from "../services/capability-graph-vector";

const router: IRouter = Router();

const SearchBody = z.object({
  query: z.string().min(1).max(2000),
  k: z.number().int().min(1).max(50).optional(),
});

router.post("/admin/graphiti/vector/init", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await ensureVectorIndex();
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "init failed" });
  }
});

router.post("/admin/graphiti/vector/search", requireAdmin, async (req: Request, res: Response) => {
  const parsed = SearchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.issues });
    return;
  }
  if (!isVectorSearchAvailable()) {
    res.status(503).json({
      available: false,
      reason:
        "Either OPENAI_API_KEY is unset OR USE_GRAPHITI_WORLD_MODEL is not 1 OR Graphiti MCP is not reachable.",
      results: [],
    });
    return;
  }
  try {
    const hits = await searchCapabilitiesByText(parsed.data.query, parsed.data.k ?? 10);
    res.json({
      available: true,
      query: parsed.data.query,
      k: parsed.data.k ?? 10,
      count: hits.length,
      results: hits.map((h) => ({
        pgId: h.pgId,
        name: h.name ?? null,
        score: h.score,
        similarity: Math.max(0, Math.min(1, 1 - h.score)),
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "search failed" });
  }
});

export default router;
