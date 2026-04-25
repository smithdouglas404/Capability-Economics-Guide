import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  pePortfoliosTable,
  companiesTable,
  companyScoresTable,
  industriesTable,
} from "@workspace/db";
import { and, eq, desc, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { logFeatureUsed } from "../services/persona-events";

const router: IRouter = Router();

const PortfolioBody = z.object({
  name: z.string().min(1).max(120),
  industryId: z.number().int().positive().optional().nullable(),
  companyIds: z.array(z.number().int().positive()).max(200).default([]),
  notes: z.string().max(2000).optional().nullable(),
});

/** List the caller's portfolios. */
router.get("/pipeline/portfolios", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  void logFeatureUsed({ userId: auth.userId, feature: "/pipeline/portfolios" });
  const rows = await db.select().from(pePortfoliosTable)
    .where(eq(pePortfoliosTable.userId, auth.userId))
    .orderBy(desc(pePortfoliosTable.updatedAt));
  res.json({ portfolios: rows });
});

/** Get one portfolio + its companies hydrated with composite scores. */
router.get("/pipeline/portfolios/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }

  const [pf] = await db.select().from(pePortfoliosTable)
    .where(and(eq(pePortfoliosTable.id, id), eq(pePortfoliosTable.userId, auth.userId)));
  if (!pf) { res.status(404).json({ error: "Portfolio not found" }); return; }

  const ids = pf.companyIds ?? [];
  const companies = ids.length ? await db.select().from(companiesTable).where(inArray(companiesTable.id, ids)) : [];
  const scores = ids.length ? await db.select().from(companyScoresTable).where(inArray(companyScoresTable.companyId, ids)) : [];
  const indIds = Array.from(new Set(companies.map((c) => c.industryId)));
  const industries = indIds.length ? await db.select().from(industriesTable).where(inArray(industriesTable.id, indIds)) : [];
  const indMap = new Map(industries.map((i) => [i.id, i.name]));
  const scoreMap = new Map(scores.map((s) => [s.companyId, s]));

  const hydrated = companies.map((c) => ({
    ...c,
    industryName: indMap.get(c.industryId) ?? null,
    scores: scoreMap.get(c.id) ?? null,
  }));

  res.json({ portfolio: pf, companies: hydrated });
});

/** Create a portfolio. */
router.post("/pipeline/portfolios", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = PortfolioBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const [created] = await db.insert(pePortfoliosTable).values({
    userId: auth.userId,
    name: parsed.data.name,
    industryId: parsed.data.industryId ?? null,
    companyIds: parsed.data.companyIds,
    notes: parsed.data.notes ?? null,
  }).returning();
  res.status(201).json({ portfolio: created });
});

/** Update a portfolio (name, industry, companyIds, notes). */
router.patch("/pipeline/portfolios/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const parsed = PortfolioBody.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }

  const [pf] = await db.select().from(pePortfoliosTable)
    .where(and(eq(pePortfoliosTable.id, id), eq(pePortfoliosTable.userId, auth.userId)));
  if (!pf) { res.status(404).json({ error: "Portfolio not found" }); return; }

  await db.update(pePortfoliosTable).set({
    ...parsed.data,
    updatedAt: new Date(),
  }).where(eq(pePortfoliosTable.id, id));
  const [updated] = await db.select().from(pePortfoliosTable).where(eq(pePortfoliosTable.id, id));
  res.json({ portfolio: updated });
});

/** Delete a portfolio. */
router.delete("/pipeline/portfolios/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }

  const result = await db.delete(pePortfoliosTable)
    .where(and(eq(pePortfoliosTable.id, id), eq(pePortfoliosTable.userId, auth.userId)))
    .returning({ id: pePortfoliosTable.id });
  if (result.length === 0) { res.status(404).json({ error: "Portfolio not found" }); return; }
  res.json({ ok: true, id });
});

export default router;
