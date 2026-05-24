/**
 * Disruption Simulator API.
 *
 *   POST /api/disruption-simulator/run
 *     Compute a trajectory. No DB write. Returns the full SimulationResult.
 *
 *   POST /api/disruption-simulator/from-pitch
 *     Conversational entry — pitch text → LLM extracts entrant fields →
 *     runs the simulation.
 *
 *   POST /api/disruption-simulator/scenarios
 *     Save the resolved scenario for the signed-in user.
 *
 *   GET /api/disruption-simulator/scenarios
 *     List my saved scenarios.
 *
 *   GET /api/disruption-simulator/scenarios/:id
 *     Single scenario detail (owner only).
 *
 *   DELETE /api/disruption-simulator/scenarios/:id
 *     Delete owned scenario.
 *
 *   POST /api/disruption-simulator/scenarios/:id/fork
 *     Fork an existing scenario as a starting point for a new one.
 */
import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  disruptionSimulationsTable,
  capabilitiesTable,
  industriesTable,
  disruptionEnablingTechTable,
  disruptionPlaybookArchetypesTable,
  type DisruptionSubscoreProfile,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  runSimulation,
  type SimulationInput,
  type AdoptionCurve,
  type CapitalTier,
  type DefenderResponse,
} from "../services/disruption-simulator";
import { chatWithFallback } from "../services/llm-fallback";
import { logger } from "../lib/logger";

const router = Router();
const SONNET = "anthropic/claude-sonnet-4.6";
const HAIKU = "anthropic/claude-haiku-4.5";

const VALID_CURVES: AdoptionCurve[] = ["slow_burn", "standard_b2b_saas", "viral_b2c", "stripe_dev"];
const VALID_CAPITAL: CapitalTier[] = ["bootstrap", "seed", "series_b", "mega_fund"];
const VALID_DEFENDER: DefenderResponse[] = ["none", "acquire", "build", "lobby_regulatory"];

function parseInput(body: Record<string, unknown>): SimulationInput {
  const entrantName = typeof body.entrantName === "string" ? body.entrantName.trim().slice(0, 200) : "";
  const entrantJtbd = typeof body.entrantJtbd === "string" ? body.entrantJtbd.trim().slice(0, 600) : "";
  const entrantTechIds = Array.isArray(body.entrantTechIds) ? (body.entrantTechIds as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 8) : [];
  const targetCapabilityIds = Array.isArray(body.targetCapabilityIds) ? (body.targetCapabilityIds as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 5) : [];
  const adoptionCurve = (VALID_CURVES.includes(body.adoptionCurve as AdoptionCurve) ? body.adoptionCurve : "standard_b2b_saas") as AdoptionCurve;
  const capitalTier = (VALID_CAPITAL.includes(body.capitalTier as CapitalTier) ? body.capitalTier : "seed") as CapitalTier;
  const defenderResponse = (VALID_DEFENDER.includes(body.defenderResponse as DefenderResponse) ? body.defenderResponse : "none") as DefenderResponse;
  const regulatoryFrictionMonths = Math.max(0, Math.min(60, Number(body.regulatoryFrictionMonths) || 0));
  const horizonMonths = Math.max(1, Math.min(60, Number(body.horizonMonths) || 36));
  const substitutionFactor = Math.max(0.1, Math.min(1, Number(body.substitutionFactor) || 0.7));
  const baselineCviOverride = typeof body.baselineCviOverride === "number" ? Math.max(0, Math.min(100, body.baselineCviOverride)) : undefined;

  if (!entrantName) throw new Error("entrantName required");
  if (!entrantJtbd) throw new Error("entrantJtbd required");
  if (targetCapabilityIds.length === 0) throw new Error("targetCapabilityIds must include at least one cap");

  return {
    entrantName,
    entrantJtbd,
    entrantTechIds,
    targetCapabilityIds,
    adoptionCurve,
    capitalTier,
    regulatoryFrictionMonths,
    horizonMonths,
    substitutionFactor,
    defenderResponse,
    baselineCviOverride,
  };
}

// ─── POST /api/disruption-simulator/run ─────────────────────────────────
router.post("/disruption-simulator/run", async (req: Request, res: Response) => {
  try {
    const input = parseInput(req.body ?? {});
    const result = await runSimulation(input);
    res.json({ input, ...result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── POST /api/disruption-simulator/from-pitch ──────────────────────────
router.post("/disruption-simulator/from-pitch", async (req: Request, res: Response) => {
  try {
    const pitch = typeof req.body?.pitch === "string" ? req.body.pitch.trim() : "";
    if (pitch.length < 30) { res.status(400).json({ error: "pitch must be at least 30 characters" }); return; }
    if (pitch.length > 8000) { res.status(400).json({ error: "pitch must be 8000 characters or fewer" }); return; }

    const [caps, techs] = await Promise.all([
      db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name, industryName: industriesTable.name })
        .from(capabilitiesTable)
        .innerJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId))
        .where(eq(capabilitiesTable.isLeaf, true)),
      db.select().from(disruptionEnablingTechTable),
    ]);

    const capMenu = caps.slice(0, 400).map((c) => `[${c.id}] ${c.name} (${c.industryName})`).join("\n");
    const techMenu = techs.map((t) => `[${t.id}] ${t.name} — ${t.category}`).join("\n");

    const system = `You are extracting structured disruption-simulator inputs from a startup pitch. Identify:
  - entrantName: 4-12 word name for the disruptive capability
  - entrantJtbd: 1-sentence Job-To-Be-Done in capability-economics terms
  - targetCapabilityIds: 1-3 incumbent cap ids the entrant would replace
  - entrantTechIds: 3-5 enabling-tech ids the pitch's approach leverages
  - adoptionCurve: one of slow_burn / standard_b2b_saas / viral_b2c / stripe_dev — best fit
  - capitalTier: one of bootstrap / seed / series_b / mega_fund — best inferred from the pitch
  - regulatoryFrictionMonths: 0-36, regulatory delay before adoption can start
  - substitutionFactor: 0.1-1.0, how perfectly the entrant replaces incumbent demand
  - rationale: 1-2 sentence explanation

Return ONLY valid JSON.`;

    const user = `## Pitch
${pitch}

## Capability catalog (pick 1-3 target ids)
${capMenu}

## Enabling tech catalog (pick 3-5 ids)
${techMenu}

Return the JSON now.`;

    const llm = await chatWithFallback({
      models: [SONNET, HAIKU],
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      responseFormat: { type: "json_object" },
      maxTokens: 800,
      endpoint: "disruption_simulator:from_pitch",
    });

    let parsed: Partial<SimulationInput> & { rationale?: string };
    try {
      const clean = llm.text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      parsed = JSON.parse(clean);
    } catch (err) {
      logger.warn({ err }, "[dsim from-pitch] LLM returned non-JSON");
      res.status(502).json({ error: "Couldn't parse the extraction. Try the manual mode." });
      return;
    }

    const validTargetIds = (parsed.targetCapabilityIds ?? []).filter((id) => caps.find((c) => c.id === id));
    const validTechIds = (parsed.entrantTechIds ?? []).filter((id) => techs.find((t) => t.id === id));

    if (validTargetIds.length === 0) {
      res.status(400).json({
        error: "LLM didn't pick valid target capabilities. Try a more specific pitch.",
        extraction: parsed,
      });
      return;
    }

    const input: SimulationInput = {
      entrantName: (parsed.entrantName ?? "Hypothetical disruptor").slice(0, 200),
      entrantJtbd: (parsed.entrantJtbd ?? pitch.slice(0, 300)).slice(0, 600),
      entrantTechIds: validTechIds.slice(0, 8),
      targetCapabilityIds: validTargetIds.slice(0, 5),
      adoptionCurve: (VALID_CURVES.includes(parsed.adoptionCurve as AdoptionCurve) ? parsed.adoptionCurve : "standard_b2b_saas") as AdoptionCurve,
      capitalTier: (VALID_CAPITAL.includes(parsed.capitalTier as CapitalTier) ? parsed.capitalTier : "seed") as CapitalTier,
      defenderResponse: "none",
      regulatoryFrictionMonths: Math.max(0, Math.min(36, Number(parsed.regulatoryFrictionMonths) || 0)),
      horizonMonths: 36,
      substitutionFactor: Math.max(0.1, Math.min(1, Number(parsed.substitutionFactor) || 0.7)),
    };

    const result = await runSimulation(input);

    res.json({
      extraction: { ...parsed, validTargetIds, validTechIds },
      input,
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── POST /api/disruption-simulator/scenarios — save ────────────────────
router.post("/disruption-simulator/scenarios", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Sign in to save" }); return; }

    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : "";
    const description = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 2000) : null;
    const pitchSource = typeof req.body?.pitchSource === "string" ? req.body.pitchSource.slice(0, 8000) : null;
    const origin = ["manual", "pitch", "fork-of-lab", "fork-of-sim"].includes(req.body?.origin) ? req.body.origin : "manual";
    const parentSimulationId = Number(req.body?.parentSimulationId) || null;

    if (!name) { res.status(400).json({ error: "name required" }); return; }

    const input = parseInput(req.body ?? {});
    const result = await runSimulation(input);

    const [inserted] = await db
      .insert(disruptionSimulationsTable)
      .values({
        userId: auth.userId,
        name,
        description,
        entrantName: input.entrantName,
        entrantJtbd: input.entrantJtbd,
        entrantTechIds: input.entrantTechIds,
        targetCapabilityIds: input.targetCapabilityIds,
        adoptionCurve: input.adoptionCurve,
        capitalTier: input.capitalTier,
        regulatoryFrictionMonths: input.regulatoryFrictionMonths,
        horizonMonths: input.horizonMonths,
        substitutionFactor: input.substitutionFactor,
        defenderResponse: input.defenderResponse,
        crossoverMonth: result.crossoverMonth,
        finalEntrantShare: result.finalEntrantShare,
        totalDollarsDisruptedMm: result.totalDollarsDisruptedMm,
        trajectory: result.trajectory,
        cascade: result.cascade,
        defenderOptions: result.defenderOptions,
        topPlaybookId: result.context.topPlaybookId,
        pitchSource,
        origin,
        parentSimulationId,
      })
      .returning();

    res.json({ scenario: inserted, result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── GET /api/disruption-simulator/scenarios — list mine ────────────────
router.get("/disruption-simulator/scenarios", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    const rows = await db
      .select({
        id: disruptionSimulationsTable.id,
        name: disruptionSimulationsTable.name,
        description: disruptionSimulationsTable.description,
        entrantName: disruptionSimulationsTable.entrantName,
        targetCapabilityIds: disruptionSimulationsTable.targetCapabilityIds,
        adoptionCurve: disruptionSimulationsTable.adoptionCurve,
        capitalTier: disruptionSimulationsTable.capitalTier,
        horizonMonths: disruptionSimulationsTable.horizonMonths,
        crossoverMonth: disruptionSimulationsTable.crossoverMonth,
        finalEntrantShare: disruptionSimulationsTable.finalEntrantShare,
        totalDollarsDisruptedMm: disruptionSimulationsTable.totalDollarsDisruptedMm,
        topPlaybookId: disruptionSimulationsTable.topPlaybookId,
        origin: disruptionSimulationsTable.origin,
        createdAt: disruptionSimulationsTable.createdAt,
      })
      .from(disruptionSimulationsTable)
      .where(eq(disruptionSimulationsTable.userId, auth.userId))
      .orderBy(desc(disruptionSimulationsTable.createdAt))
      .limit(limit);

    // Hydrate target cap names + playbook names.
    const allTargetIds = Array.from(new Set(rows.flatMap((r) => (r.targetCapabilityIds as number[]) ?? [])));
    const allPlaybookIds = Array.from(new Set(rows.flatMap((r) => r.topPlaybookId ? [r.topPlaybookId] : [])));
    const targetCaps = allTargetIds.length > 0
      ? await db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name }).from(capabilitiesTable).where(inArray(capabilitiesTable.id, allTargetIds))
      : [];
    const playbooks = allPlaybookIds.length > 0
      ? await db.select({ id: disruptionPlaybookArchetypesTable.id, name: disruptionPlaybookArchetypesTable.name }).from(disruptionPlaybookArchetypesTable).where(inArray(disruptionPlaybookArchetypesTable.id, allPlaybookIds))
      : [];
    const capMap = new Map(targetCaps.map((c) => [c.id, c.name]));
    const pbMap = new Map(playbooks.map((p) => [p.id, p.name]));

    const enriched = rows.map((r) => ({
      ...r,
      targetCapabilityNames: ((r.targetCapabilityIds as number[]) ?? []).flatMap((id) => capMap.get(id) ? [capMap.get(id)!] : []),
      topPlaybookName: r.topPlaybookId ? pbMap.get(r.topPlaybookId) ?? null : null,
    }));

    res.json({ scenarios: enriched });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── GET /api/disruption-simulator/scenarios/:id ────────────────────────
router.get("/disruption-simulator/scenarios/:id", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const [row] = await db
      .select()
      .from(disruptionSimulationsTable)
      .where(and(eq(disruptionSimulationsTable.id, id), eq(disruptionSimulationsTable.userId, auth.userId)))
      .limit(1);
    if (!row) { res.status(404).json({ error: "Not found or not yours" }); return; }
    res.json({ scenario: row });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── DELETE /api/disruption-simulator/scenarios/:id ─────────────────────
router.delete("/disruption-simulator/scenarios/:id", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const result = await db
      .delete(disruptionSimulationsTable)
      .where(and(eq(disruptionSimulationsTable.id, id), eq(disruptionSimulationsTable.userId, auth.userId)))
      .returning({ id: disruptionSimulationsTable.id });
    if (result.length === 0) { res.status(404).json({ error: "Not found or not yours" }); return; }
    res.json({ ok: true, deleted: id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── POST /api/disruption-simulator/scenarios/:id/fork ──────────────────
router.post("/disruption-simulator/scenarios/:id/fork", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { res.status(400).json({ error: "invalid id" }); return; }
    const [parent] = await db
      .select()
      .from(disruptionSimulationsTable)
      .where(and(eq(disruptionSimulationsTable.id, id), eq(disruptionSimulationsTable.userId, auth.userId)))
      .limit(1);
    if (!parent) { res.status(404).json({ error: "Not found or not yours" }); return; }

    // Return the parent payload — frontend pre-fills + lets user tweak then saves.
    res.json({
      forkFrom: parent.id,
      prefill: {
        name: `${parent.name} (fork)`,
        description: parent.description,
        entrantName: parent.entrantName,
        entrantJtbd: parent.entrantJtbd,
        entrantTechIds: parent.entrantTechIds,
        targetCapabilityIds: parent.targetCapabilityIds,
        adoptionCurve: parent.adoptionCurve,
        capitalTier: parent.capitalTier,
        regulatoryFrictionMonths: parent.regulatoryFrictionMonths,
        horizonMonths: parent.horizonMonths,
        substitutionFactor: parent.substitutionFactor,
        defenderResponse: parent.defenderResponse,
        origin: "fork-of-sim",
        parentSimulationId: parent.id,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
