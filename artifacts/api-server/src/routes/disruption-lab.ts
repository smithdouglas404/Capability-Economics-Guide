/**
 * Disruption Lab API — interactive write paths for /disruption-lab.
 *
 *   POST /api/disruption-lab/recompute-scenario
 *     body: { capabilityId, appliedTechIds: number[] }
 *     Recomputes the DI under an alt-stack of enabling techs (drag-drop UI).
 *     No DB write. Returns the recomputed sub-scores + composite + playbook
 *     similarity + topEnablingTech.
 *
 *   POST /api/disruption-lab/from-pitch
 *     body: { pitch: string }
 *     Conversational entry mode. Sends the pitch text to Claude with the
 *     catalog of capabilities + enabling techs and asks it to extract:
 *       { targetCapabilityId, appliedTechIds[], rationale }
 *     Then runs recompute-scenario with the extracted set and returns both
 *     the extraction (so the user can correct it) and the resulting DI.
 *
 *   POST /api/disruption-lab/scenarios
 *     body: { name, description?, targetCapabilityId, appliedTechIds[],
 *             pitchSource?, origin? }
 *     Save the resolved scenario to disruption_lab_scenarios. Requires
 *     Clerk auth. Re-runs scoring to snapshot the resolved sub-scores at
 *     save time so the saved row is self-contained.
 *
 *   GET /api/disruption-lab/scenarios
 *     List the signed-in user's saved scenarios. Returns the saved
 *     snapshot — call recompute-scenario explicitly to refresh.
 *
 *   GET /api/disruption-lab/scenarios/:id
 *     Single scenario detail. Owner only.
 *
 *   DELETE /api/disruption-lab/scenarios/:id
 *     Delete one of your own scenarios.
 */
import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  disruptionLabScenariosTable,
  capabilitiesTable,
  industriesTable,
  disruptionEnablingTechTable,
  disruptionPlaybookArchetypesTable,
  type DisruptionSubscoreProfile,
} from "@workspace/db";
import { eq, and, desc, ilike, sql } from "drizzle-orm";
import { scoreCapabilityDisruption } from "../services/disruption-index";
import { chatWithFallback } from "../services/llm-fallback";
import { logger } from "../lib/logger";

const router = Router();
const SONNET = "anthropic/claude-sonnet-4.6";
const HAIKU = "anthropic/claude-haiku-4.5";

// ─── POST /api/disruption-lab/recompute-scenario ────────────────────────
router.post("/disruption-lab/recompute-scenario", async (req: Request, res: Response) => {
  try {
    const capabilityId = Number(req.body?.capabilityId);
    const appliedTechIds = Array.isArray(req.body?.appliedTechIds)
      ? req.body.appliedTechIds.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    if (!Number.isFinite(capabilityId) || capabilityId <= 0) {
      res.status(400).json({ error: "capabilityId required" });
      return;
    }

    const result = await scoreCapabilityDisruption(capabilityId, { appliedTechIds });
    if (!result) {
      res.status(404).json({ error: `capability ${capabilityId} not found` });
      return;
    }

    res.json({
      capabilityId,
      appliedTechIds,
      subscores: result.subscores,
      compositeDi: result.compositeDi,
      rationale: result.rationale,
      topPlaybookId: result.topPlaybookId,
      topPlaybookName: result.topPlaybookName,
      topPlaybookSimilarity: result.topPlaybookSimilarity,
      playbookSimilarities: result.playbookSimilarities,
      topEnablingTech: result.topEnablingTech,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── POST /api/disruption-lab/from-pitch ─────────────────────────────────
router.post("/disruption-lab/from-pitch", async (req: Request, res: Response) => {
  try {
    const pitch = typeof req.body?.pitch === "string" ? req.body.pitch.trim() : "";
    if (pitch.length < 30) {
      res.status(400).json({ error: "pitch must be at least 30 characters" });
      return;
    }
    if (pitch.length > 8000) {
      res.status(400).json({ error: "pitch must be 8000 characters or fewer" });
      return;
    }

    // Load the catalogs the LLM picks from. Capability list is large (~350)
    // so we send only id + name + industry + slug. Enabling-tech is small.
    const [caps, techs] = await Promise.all([
      db
        .select({
          id: capabilitiesTable.id,
          name: capabilitiesTable.name,
          industryId: capabilitiesTable.industryId,
          industryName: industriesTable.name,
        })
        .from(capabilitiesTable)
        .innerJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId))
        .where(eq(capabilitiesTable.isLeaf, true)),
      db.select().from(disruptionEnablingTechTable),
    ]);

    if (caps.length === 0 || techs.length === 0) {
      res.status(503).json({ error: "DI catalogs not yet seeded — run admin seeds first" });
      return;
    }

    const capMenu = caps
      .slice(0, 400) // bound prompt size
      .map((c) => `[${c.id}] ${c.name} (${c.industryName})`)
      .join("\n");
    const techMenu = techs.map((t) => `[${t.id}] ${t.name} — ${t.category}`).join("\n");

    const system = `You are extracting structured DI-lab inputs from a startup pitch. Given the catalogs below and a pitch text, identify:
  - The TARGET capability the pitch is disrupting (one id from the capability catalog). Pick the SINGLE best match. If the pitch describes a brand-new capability not in the catalog, pick the closest existing one and note the gap in rationale.
  - The applied enabling-tech stack (up to 5 ids from the tech catalog) the pitch's described approach leverages.
  - A 1-2 sentence rationale explaining the picks.

Return ONLY valid JSON: { "targetCapabilityId": N, "appliedTechIds": [N, ...], "rationale": "..." }`;

    const user = `## Pitch
${pitch}

## Capability catalog (pick ONE id)
${capMenu}

## Enabling tech catalog (pick up to 5 ids)
${techMenu}

Return the JSON.`;

    const llm = await chatWithFallback({
      models: [SONNET, HAIKU],
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      responseFormat: { type: "json_object" },
      maxTokens: 600,
      endpoint: "disruption_index:from_pitch",
    });

    let parsed: { targetCapabilityId?: number; appliedTechIds?: number[]; rationale?: string };
    try {
      const clean = llm.text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      parsed = JSON.parse(clean);
    } catch (err) {
      logger.warn({ err, text: llm.text.slice(0, 200) }, "[from-pitch] LLM returned non-JSON");
      res.status(502).json({ error: "Couldn't parse the extraction. Try the manual mode." });
      return;
    }

    const capId = Number(parsed.targetCapabilityId);
    if (!Number.isFinite(capId) || !caps.find((c) => c.id === capId)) {
      res.status(400).json({
        error: "LLM didn't pick a valid capability id. Try a more specific pitch.",
        extraction: parsed,
      });
      return;
    }

    const techIds = (parsed.appliedTechIds ?? [])
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && techs.find((t) => t.id === n))
      .slice(0, 5);

    // Score the extracted scenario.
    const result = await scoreCapabilityDisruption(capId, { appliedTechIds: techIds });
    if (!result) {
      res.status(500).json({ error: "Scoring failed after extraction" });
      return;
    }

    const cap = caps.find((c) => c.id === capId);
    res.json({
      extraction: {
        targetCapabilityId: capId,
        targetCapabilityName: cap?.name ?? null,
        targetIndustryName: cap?.industryName ?? null,
        appliedTechIds: techIds,
        appliedTechNames: techIds.map((id) => techs.find((t) => t.id === id)?.name).filter(Boolean),
        rationale: parsed.rationale ?? "",
      },
      scenario: {
        capabilityId: capId,
        appliedTechIds: techIds,
        subscores: result.subscores,
        compositeDi: result.compositeDi,
        rationale: result.rationale,
        topPlaybookId: result.topPlaybookId,
        topPlaybookName: result.topPlaybookName,
        topPlaybookSimilarity: result.topPlaybookSimilarity,
        playbookSimilarities: result.playbookSimilarities,
        topEnablingTech: result.topEnablingTech,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── POST /api/disruption-lab/scenarios (save) ──────────────────────────
router.post("/disruption-lab/scenarios", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      res.status(401).json({ error: "Sign in to save scenarios" });
      return;
    }

    const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 200) : "";
    const description = typeof req.body?.description === "string" ? req.body.description.trim().slice(0, 2000) : null;
    const targetCapabilityId = Number(req.body?.targetCapabilityId);
    const appliedTechIds = Array.isArray(req.body?.appliedTechIds)
      ? req.body.appliedTechIds.map((x: unknown) => Number(x)).filter((n: number) => Number.isFinite(n) && n > 0)
      : [];
    const pitchSource = typeof req.body?.pitchSource === "string" ? req.body.pitchSource.slice(0, 8000) : null;
    const origin = req.body?.origin === "pitch" ? "pitch" : "manual";

    if (!name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    if (!Number.isFinite(targetCapabilityId) || targetCapabilityId <= 0) {
      res.status(400).json({ error: "targetCapabilityId required" });
      return;
    }

    // Score AT SAVE TIME so the snapshot is reproducible later.
    const result = await scoreCapabilityDisruption(targetCapabilityId, { appliedTechIds });
    if (!result) {
      res.status(404).json({ error: `capability ${targetCapabilityId} not found` });
      return;
    }

    const [inserted] = await db
      .insert(disruptionLabScenariosTable)
      .values({
        userId: auth.userId,
        name,
        description,
        targetCapabilityId,
        appliedTechIds,
        resolvedSubscores: result.subscores as DisruptionSubscoreProfile,
        resolvedCompositeDi: result.compositeDi,
        resolvedTopPlaybookId: result.topPlaybookId,
        pitchSource,
        origin,
      })
      .returning();

    res.json({ scenario: inserted });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── GET /api/disruption-lab/scenarios (list mine) ───────────────────────
router.get("/disruption-lab/scenarios", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      res.status(401).json({ error: "Sign in to view your scenarios" });
      return;
    }
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));

    const rows = await db
      .select({
        id: disruptionLabScenariosTable.id,
        name: disruptionLabScenariosTable.name,
        description: disruptionLabScenariosTable.description,
        targetCapabilityId: disruptionLabScenariosTable.targetCapabilityId,
        appliedTechIds: disruptionLabScenariosTable.appliedTechIds,
        resolvedCompositeDi: disruptionLabScenariosTable.resolvedCompositeDi,
        resolvedTopPlaybookId: disruptionLabScenariosTable.resolvedTopPlaybookId,
        origin: disruptionLabScenariosTable.origin,
        createdAt: disruptionLabScenariosTable.createdAt,
        capabilityName: capabilitiesTable.name,
        industryName: industriesTable.name,
        playbookName: disruptionPlaybookArchetypesTable.name,
      })
      .from(disruptionLabScenariosTable)
      .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, disruptionLabScenariosTable.targetCapabilityId))
      .innerJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId))
      .leftJoin(disruptionPlaybookArchetypesTable, eq(disruptionPlaybookArchetypesTable.id, disruptionLabScenariosTable.resolvedTopPlaybookId))
      .where(
        search
          ? and(eq(disruptionLabScenariosTable.userId, auth.userId), ilike(disruptionLabScenariosTable.name, `%${search}%`))
          : eq(disruptionLabScenariosTable.userId, auth.userId),
      )
      .orderBy(desc(disruptionLabScenariosTable.createdAt))
      .limit(limit);

    res.json({ scenarios: rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── GET /api/disruption-lab/scenarios/:id ───────────────────────────────
router.get("/disruption-lab/scenarios/:id", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      res.status(401).json({ error: "Sign in" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const [row] = await db
      .select()
      .from(disruptionLabScenariosTable)
      .where(and(eq(disruptionLabScenariosTable.id, id), eq(disruptionLabScenariosTable.userId, auth.userId)))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Not found or not yours" });
      return;
    }
    res.json({ scenario: row });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── DELETE /api/disruption-lab/scenarios/:id ────────────────────────────
router.delete("/disruption-lab/scenarios/:id", async (req: Request, res: Response) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      res.status(401).json({ error: "Sign in" });
      return;
    }
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "invalid id" });
      return;
    }
    const result = await db
      .delete(disruptionLabScenariosTable)
      .where(and(eq(disruptionLabScenariosTable.id, id), eq(disruptionLabScenariosTable.userId, auth.userId)))
      .returning({ id: disruptionLabScenariosTable.id });
    if (result.length === 0) {
      res.status(404).json({ error: "Not found or not yours" });
      return;
    }
    res.json({ ok: true, deleted: id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
