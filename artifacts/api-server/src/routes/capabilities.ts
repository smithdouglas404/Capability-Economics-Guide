import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  capabilitiesTable,
  capabilityMetricsTable,
  capabilityDependenciesTable,
  capabilityRoleMappingsTable,
  cSuiteRolesTable,
  ceiComponentsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { ListCapabilitiesQueryParams, GetCapabilityParams } from "@workspace/api-zod";
import { buildLifecycleMap, deriveLifecycleStage } from "../services/lifecycle";
import { getOrFetchCapabilityFilings } from "../services/edgar/capability-filings";
import { getPeerBenchmark } from "../services/peer-benchmarks/aggregator";
import { db as dbConn } from "@workspace/db";
import { ceiSnapshotsTable, ceiCapabilityHistoryTable } from "@workspace/db";
import { gte, desc as descOrder, asc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/capabilities", async (req, res) => {
  const parsed = ListCapabilitiesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }

  const { industryId } = parsed.data;

  const includePending = req.query.includePending === "1" || req.query.includePending === "true";
  let query = db.select().from(capabilitiesTable);
  if (industryId !== undefined && !includePending) {
    query = query.where(and(eq(capabilitiesTable.industryId, industryId), eq(capabilitiesTable.reviewStatus, "approved"))) as typeof query;
  } else if (industryId !== undefined) {
    query = query.where(eq(capabilitiesTable.industryId, industryId)) as typeof query;
  } else if (!includePending) {
    query = query.where(eq(capabilitiesTable.reviewStatus, "approved")) as typeof query;
  }
  const capabilities = await query;

  // Enrich every cap with a derived lifecycle stage (Emerging / Adopted /
  // Mature / Decaying / Obsolete) computed from its current ceiComponents
  // posterior. Computed on read so it can never go stale.
  const capIds = capabilities.map((c) => c.id);
  const components = capIds.length > 0
    ? await db.select({
        capabilityId: ceiComponentsTable.capabilityId,
        consensusScore: ceiComponentsTable.consensusScore,
        velocity: ceiComponentsTable.velocity,
      }).from(ceiComponentsTable).where(inArray(ceiComponentsTable.capabilityId, capIds))
    : [];
  const lifecycleByCap = buildLifecycleMap(capabilities, components);

  res.json(capabilities.map((c) => ({ ...c, lifecycleStage: lifecycleByCap.get(c.id) ?? "adopted" })));
});

router.get("/capabilities/:id", async (req, res) => {
  const parsed = GetCapabilityParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid capability ID" });
    return;
  }

  const { id } = parsed.data;

  const [capability] = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, id));
  if (!capability) {
    res.status(404).json({ error: "Capability not found" });
    return;
  }

  const metrics = await db.select().from(capabilityMetricsTable).where(eq(capabilityMetricsTable.capabilityId, id));

  const depsRaw = await db
    .select({
      id: capabilityDependenciesTable.id,
      dependsOnId: capabilityDependenciesTable.dependsOnId,
      dependsOnName: capabilitiesTable.name,
      strength: capabilityDependenciesTable.strength,
    })
    .from(capabilityDependenciesTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, capabilityDependenciesTable.dependsOnId))
    .where(eq(capabilityDependenciesTable.capabilityId, id));

  const roleMappingsRaw = await db
    .select({
      roleId: capabilityRoleMappingsTable.roleId,
      roleTitle: cSuiteRolesTable.title,
      roleName: cSuiteRolesTable.name,
      relevance: capabilityRoleMappingsTable.relevance,
      perspective: capabilityRoleMappingsTable.perspective,
    })
    .from(capabilityRoleMappingsTable)
    .innerJoin(cSuiteRolesTable, eq(cSuiteRolesTable.id, capabilityRoleMappingsTable.roleId))
    .where(eq(capabilityRoleMappingsTable.capabilityId, id));

  // Derived lifecycle stage from the cap's current CEI posterior.
  const [comp] = await db
    .select({ consensusScore: ceiComponentsTable.consensusScore, velocity: ceiComponentsTable.velocity })
    .from(ceiComponentsTable)
    .where(eq(ceiComponentsTable.capabilityId, id))
    .limit(1);
  const lifecycleStage = deriveLifecycleStage({
    consensusScore: comp?.consensusScore ?? null,
    velocity: comp?.velocity ?? null,
    benchmarkScore: capability.benchmarkScore,
  });

  // Products that contribute to this capability (top contributors first).
  const { listProductsByCapability } = await import("../services/products");
  const products = await listProductsByCapability(id);

  res.json({
    ...capability,
    lifecycleStage,
    metrics,
    dependencies: depsRaw,
    roleMappings: roleMappingsRaw,
    products,
  });
});

router.get("/roles", async (_req, res) => {
  const roles = await db.select().from(cSuiteRolesTable);
  res.json(roles);
});

/**
 * SEC EDGAR filings mentioning this capability. Lazy + usage-driven:
 * serves cache if fresh (< 24h), otherwise hits EDGAR full-text search,
 * upserts hits to capability_filings, and returns the freshened list.
 *
 * Each view increments capability_filing_status.view_count which will
 * later drive a "viewed 10+ times → queue 3-year historical backfill"
 * trigger (Task #2 phase 2).
 */
/**
 * Peer benchmarks for a capability, scoped to the requesting industry.
 * Requires ?industryId=N because the benchmark is per-industry. Returns
 * null + suppressed=true when the cell has fewer than 5 contributors.
 *
 * Composition disclosure: nRealOrgs vs nSyntheticOrgs lets the UI label
 * cells that include synthetic-agent (bot) data honestly.
 */
router.get("/capabilities/:id/peer-benchmark", async (req, res) => {
  const idRaw = req.params.id;
  const capId = parseInt(Array.isArray(idRaw) ? (idRaw[0] ?? "") : idRaw, 10);
  const industryId = Number(req.query.industryId);
  if (!Number.isFinite(capId) || !Number.isFinite(industryId)) {
    res.status(400).json({ error: "Invalid capability id or missing industryId query param" });
    return;
  }
  try {
    const result = await getPeerBenchmark(industryId, capId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch peer benchmark" });
  }
});

/**
 * Per-capability CEI history. Derives the industry index series from
 * cei_snapshots.industryBreakdowns over the requested window. Marks
 * each point as live or reconstructed via methodologyVersion so the
 * frontend can render reconstructed segments differently (dashed line,
 * methodology disclosure).
 *
 * The capability's industry is resolved from the capability row; the
 * series is the industry index, not a per-capability index (that
 * granularity needs a separate per-cap snapshot table — future work).
 */
router.get("/capabilities/:id/cei-history", async (req, res) => {
  const idRaw = req.params.id;
  const capId = parseInt(Array.isArray(idRaw) ? (idRaw[0] ?? "") : idRaw, 10);
  if (!Number.isFinite(capId)) { res.status(400).json({ error: "Invalid capability id" }); return; }
  try {
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 90));
    const [cap] = await dbConn.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, capId)).limit(1);
    if (!cap) { res.status(404).json({ error: "Capability not found" }); return; }
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Prefer per-capability history (cei_capability_history) when available
    // — it's the high-fidelity per-cap series. Falls back to industry-level
    // rollup from cei_snapshots when the per-cap table is empty (early
    // post-deploy state, before the engine has banked enough capability
    // history rows).
    const capHistory = await dbConn
      .select()
      .from(ceiCapabilityHistoryTable)
      .where(and(eq(ceiCapabilityHistoryTable.capabilityId, capId), gte(ceiCapabilityHistoryTable.snapshotAt, since)))
      .orderBy(asc(ceiCapabilityHistoryTable.snapshotAt));

    let series: Array<{ at: string; value: number; reconstructed: boolean }>;
    let granularity: "per-capability" | "industry-rollup";
    if (capHistory.length > 0) {
      granularity = "per-capability";
      series = capHistory.map(h => ({
        at: h.snapshotAt.toISOString(),
        value: h.consensusScore,
        reconstructed: (h.methodologyVersion ?? "").startsWith("reconstructed"),
      }));
    } else {
      granularity = "industry-rollup";
      const snapshots = await dbConn
        .select()
        .from(ceiSnapshotsTable)
        .where(gte(ceiSnapshotsTable.snapshotAt, since))
        .orderBy(descOrder(ceiSnapshotsTable.snapshotAt));
      const industryKey = String(cap.industryId);
      series = snapshots
        .map(snap => {
          const breakdown = (snap.industryBreakdowns as Record<string, { indexValue?: number }> | null)?.[industryKey];
          if (!breakdown || typeof breakdown.indexValue !== "number") return null;
          return {
            at: snap.snapshotAt.toISOString(),
            value: breakdown.indexValue,
            reconstructed: (snap.methodologyVersion ?? "").startsWith("reconstructed"),
          };
        })
        .filter((p): p is { at: string; value: number; reconstructed: boolean } => p !== null)
        .reverse();
    }

    const liveCount = series.filter(p => !p.reconstructed).length;
    const reconstructedCount = series.length - liveCount;
    res.json({
      industryId: cap.industryId,
      capabilityId: capId,
      days,
      granularity,
      series,
      liveCount,
      reconstructedCount,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch CEI history" });
  }
});

router.get("/capabilities/:id/filings", async (req, res) => {
  const idRaw = req.params.id;
  const id = parseInt(Array.isArray(idRaw) ? (idRaw[0] ?? "") : idRaw, 10);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid capability id" }); return; }
  try {
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 20));
    const forceFresh = req.query.fresh === "1";
    const result = await getOrFetchCapabilityFilings(id, { limit, forceFresh });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch SEC filings" });
  }
});

export default router;
