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
import { eq, sql, and } from "drizzle-orm";
import { runAlphaEnrichment } from "../services/alpha/enrich";
import { generateThesisMemo } from "../services/alpha/thesis";

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

    const items = caps.map(c => {
      const e = econByCapId.get(c.id);
      const q = quadByCapId.get(c.id);
      const halfLife = e?.halfLifeMonths ?? 24;
      const upstream = upstreamCount.get(c.id) ?? 0;
      const downstream = downstreamCount.get(c.id) ?? 0;
      const economic = q?.economicImpactScore ?? 50;
      const disruption = q?.disruptionIntensity ?? 0.5;
      const hhi = hhiByCapId.get(c.id) ?? 0.2;

      const halfLifeC = Math.min(100, (halfLife / 60) * 100);
      const depthC = Math.min(100, (upstream + downstream * 0.5) * 12);
      const economicC = Math.min(100, economic);
      const stickinessC = Math.max(0, 100 - disruption * 100);
      const concentrationC = Math.min(100, hhi * 100);

      const moat = Math.round(halfLifeC * 0.30 + depthC * 0.25 + economicC * 0.20 + stickinessC * 0.15 + concentrationC * 0.10);
      const tier = moat >= 70 ? "fortress" : moat >= 50 ? "defensible" : moat >= 30 ? "contestable" : "exposed";

      return {
        capabilityId: c.id, capabilityName: c.name, industryId: c.industryId, industryName: indById.get(c.industryId) ?? "",
        moatScore: moat, tier,
        components: {
          halfLifeContribution: Math.round(halfLifeC), dependencyDepth: Math.round(depthC),
          economicImpact: Math.round(economicC), stickiness: Math.round(stickinessC), supplierConcentration: Math.round(concentrationC),
        },
        halfLifeMonths: halfLife, upstreamDeps: upstream, downstreamDeps: downstream, hhi: Math.round(hhi * 100) / 100, enriched: !!e,
      };
    }).sort((a, b) => b.moatScore - a.moatScore);

    res.json({ items });
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

    const items = caps.map(c => {
      const e = econByCapId.get(c.id);
      const q = quadByCapId.get(c.id);
      const ups = upstreamByCapId.get(c.id) ?? [];
      const halfLife = e?.halfLifeMonths ?? 24;
      const disruption = q?.disruptionIntensity ?? 0.5;

      let topEdgeExpectedImpact = 0;
      for (const u of ups) {
        const sc = scoreByDepId.get(u.id);
        if (sc) {
          const exp = (sc.dollarImpactMm ?? 0) * (sc.disruptionProbability ?? 0.5);
          if (exp > topEdgeExpectedImpact) topEdgeExpectedImpact = exp;
        }
      }
      const supplier = supplierConcByCapId.get(c.id) ?? 0.2;

      const decaySpeed = Math.min(100, (24 / Math.max(6, halfLife)) * 100);
      const upstreamDepth = Math.min(100, ups.length * 18);
      const concentration = Math.min(100, supplier * 100);
      const edgeShock = e?.revenueExposureMm ? Math.min(100, (topEdgeExpectedImpact / e.revenueExposureMm) * 100) : 30;
      const disruptionPressure = Math.min(100, disruption * 100);

      const fragility = Math.round(decaySpeed * 0.25 + upstreamDepth * 0.20 + concentration * 0.15 + edgeShock * 0.25 + disruptionPressure * 0.15);
      const severity = fragility >= 70 ? "critical" : fragility >= 50 ? "elevated" : fragility >= 30 ? "moderate" : "stable";

      return {
        capabilityId: c.id, capabilityName: c.name, industryId: c.industryId, industryName: indById.get(c.industryId) ?? "",
        fragilityScore: fragility, severity,
        components: { decaySpeed: Math.round(decaySpeed), upstreamDepth: Math.round(upstreamDepth), supplierConcentration: Math.round(concentration), edgeShock: Math.round(edgeShock), disruptionPressure: Math.round(disruptionPressure) },
        topUpstreamRiskMm: Math.round(topEdgeExpectedImpact), halfLifeMonths: halfLife, upstreamDeps: ups.length, enriched: !!e,
      };
    }).sort((a, b) => b.fragilityScore - a.fragilityScore);

    res.json({ items });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/* ============================= ARBITRAGE MAP ============================= */
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
    const profiles = await db.select().from(companyCapabilityProfilesTable);
    const profById = new Map(profiles.map(p => [p.id, p]));
    const quads = await db.select().from(capabilityQuadrantsTable).where(sql`${capabilityQuadrantsTable.capabilityId} IN (${inIds})`);
    const quadByCapId = new Map(quads.map(q => [q.capabilityId, q]));

    const strengthW: Record<string, number> = { core: 1.0, strong: 0.7, partial: 0.4, peripheral: 0.2 };

    const mappingsByCap = new Map<number, typeof mappings>();
    for (const m of mappings) {
      const arr = mappingsByCap.get(m.capabilityId) ?? [];
      arr.push(m);
      mappingsByCap.set(m.capabilityId, arr);
    }

    const items = econ.map(e => {
      const cap = capById.get(e.capabilityId);
      const q = quadByCapId.get(e.capabilityId);
      const ms = mappingsByCap.get(e.capabilityId) ?? [];
      let impliedRaw = 0;
      let companies = 0;
      for (const m of ms) {
        const p = profById.get(m.companyId);
        if (!p) continue;
        impliedRaw += (p.feviScore ?? 0) * (strengthW[m.strength] ?? 0.5);
        companies++;
      }
      const marketImpliedMm = Math.round(impliedRaw * 8);
      const revenue = e.revenueExposureMm ?? e.tamUsdMm ?? 0;
      const margin = (e.marginStructurePct ?? 40) / 100;
      const confidence = e.consensusConfidence ?? 0.5;
      const intrinsicMm = Math.round(revenue * margin * 3 * confidence);
      const spreadMm = intrinsicMm - marketImpliedMm;
      const spreadPct = marketImpliedMm > 0 ? Math.round((spreadMm / marketImpliedMm) * 100) : null;
      const direction = spreadMm > Math.max(intrinsicMm * 0.15, 50) ? "long" : spreadMm < -Math.max(intrinsicMm * 0.15, 50) ? "short" : "neutral";

      return {
        capabilityId: e.capabilityId, capabilityName: cap?.name ?? `#${e.capabilityId}`, industryName: indById.get(e.industryId) ?? "",
        marketImpliedMm, intrinsicMm, spreadMm, spreadPct, direction, companies,
        ceQuadrant: q?.quadrant ?? null, consensusQuadrant: e.consensusQuadrant, confidence, rationale: e.rationale,
      };
    }).sort((a, b) => Math.abs(b.spreadMm) - Math.abs(a.spreadMm));

    const totals = {
      longExposureMm: items.filter(i => i.direction === "long").reduce((s, i) => s + i.spreadMm, 0),
      shortExposureMm: Math.abs(items.filter(i => i.direction === "short").reduce((s, i) => s + i.spreadMm, 0)),
      pairs: items.length,
    };
    res.json({ items, totals });
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

    for (const s of stages) {
      const cap = s.capitalFlowMm ?? 0;
      const trend = s.capitalTrendPct ?? 0;
      const sb = stageBuckets.get(s.stageName) ?? { name: s.stageName, totalCapitalMm: 0, avgTrend: 0, count: 0 };
      sb.totalCapitalMm += cap; sb.avgTrend += trend; sb.count += 1;
      stageBuckets.set(s.stageName, sb);

      const indName = indById.get(s.industryId) ?? `Industry ${s.industryId}`;
      const ib = industryBuckets.get(s.industryId) ?? { id: s.industryId, name: indName, totalCapitalMm: 0, avgTrend: 0, count: 0 };
      ib.totalCapitalMm += cap; ib.avgTrend += trend; ib.count += 1;
      industryBuckets.set(s.industryId, ib);

      if (cap > 0) links.push({ source: `stage:${s.stageName}`, target: `industry:${indName}`, valueMm: Math.round(cap), trendPct: Math.round(trend) });
    }

    const stagesOut = Array.from(stageBuckets.values()).map(s => ({ ...s, totalCapitalMm: Math.round(s.totalCapitalMm), avgTrend: s.count ? Math.round(s.avgTrend / s.count) : 0 })).sort((a, b) => b.totalCapitalMm - a.totalCapitalMm);
    const industriesOut = Array.from(industryBuckets.values()).map(i => ({ ...i, totalCapitalMm: Math.round(i.totalCapitalMm), avgTrend: i.count ? Math.round(i.avgTrend / i.count) : 0 })).sort((a, b) => b.totalCapitalMm - a.totalCapitalMm);
    const totalCapitalMm = stagesOut.reduce((s, x) => s + x.totalCapitalMm, 0);
    const acceleratingMm = stagesOut.filter(s => s.avgTrend > 10).reduce((s, x) => s + x.totalCapitalMm, 0);
    const deceleratingMm = stagesOut.filter(s => s.avgTrend < -5).reduce((s, x) => s + x.totalCapitalMm, 0);

    res.json({ stages: stagesOut, industries: industriesOut, links: links.sort((a, b) => b.valueMm - a.valueMm), totals: { totalCapitalMm, acceleratingMm, deceleratingMm } });
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
      const synergyMm = Math.round(Math.min(ea?.revenueExposureMm ?? 0, eb?.revenueExposureMm ?? 0) * 0.10);
      // Display label: combine names if they differ, else just the shared name
      const label = ca.name.toLowerCase() === cb.name.toLowerCase()
        ? ca.name
        : `${ca.name}  ↔  ${cb.name}`;
      return { capabilityName: label, similarity: Math.round(sim * 100) / 100, a: profile(ca), b: profile(cb), clash: conflict, clashType: conflict ? `${qa} vs ${qb}` : null, synergyMm };
    }).sort((x, y) => (y.synergyMm + (y.clash ? 999999 : 0)) - (x.synergyMm + (x.clash ? 999999 : 0)));

    const onlyA = capsA.filter(c => !sharedAIds.has(c.id)).map(profile);
    const onlyB = capsB.filter(c => !sharedBIds.has(c.id)).map(profile);

    const union = capsA.length + capsB.length - sharedPairs.length;
    const jaccard = union > 0 ? sharedPairs.length / union : 0;
    const totalSynergyMm = synergies.reduce((s, x) => s + x.synergyMm, 0);
    const clashCount = synergies.filter(s => s.clash).length;

    res.json({
      industryA: { id: a.id, name: a.name }, industryB: { id: b.id, name: b.name },
      summary: { sharedCount: sharedPairs.length, onlyACount: onlyA.length, onlyBCount: onlyB.length, jaccard: Math.round(jaccard * 1000) / 1000, totalSynergyMm, clashCount },
      synergies, onlyA, onlyB,
    });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/* ============================= THESIS MEMO ============================= */
router.post("/thesis", async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === "production") {
    const expected = process.env.ADMIN_API_KEY;
    const provided = req.headers["x-admin-key"];
    if (!expected || typeof provided !== "string" || provided !== expected) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }
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
