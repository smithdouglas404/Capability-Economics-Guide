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
  macroEventsTable,
  regulationCapabilityRequirementsTable,
  regulationsTable,
} from "@workspace/db";
import { eq, inArray, desc, and, gt, sql } from "drizzle-orm";

const router = Router();

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

export default router;
