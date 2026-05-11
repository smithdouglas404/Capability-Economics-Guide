import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { searchCapabilities, findSimilarToCapability } from "../services/semantic-search";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SearchQuery = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  leafOnly: z.union([z.literal("1"), z.literal("true")]).optional(),
  includePending: z.union([z.literal("1"), z.literal("true")]).optional(),
  industryId: z.coerce.number().int().positive().optional(),
});

router.get("/search/capabilities", async (req, res) => {
  const parsed = SearchQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
    return;
  }
  try {
    const result = await searchCapabilities({
      query: parsed.data.q,
      limit: parsed.data.limit,
      leafOnly: parsed.data.leafOnly === "1" || parsed.data.leafOnly === "true",
      includePending: parsed.data.includePending === "1" || parsed.data.includePending === "true",
      industryId: parsed.data.industryId,
    });
    res.set("Cache-Control", "public, max-age=60");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "semantic search failed");
    res.status(500).json({ error: "Search failed" });
  }
});

router.get("/capabilities/:id/similar", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid capability id" });
    return;
  }
  const limit = req.query.limit ? Math.min(100, Math.max(1, Number(req.query.limit))) : 10;
  try {
    const results = await findSimilarToCapability(id, limit);
    res.set("Cache-Control", "public, max-age=300");
    res.json({ results });
  } catch (err) {
    logger.error({ err, id }, "similar capabilities failed");
    res.status(500).json({ error: "Similarity search failed" });
  }
});

export default router;
