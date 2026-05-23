/**
 * Synthesis + temporal-shift brief endpoint.
 *
 * The Synthesis Agent writes a daily cross-agent strategic brief to
 * `kv_cache` under key `synthesis_brief:latest` (composed by
 * services/synthesis-agent.ts after all 5 specialized agents complete
 * their cycles). The temporal-shift detector writes its 6-hourly
 * accelerating/reversing-relationship report under `temporal_shifts:latest`.
 *
 * Until this route shipped, both were invisible to the UI — only the
 * health probe read them. This exposes both via a single public endpoint
 * so any page (CVI dashboard, knowledge graph, regulations, scorecard,
 * alpha) can surface the platform's own synthesized view.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { getKvCache } from "../services/agent/store";
import { runSynthesisAgent } from "../services/synthesis-agent";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

interface SynthesisBriefPayload {
  brief: string;
  keyFindings: string[];
  crossAgentInsights: string[];
  generatedAt: string;
}

interface TemporalShiftPayload {
  accelerating?: Array<{ subject: string; predicate: string; object: string; trend: string; signalStrength: number }>;
  reversing?: Array<{ subject: string; predicate: string; object: string; trend: string; signalStrength: number }>;
  generatedAt?: string;
  summary?: string;
  // Tolerant — the temporal-shift report payload has evolved over the project.
  [key: string]: unknown;
}

router.get("/synthesis/brief", async (_req, res) => {
  try {
    const [synthesis, temporal] = await Promise.all([
      getKvCache<SynthesisBriefPayload>("synthesis_brief:latest"),
      getKvCache<TemporalShiftPayload>("temporal_shifts:latest"),
    ]);

    if (!synthesis && !temporal) {
      res.status(200).json({
        available: false,
        message: "Synthesis brief not yet generated. The synthesis agent runs daily after the five specialized agents complete their cycles.",
      });
      return;
    }

    res.json({
      available: true,
      synthesis: synthesis
        ? {
            ...synthesis.value,
            cachedAt: synthesis.updatedAt,
          }
        : null,
      temporalShifts: temporal
        ? {
            ...temporal.value,
            cachedAt: temporal.updatedAt,
          }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Manual trigger for the synthesis agent. Normally runs on a daily cron after
 * the 5 specialized agents complete their cycles. Admin-protected — kicks off
 * a full Sonnet-class cycle (~30s) and returns the result inline.
 *
 * Useful when seeding a fresh deploy or when an operator wants to refresh the
 * brief immediately after the specialized agents have advanced.
 *
 *   POST /api/admin/synthesis/run
 *     headers: x-admin-key: $ADMIN_API_KEY
 *     response: { ok, brief, durationMs }
 */
router.post("/admin/synthesis/run", requireAdmin, async (_req: Request, res: Response) => {
  const start = Date.now();
  try {
    const result = await runSynthesisAgent();
    res.json({
      ok: true,
      result,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start });
  }
});

export default router;
