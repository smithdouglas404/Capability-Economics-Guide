/**
 * Portfolio company watch endpoints.
 *
 *   GET    /api/portfolio
 *     Returns the caller's portfolio with current FEVI scores joined
 *     in, plus a digest object summarizing capability movements and
 *     regulatory exposure for the watched companies' industries.
 *
 *   POST   /api/portfolio/companies/:id
 *     Adds the company to the caller's portfolio. Idempotent on
 *     (session_token, company_id). Body may include {notes}.
 *
 *   DELETE /api/portfolio/companies/:id
 *     Removes the company from the caller's portfolio.
 *
 *   PUT    /api/portfolio/companies/:id
 *     Updates the row's notes and alert preferences.
 *
 * Authentication: session-token cookie (the codebase's anonymous
 * identity model) — same pattern as /api/watchlist routes. Falls
 * back to the X-Session-Token header.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  portfolioCompaniesTable,
  companiesTable,
  companyScoresTable,
  companyCapabilityFingerprintTable,
  capabilitiesTable,
  capabilityAlphaTable,
  macroEventsTable,
  regulationCapabilityRequirementsTable,
  regulationsTable,
} from "@workspace/db";
import { eq, inArray, desc, and, gt, sql } from "drizzle-orm";

const router = Router();

/**
 * Conservative 12-month EVaR for a capability — same formula as
 * routes/regulations.ts:evar12ForAlpha. Returns 0 when any required
 * field is missing so the aggregate stays honest rather than guessed.
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

function resolveSessionToken(req: import("express").Request): string {
  const fromCookie = req.headers["cookie"]?.split(";").map(s => s.trim()).find(s => s.startsWith("ce_session_token="))?.split("=")[1];
  const fromHeader = typeof req.headers["x-session-token"] === "string" ? req.headers["x-session-token"] : null;
  return fromCookie || fromHeader || "anonymous";
}

// ── GET /portfolio ───────────────────────────────────────────────────────

router.get("/portfolio", async (req, res) => {
  try {
    const token = resolveSessionToken(req);
    const rows = await db
      .select({
        portfolio: portfolioCompaniesTable,
        company: companiesTable,
        scores: companyScoresTable,
      })
      .from(portfolioCompaniesTable)
      .innerJoin(companiesTable, eq(portfolioCompaniesTable.companyId, companiesTable.id))
      .leftJoin(companyScoresTable, eq(companyScoresTable.companyId, companiesTable.id))
      .where(eq(portfolioCompaniesTable.sessionToken, token))
      .orderBy(desc(portfolioCompaniesTable.addedAt));

    // Optional aggregate digest: macro events + regulatory exposure
    // touching this portfolio's industries
    const companyIds = rows.map(r => r.company.id);
    const industryIds = Array.from(new Set(rows.map(r => r.company.industryId)));

    let macroEvents: typeof macroEventsTable.$inferSelect[] = [];
    if (industryIds.length > 0) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      // macro_events.affected_industry_ids is JSONB array — post-filter in JS
      // since the trailing 30d window is already small (typically ≤ 50 events)
      // and JSONB overlap predicates aren't worth the drizzle complexity here.
      const recent = await db
        .select()
        .from(macroEventsTable)
        .where(gt(macroEventsTable.startedAt, thirtyDaysAgo))
        .orderBy(desc(macroEventsTable.startedAt))
        .limit(100);
      const industrySet = new Set(industryIds);
      macroEvents = recent.filter(e => (e.affectedIndustryIds ?? []).some((id: number) => industrySet.has(id))).slice(0, 20);
    }

    // Regulations that touch the portfolio's capabilities (via the
    // capability fingerprint)
    let regulatoryExposure: Array<{ regulationCode: string; regulationName: string; capabilityName: string; priority: string }> = [];
    if (companyIds.length > 0) {
      const fingerprints = await db
        .select()
        .from(companyCapabilityFingerprintTable)
        .where(inArray(companyCapabilityFingerprintTable.companyId, companyIds));
      const capIds = Array.from(new Set(fingerprints.map(f => f.capabilityId)));
      if (capIds.length > 0) {
        const reqs = await db
          .select({
            reg: regulationsTable,
            cap: capabilitiesTable,
            req: regulationCapabilityRequirementsTable,
          })
          .from(regulationCapabilityRequirementsTable)
          .innerJoin(regulationsTable, eq(regulationsTable.id, regulationCapabilityRequirementsTable.regulationId))
          .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, regulationCapabilityRequirementsTable.capabilityId))
          .where(inArray(regulationCapabilityRequirementsTable.capabilityId, capIds));
        regulatoryExposure = reqs.map(r => ({
          regulationCode: r.reg.shortCode,
          regulationName: r.reg.name,
          capabilityName: r.cap.name,
          priority: r.req.priority,
        }));
      }
    }

    res.json({
      portfolio: rows.map(r => ({
        portfolioId: r.portfolio.id,
        addedAt: r.portfolio.addedAt,
        notes: r.portfolio.notes,
        alerts: {
          feviDelta: r.portfolio.alertFeviDelta,
          capabilityDecay: r.portfolio.alertCapabilityDecay,
          regulationChange: r.portfolio.alertRegulationChange,
        },
        company: r.company,
        scores: r.scores,
      })),
      digest: {
        companyCount: rows.length,
        industryCount: industryIds.length,
        macroEvents: macroEvents.map(e => ({
          id: e.id,
          title: e.title,
          severity: e.severity,
          sentimentDirection: e.sentimentDirection,
          startedAt: e.startedAt,
        })),
        regulatoryExposure,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /portfolio/companies/:id ────────────────────────────────────────

router.post("/portfolio/companies/:id", async (req, res) => {
  try {
    const token = resolveSessionToken(req);
    const companyId = parseInt(String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id), 10);
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "Invalid company id" });
      return;
    }
    const notes = typeof req.body?.notes === "string" ? req.body.notes : null;

    // Verify the company exists
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    // Idempotent upsert on (session_token, company_id)
    const [existing] = await db
      .select()
      .from(portfolioCompaniesTable)
      .where(
        and(
          eq(portfolioCompaniesTable.sessionToken, token),
          eq(portfolioCompaniesTable.companyId, companyId),
        ),
      );
    if (existing) {
      if (notes && notes !== existing.notes) {
        await db.update(portfolioCompaniesTable).set({ notes }).where(eq(portfolioCompaniesTable.id, existing.id));
      }
      res.json({ ok: true, portfolioId: existing.id, alreadyInPortfolio: true });
      return;
    }
    const [inserted] = await db
      .insert(portfolioCompaniesTable)
      .values({ sessionToken: token, companyId, notes })
      .returning();
    res.json({ ok: true, portfolioId: inserted.id, alreadyInPortfolio: false });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── PUT /portfolio/companies/:id ─────────────────────────────────────────

router.put("/portfolio/companies/:id", async (req, res) => {
  try {
    const token = resolveSessionToken(req);
    const companyId = parseInt(String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id), 10);
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "Invalid company id" });
      return;
    }
    const body = req.body ?? {};
    const updates: Partial<typeof portfolioCompaniesTable.$inferInsert> = {};
    if (typeof body.notes === "string") updates.notes = body.notes;
    if (typeof body.alertFeviDelta === "boolean") updates.alertFeviDelta = body.alertFeviDelta;
    if (typeof body.alertCapabilityDecay === "boolean") updates.alertCapabilityDecay = body.alertCapabilityDecay;
    if (typeof body.alertRegulationChange === "boolean") updates.alertRegulationChange = body.alertRegulationChange;
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    const result = await db
      .update(portfolioCompaniesTable)
      .set(updates)
      .where(
        and(
          eq(portfolioCompaniesTable.sessionToken, token),
          eq(portfolioCompaniesTable.companyId, companyId),
        ),
      );
    res.json({ ok: true, updated: result.rowCount ?? 0 });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── DELETE /portfolio/companies/:id ──────────────────────────────────────

router.delete("/portfolio/companies/:id", async (req, res) => {
  try {
    const token = resolveSessionToken(req);
    const companyId = parseInt(String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id), 10);
    if (!Number.isFinite(companyId)) {
      res.status(400).json({ error: "Invalid company id" });
      return;
    }
    const result = await db
      .delete(portfolioCompaniesTable)
      .where(
        and(
          eq(portfolioCompaniesTable.sessionToken, token),
          eq(portfolioCompaniesTable.companyId, companyId),
        ),
      );
    res.json({ ok: true, removed: result.rowCount ?? 0 });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /portfolio/synthesis ─────────────────────────────────────────────
//
// Portfolio-scoped synthesis brief — same look/feel as /api/synthesis/brief
// but composed deterministically from the caller's tracked companies. No
// LLM in the loop: aggregates fingerprint capabilities and capability-alpha
// EVaR exposure across the portfolio and emits a headline narrative.

router.get("/portfolio/synthesis", async (req, res) => {
  try {
    const token = resolveSessionToken(req);
    const portfolioRows = await db
      .select({
        company: companiesTable,
      })
      .from(portfolioCompaniesTable)
      .innerJoin(companiesTable, eq(portfolioCompaniesTable.companyId, companiesTable.id))
      .where(eq(portfolioCompaniesTable.sessionToken, token));

    const companyIds = portfolioRows.map(r => r.company.id);
    const generatedAt = new Date().toISOString();

    if (companyIds.length === 0) {
      res.json({
        headline: "No portfolio companies yet. Add positions from /source to see aggregate weakness and EVaR exposure here.",
        weakestCapabilities: [],
        totalExposureMm: 0,
        companyCount: 0,
        generatedAt,
      });
      return;
    }

    // Pull all fingerprint rows + capability names in a single roundtrip
    const fingerprints = await db
      .select({
        companyId: companyCapabilityFingerprintTable.companyId,
        capabilityId: companyCapabilityFingerprintTable.capabilityId,
        weight: companyCapabilityFingerprintTable.weight,
        capabilityName: capabilitiesTable.name,
        benchmarkScore: capabilitiesTable.benchmarkScore,
      })
      .from(companyCapabilityFingerprintTable)
      .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, companyCapabilityFingerprintTable.capabilityId))
      .where(inArray(companyCapabilityFingerprintTable.companyId, companyIds));

    // Aggregate weakness by capability: a capability is "weak across the
    // portfolio" when many portcos have it on their fingerprint AND the
    // capability's benchmark score is low. Score = count × (1 - benchmark/100).
    type CapAgg = { capabilityId: number; name: string; count: number; sumBenchmark: number };
    const byCap = new Map<number, CapAgg>();
    for (const f of fingerprints) {
      const prev = byCap.get(f.capabilityId);
      if (prev) {
        prev.count += 1;
        prev.sumBenchmark += f.benchmarkScore;
      } else {
        byCap.set(f.capabilityId, {
          capabilityId: f.capabilityId,
          name: f.capabilityName,
          count: 1,
          sumBenchmark: f.benchmarkScore,
        });
      }
    }
    const weakestCapabilities = Array.from(byCap.values())
      .map(c => ({
        capabilityId: c.capabilityId,
        name: c.name,
        count: c.count,
        avgScore: Math.round((c.sumBenchmark / c.count) * 10) / 10,
        weaknessRank: c.count * (1 - c.sumBenchmark / c.count / 100),
      }))
      .sort((a, b) => b.weaknessRank - a.weaknessRank)
      .slice(0, 3)
      .map(({ weaknessRank, capabilityId, ...rest }) => rest);

    // Total EVaR exposure: sum evar12ForAlpha for every (company, capability)
    // edge in the portfolio's fingerprint, weighted by the fingerprint weight.
    // This gives a portfolio-wide "$M at risk over the next 12 months" figure.
    const capIds = Array.from(byCap.keys());
    const alphaRows = capIds.length > 0
      ? await db.select().from(capabilityAlphaTable).where(inArray(capabilityAlphaTable.capabilityId, capIds))
      : [];
    const alphaByCap = new Map(alphaRows.map(a => [a.capabilityId, a]));
    let totalExposureMm = 0;
    for (const f of fingerprints) {
      const alpha = alphaByCap.get(f.capabilityId);
      if (!alpha) continue;
      totalExposureMm += f.weight * evar12ForAlpha(alpha);
    }
    totalExposureMm = Math.round(totalExposureMm * 10) / 10;

    // Headline: deterministic synthesis of the aggregates
    const topWeak = weakestCapabilities[0];
    const headline = topWeak
      ? `Across your ${portfolioRows.length} portfolio compan${portfolioRows.length === 1 ? "y" : "ies"}, ${topWeak.name} is the dominant weakness — present on ${topWeak.count} portco${topWeak.count === 1 ? "" : "s"} at avg score ${topWeak.avgScore.toFixed(0)}/100. Aggregate 12-month EVaR exposure: $${totalExposureMm.toFixed(1)}M.`
      : `Across your ${portfolioRows.length} portfolio compan${portfolioRows.length === 1 ? "y" : "ies"}, no capability fingerprints have landed yet — enrichment is still propagating. Check back after the next enrichment cycle.`;

    res.json({
      headline,
      weakestCapabilities,
      totalExposureMm,
      companyCount: portfolioRows.length,
      generatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
