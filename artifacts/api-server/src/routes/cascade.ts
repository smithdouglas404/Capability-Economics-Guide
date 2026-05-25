/**
 * Capability cascade — "if this capability fails, these N downstream break."
 *
 * Returns the n-hop downstream cascade rooted at `:id`: every capability that
 * transitively depends on the root through any path, annotated with the EVaR
 * (revenue_exposure_mm) from capability_alpha so the side panel can render a
 * total cascade-impact $ figure alongside per-node risk.
 *
 * Read path:
 *  - When USE_GRAPHITI_WORLD_MODEL=1 → uses cypherCascadeImpacted for
 *    multi-hop traversal in Graphiti+FalkorDB (path-aware, faster on
 *    dense graphs).
 *  - Otherwise → recursive Postgres CTE on capability_dependencies. The
 *    semantics match: starting from the root, walk dependencies in reverse
 *    (anything where depends_on_id = root) and recurse.
 *
 * Both paths surface the path-from-root as an array of capability names so
 * the panel can show "Pricing Engine ← Risk Underwriting ← Claims Triage"
 * lineage even on multi-hop nodes.
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, capabilitiesTable, capabilityAlphaTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { cypherCascadeImpacted, useGraphitiWorldModel } from "../services/agent/capabilityGraphSync";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const Query = z.object({
  depth: z.coerce.number().int().min(1).max(6).optional(),
});

export interface CascadeNode {
  capabilityId: number;
  name: string;
  distance: number;
  evarAtRisk: number | null;  // capability_alpha.revenue_exposure_mm in $MM
  pathFrom: string[];          // chain of capability names from root → this node (inclusive)
}

interface CascadeResponse {
  rootCapabilityId: number;
  rootCapabilityName: string;
  depth: number;
  source: "graph" | "postgres";
  totalImpactUsdMm: number;
  nodes: CascadeNode[];
}

router.get("/cascade/:capabilityId", async (req, res) => {
  const rootId = Number(req.params.capabilityId);
  if (!Number.isInteger(rootId) || rootId <= 0) {
    res.status(400).json({ error: "Invalid capability id" });
    return;
  }
  const parsed = Query.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.issues });
    return;
  }
  const depth = parsed.data.depth ?? 3;

  try {
    const [root] = await db
      .select({ id: capabilitiesTable.id, name: capabilitiesTable.name })
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.id, rootId));
    if (!root) {
      res.status(404).json({ error: "Capability not found" });
      return;
    }

    // ── Stage 1: enumerate (id, distance) via Graphiti or Postgres CTE ──
    let rawNodes: Array<{ id: number; distance: number }> = [];
    let source: "graph" | "postgres" = "postgres";

    if (useGraphitiWorldModel()) {
      const cypher = await cypherCascadeImpacted(rootId, depth);
      if (cypher) {
        rawNodes = cypher.map(c => ({ id: c.pgId, distance: c.hops }));
        source = "graph";
      }
    }

    if (source === "postgres") {
      // Recursive CTE — walk capability_dependencies in reverse from the root.
      // Direction: cap_a depends_on cap_b means "if cap_b fails, cap_a is impacted".
      // So we seed with (cap where depends_on_id = root, distance=1) and recurse.
      const rows = await db.execute<{ capability_id: number; distance: number }>(
        sql`
          WITH RECURSIVE downstream AS (
            SELECT capability_id, 1::int AS distance
            FROM capability_dependencies
            WHERE depends_on_id = ${rootId}

            UNION

            SELECT d.capability_id, downstream.distance + 1
            FROM capability_dependencies d
            JOIN downstream ON d.depends_on_id = downstream.capability_id
            WHERE downstream.distance < ${depth}
          )
          SELECT capability_id, MIN(distance)::int AS distance
          FROM downstream
          GROUP BY capability_id
          ORDER BY distance ASC, capability_id ASC
        `,
      );
      rawNodes = rows.rows.map(r => ({ id: Number(r.capability_id), distance: Number(r.distance) }));
    }

    if (rawNodes.length === 0) {
      const empty: CascadeResponse = {
        rootCapabilityId: rootId,
        rootCapabilityName: root.name,
        depth,
        source,
        totalImpactUsdMm: 0,
        nodes: [],
      };
      res.set("Cache-Control", "public, max-age=300");
      res.json(empty);
      return;
    }

    // ── Stage 2: hydrate names + EVaR in two batched queries ──
    const ids = rawNodes.map(n => n.id);
    const [capRows, alphaRows] = await Promise.all([
      db
        .select({ id: capabilitiesTable.id, name: capabilitiesTable.name })
        .from(capabilitiesTable)
        .where(inArray(capabilitiesTable.id, ids)),
      db
        .select({
          capabilityId: capabilityAlphaTable.capabilityId,
          revenueExposureMm: capabilityAlphaTable.revenueExposureMm,
        })
        .from(capabilityAlphaTable)
        .where(inArray(capabilityAlphaTable.capabilityId, ids)),
    ]);
    const nameById = new Map<number, string>(capRows.map(c => [c.id, c.name]));
    // capability_alpha can have multiple rows per cap (multiple runs) — keep most
    // recent non-null revenueExposureMm by iterating; for simplicity we take any.
    const evarById = new Map<number, number | null>();
    for (const a of alphaRows) {
      if (a.revenueExposureMm !== null && a.revenueExposureMm !== undefined) {
        evarById.set(a.capabilityId, a.revenueExposureMm);
      }
    }

    // ── Stage 3: compute pathFrom by walking parents via Postgres ──
    // For each node, pathFrom is [root.name, …intermediates…, node.name].
    // We materialize one map of "shortest predecessor in cascade" using a BFS
    // over capability_dependencies starting from the root (Postgres-only, even
    // when Graphiti returned the ids — keeps the implementation small).
    const predecessorByCap = new Map<number, number>(); // capId → its parent in the BFS tree
    {
      const queue: number[] = [rootId];
      const visited = new Set<number>([rootId]);
      let hops = 0;
      while (queue.length > 0 && hops < depth) {
        const frontier = queue.splice(0, queue.length);
        // Validate ids are integers before interpolating (frontier originates
        // from rootId + DB-returned numerics — but belt-and-suspenders).
        const safeFrontier = frontier.filter(n => Number.isInteger(n));
        if (safeFrontier.length === 0) break;
        hops += 1;
        const arrayLiteral = `ARRAY[${safeFrontier.map(n => Number(n)).join(",")}]::int[]`;
        const nextRows = await db.execute<{ capability_id: number; depends_on_id: number }>(
          sql`
            SELECT capability_id, depends_on_id
            FROM capability_dependencies
            WHERE depends_on_id = ANY(${sql.raw(arrayLiteral)})
          `,
        );
        for (const r of nextRows.rows) {
          const childId = Number(r.capability_id);
          const parentId = Number(r.depends_on_id);
          if (!visited.has(childId)) {
            visited.add(childId);
            predecessorByCap.set(childId, parentId);
            queue.push(childId);
          }
        }
      }
    }

    function buildPath(capId: number): string[] {
      const chain: number[] = [capId];
      let cur = capId;
      const guard = new Set<number>([capId]);
      while (predecessorByCap.has(cur)) {
        const p = predecessorByCap.get(cur)!;
        if (guard.has(p)) break; // cycle guard
        guard.add(p);
        chain.push(p);
        cur = p;
      }
      // chain currently leaf→root; prepend root if not already terminal there
      if (chain[chain.length - 1] !== rootId) chain.push(rootId);
      chain.reverse();
      return chain.map(id => id === rootId ? root.name : (nameById.get(id) ?? `#${id}`));
    }

    const nodes: CascadeNode[] = rawNodes.map(n => ({
      capabilityId: n.id,
      name: nameById.get(n.id) ?? `#${n.id}`,
      distance: n.distance,
      evarAtRisk: evarById.get(n.id) ?? null,
      pathFrom: buildPath(n.id),
    }));

    const totalImpactUsdMm = nodes.reduce((sum, n) => sum + (n.evarAtRisk ?? 0), 0);

    const result: CascadeResponse = {
      rootCapabilityId: rootId,
      rootCapabilityName: root.name,
      depth,
      source,
      totalImpactUsdMm: Math.round(totalImpactUsdMm * 100) / 100,
      nodes,
    };
    res.set("Cache-Control", "public, max-age=300");
    res.json(result);
  } catch (err) {
    logger.error({ err, rootId, depth }, "cascade endpoint failed");
    res.status(500).json({ error: "Failed to compute cascade" });
  }
});

export default router;
