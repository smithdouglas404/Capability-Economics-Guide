import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getCachedSchemaStatus, verifySchema } from "../lib/schema-check";
import { getAllServiceHealth } from "../services/health/probes";

const router: IRouter = Router();

/**
 * Aggregated upstream service health — Mem0, Letta, OpenRouter, Anthropic,
 * Perplexity, Foundry, Stripe, Clerk. Cached 60s per service; never blocks
 * page load. Drives the dismissible degraded-mode banner and `/system-status`
 * detail page on the frontend.
 */
router.get("/health/services", async (_req, res) => {
  try {
    const result = await getAllServiceHealth();
    res.json(result);
  } catch (err) {
    res.status(500).json({
      overall: "down",
      services: [],
      generatedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

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
