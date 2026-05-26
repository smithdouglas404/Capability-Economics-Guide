/**
 * Capability-graph-derived insights for the capability detail page.
 *
 * Three endpoints, all keyed on capability id (pgId):
 *
 *   GET /api/capabilities/:id/community-peers
 *     Caps in the same CDLP (Label Propagation) community on the
 *     FalkorDB :Capability graph. The community id itself is opaque —
 *     what's useful is the peer list. Returns empty array when Graphiti
 *     is off or the cap isn't in the graph. Cached for 1h via the
 *     algorithm service.
 *
 *   GET /api/capabilities/:id/industry-analogues
 *     Capabilities semantically near this cap in OTHER industries.
 *     Uses the FalkorDB vector index over Capability.embedding —
 *     finds top-K nearest, then filters out same-industry hits. Useful
 *     for surfacing "the analog of X in healthcare" when the user is
 *     looking at the same concept in insurance.
 *
 *   GET /api/cvi/platform-history-bitemporal?days=180
 *     Bi-temporal CVI trajectory at the PLATFORM level, sourced from
 *     the Graphiti :Episodic nodes the backfill landed (one per
 *     cvi_snapshots row, with valid_at = snapshot timestamp). Mostly
 *     a demonstration of the bi-temporal feature; the per-cap history
 *     endpoint at /api/capabilities/:id/cvi-history (owned by
 *     routes/capabilities.ts) is the one the capability-detail page
 *     uses.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, capabilitiesTable, industriesTable } from "@workspace/db";
import { and, eq, inArray, ne } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getCommunityAssignments } from "../services/capability-graph-algorithms";
import { isVectorSearchAvailable, searchCapabilitiesByVector, embedText } from "../services/capability-graph-vector";
import { isGraphitiEnabled, queryCypher } from "../lib/graphiti-client";

const router: IRouter = Router();

// ── Community peers (CDLP) ───────────────────────────────────────────────
router.get("/capabilities/:id/community-peers", async (req: Request, res: Response) => {
  const capId = Number(req.params.id);
  if (!Number.isFinite(capId) || capId <= 0) {
    res.status(400).json({ error: "Invalid capability id" });
    return;
  }
  try {
    const communities = await getCommunityAssignments();
    const myCommunity = communities.get(capId);
    if (myCommunity === undefined) {
      res.json({ capabilityId: capId, communityId: null, peerCount: 0, peers: [], source: "graphiti-off-or-not-in-graph" });
      return;
    }
    const peerIds: number[] = [];
    for (const [pg, cid] of communities) {
      if (cid === myCommunity && pg !== capId) peerIds.push(pg);
    }
    if (peerIds.length === 0) {
      res.json({ capabilityId: capId, communityId: myCommunity, peerCount: 0, peers: [], source: "graph" });
      return;
    }
    // Hydrate peer names + industries
    const peerRows = await db
      .select({
        id: capabilitiesTable.id,
        name: capabilitiesTable.name,
        slug: capabilitiesTable.slug,
        industryId: capabilitiesTable.industryId,
      })
      .from(capabilitiesTable)
      .where(inArray(capabilitiesTable.id, peerIds.slice(0, 25)));
    const industryIds = Array.from(new Set(peerRows.map((p) => p.industryId)));
    const industries = industryIds.length > 0
      ? await db
          .select({ id: industriesTable.id, name: industriesTable.name, slug: industriesTable.slug })
          .from(industriesTable)
          .where(inArray(industriesTable.id, industryIds))
      : [];
    const industryByCap = new Map(industries.map((i) => [i.id, { id: i.id, name: i.name, slug: i.slug }]));
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      capabilityId: capId,
      communityId: myCommunity,
      peerCount: peerIds.length,
      peers: peerRows.map((p) => ({
        pgId: p.id,
        name: p.name,
        slug: p.slug,
        industry: industryByCap.get(p.industryId) ?? null,
      })),
      source: "graph",
    });
  } catch (err) {
    logger.error({ err, capId }, "[capability-graph-insights] community-peers failed");
    res.status(500).json({ error: "Failed to load community peers" });
  }
});

// ── Cross-industry analogues (vector search) ─────────────────────────────
router.get("/capabilities/:id/industry-analogues", async (req: Request, res: Response) => {
  const capId = Number(req.params.id);
  if (!Number.isFinite(capId) || capId <= 0) {
    res.status(400).json({ error: "Invalid capability id" });
    return;
  }
  try {
    if (!isVectorSearchAvailable()) {
      res.json({ capabilityId: capId, available: false, reason: "Vector search not configured (OPENAI_API_KEY or USE_GRAPHITI_WORLD_MODEL missing)", analogues: [] });
      return;
    }
    // 1. Look up THIS cap's name + narrative — used as the embed source.
    const [cap] = await db
      .select({
        id: capabilitiesTable.id,
        name: capabilitiesTable.name,
        industryId: capabilitiesTable.industryId,
        description: capabilitiesTable.description,
        traditionalView: capabilitiesTable.traditionalView,
        economicView: capabilitiesTable.economicView,
      })
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.id, capId));
    if (!cap) {
      res.status(404).json({ error: "Capability not found" });
      return;
    }
    const parts: string[] = [cap.name];
    if (cap.description) parts.push(cap.description);
    if (cap.economicView) parts.push(cap.economicView);
    if (cap.traditionalView) parts.push(cap.traditionalView);
    const embedSource = parts.join(" — ").slice(0, 4000);

    const vec = await embedText(embedSource);
    if (!vec) {
      res.json({ capabilityId: capId, available: false, reason: "Embedding failed", analogues: [] });
      return;
    }
    // Pull 25 nearest; filter out same-industry + self below.
    const hits = await searchCapabilitiesByVector(vec, 25);
    const otherCaps = hits.filter((h) => h.pgId !== capId);
    if (otherCaps.length === 0) {
      res.json({ capabilityId: capId, available: true, analogues: [] });
      return;
    }
    const hitRows = await db
      .select({
        id: capabilitiesTable.id,
        name: capabilitiesTable.name,
        slug: capabilitiesTable.slug,
        industryId: capabilitiesTable.industryId,
      })
      .from(capabilitiesTable)
      .where(and(
        inArray(capabilitiesTable.id, otherCaps.map((h) => h.pgId)),
        ne(capabilitiesTable.industryId, cap.industryId),
      ));
    const scoreByPg = new Map(otherCaps.map((h) => [h.pgId, h.score]));
    const industryIds = Array.from(new Set(hitRows.map((r) => r.industryId)));
    const industries = industryIds.length > 0
      ? await db
          .select({ id: industriesTable.id, name: industriesTable.name, slug: industriesTable.slug })
          .from(industriesTable)
          .where(inArray(industriesTable.id, industryIds))
      : [];
    const industryById = new Map(industries.map((i) => [i.id, { id: i.id, name: i.name, slug: i.slug }]));
    const analogues = hitRows
      .map((r) => {
        const score = scoreByPg.get(r.id) ?? 1;
        return {
          pgId: r.id,
          name: r.name,
          slug: r.slug,
          industry: industryById.get(r.industryId) ?? null,
          score,
          similarity: Math.max(0, Math.min(1, 1 - score)),
        };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 10);
    res.set("Cache-Control", "public, max-age=600");
    res.json({
      capabilityId: capId,
      sourceIndustryId: cap.industryId,
      available: true,
      analogues,
    });
  } catch (err) {
    logger.error({ err, capId }, "[capability-graph-insights] industry-analogues failed");
    res.status(500).json({ error: "Failed to load industry analogues" });
  }
});

// ── Bi-temporal platform CVI from Graphiti episodes (admin-style) ────────
//
// The cvi_capability_history endpoint above covers per-cap history from
// Postgres. This one demonstrates the Graphiti bi-temporal feature — it
// reads the 322 :Episodic nodes the backfill landed (one per
// cvi_snapshots row, with valid_at = snapshot timestamp) and returns the
// platform-level trajectory. Useful for the global "what was the
// platform CVI on date X" question and as a smoke-test that the
// bi-temporal store is alive.
router.get("/cvi/platform-history-bitemporal", async (req: Request, res: Response) => {
  if (!isGraphitiEnabled()) {
    res.json({ available: false, reason: "USE_GRAPHITI_WORLD_MODEL not set", points: [] });
    return;
  }
  const days = Math.max(1, Math.min(730, Number(req.query.days ?? 180)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const result = await queryCypher({
      cypher:
        "MATCH (e:Episodic) WHERE e.name STARTS WITH 'cvi-snapshot-' AND e.valid_at >= $since " +
        "RETURN e.name AS name, e.valid_at AS validAt, e.content AS content " +
        "ORDER BY e.valid_at ASC",
      params: { since },
    });
    if (!result.ok || !result.rows) {
      res.json({ available: true, points: [], count: 0, error: result.error });
      return;
    }
    const points = result.rows.map((r) => {
      const content = String(r.content ?? "");
      // Parse "Platform CVI snapshot at <iso>: overall <X>...
      const m = content.match(/overall\s+([0-9]+(?:\.[0-9]+)?)/i);
      const overall = m ? Number(m[1]) : null;
      return {
        name: String(r.name ?? ""),
        validAt: String(r.validAt ?? ""),
        overall,
        summary: content.slice(0, 300),
      };
    });
    res.set("Cache-Control", "public, max-age=600");
    res.json({ available: true, days, points, count: points.length });
  } catch (err) {
    logger.error({ err }, "[capability-graph-insights] bitemporal platform-history failed");
    res.status(500).json({ error: "Failed to load bitemporal history" });
  }
});

export default router;
