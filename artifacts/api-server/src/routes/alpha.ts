import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityDependenciesTable,
  capabilityQuadrantsTable,
  capabilityEconomicsTable,
  dependencyEdgeScoresTable,
  industriesTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { runAlphaEnrichment } from "../services/alpha/enrich";

const router = Router();

router.get("/status", async (_req: Request, res: Response) => {
  try {
    const [caps] = await db.select({ count: sql<number>`count(*)::int` }).from(capabilitiesTable);
    const [econ] = await db.select({ count: sql<number>`count(*)::int` }).from(capabilityEconomicsTable);
    const [deps] = await db.select({ count: sql<number>`count(*)::int` }).from(capabilityDependenciesTable);
    const [edgeScores] = await db.select({ count: sql<number>`count(*)::int` }).from(dependencyEdgeScoresTable);
    res.json({
      capabilities: caps?.count ?? 0,
      capabilitiesEnriched: econ?.count ?? 0,
      dependencies: deps?.count ?? 0,
      dependenciesScored: edgeScores?.count ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/enrich", async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    const expected = process.env.ADMIN_API_KEY;
    const provided = req.headers["x-admin-key"];
    if (!expected || typeof provided !== "string" || provided !== expected) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }
  const limitCapabilities = typeof req.body?.limitCapabilities === "number" ? req.body.limitCapabilities : 12;
  const limitEdges = typeof req.body?.limitEdges === "number" ? req.body.limitEdges : 15;
  const industryId = typeof req.body?.industryId === "number" ? req.body.industryId : undefined;
  try {
    const result = await runAlphaEnrichment({ limitCapabilities, limitEdges, industryId });
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Alpha enrichment failed";
    const status = msg.includes("already in progress") ? 409 : 500;
    res.status(status).json({ error: msg });
  }
});

router.get("/economics", async (req: Request, res: Response) => {
  try {
    const industryId = req.query.industryId ? parseInt(req.query.industryId as string) : undefined;
    const where = industryId ? eq(capabilityEconomicsTable.industryId, industryId) : undefined;
    const rows = where
      ? await db.select().from(capabilityEconomicsTable).where(where)
      : await db.select().from(capabilityEconomicsTable);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// EVaR: for each enriched capability, project $ at risk at 12/24/36 months
router.get("/evar", async (req: Request, res: Response) => {
  try {
    const industryId = req.query.industryId ? parseInt(req.query.industryId as string) : undefined;
    const where = industryId ? eq(capabilityEconomicsTable.industryId, industryId) : undefined;
    const econRows = where
      ? await db.select().from(capabilityEconomicsTable).where(where)
      : await db.select().from(capabilityEconomicsTable);
    const capIds = econRows.map(r => r.capabilityId);
    const caps = capIds.length > 0
      ? await db.select().from(capabilitiesTable).where(sql`${capabilitiesTable.id} IN (${sql.join(capIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    const capById = new Map(caps.map(c => [c.id, c]));
    const industries = await db.select().from(industriesTable);
    const indById = new Map(industries.map(i => [i.id, i.name]));
    const quadrantRows = capIds.length > 0
      ? await db.select().from(capabilityQuadrantsTable).where(sql`${capabilityQuadrantsTable.capabilityId} IN (${sql.join(capIds.map(id => sql`${id}`), sql`, `)})`)
      : [];
    const qByCapId = new Map(quadrantRows.map(q => [q.capabilityId, q]));

    const items = econRows.map(r => {
      const cap = capById.get(r.capabilityId);
      const q = qByCapId.get(r.capabilityId);
      const halfLife = r.halfLifeMonths ?? 36;
      const velocity = r.commoditizationVelocity ?? 0.2;
      const revenue = r.revenueExposureMm ?? r.tamUsdMm ?? 0;
      const margin = (r.marginStructurePct ?? 40) / 100;
      const disruption = q?.disruptionIntensity ?? 0.3;

      // Decay model: share of current differentiated margin that collapses by month t
      // fraction_lost(t) = 1 - 0.5^(t/halfLife) * (1 - velocity*disruption)^(t/12)
      // EVaR_$ = revenue * margin * fraction_lost(t)
      function fracLost(months: number): number {
        const halfLifeDecay = 1 - Math.pow(0.5, months / Math.max(6, halfLife));
        const marketErosion = 1 - Math.pow(1 - Math.min(0.95, velocity * (0.6 + disruption * 0.8)), months / 12);
        // combine conservatively: take the larger of the two
        return Math.max(halfLifeDecay, marketErosion);
      }

      const evar12 = revenue * margin * fracLost(12);
      const evar24 = revenue * margin * fracLost(24);
      const evar36 = revenue * margin * fracLost(36);

      // Confidence band: +/- depending on margin uncertainty and consensus confidence
      const confidence = r.consensusConfidence ?? 0.5;
      const bandPct = 0.15 + (1 - confidence) * 0.35;

      return {
        capabilityId: r.capabilityId,
        capabilityName: cap?.name ?? `#${r.capabilityId}`,
        industryId: r.industryId,
        industryName: indById.get(r.industryId) ?? "",
        tamUsdMm: r.tamUsdMm,
        revenueExposureMm: revenue,
        marginStructurePct: r.marginStructurePct,
        halfLifeMonths: halfLife,
        commoditizationVelocity: velocity,
        disruptionIntensity: disruption,
        quadrant: q?.quadrant ?? null,
        consensusQuadrant: r.consensusQuadrant,
        consensusConfidence: confidence,
        evar12: Math.round(evar12 * 10) / 10,
        evar24: Math.round(evar24 * 10) / 10,
        evar36: Math.round(evar36 * 10) / 10,
        bandPct: Math.round(bandPct * 100) / 100,
        rationale: r.rationale,
        consensusSummary: r.consensusSummary,
      };
    }).sort((a, b) => b.evar36 - a.evar36);

    const totals = {
      totalEvar12: items.reduce((s, x) => s + x.evar12, 0),
      totalEvar24: items.reduce((s, x) => s + x.evar24, 0),
      totalEvar36: items.reduce((s, x) => s + x.evar36, 0),
      count: items.length,
    };

    res.json({ items, totals });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Cascade DAG: starting from a capabilityId, return BFS of scored dependency edges
router.get("/cascade", async (req: Request, res: Response) => {
  try {
    const rootCapId = req.query.capabilityId ? parseInt(req.query.capabilityId as string) : undefined;
    const maxDepth = Math.min(4, parseInt(req.query.depth as string) || 3);

    const deps = await db.select().from(capabilityDependenciesTable);
    const edgeScores = await db.select().from(dependencyEdgeScoresTable);
    const scoreByDepId = new Map(edgeScores.map(s => [s.dependencyId, s]));
    const caps = await db.select().from(capabilitiesTable);
    const capById = new Map(caps.map(c => [c.id, c]));

    // Build adjacency using ONLY scored edges so the cascade graph reflects
    // real enrichment output, not unverified raw dependencies.
    const scoredDeps = deps.filter(d => scoreByDepId.has(d.id));
    const reverseAdj = new Map<number, Array<{ dependencyId: number; dependentCapId: number }>>();
    for (const d of scoredDeps) {
      const arr = reverseAdj.get(d.dependsOnId) ?? [];
      arr.push({ dependencyId: d.id, dependentCapId: d.capabilityId });
      reverseAdj.set(d.dependsOnId, arr);
    }

    if (!rootCapId || !capById.has(rootCapId)) {
      // Return a roots-listing: capabilities with most outgoing blast radius
      const roots = caps.map(c => {
        const outgoing = reverseAdj.get(c.id) ?? [];
        const totalImpact = outgoing.reduce((s, e) => {
          const sc = scoreByDepId.get(e.dependencyId);
          return s + (sc?.dollarImpactMm ?? 0);
        }, 0);
        return { id: c.id, name: c.name, industryId: c.industryId, dependentCount: outgoing.length, totalDownstreamImpactMm: Math.round(totalImpact) };
      }).sort((a, b) => b.totalDownstreamImpactMm - a.totalDownstreamImpactMm);
      res.json({ roots: roots.slice(0, 40) });
      return;
    }

    // BFS from root, collecting nodes and edges
    const visited = new Set<number>([rootCapId]);
    const frontier: Array<{ id: number; depth: number }> = [{ id: rootCapId, depth: 0 }];
    const nodesOut: Array<{ id: number; name: string; depth: number; industryId: number }> = [{
      id: rootCapId, name: capById.get(rootCapId)!.name, depth: 0, industryId: capById.get(rootCapId)!.industryId,
    }];
    const edgesOut: Array<{
      id: number; fromId: number; toId: number; depth: number;
      disruptionProbability: number | null; timeToImpactMonths: number | null; dollarImpactMm: number | null; rationale: string | null;
    }> = [];

    while (frontier.length > 0) {
      const cur = frontier.shift()!;
      if (cur.depth >= maxDepth) continue;
      const edges = reverseAdj.get(cur.id) ?? [];
      for (const e of edges) {
        const sc = scoreByDepId.get(e.dependencyId);
        edgesOut.push({
          id: e.dependencyId,
          fromId: cur.id,
          toId: e.dependentCapId,
          depth: cur.depth + 1,
          disruptionProbability: sc?.disruptionProbability ?? null,
          timeToImpactMonths: sc?.timeToImpactMonths ?? null,
          dollarImpactMm: sc?.dollarImpactMm ?? null,
          rationale: sc?.rationale ?? null,
        });
        if (!visited.has(e.dependentCapId)) {
          visited.add(e.dependentCapId);
          const c = capById.get(e.dependentCapId);
          if (c) {
            nodesOut.push({ id: c.id, name: c.name, depth: cur.depth + 1, industryId: c.industryId });
            frontier.push({ id: c.id, depth: cur.depth + 1 });
          }
        }
      }
    }

    const totalDollarImpact = edgesOut.reduce((s, e) => s + (e.dollarImpactMm ?? 0) * (e.disruptionProbability ?? 0.5), 0);
    res.json({
      root: { id: rootCapId, name: capById.get(rootCapId)!.name },
      nodes: nodesOut,
      edges: edgesOut,
      totalExpectedImpactMm: Math.round(totalDollarImpact),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Narrative Delta: capabilities where CE quadrant ≠ consensus quadrant
router.get("/narrative-delta", async (_req: Request, res: Response) => {
  try {
    const econ = await db.select().from(capabilityEconomicsTable);
    const capIds = econ.map(e => e.capabilityId);
    if (capIds.length === 0) { res.json({ items: [] }); return; }
    const quadRows = await db.select().from(capabilityQuadrantsTable).where(sql`${capabilityQuadrantsTable.capabilityId} IN (${sql.join(capIds.map(id => sql`${id}`), sql`, `)})`);
    const qByCapId = new Map(quadRows.map(q => [q.capabilityId, q]));
    const caps = await db.select().from(capabilitiesTable).where(sql`${capabilitiesTable.id} IN (${sql.join(capIds.map(id => sql`${id}`), sql`, `)})`);
    const capById = new Map(caps.map(c => [c.id, c]));
    const industries = await db.select().from(industriesTable);
    const indById = new Map(industries.map(i => [i.id, i.name]));

    const quadRank: Record<string, number> = { cooling: 0, table_stakes: 1, emerging: 2, hot: 3 };

    const items = econ
      .filter(e => e.consensusQuadrant && qByCapId.get(e.capabilityId)?.quadrant)
      .map(e => {
        const ceQ = qByCapId.get(e.capabilityId)!.quadrant;
        const consQ = e.consensusQuadrant!;
        const delta = (quadRank[ceQ] ?? 0) - (quadRank[consQ] ?? 0);
        const direction = delta > 0 ? "long" : delta < 0 ? "short" : "agree";
        const cap = capById.get(e.capabilityId);
        return {
          capabilityId: e.capabilityId,
          capabilityName: cap?.name ?? `#${e.capabilityId}`,
          industryName: indById.get(e.industryId) ?? "",
          ceQuadrant: ceQ,
          consensusQuadrant: consQ,
          consensusConfidence: e.consensusConfidence,
          deltaSteps: delta,
          direction,
          consensusSummary: e.consensusSummary,
          rationale: e.rationale,
          tamUsdMm: e.tamUsdMm,
          sources: e.consensusSources,
        };
      })
      .filter(x => x.direction !== "agree")
      .sort((a, b) => Math.abs(b.deltaSteps) - Math.abs(a.deltaSteps));

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
