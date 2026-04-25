import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getCachedSchemaStatus, verifySchema } from "../lib/schema-check";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

/**
 * Schema diagnostic — reports whether every load-bearing table exists. Runs
 * a fresh check if no boot-time result is cached. Used by the admin
 * Enrichment Health panel and by anyone debugging "why isn't this working?"
 * when a feature silently degrades.
 */
router.get("/healthz/schema", async (_req, res) => {
  const cached = getCachedSchemaStatus();
  if (cached) { res.json(cached); return; }
  try {
    const status = await verifySchema();
    res.json(status);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
