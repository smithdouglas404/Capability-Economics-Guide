/**
 * Admin write paths for the Disruption Index.
 *
 *   POST /api/admin/disruption-index/recompute/:capabilityId
 *     Force a fresh DI computation for one capability. Persists. Useful
 *     after an alpha enrichment lands new margin / capex data, or after a
 *     manual edit to the playbook archetypes table.
 *
 *   POST /api/admin/disruption-index/recompute-all
 *     body: { stalenessDays?, limit? }
 *     Walk stale-DI leaf capabilities (>N days or null), recompute each.
 *     Sync (NOT Inngest-fired) — bounded by `limit` (default 5) so the
 *     request stays under Railway's HTTP timeout. For full sweeps prefer
 *     the autoDisruptionIndexCron Inngest function.
 *
 *   POST /api/admin/disruption-index/run-agent
 *     Fire the disruption-vector-agent inline. Returns the agent's output.
 */
import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../middlewares/requireAdmin";
import { scoreCapabilityDisruption, persistDisruptionScore, listStaleCapabilityIds } from "../services/disruption-index";
import { composeDisruptionNarrative, findCandidateDisruptors } from "../services/disruption-narrative";
import { runDisruptionVectorAgentAgentKit } from "../services/disruption-vector-agent-agentkit";
import { db, capabilitiesTable, industriesTable, disruptionPlaybookArchetypesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

async function recomputeOne(capabilityId: number): Promise<{ capabilityId: number; ok: boolean; compositeDi?: number; error?: string }> {
  try {
    const result = await scoreCapabilityDisruption(capabilityId);
    if (!result) return { capabilityId, ok: false, error: "capability not found" };

    const [cap] = await db
      .select({ name: capabilitiesTable.name, industryId: capabilitiesTable.industryId })
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.id, capabilityId))
      .limit(1);
    if (!cap) return { capabilityId, ok: false, error: "cap row missing" };

    const [industry] = await db
      .select({ name: industriesTable.name })
      .from(industriesTable)
      .where(eq(industriesTable.id, cap.industryId))
      .limit(1);
    const [archetype] = result.topPlaybookId
      ? await db
          .select()
          .from(disruptionPlaybookArchetypesTable)
          .where(eq(disruptionPlaybookArchetypesTable.id, result.topPlaybookId))
          .limit(1)
      : [];

    const candidates = await findCandidateDisruptors(capabilityId, cap.industryId, 5);
    const narrative = await composeDisruptionNarrative(
      result,
      cap.name,
      industry?.name ?? "Unknown industry",
      archetype ?? null,
      candidates,
    );
    await persistDisruptionScore(result, narrative, candidates, null);
    return { capabilityId, ok: true, compositeDi: result.compositeDi };
  } catch (err) {
    return { capabilityId, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

router.post("/admin/disruption-index/recompute/:capabilityId", requireAdmin, async (req: Request, res: Response) => {
  const capabilityId = Number(req.params.capabilityId);
  if (!Number.isFinite(capabilityId) || capabilityId <= 0) {
    res.status(400).json({ error: "invalid capability id" });
    return;
  }
  const result = await recomputeOne(capabilityId);
  res.status(result.ok ? 200 : 500).json(result);
});

router.post("/admin/disruption-index/recompute-all", requireAdmin, async (req: Request, res: Response) => {
  try {
    const stalenessDays = Number(req.body?.stalenessDays ?? 7);
    const limit = Math.min(20, Math.max(1, Number(req.body?.limit ?? 5)));
    const ids = await listStaleCapabilityIds(stalenessDays, limit);
    if (ids.length === 0) {
      res.json({ ok: true, scored: 0, message: "No stale capabilities" });
      return;
    }
    const results: Array<Awaited<ReturnType<typeof recomputeOne>>> = [];
    for (const id of ids) {
      results.push(await recomputeOne(id));
    }
    const okCount = results.filter((r) => r.ok).length;
    res.json({ ok: true, scored: okCount, attempted: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/admin/disruption-index/run-agent", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await runDisruptionVectorAgentAgentKit();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
