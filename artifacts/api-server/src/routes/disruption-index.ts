/**
 * Public Disruption Index API. Reads from capability_disruption_index +
 * its sibling tables. Write paths (recompute, lab scenarios, conversational
 * pitch entry) are in admin-disruption-index.ts (commit 9) + lab-disruption
 * .ts (commit 8). This file is pure read.
 *
 *   GET /api/disruption-index                    — list rows, sortable + filterable
 *   GET /api/disruption-index/capability/:id     — full detail (DI + narrative +
 *                                                  top techs + candidates + all
 *                                                  playbook similarities)
 *   GET /api/disruption-index/archetypes         — list playbook archetypes
 *                                                  (for the lab UI)
 *   GET /api/disruption-index/enabling-tech      — list enabling-tech catalog
 *                                                  (for the lab UI)
 *
 * No auth required — DI is part of the public capability narrative.
 * Admin-protected recompute lives separately.
 */
import { Router, type Request, type Response } from "express";
import {
  db,
  capabilityDisruptionIndexTable,
  capabilitiesTable,
  industriesTable,
  disruptionPlaybookArchetypesTable,
  disruptionPlaybookMatchesTable,
  disruptionEnablingTechTable,
} from "@workspace/db";
import { eq, desc, sql, inArray, and, gte } from "drizzle-orm";

const router = Router();

// ─── GET /api/disruption-index — sortable + filterable list ──────────────
//
// Query params (all optional):
//   industryId   — filter to one industry
//   minDi        — composite_di >= this
//   playbookSlug — only caps whose top playbook is this slug
//   sortBy       — composite_di | asset_friction | enabling_tech_strength |
//                  jtbd_abstractability | trust_replaceability |
//                  latent_supply_multiplier | margin_asymmetry
//   sortDir      — desc (default) | asc
//   limit        — default 50, max 200
//   offset       — default 0
router.get("/disruption-index", async (req: Request, res: Response) => {
  try {
    const industryId = req.query.industryId ? Number(req.query.industryId) : null;
    const minDi = req.query.minDi ? Number(req.query.minDi) : 0;
    const playbookSlug = typeof req.query.playbookSlug === "string" ? req.query.playbookSlug : null;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const sortBy = ((): string => {
      const s = typeof req.query.sortBy === "string" ? req.query.sortBy : "composite_di";
      const allowed = [
        "composite_di", "asset_friction", "enabling_tech_strength",
        "jtbd_abstractability", "trust_replaceability",
        "latent_supply_multiplier", "margin_asymmetry",
      ];
      return allowed.includes(s) ? s : "composite_di";
    })();
    const sortDir = req.query.sortDir === "asc" ? "asc" : "desc";

    // Build a single SQL with optional joins so we can return the cap +
    // industry + playbook names in one shot.
    let playbookFilter: number | null = null;
    if (playbookSlug) {
      const [pb] = await db
        .select({ id: disruptionPlaybookArchetypesTable.id })
        .from(disruptionPlaybookArchetypesTable)
        .where(eq(disruptionPlaybookArchetypesTable.slug, playbookSlug))
        .limit(1);
      playbookFilter = pb?.id ?? -1; // -1 forces 0 results
    }

    const rows = await db.execute(sql`
      SELECT
        di.id,
        di.capability_id AS "capabilityId",
        c.name AS "capabilityName",
        c.slug AS "capabilitySlug",
        c.industry_id AS "industryId",
        i.name AS "industryName",
        di.asset_friction AS "assetFriction",
        di.jtbd_abstractability AS "jtbdAbstractability",
        di.enabling_tech_strength AS "enablingTechStrength",
        di.trust_replaceability AS "trustReplaceability",
        di.latent_supply_multiplier AS "latentSupplyMultiplier",
        di.margin_asymmetry AS "marginAsymmetry",
        di.composite_di AS "compositeDi",
        di.top_playbook_id AS "topPlaybookId",
        di.top_playbook_similarity AS "topPlaybookSimilarity",
        pb.name AS "topPlaybookName",
        pb.slug AS "topPlaybookSlug",
        di.top_enabling_tech_ids AS "topEnablingTechIds",
        di.computed_at AS "computedAt"
      FROM capability_disruption_index di
      JOIN capabilities c ON c.id = di.capability_id
      JOIN industries i ON i.id = c.industry_id
      LEFT JOIN disruption_playbook_archetypes pb ON pb.id = di.top_playbook_id
      WHERE di.composite_di >= ${minDi}
        ${industryId !== null ? sql`AND c.industry_id = ${industryId}` : sql``}
        ${playbookFilter !== null ? sql`AND di.top_playbook_id = ${playbookFilter}` : sql``}
      ORDER BY di.${sql.raw(sortBy)} ${sql.raw(sortDir)} NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `);

    const data = (rows.rows ?? rows) as Array<Record<string, unknown>>;

    // Hydrate dominant-force per row (highest sub-score by value) — useful for
    // the table's "what's driving this" column.
    const enriched = data.map((r) => {
      const subscores: Record<string, number> = {
        assetFriction: r.assetFriction as number,
        jtbdAbstractability: r.jtbdAbstractability as number,
        enablingTechStrength: r.enablingTechStrength as number,
        trustReplaceability: r.trustReplaceability as number,
        latentSupplyMultiplier: r.latentSupplyMultiplier as number,
        marginAsymmetry: r.marginAsymmetry as number,
      };
      const dominantForce = Object.entries(subscores).sort((a, b) => b[1] - a[1])[0][0];
      return { ...r, dominantForce };
    });

    // Total count for pagination.
    const [{ total }] = (await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM capability_disruption_index di
      JOIN capabilities c ON c.id = di.capability_id
      WHERE di.composite_di >= ${minDi}
        ${industryId !== null ? sql`AND c.industry_id = ${industryId}` : sql``}
        ${playbookFilter !== null ? sql`AND di.top_playbook_id = ${playbookFilter}` : sql``}
    `)).rows as Array<{ total: number }>;

    res.json({ total, limit, offset, sortBy, sortDir, rows: enriched });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── GET /api/disruption-index/capability/:id — full detail ─────────────
router.get("/disruption-index/capability/:id", async (req: Request, res: Response) => {
  try {
    const capabilityId = Number(req.params.id);
    if (!Number.isFinite(capabilityId)) {
      res.status(400).json({ error: "invalid capability id" });
      return;
    }

    const [di] = await db
      .select()
      .from(capabilityDisruptionIndexTable)
      .where(eq(capabilityDisruptionIndexTable.capabilityId, capabilityId))
      .limit(1);
    if (!di) {
      res.status(404).json({ error: "No DI score yet for this capability — request a recompute via /api/admin/disruption-index/recompute/:id" });
      return;
    }

    const [cap] = await db
      .select({ id: capabilitiesTable.id, name: capabilitiesTable.name, slug: capabilitiesTable.slug, industryId: capabilitiesTable.industryId })
      .from(capabilitiesTable)
      .where(eq(capabilitiesTable.id, capabilityId))
      .limit(1);
    const [industry] = cap
      ? await db.select({ id: industriesTable.id, name: industriesTable.name }).from(industriesTable).where(eq(industriesTable.id, cap.industryId)).limit(1)
      : [];

    const matches = await db
      .select({
        playbookId: disruptionPlaybookMatchesTable.playbookId,
        similarity: disruptionPlaybookMatchesTable.similarity,
        name: disruptionPlaybookArchetypesTable.name,
        slug: disruptionPlaybookArchetypesTable.slug,
        summary: disruptionPlaybookArchetypesTable.summary,
      })
      .from(disruptionPlaybookMatchesTable)
      .innerJoin(disruptionPlaybookArchetypesTable, eq(disruptionPlaybookArchetypesTable.id, disruptionPlaybookMatchesTable.playbookId))
      .where(eq(disruptionPlaybookMatchesTable.capabilityId, capabilityId))
      .orderBy(desc(disruptionPlaybookMatchesTable.similarity));

    const topTechIds = (di.topEnablingTechIds ?? []) as number[];
    const topTech = topTechIds.length > 0
      ? await db
          .select({
            id: disruptionEnablingTechTable.id,
            slug: disruptionEnablingTechTable.slug,
            name: disruptionEnablingTechTable.name,
            category: disruptionEnablingTechTable.category,
            maturityYear: disruptionEnablingTechTable.maturityYear,
            description: disruptionEnablingTechTable.description,
          })
          .from(disruptionEnablingTechTable)
          .where(inArray(disruptionEnablingTechTable.id, topTechIds))
      : [];

    res.json({
      capability: cap ? { ...cap, industryName: industry?.name ?? null } : null,
      subscores: {
        assetFriction: di.assetFriction,
        jtbdAbstractability: di.jtbdAbstractability,
        enablingTechStrength: di.enablingTechStrength,
        trustReplaceability: di.trustReplaceability,
        latentSupplyMultiplier: di.latentSupplyMultiplier,
        marginAsymmetry: di.marginAsymmetry,
      },
      compositeDi: di.compositeDi,
      narrative: di.narrative,
      rationale: di.rationale,
      topPlaybook: matches[0] ?? null,
      playbookMatches: matches,
      topEnablingTech: topTech,
      candidateDisruptors: di.candidateDisruptors,
      computedAt: di.computedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── GET /api/disruption-index/archetypes ───────────────────────────────
router.get("/disruption-index/archetypes", async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(disruptionPlaybookArchetypesTable)
      .orderBy(disruptionPlaybookArchetypesTable.id);
    res.json({ archetypes: rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── GET /api/disruption-index/enabling-tech ────────────────────────────
router.get("/disruption-index/enabling-tech", async (req: Request, res: Response) => {
  try {
    const category = typeof req.query.category === "string" ? req.query.category : null;
    const rows = category
      ? await db.select().from(disruptionEnablingTechTable).where(eq(disruptionEnablingTechTable.category, category))
      : await db.select().from(disruptionEnablingTechTable);
    res.json({ enablingTech: rows.sort((a, b) => b.maturityYear - a.maturityYear) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── GET /api/disruption-index/frontier — top-N newly elevated ──────────
//
// Convenience for the synthesis brief + dashboard hero. Returns the
// top-N capabilities by composite_di whose row was computed in the last
// `recentDays` (default 7).
router.get("/disruption-index/frontier", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const recentDays = Math.min(90, Math.max(1, Number(req.query.recentDays) || 7));
    const cutoff = new Date(Date.now() - recentDays * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        capabilityId: capabilityDisruptionIndexTable.capabilityId,
        compositeDi: capabilityDisruptionIndexTable.compositeDi,
        topPlaybookId: capabilityDisruptionIndexTable.topPlaybookId,
        computedAt: capabilityDisruptionIndexTable.computedAt,
        capabilityName: capabilitiesTable.name,
        industryName: industriesTable.name,
        playbookName: disruptionPlaybookArchetypesTable.name,
        playbookSlug: disruptionPlaybookArchetypesTable.slug,
      })
      .from(capabilityDisruptionIndexTable)
      .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, capabilityDisruptionIndexTable.capabilityId))
      .innerJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId))
      .leftJoin(disruptionPlaybookArchetypesTable, eq(disruptionPlaybookArchetypesTable.id, capabilityDisruptionIndexTable.topPlaybookId))
      .where(and(
        gte(capabilityDisruptionIndexTable.computedAt, cutoff),
      ))
      .orderBy(desc(capabilityDisruptionIndexTable.compositeDi))
      .limit(limit);

    res.json({ recentDays, rows });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
