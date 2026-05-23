import { Router } from "express";
import { db } from "@workspace/db";
import {
  regulationsTable,
  regulationCapabilityRequirementsTable,
  capabilitiesTable,
  organizationsTable,
  organizationCapabilitiesTable,
  capabilityAlphaTable,
  regulationWatchesTable,
  regulationEnforcementForecastsTable,
} from "@workspace/db";
import { eq, inArray, and, sql, desc, gt } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { getAuth } from "@clerk/express";

const router = Router();

interface RequirementResult {
  capabilityId: number;
  capabilityName: string | null;
  requiredMaturity: number;
  priority: string;
  article: string | null;
  evidenceNotes: string | null;
  myScore: number | null;
  compliant: boolean | null;
  gap: number | null;
}

interface ComplianceSummary {
  regulation: typeof regulationsTable.$inferSelect;
  overallCompliance: number | null;
  total: number;
  assessed: number;
  compliant: number;
  nonCompliant: number;
  criticalGaps: number;
  results: RequirementResult[];
}

/**
 * Conservative 12-month EVaR for a capability:
 *   evar12 = revenue × margin × (1 - 0.5^(12/max(6, halfLifeMonths)))
 * Returns 0 if any of the required alpha fields is missing — same strict
 * policy as the /api/alpha/evar route.
 */
function evar12ForAlpha(a: {
  revenueExposureMm: number | null;
  marginStructurePct: number | null;
  halfLifeMonths: number | null;
}): number {
  if (a.revenueExposureMm == null || a.marginStructurePct == null || a.halfLifeMonths == null) return 0;
  const halfLife = Math.max(6, a.halfLifeMonths);
  const fracLost = 1 - Math.pow(0.5, 12 / halfLife);
  return a.revenueExposureMm * (a.marginStructurePct / 100) * fracLost;
}

/**
 * Compute compliance for a single regulation against the org keyed by
 * sessionToken. Shared by the detail (`/regulations/:id/compliance`) and
 * overview (`/regulations/overview`) endpoints so the math stays in one place.
 *
 * Returns null when the regulation id is invalid.
 */
async function computeComplianceFor(
  regulationId: number,
  sessionToken: string,
): Promise<ComplianceSummary | null> {
  const [reg] = await db.select().from(regulationsTable).where(eq(regulationsTable.id, regulationId));
  if (!reg) return null;

  const reqs = await db
    .select({
      req: regulationCapabilityRequirementsTable,
      capabilityName: capabilitiesTable.name,
    })
    .from(regulationCapabilityRequirementsTable)
    .leftJoin(capabilitiesTable, eq(regulationCapabilityRequirementsTable.capabilityId, capabilitiesTable.id))
    .where(eq(regulationCapabilityRequirementsTable.regulationId, regulationId));

  let orgScores = new Map<number, number>();
  if (sessionToken) {
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, sessionToken));
    if (org) {
      const caps = await db
        .select()
        .from(organizationCapabilitiesTable)
        .where(eq(organizationCapabilitiesTable.organizationId, org.id));
      orgScores = new Map(caps.map((c) => [c.capabilityId, c.maturityScore]));
    }
  }

  const results: RequirementResult[] = reqs.map((r) => {
    const myScore = orgScores.get(r.req.capabilityId) ?? null;
    const required = r.req.requiredMaturity;
    const compliant = myScore !== null ? myScore >= required : null;
    const gap = myScore !== null ? myScore - required : null;
    return {
      capabilityId: r.req.capabilityId,
      capabilityName: r.capabilityName,
      requiredMaturity: required,
      priority: r.req.priority,
      article: r.req.article,
      evidenceNotes: r.req.evidenceNotes,
      myScore,
      compliant,
      gap,
    };
  });

  const total = results.length;
  const assessed = results.filter((r) => r.myScore !== null).length;
  const compliantCount = results.filter((r) => r.compliant === true).length;
  const nonCompliant = results.filter((r) => r.compliant === false);
  const criticalGaps = nonCompliant.filter((r) => r.priority === "required").length;

  return {
    regulation: reg,
    overallCompliance: assessed > 0 ? Math.round((compliantCount / assessed) * 100) : null,
    total,
    assessed,
    compliant: compliantCount,
    nonCompliant: nonCompliant.length,
    criticalGaps,
    results,
  };
}

// List all regulations
router.get("/regulations", async (req, res) => {
  try {
    const rows = await db.select().from(regulationsTable);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Overview — one row per regulation with compliance, gap counts, and the
 * EVaR-weighted dollar exposure. Optionally filtered by industryId. The
 * EVaR weight is summed across each regulation's requirements:
 *   gap_fraction      = max(0, (required - myScore) / required)
 *   requirement_evar  = gap_fraction × evar12_for_capability
 * Sort: evarWeightedExposure desc (largest dollar exposure first).
 */
router.get("/regulations/overview", async (req, res) => {
  try {
    const industryId = req.query.industryId ? Number(req.query.industryId) : null;
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";

    const allRegs = await db.select().from(regulationsTable);
    const regs = industryId
      ? allRegs.filter((r) => Array.isArray(r.industries) && (r.industries as number[]).includes(industryId))
      : allRegs;

    if (regs.length === 0) {
      res.json({ rows: [], industryId, totalCount: allRegs.length, filteredCount: 0 });
      return;
    }

    const regIds = regs.map((r) => r.id);

    // Pull all requirements for these regulations in one shot
    const allReqs = await db
      .select()
      .from(regulationCapabilityRequirementsTable)
      .where(inArray(regulationCapabilityRequirementsTable.regulationId, regIds));

    const capIds = Array.from(new Set(allReqs.map((r) => r.capabilityId)));

    // Capability alpha lookup (for EVaR weighting). One pass, in-memory join.
    const alphaRows = capIds.length > 0
      ? await db
          .select()
          .from(capabilityAlphaTable)
          .where(inArray(capabilityAlphaTable.capabilityId, capIds))
      : [];
    const alphaByCap = new Map(alphaRows.map((a) => [a.capabilityId, a]));

    // Org scores (single lookup)
    let orgScores = new Map<number, number>();
    if (token) {
      const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.sessionToken, token));
      if (org) {
        const caps = await db
          .select()
          .from(organizationCapabilitiesTable)
          .where(eq(organizationCapabilitiesTable.organizationId, org.id));
        orgScores = new Map(caps.map((c) => [c.capabilityId, c.maturityScore]));
      }
    }

    const reqsByReg = new Map<number, typeof allReqs>();
    for (const r of allReqs) {
      const arr = reqsByReg.get(r.regulationId) ?? [];
      arr.push(r);
      reqsByReg.set(r.regulationId, arr);
    }

    // Latest in-window enforcement forecast per regulation, if any.
    const forecasts = await db
      .select()
      .from(regulationEnforcementForecastsTable)
      .where(and(inArray(regulationEnforcementForecastsTable.regulationId, regIds), gt(regulationEnforcementForecastsTable.validUntil, new Date())))
      .orderBy(desc(regulationEnforcementForecastsTable.forecastedAt));
    const forecastByReg = new Map<number, typeof forecasts[number]>();
    for (const f of forecasts) {
      if (!forecastByReg.has(f.regulationId)) forecastByReg.set(f.regulationId, f);
    }

    const rows = regs.map((reg) => {
      const reqList = reqsByReg.get(reg.id) ?? [];
      let assessed = 0;
      let compliant = 0;
      let nonCompliant = 0;
      let criticalGaps = 0;
      let totalGapPoints = 0;
      let evarWeightedExposure = 0;

      for (const r of reqList) {
        const score = orgScores.get(r.capabilityId) ?? null;
        if (score === null) continue;
        assessed++;
        if (score >= r.requiredMaturity) {
          compliant++;
        } else {
          nonCompliant++;
          if (r.priority === "required") criticalGaps++;
          const gapFraction = Math.max(0, (r.requiredMaturity - score) / Math.max(1, r.requiredMaturity));
          totalGapPoints += r.requiredMaturity - score;
          const alpha = alphaByCap.get(r.capabilityId);
          if (alpha) {
            evarWeightedExposure += gapFraction * evar12ForAlpha(alpha);
          }
        }
      }

      const forecast = forecastByReg.get(reg.id);
      return {
        regulation: reg,
        overallCompliance: assessed > 0 ? Math.round((compliant / assessed) * 100) : null,
        total: reqList.length,
        assessed,
        compliant,
        nonCompliant,
        criticalGaps,
        totalGapPoints: Math.round(totalGapPoints * 10) / 10,
        evarWeightedExposure: Math.round(evarWeightedExposure * 10) / 10,
        enforcementForecast: forecast
          ? {
              direction: forecast.direction as "stricter" | "steady" | "softer",
              confidence: forecast.confidence,
              summary: forecast.summary,
              forecastedAt: forecast.forecastedAt.toISOString(),
            }
          : null,
      };
    });

    rows.sort((a, b) => {
      if (b.evarWeightedExposure !== a.evarWeightedExposure) {
        return b.evarWeightedExposure - a.evarWeightedExposure;
      }
      return b.criticalGaps - a.criticalGaps;
    });

    res.json({
      rows,
      industryId,
      totalCount: allRegs.length,
      filteredCount: rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get regulation with requirements
router.get("/regulations/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [reg] = await db.select().from(regulationsTable).where(eq(regulationsTable.id, id));
    if (!reg) { res.status(404).json({ error: "Not found" }); return; }

    const reqs = await db.select({
      req: regulationCapabilityRequirementsTable,
      capabilityName: capabilitiesTable.name,
      benchmarkScore: capabilitiesTable.benchmarkScore,
    })
      .from(regulationCapabilityRequirementsTable)
      .leftJoin(capabilitiesTable, eq(regulationCapabilityRequirementsTable.capabilityId, capabilitiesTable.id))
      .where(eq(regulationCapabilityRequirementsTable.regulationId, id));

    res.json({ ...reg, requirements: reqs.map((r) => ({ ...r.req, capabilityName: r.capabilityName, benchmarkScore: r.benchmarkScore })) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Create regulation — global catalog write, admin-only.
router.post("/regulations", requireAdmin, async (req, res) => {
  try {
    const { name, shortCode, description, jurisdiction, effectiveDate, industries } = req.body;
    const [reg] = await db.insert(regulationsTable).values({
      name, shortCode, description,
      jurisdiction: jurisdiction ?? "global",
      effectiveDate: effectiveDate ? new Date(effectiveDate) : undefined,
      industries: industries ?? [],
    }).returning();
    res.json(reg);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Edit existing regulation — global catalog write, admin-only.
router.patch("/regulations/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
    const body = req.body as Partial<{
      name: string;
      description: string | null;
      jurisdiction: string;
      effectiveDate: string | null;
      industries: number[];
    }>;
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (body.description !== undefined) patch.description = body.description;
    if (typeof body.jurisdiction === "string") patch.jurisdiction = body.jurisdiction;
    if (body.effectiveDate !== undefined) patch.effectiveDate = body.effectiveDate ? new Date(body.effectiveDate) : null;
    if (Array.isArray(body.industries)) patch.industries = body.industries;
    if (Object.keys(patch).length === 0) { res.status(400).json({ error: "Nothing to patch" }); return; }
    const [row] = await db.update(regulationsTable).set(patch).where(eq(regulationsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Edit existing requirement — admin-only.
router.patch("/regulations/:id/requirements/:reqId", requireAdmin, async (req, res) => {
  try {
    const reqId = Number(req.params.reqId);
    if (!Number.isInteger(reqId) || reqId <= 0) { res.status(400).json({ error: "Invalid reqId" }); return; }
    const body = req.body as Partial<{
      requiredMaturity: number;
      priority: string;
      evidenceNotes: string | null;
      article: string | null;
    }>;
    const patch: Record<string, unknown> = {};
    if (typeof body.requiredMaturity === "number") patch.requiredMaturity = body.requiredMaturity;
    if (typeof body.priority === "string") patch.priority = body.priority;
    if (body.evidenceNotes !== undefined) patch.evidenceNotes = body.evidenceNotes;
    if (body.article !== undefined) patch.article = body.article;
    if (Object.keys(patch).length === 0) { res.status(400).json({ error: "Nothing to patch" }); return; }
    const [row] = await db.update(regulationCapabilityRequirementsTable).set(patch).where(eq(regulationCapabilityRequirementsTable.id, reqId)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Delete a requirement — admin-only.
router.delete("/regulations/:id/requirements/:reqId", requireAdmin, async (req, res) => {
  try {
    const reqId = Number(req.params.reqId);
    if (!Number.isInteger(reqId) || reqId <= 0) { res.status(400).json({ error: "Invalid reqId" }); return; }
    await db.delete(regulationCapabilityRequirementsTable).where(eq(regulationCapabilityRequirementsTable.id, reqId));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Add capability requirement — global catalog write, admin-only.
router.post("/regulations/:id/requirements", requireAdmin, async (req, res) => {
  try {
    const regulationId = Number(req.params.id);
    const { capabilityId, requiredMaturity, priority, evidenceNotes, article } = req.body;
    if (!capabilityId || requiredMaturity == null) { res.status(400).json({ error: "capabilityId and requiredMaturity are required" }); return; }
    const [row] = await db.insert(regulationCapabilityRequirementsTable).values({
      regulationId,
      capabilityId,
      requiredMaturity,
      priority: priority ?? "required",
      evidenceNotes,
      article,
    }).returning();
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Check compliance for an organization — now backed by computeComplianceFor.
router.get("/regulations/:id/compliance", async (req, res) => {
  try {
    const regId = Number(req.params.id);
    const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
    const result = await computeComplianceFor(regId, token);
    if (!result) { res.status(404).json({ error: "Regulation not found" }); return; }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Delete regulation — regulations are GLOBAL reference data (no tenant column),
// so writes must be admin-only. Pre-fix any caller could wipe the catalog.
router.delete("/regulations/:id", requireAdmin, async (req, res) => {
  try {
    await db.delete(regulationsTable).where(eq(regulationsTable.id, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── Per-user regulation watches ───────────────────────────────────────

router.get("/me/regulation-watches", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const rows = await db
      .select({
        watch: regulationWatchesTable,
        regulation: regulationsTable,
      })
      .from(regulationWatchesTable)
      .innerJoin(regulationsTable, eq(regulationWatchesTable.regulationId, regulationsTable.id))
      .where(eq(regulationWatchesTable.userId, auth.userId));
    res.json(rows.map(r => ({ ...r.watch, regulation: r.regulation })));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/me/regulation-watches/:regulationId", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const regId = Number(req.params.regulationId);
    if (!Number.isInteger(regId) || regId <= 0) { res.status(400).json({ error: "Invalid regulationId" }); return; }
    const [reg] = await db.select().from(regulationsTable).where(eq(regulationsTable.id, regId));
    if (!reg) { res.status(404).json({ error: "Regulation not found" }); return; }

    // Idempotent on (user_id, regulation_id)
    await db
      .insert(regulationWatchesTable)
      .values({ userId: auth.userId, regulationId: regId })
      .onConflictDoNothing({ target: [regulationWatchesTable.userId, regulationWatchesTable.regulationId] });

    res.json({ ok: true, regulationId: regId });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.delete("/me/regulation-watches/:regulationId", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    const regId = Number(req.params.regulationId);
    if (!Number.isInteger(regId) || regId <= 0) { res.status(400).json({ error: "Invalid regulationId" }); return; }
    await db
      .delete(regulationWatchesTable)
      .where(and(eq(regulationWatchesTable.userId, auth.userId), eq(regulationWatchesTable.regulationId, regId)));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
