import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityDependenciesTable,
  capabilityQuadrantsTable,
  capabilityEconomicsTable,
  dependencyEdgeScoresTable,
  industriesTable,
  valueChainStagesTable,
  companyCapabilityProfilesTable,
  companyCapabilityMappingsTable,
} from "@workspace/db";
import { eq, sql, and, inArray } from "drizzle-orm";
import { enqueueEnrichmentJob } from "../services/alpha/queue";
import { generateThesisMemo } from "../services/alpha/thesis";
import { requireAdmin } from "../middlewares/requireAdmin";

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

router.post("/enrich", requireAdmin, async (req: Request, res: Response) => {
  const limitCapabilities = typeof req.body?.limitCapabilities === "number" ? req.body.limitCapabilities : 12;
  const limitEdges = typeof req.body?.limitEdges === "number" ? req.body.limitEdges : 15;
  const industryId = typeof req.body?.industryId === "number" ? req.body.industryId : undefined;
  try {
    const job = await enqueueEnrichmentJob(
      "alpha",
      { limitCapabilities, limitEdges, industryId },
      { industryId },
    );
    res.status(202).json({ jobId: job.id, status: job.status, message: "Alpha enrichment queued" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Alpha enqueue failed" });
  }
});

router.post("/enrich-detail", requireAdmin, async (req: Request, res: Response) => {
  const limit = typeof req.body?.limit === "number" ? req.body.limit : 6;
  const force = req.body?.force === true;
  const capabilityId = typeof req.body?.capabilityId === "number" ? req.body.capabilityId : undefined;
  try {
    const job = await enqueueEnrichmentJob(
      "detail",
      { limit, force, capabilityId },
      { capabilityId },
    );
    res.status(202).json({ jobId: job.id, status: job.status, message: "Detail enrichment queued" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Detail enqueue failed" });
  }
});

// Capability detail aggregator — used by the capability detail page
router.get("/capability/:id", async (req: Request, res: Response) => {
  try {
    const capId = parseInt(req.params.id);
    if (isNaN(capId)) { res.status(400).json({ error: "bad id" }); return; }

    const [cap] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, capId));
    if (!cap) { res.status(404).json({ error: "capability not found" }); return; }

    const [econ] = await db.select().from(capabilityEconomicsTable).where(eq(capabilityEconomicsTable.capabilityId, capId));
    const [quad] = await db.select().from(capabilityQuadrantsTable).where(eq(capabilityQuadrantsTable.capabilityId, capId));

    // EVaR projection — only when all required inputs exist (no synthetic defaults)
    let evar: { mo12: number | null; mo24: number | null; mo36: number | null; ceQuadrant: string | null } = {
      mo12: null, mo24: null, mo36: null,
      ceQuadrant: quad?.quadrant ?? null,  // single source of truth for CE quadrant
    };
    if (econ && econ.revenueExposureMm != null && econ.halfLifeMonths != null && econ.marginStructurePct != null) {
      const rev = econ.revenueExposureMm;
      const margin = econ.marginStructurePct / 100;
      const hl = Math.max(6, econ.halfLifeMonths);
      const decay = (mo: number) => 1 - Math.pow(0.5, mo / hl);
      evar.mo12 = Math.round(rev * margin * decay(12));
      evar.mo24 = Math.round(rev * margin * decay(24));
      evar.mo36 = Math.round(rev * margin * decay(36));
    }

    // Fragility — incoming edges to this cap, sum of probability * dollar impact for upstream
    const upstreamDeps = await db.select().from(capabilityDependenciesTable).where(eq(capabilityDependenciesTable.capabilityId, capId));
    const upstreamScores = upstreamDeps.length > 0
      ? await db.select().from(dependencyEdgeScoresTable).where(inArray(dependencyEdgeScoresTable.dependencyId, upstreamDeps.map(d => d.id)))
      : [];
    const scoreByDepId = new Map(upstreamScores.map(s => [s.dependencyId, s]));
    const pricedUpstream = upstreamDeps.filter(d => scoreByDepId.has(d.id));
    let topUpstreamRiskMm: number | null = null;
    let fragilityScore: number | null = null;
    if (pricedUpstream.length > 0) {
      let topRisk = 0;
      for (const d of pricedUpstream) {
        const sc = scoreByDepId.get(d.id);
        const r = (sc?.dollarImpactMm ?? 0) * (sc?.disruptionProbability ?? 0);
        if (r > topRisk) topRisk = r;
      }
      topUpstreamRiskMm = Math.round(topRisk);
      const avgProb = pricedUpstream.reduce((s, d) => s + (scoreByDepId.get(d.id)?.disruptionProbability ?? 0), 0) / pricedUpstream.length;
      fragilityScore = Math.round(avgProb * 100);
    }

    // Cascade downstream preview (depth 2)
    const allDeps = await db.select().from(capabilityDependenciesTable);
    const allEdgeScores = await db.select().from(dependencyEdgeScoresTable);
    const allScoreMap = new Map(allEdgeScores.map(s => [s.dependencyId, s]));
    const reverseAdj = new Map<number, Array<{ depId: number; depCapId: number }>>();
    for (const d of allDeps) {
      if (!allScoreMap.has(d.id)) continue;
      const arr = reverseAdj.get(d.dependsOnId) ?? [];
      arr.push({ depId: d.id, depCapId: d.capabilityId });
      reverseAdj.set(d.dependsOnId, arr);
    }
    const allCaps = await db.select().from(capabilitiesTable);
    const capById = new Map(allCaps.map(c => [c.id, c]));
    const cascadeNodes: Array<{ id: number; name: string; depth: number }> = [{ id: capId, name: cap.name, depth: 0 }];
    const cascadeEdges: Array<{ fromId: number; toId: number; dollarImpactMm: number | null; disruptionProbability: number | null }> = [];
    const visited = new Set<number>([capId]);
    const frontier = [{ id: capId, depth: 0 }];
    let totalBlast = 0;
    while (frontier.length > 0) {
      const cur = frontier.shift()!;
      if (cur.depth >= 2) continue;
      const downstream = reverseAdj.get(cur.id) ?? [];
      for (const e of downstream) {
        const sc = allScoreMap.get(e.depId);
        cascadeEdges.push({ fromId: cur.id, toId: e.depCapId, dollarImpactMm: sc?.dollarImpactMm ?? null, disruptionProbability: sc?.disruptionProbability ?? null });
        totalBlast += (sc?.dollarImpactMm ?? 0) * (sc?.disruptionProbability ?? 0);
        if (!visited.has(e.depCapId)) {
          visited.add(e.depCapId);
          const c = capById.get(e.depCapId);
          if (c) {
            cascadeNodes.push({ id: c.id, name: c.name, depth: cur.depth + 1 });
            frontier.push({ id: c.id, depth: cur.depth + 1 });
          }
        }
      }
    }

    res.json({
      economics: econ ?? null,
      evar,
      fragility: { score: fragilityScore, topUpstreamRiskMm, scoredEdges: pricedUpstream.length, totalUpstreamEdges: upstreamDeps.length },
      cascade: { nodes: cascadeNodes, edges: cascadeEdges, totalExpectedImpactMm: Math.round(totalBlast) },
      sources: econ?.consensusSources ?? [],
      generatedAt: econ?.generatedAt ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
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

/* ============================= MOAT SCORE =============================
 * Composite per-capability "how hard is this to replicate" score (0-100).
 * Inputs: half-life, dependency depth, economic impact, inverted disruption,
 * supplier concentration HHI.
 */
router.get("/moat", async (req: Request, res: Response) => {
  try {
    const industryId = req.query.industryId ? parseInt(req.query.industryId as string) : undefined;
    if (req.query.industryId && isNaN(industryId!)) { res.status(400).json({ error: "Bad industryId" }); return; }

    const caps = industryId
      ? await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId))
      : await db.select().from(capabilitiesTable);
    const capIds = caps.map(c => c.id);
    if (capIds.length === 0) { res.json({ items: [] }); return; }

    const inIds = sql.join(capIds.map(id => sql`${id}`), sql`, `);
    const econ = await db.select().from(capabilityEconomicsTable).where(sql`${capabilityEconomicsTable.capabilityId} IN (${inIds})`);
    const econByCapId = new Map(econ.map(e => [e.capabilityId, e]));
    const quads = await db.select().from(capabilityQuadrantsTable).where(sql`${capabilityQuadrantsTable.capabilityId} IN (${inIds})`);
    const quadByCapId = new Map(quads.map(q => [q.capabilityId, q]));

    const deps = await db.select().from(capabilityDependenciesTable);
    const upstreamCount = new Map<number, number>();
    const downstreamCount = new Map<number, number>();
    for (const d of deps) {
      upstreamCount.set(d.capabilityId, (upstreamCount.get(d.capabilityId) ?? 0) + 1);
      downstreamCount.set(d.dependsOnId, (downstreamCount.get(d.dependsOnId) ?? 0) + 1);
    }

    const stages = await db.select().from(valueChainStagesTable);
    const hhiByCapId = new Map<number, number>();
    for (const s of stages) {
      const keyCaps = (s.keyCapabilities ?? []) as number[];
      for (const cid of keyCaps) {
        if (s.hhiScore != null && (hhiByCapId.get(cid) ?? 0) < s.hhiScore) hhiByCapId.set(cid, s.hhiScore);
      }
    }

    const industries = await db.select().from(industriesTable);
    const indById = new Map(industries.map(i => [i.id, i.name]));

    const items = caps
      .filter(c => econByCapId.has(c.id) && quadByCapId.has(c.id)) // no fallback defaults — only real data
      .map(c => {
        const e = econByCapId.get(c.id)!;
        const q = quadByCapId.get(c.id)!;
        const halfLife = e.halfLifeMonths;
        const upstream = upstreamCount.get(c.id) ?? 0;
        const downstream = downstreamCount.get(c.id) ?? 0;
        const economic = q.economicImpactScore;
        const disruption = q.disruptionIntensity;
        const hhi = hhiByCapId.get(c.id);

        const halfLifeC = halfLife != null ? Math.min(100, (halfLife / 60) * 100) : null;
        const depthC = Math.min(100, (upstream + downstream * 0.5) * 12);
        const economicC = economic != null ? Math.min(100, economic) : null;
        const stickinessC = disruption != null ? Math.max(0, 100 - disruption * 100) : null;
        const concentrationC = hhi != null ? Math.min(100, hhi * 100) : null;

        // Reweight only across components we actually have data for, so a
        // missing input doesn't get treated as zero.
        const segs = [
          { val: halfLifeC, w: 0.30 },
          { val: depthC, w: 0.25 },
          { val: economicC, w: 0.20 },
          { val: stickinessC, w: 0.15 },
          { val: concentrationC, w: 0.10 },
        ].filter(s => s.val != null) as Array<{ val: number; w: number }>;
        const wSum = segs.reduce((s, x) => s + x.w, 0);
        if (wSum === 0) return null;
        const moat = Math.round(segs.reduce((s, x) => s + x.val * (x.w / wSum), 0));
        const tier = moat >= 70 ? "fortress" : moat >= 50 ? "defensible" : moat >= 30 ? "contestable" : "exposed";

        return {
          capabilityId: c.id, capabilityName: c.name, industryId: c.industryId, industryName: indById.get(c.industryId) ?? "",
          moatScore: moat, tier,
          components: {
            halfLifeContribution: halfLifeC != null ? Math.round(halfLifeC) : null,
            dependencyDepth: Math.round(depthC),
            economicImpact: economicC != null ? Math.round(economicC) : null,
            stickiness: stickinessC != null ? Math.round(stickinessC) : null,
            supplierConcentration: concentrationC != null ? Math.round(concentrationC) : null,
          },
          halfLifeMonths: halfLife, upstreamDeps: upstream, downstreamDeps: downstream,
          hhi: hhi != null ? Math.round(hhi * 100) / 100 : null,
          rationale: q.rationale, sources: e.sources,
          enriched: true,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.moatScore - a.moatScore);

    const totalCaps = industryId ? caps.length : (await db.select().from(capabilitiesTable)).length;
    res.json({ items, coverage: { scored: items.length, totalCapabilities: totalCaps } });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/* ============================= FRAGILITY SCORECARD ============================= */
router.get("/fragility", async (_req: Request, res: Response) => {
  try {
    const caps = await db.select().from(capabilitiesTable);
    const capIds = caps.map(c => c.id);
    if (capIds.length === 0) { res.json({ items: [] }); return; }
    const inIds = sql.join(capIds.map(id => sql`${id}`), sql`, `);

    const econ = await db.select().from(capabilityEconomicsTable);
    const econByCapId = new Map(econ.map(e => [e.capabilityId, e]));
    const quads = await db.select().from(capabilityQuadrantsTable).where(sql`${capabilityQuadrantsTable.capabilityId} IN (${inIds})`);
    const quadByCapId = new Map(quads.map(q => [q.capabilityId, q]));
    const deps = await db.select().from(capabilityDependenciesTable);
    const edgeScores = await db.select().from(dependencyEdgeScoresTable);
    const scoreByDepId = new Map(edgeScores.map(s => [s.dependencyId, s]));
    const stages = await db.select().from(valueChainStagesTable);
    const industries = await db.select().from(industriesTable);
    const indById = new Map(industries.map(i => [i.id, i.name]));

    const upstreamByCapId = new Map<number, typeof deps>();
    for (const d of deps) {
      const arr = upstreamByCapId.get(d.capabilityId) ?? [];
      arr.push(d);
      upstreamByCapId.set(d.capabilityId, arr);
    }

    const supplierConcByCapId = new Map<number, number>();
    for (const s of stages) {
      const keyCaps = (s.keyCapabilities ?? []) as number[];
      const conc = s.hhiScore ?? 0.2;
      for (const cid of keyCaps) {
        if (conc > (supplierConcByCapId.get(cid) ?? 0)) supplierConcByCapId.set(cid, conc);
      }
    }

    const items = caps
      .filter(c => econByCapId.has(c.id) && quadByCapId.has(c.id)) // only enriched
      .map(c => {
        const e = econByCapId.get(c.id)!;
        const q = quadByCapId.get(c.id)!;
        const ups = upstreamByCapId.get(c.id) ?? [];

        // Edge shock requires at least one scored upstream edge — skip if none.
        let topEdgeExpectedImpact: number | null = null;
        let scoredEdgesCount = 0;
        for (const u of ups) {
          const sc = scoreByDepId.get(u.id);
          if (sc?.dollarImpactMm != null && sc.disruptionProbability != null) {
            scoredEdgesCount++;
            const exp = sc.dollarImpactMm * sc.disruptionProbability;
            if (topEdgeExpectedImpact == null || exp > topEdgeExpectedImpact) topEdgeExpectedImpact = exp;
          }
        }
        const supplier = supplierConcByCapId.get(c.id);
        const halfLife = e.halfLifeMonths;
        const disruption = q.disruptionIntensity;

        const decaySpeed = halfLife != null ? Math.min(100, (24 / Math.max(6, halfLife)) * 100) : null;
        const upstreamDepth = ups.length > 0 ? Math.min(100, ups.length * 18) : null;
        const concentration = supplier != null ? Math.min(100, supplier * 100) : null;
        const edgeShock = (topEdgeExpectedImpact != null && e.revenueExposureMm)
          ? Math.min(100, (topEdgeExpectedImpact / e.revenueExposureMm) * 100)
          : null;
        const disruptionPressure = disruption != null ? Math.min(100, disruption * 100) : null;

        const segs = [
          { val: decaySpeed, w: 0.25 },
          { val: upstreamDepth, w: 0.20 },
          { val: concentration, w: 0.15 },
          { val: edgeShock, w: 0.25 },
          { val: disruptionPressure, w: 0.15 },
        ].filter(s => s.val != null) as Array<{ val: number; w: number }>;
        const wSum = segs.reduce((s, x) => s + x.w, 0);
        if (wSum === 0) return null;
        const fragility = Math.round(segs.reduce((s, x) => s + x.val * (x.w / wSum), 0));
        const severity = fragility >= 70 ? "critical" : fragility >= 50 ? "elevated" : fragility >= 30 ? "moderate" : "stable";

        return {
          capabilityId: c.id, capabilityName: c.name, industryId: c.industryId, industryName: indById.get(c.industryId) ?? "",
          fragilityScore: fragility, severity,
          components: {
            decaySpeed: decaySpeed != null ? Math.round(decaySpeed) : null,
            upstreamDepth: upstreamDepth != null ? Math.round(upstreamDepth) : null,
            supplierConcentration: concentration != null ? Math.round(concentration) : null,
            edgeShock: edgeShock != null ? Math.round(edgeShock) : null,
            disruptionPressure: disruptionPressure != null ? Math.round(disruptionPressure) : null,
          },
          topUpstreamRiskMm: topEdgeExpectedImpact != null ? Math.round(topEdgeExpectedImpact) : null,
          scoredEdgesCount, totalUpstreamEdges: ups.length,
          halfLifeMonths: halfLife,
          rationale: q.rationale, sources: e.sources, enriched: true,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.fragilityScore - a.fragilityScore);

    res.json({ items, coverage: { scored: items.length, totalCapabilities: caps.length } });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/* ============================= ARBITRAGE MAP =============================
 * Compares the cash-flow value implied by the STREET (consensus) quadrant
 * against the cash-flow value implied by the CE quadrant.
 * Spread = ceValue - consensusValue. Positive = market is mis-pricing low → long,
 * negative = market is over-paying → short. Direction is gated on consensus
 * confidence (low confidence = neutral, no actionable signal).
 *
 * Quadrant → annual cash-flow multiple (industry-standard buckets):
 *   hot         15× revenue (high growth, expanding margins)
 *   emerging    10× revenue (early but accelerating)
 *   table_stakes 4× revenue (commoditized, defensive cash flows)
 *   declining    1× revenue (terminal, run-off)
 */
router.get("/arbitrage", async (_req: Request, res: Response) => {
  try {
    const econ = await db.select().from(capabilityEconomicsTable);
    if (econ.length === 0) { res.json({ items: [], totals: { longExposureMm: 0, shortExposureMm: 0, pairs: 0 } }); return; }
    const capIds = econ.map(e => e.capabilityId);
    const inIds = sql.join(capIds.map(id => sql`${id}`), sql`, `);

    const caps = await db.select().from(capabilitiesTable).where(sql`${capabilitiesTable.id} IN (${inIds})`);
    const capById = new Map(caps.map(c => [c.id, c]));
    const industries = await db.select().from(industriesTable);
    const indById = new Map(industries.map(i => [i.id, i.name]));
    const mappings = await db.select().from(companyCapabilityMappingsTable).where(sql`${companyCapabilityMappingsTable.capabilityId} IN (${inIds})`);
    const mappingsByCap = new Map<number, number>();
    for (const m of mappings) mappingsByCap.set(m.capabilityId, (mappingsByCap.get(m.capabilityId) ?? 0) + 1);
    const quads = await db.select().from(capabilityQuadrantsTable).where(sql`${capabilityQuadrantsTable.capabilityId} IN (${inIds})`);
    const quadByCapId = new Map(quads.map(q => [q.capabilityId, q]));

    const QUADRANT_MULTIPLE: Record<string, number> = {
      hot: 15, emerging: 10, table_stakes: 4, declining: 1,
    };

    const items = econ
      .filter(e => e.consensusQuadrant && e.revenueExposureMm != null && quadByCapId.has(e.capabilityId))
      .map(e => {
        const cap = capById.get(e.capabilityId);
        const q = quadByCapId.get(e.capabilityId)!;
        const consensusM = QUADRANT_MULTIPLE[e.consensusQuadrant!];
        const ceM = QUADRANT_MULTIPLE[q.quadrant];
        if (consensusM == null || ceM == null) return null;

        const revenue = e.revenueExposureMm!;
        const margin = e.marginStructurePct != null ? e.marginStructurePct / 100 : null;
        if (margin == null) return null;

        // Annual margin × multiple = enterprise-value-equivalent of capability cashflow
        const annualMarginMm = revenue * margin;
        const consensusValueMm = Math.round(annualMarginMm * consensusM);
        const ceValueMm = Math.round(annualMarginMm * ceM);
        const spreadMm = ceValueMm - consensusValueMm;
        const spreadPct = consensusValueMm > 0 ? Math.round((spreadMm / consensusValueMm) * 100) : null;
        const conf = e.consensusConfidence ?? 0;

        // Only emit a directional signal if consensus is reasonably confident;
        // otherwise the disagreement is noise.
        const minConfidence = 0.55;
        const direction: "long" | "short" | "neutral" =
          conf < minConfidence ? "neutral"
          : spreadMm > Math.max(consensusValueMm * 0.10, 100) ? "long"
          : spreadMm < -Math.max(consensusValueMm * 0.10, 100) ? "short"
          : "neutral";

        return {
          capabilityId: e.capabilityId,
          capabilityName: cap?.name ?? `#${e.capabilityId}`,
          industryName: indById.get(e.industryId) ?? "",
          ceQuadrant: q.quadrant,
          ceMultiple: ceM,
          consensusQuadrant: e.consensusQuadrant!,
          consensusMultiple: consensusM,
          revenueExposureMm: revenue,
          marginPct: e.marginStructurePct,
          consensusValueMm,
          ceValueMm,
          spreadMm,
          spreadPct,
          direction,
          confidence: conf,
          companies: mappingsByCap.get(e.capabilityId) ?? 0,
          rationale: e.rationale,
          consensusSummary: e.consensusSummary,
          sources: e.sources,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => Math.abs(b.spreadMm) - Math.abs(a.spreadMm));

    const totals = {
      longExposureMm: items.filter(i => i.direction === "long").reduce((s, i) => s + i.spreadMm, 0),
      shortExposureMm: Math.abs(items.filter(i => i.direction === "short").reduce((s, i) => s + i.spreadMm, 0)),
      neutralCount: items.filter(i => i.direction === "neutral").length,
      pairs: items.length,
    };
    res.json({
      items, totals,
      methodology: {
        formula: "spread = (revenueExposure × margin × ceMultiple) − (revenueExposure × margin × consensusMultiple)",
        multiples: QUADRANT_MULTIPLE,
        minConfidenceForSignal: 0.55,
      },
    });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/* ============================= FLOWS (Capital) ============================= */
router.get("/flows", async (_req: Request, res: Response) => {
  try {
    const stages = await db.select().from(valueChainStagesTable);
    const industries = await db.select().from(industriesTable);
    const indById = new Map(industries.map(i => [i.id, i.name]));

    const stageBuckets = new Map<string, { name: string; totalCapitalMm: number; avgTrend: number; count: number }>();
    const industryBuckets = new Map<number, { id: number; name: string; totalCapitalMm: number; avgTrend: number; count: number }>();
    const links: Array<{ source: string; target: string; valueMm: number; trendPct: number }> = [];

    // Only stages with real capital-flow data — never invent zeros.
    const realStages = stages.filter(s => s.capitalFlowMm != null);
    for (const s of realStages) {
      const cap = s.capitalFlowMm!;
      const trend = s.capitalTrendPct;
      const sb = stageBuckets.get(s.stageName) ?? { name: s.stageName, totalCapitalMm: 0, avgTrend: 0, count: 0 };
      sb.totalCapitalMm += cap;
      if (trend != null) { sb.avgTrend += trend; sb.count += 1; }
      stageBuckets.set(s.stageName, sb);

      const indName = indById.get(s.industryId) ?? `Industry ${s.industryId}`;
      const ib = industryBuckets.get(s.industryId) ?? { id: s.industryId, name: indName, totalCapitalMm: 0, avgTrend: 0, count: 0 };
      ib.totalCapitalMm += cap;
      if (trend != null) { ib.avgTrend += trend; ib.count += 1; }
      industryBuckets.set(s.industryId, ib);

      if (cap > 0) links.push({ source: `stage:${s.stageName}`, target: `industry:${indName}`, valueMm: Math.round(cap), trendPct: trend != null ? Math.round(trend) : 0 });
    }

    const stagesOut = Array.from(stageBuckets.values()).map(s => ({ ...s, totalCapitalMm: Math.round(s.totalCapitalMm), avgTrend: s.count ? Math.round(s.avgTrend / s.count) : 0 })).sort((a, b) => b.totalCapitalMm - a.totalCapitalMm);
    const industriesOut = Array.from(industryBuckets.values()).map(i => ({ ...i, totalCapitalMm: Math.round(i.totalCapitalMm), avgTrend: i.count ? Math.round(i.avgTrend / i.count) : 0 })).sort((a, b) => b.totalCapitalMm - a.totalCapitalMm);
    const totalCapitalMm = stagesOut.reduce((s, x) => s + x.totalCapitalMm, 0);
    const acceleratingMm = stagesOut.filter(s => s.avgTrend > 10).reduce((s, x) => s + x.totalCapitalMm, 0);
    const deceleratingMm = stagesOut.filter(s => s.avgTrend < -5).reduce((s, x) => s + x.totalCapitalMm, 0);

    res.json({
      stages: stagesOut, industries: industriesOut, links: links.sort((a, b) => b.valueMm - a.valueMm),
      totals: { totalCapitalMm, acceleratingMm, deceleratingMm },
      coverage: { stagesWithCapital: realStages.length, totalStages: stages.length },
    });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/* ============================= TALENT CHAIN ============================= */
router.get("/talent", async (_req: Request, res: Response) => {
  try {
    const mappings = await db.select().from(companyCapabilityMappingsTable);
    const profiles = await db.select().from(companyCapabilityProfilesTable);
    const profById = new Map(profiles.map(p => [p.id, p]));
    const caps = await db.select().from(capabilitiesTable);
    const capById = new Map(caps.map(c => [c.id, c]));
    const industries = await db.select().from(industriesTable);
    const indById = new Map(industries.map(i => [i.id, i.name]));
    const quads = await db.select().from(capabilityQuadrantsTable);
    const quadByCapId = new Map(quads.map(q => [q.capabilityId, q]));

    type Bucket = { capabilityId: number; companies: number; coreCount: number; partialCount: number; bySector: Map<string, number>; byStage: Map<string, number>; topCompanies: Array<{ name: string; country: string; stage: string | null; strength: string; fevi: number }> };
    const buckets = new Map<number, Bucket>();

    for (const m of mappings) {
      const p = profById.get(m.companyId);
      if (!p) continue;
      let b = buckets.get(m.capabilityId);
      if (!b) { b = { capabilityId: m.capabilityId, companies: 0, coreCount: 0, partialCount: 0, bySector: new Map(), byStage: new Map(), topCompanies: [] }; buckets.set(m.capabilityId, b); }
      b.companies += 1;
      if (m.strength === "core" || m.strength === "strong") b.coreCount += 1; else b.partialCount += 1;
      b.bySector.set(p.naicsSector ?? "Unknown", (b.bySector.get(p.naicsSector ?? "Unknown") ?? 0) + 1);
      b.byStage.set(p.fundingStage ?? "Unknown", (b.byStage.get(p.fundingStage ?? "Unknown") ?? 0) + 1);
      b.topCompanies.push({ name: p.name, country: p.country, stage: p.fundingStage, strength: m.strength, fevi: p.feviScore });
    }

    const items = Array.from(buckets.values()).map(b => {
      const cap = capById.get(b.capabilityId);
      const q = quadByCapId.get(b.capabilityId);
      const competition = b.companies;
      const mastery = b.companies > 0 ? b.coreCount / b.companies : 0;
      const bottleneckScore = Math.round(Math.min(100, competition * 4) * (1 - mastery));
      const status = bottleneckScore >= 50 ? "bottleneck" : mastery >= 0.7 ? "saturated" : competition >= 5 ? "competitive" : "emerging";

      return {
        capabilityId: b.capabilityId, capabilityName: cap?.name ?? `#${b.capabilityId}`,
        industryId: cap?.industryId ?? null, industryName: cap ? indById.get(cap.industryId) ?? "" : "",
        quadrant: q?.quadrant ?? null, adoptionMomentum: q?.adoptionMomentumScore ?? null,
        companies: b.companies, coreCount: b.coreCount, partialCount: b.partialCount, masteryRatio: Math.round(mastery * 100) / 100,
        bottleneckScore, status,
        sectorMix: Array.from(b.bySector.entries()).map(([s, n]) => ({ sector: s, count: n })).sort((a, b) => b.count - a.count).slice(0, 5),
        stageMix: Array.from(b.byStage.entries()).map(([s, n]) => ({ stage: s, count: n })).sort((a, b) => b.count - a.count),
        topCompanies: b.topCompanies.sort((a, b) => b.fevi - a.fevi).slice(0, 5),
      };
    }).sort((a, b) => b.bottleneckScore - a.bottleneckScore);

    res.json({ items });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/* ============================= M&A TWIN ============================= */
router.get("/twin", async (req: Request, res: Response) => {
  try {
    const aId = parseInt(req.query.industryAId as string);
    const bId = parseInt(req.query.industryBId as string);
    if (isNaN(aId) || isNaN(bId)) { res.status(400).json({ error: "industryAId and industryBId required" }); return; }
    if (aId === bId) { res.status(400).json({ error: "industries must differ" }); return; }

    const industries = await db.select().from(industriesTable);
    const indById = new Map(industries.map(i => [i.id, i]));
    const a = indById.get(aId); const b = indById.get(bId);
    if (!a || !b) { res.status(404).json({ error: "industry not found" }); return; }

    const capsA = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, aId));
    const capsB = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, bId));

    // Token-Jaccard fuzzy matching: capability names rarely match exactly across
    // industries, but token sets often overlap meaningfully (e.g.
    // "Supply Chain Management" vs "Supply Chain Optimization").
    const STOP = new Set(["and", "the", "of", "for", "in", "to", "a", "&", "/", "-", ""]);
    const tokenize = (s: string) => new Set(
      s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(t => t && !STOP.has(t) && t.length > 2)
    );
    const tokensA = capsA.map(c => ({ cap: c, tokens: tokenize(c.name) }));
    const tokensB = capsB.map(c => ({ cap: c, tokens: tokenize(c.name) }));

    const sharedPairs: Array<{ a: typeof capsA[number]; b: typeof capsB[number]; sim: number }> = [];
    const matchedB = new Set<number>();
    // Overlap coefficient = |inter| / min(|A|,|B|). At least half of the smaller
    // name's tokens must be shared. This catches "Product Engineering & Design"
    // ↔ "Platform Engineering" via the shared "engineering" token.
    const SIM_THRESHOLD = 0.5;
    for (const ta of tokensA) {
      if (ta.tokens.size === 0) continue;
      let best: { b: typeof capsB[number]; sim: number } | null = null;
      for (const tb of tokensB) {
        if (matchedB.has(tb.cap.id) || tb.tokens.size === 0) continue;
        const inter = [...ta.tokens].filter(t => tb.tokens.has(t)).length;
        if (inter === 0) continue;
        const minSize = Math.min(ta.tokens.size, tb.tokens.size);
        const sim = inter / minSize;
        if (sim >= SIM_THRESHOLD && (!best || sim > best.sim)) best = { b: tb.cap, sim };
      }
      if (best) { sharedPairs.push({ a: ta.cap, b: best.b, sim: best.sim }); matchedB.add(best.b.id); }
    }
    const sharedAIds = new Set(sharedPairs.map(p => p.a.id));
    const sharedBIds = new Set(sharedPairs.map(p => p.b.id));

    const allCapIds = [...capsA.map(c => c.id), ...capsB.map(c => c.id)];
    const inIds = allCapIds.length > 0 ? sql.join(allCapIds.map(id => sql`${id}`), sql`, `) : sql`NULL`;
    const econ = allCapIds.length > 0 ? await db.select().from(capabilityEconomicsTable).where(sql`${capabilityEconomicsTable.capabilityId} IN (${inIds})`) : [];
    const econByCapId = new Map(econ.map(e => [e.capabilityId, e]));
    const quads = allCapIds.length > 0 ? await db.select().from(capabilityQuadrantsTable).where(sql`${capabilityQuadrantsTable.capabilityId} IN (${inIds})`) : [];
    const quadByCapId = new Map(quads.map(q => [q.capabilityId, q]));

    function profile(c: { id: number; name: string }) {
      const e = econByCapId.get(c.id);
      const q = quadByCapId.get(c.id);
      return { id: c.id, name: c.name, quadrant: q?.quadrant ?? null, revenueExposureMm: e?.revenueExposureMm ?? null, halfLifeMonths: e?.halfLifeMonths ?? null };
    }

    const synergies = sharedPairs.map(({ a: ca, b: cb, sim }) => {
      const qa = quadByCapId.get(ca.id)?.quadrant; const qb = quadByCapId.get(cb.id)?.quadrant;
      const ea = econByCapId.get(ca.id); const eb = econByCapId.get(cb.id);
      const conflict = !!(qa && qb && qa !== qb);
      // Synergy only when BOTH sides have real revenue exposure — otherwise
      // null (rendered as "—"), never a fake $0.
      const synergyMm = (ea?.revenueExposureMm != null && eb?.revenueExposureMm != null)
        ? Math.round(Math.min(ea.revenueExposureMm, eb.revenueExposureMm) * 0.10)
        : null;
      const label = ca.name.toLowerCase() === cb.name.toLowerCase() ? ca.name : `${ca.name}  ↔  ${cb.name}`;
      return { capabilityName: label, similarity: Math.round(sim * 100) / 100, a: profile(ca), b: profile(cb), clash: conflict, clashType: conflict ? `${qa} vs ${qb}` : null, synergyMm, enriched: synergyMm != null };
    }).sort((x, y) => {
      const yScore = (y.synergyMm ?? 0) + (y.clash ? 999999 : 0);
      const xScore = (x.synergyMm ?? 0) + (x.clash ? 999999 : 0);
      return yScore - xScore;
    });

    const onlyA = capsA.filter(c => !sharedAIds.has(c.id)).map(profile);
    const onlyB = capsB.filter(c => !sharedBIds.has(c.id)).map(profile);

    const union = capsA.length + capsB.length - sharedPairs.length;
    const jaccard = union > 0 ? sharedPairs.length / union : 0;
    const totalSynergyMm = synergies.reduce((s, x) => s + (x.synergyMm ?? 0), 0);
    const clashCount = synergies.filter(s => s.clash).length;

    res.json({
      industryA: { id: a.id, name: a.name }, industryB: { id: b.id, name: b.name },
      summary: { sharedCount: sharedPairs.length, onlyACount: onlyA.length, onlyBCount: onlyB.length, jaccard: Math.round(jaccard * 1000) / 1000, totalSynergyMm, clashCount },
      synergies, onlyA, onlyB,
    });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/* ============================= THESIS MEMO ============================= */
router.post("/thesis", requireAdmin, async (req: Request, res: Response) => {
  try {
    const capabilityId = parseInt(req.body?.capabilityId);
    if (isNaN(capabilityId)) { res.status(400).json({ error: "capabilityId required" }); return; }
    const memo = await generateThesisMemo(capabilityId);
    res.json(memo);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
