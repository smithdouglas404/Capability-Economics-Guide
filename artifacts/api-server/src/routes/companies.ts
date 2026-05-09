import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { companiesTable, capabilitiesTable, ceiComponentsTable } from "@workspace/db/schema";
import { and, eq, sql, desc } from "drizzle-orm";
import {
  ingestCompaniesForIndustry,
  computeCompanyScores,
  recomputeAllScoresForIndustry,
  listCompaniesForIndustry,
  getCompanyDetail,
  findSimilarCompanies,
} from "../services/companies";
import {
  ingestExternalSignalsForIndustry,
  backfillValueChainStages,
  valueChainStageProfile,
  inferValueChainStage,
} from "../services/external-signals";

const router: IRouter = Router();

router.get("/workbench/companies", async (req, res) => {
  const industryId = parseInt(String(req.query.industryId ?? ""), 10);
  if (!industryId) {
    res.status(400).json({ error: "industryId required" });
    return;
  }
  const limit = Math.min(200, parseInt(String(req.query.limit ?? "100"), 10) || 100);
  const rows = await listCompaniesForIndustry(industryId, { limit });
  res.json({ companies: rows });
});

router.get("/workbench/companies/:id", async (req, res) => {
  const id = parseInt(String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id), 10);
  const detail = await getCompanyDetail(id);
  if (!detail) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(detail);
});

router.get("/workbench/companies/:id/similar", async (req, res) => {
  const id = parseInt(String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id), 10);
  const limit = Math.min(20, parseInt(String(req.query.limit ?? "10"), 10) || 10);
  const sims = await findSimilarCompanies(id, { limit });
  res.json({ similar: sims });
});

router.post("/workbench/companies/:id/recompute-scores", async (req, res) => {
  const id = parseInt(String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id), 10);
  await computeCompanyScores(id);
  const detail = await getCompanyDetail(id);
  res.json({ ok: true, scores: detail?.scores ?? null });
});

router.post("/workbench/companies/_ingest", async (req, res) => {
  const industryId = parseInt(String(req.body?.industryId ?? ""), 10);
  if (!industryId) {
    res.status(400).json({ error: "industryId required" });
    return;
  }
  const limit = Math.min(50, parseInt(String(req.body?.limit ?? "25"), 10) || 25);
  setImmediate(async () => {
    try {
      const r = await ingestCompaniesForIndustry(industryId, { limit });
      console.log(`[companies-ingest] industry ${industryId}: +${r.inserted} new, ${r.updated} updated, ${r.errors.length} errors`);
      for (const cid of r.companies) await computeCompanyScores(cid);
      console.log(`[companies-ingest] industry ${industryId}: scored ${r.companies.length} companies`);
    } catch (e) {
      console.error(`[companies-ingest] error:`, e);
    }
  });
  res.json({ ok: true, message: "ingestion started in background", industryId });
});

router.post("/workbench/companies/_recompute", async (req, res) => {
  const industryId = parseInt(String(req.body?.industryId ?? ""), 10);
  if (!industryId) {
    res.status(400).json({ error: "industryId required" });
    return;
  }
  const r = await recomputeAllScoresForIndustry(industryId);
  res.json({ ok: true, ...r });
});

router.get("/workbench/value-chain/:industryId", async (req, res) => {
  const industryId = parseInt(String(Array.isArray(req.params.industryId) ? req.params.industryId[0] : req.params.industryId), 10);
  const profile = await valueChainStageProfile(industryId);
  // Augment with rolled-up CEI per stage.
  const caps = await db.select({
    id: capabilitiesTable.id,
    stage: capabilitiesTable.valueChainStage,
    score: ceiComponentsTable.consensusScore,
    confidence: ceiComponentsTable.confidence,
    velocity: ceiComponentsTable.velocity,
  }).from(capabilitiesTable)
    .leftJoin(ceiComponentsTable, eq(ceiComponentsTable.capabilityId, capabilitiesTable.id))
    .where(eq(capabilitiesTable.industryId, industryId));

  const stageMetrics = new Map<string, { ceiSum: number; confSum: number; velSum: number; n: number }>();
  for (const c of caps) {
    const s = c.stage ?? "enable";
    if (!stageMetrics.has(s)) stageMetrics.set(s, { ceiSum: 0, confSum: 0, velSum: 0, n: 0 });
    const m = stageMetrics.get(s)!;
    m.ceiSum += c.score ?? 50;
    m.confSum += c.confidence ?? 0.5;
    m.velSum += c.velocity ?? 0;
    m.n++;
  }

  // Companies per stage by joining fingerprint → cap → stage.
  const companyRows = await db.execute(sql`
    SELECT c.value_chain_stage AS stage, COUNT(DISTINCT co.id)::int AS n_companies
    FROM companies co
    JOIN company_capability_fingerprint fp ON fp.company_id = co.id
    JOIN capabilities c ON c.id = fp.capability_id
    WHERE co.industry_id = ${industryId}
    GROUP BY c.value_chain_stage
  `);
  const companyByStage = new Map<string, number>();
  for (const row of (companyRows.rows ?? companyRows) as Array<{ stage: string; n_companies: number }>) {
    companyByStage.set(row.stage ?? "enable", row.n_companies);
  }

  const enriched = profile.map(p => {
    const m = stageMetrics.get(p.stage);
    return {
      ...p,
      avgCei: m && m.n ? Math.round((m.ceiSum / m.n) * 10) / 10 : null,
      avgConfidence: m && m.n ? Math.round((m.confSum / m.n) * 100) / 100 : null,
      avgVelocity: m && m.n ? Math.round((m.velSum / m.n) * 1000) / 1000 : null,
      companyCount: companyByStage.get(p.stage) ?? 0,
    };
  });
  res.json({ industryId, stages: enriched });
});

router.post("/workbench/value-chain/_backfill-stages", async (req, res) => {
  const industryId = req.body?.industryId ? parseInt(String(req.body.industryId), 10) : undefined;
  const r = await backfillValueChainStages(industryId);
  res.json({ ok: true, ...r });
});

router.post("/workbench/external-signals/_ingest", async (req, res) => {
  const industryId = parseInt(String(req.body?.industryId ?? ""), 10);
  if (!industryId) {
    res.status(400).json({ error: "industryId required" });
    return;
  }
  setImmediate(async () => {
    try {
      const r = await ingestExternalSignalsForIndustry(industryId, { concurrency: 3, staleDays: 30 });
      console.log(`[external-signals] industry ${industryId}: scanned ${r.scanned}, succeeded ${r.succeeded}, errors ${r.errors.length}`);
    } catch (e) {
      console.error(`[external-signals] error:`, e);
    }
  });
  res.json({ ok: true, message: "external signals ingestion started in background", industryId });
});

// Quadrant: x = velocity, y = score, size = confidence × source-count.
router.get("/workbench/quadrant/:industryId", async (req, res) => {
  const industryId = parseInt(String(Array.isArray(req.params.industryId) ? req.params.industryId[0] : req.params.industryId), 10);
  const rows = await db.select({
    id: capabilitiesTable.id,
    name: capabilitiesTable.name,
    parentId: capabilitiesTable.parentCapabilityId,
    isLeaf: capabilitiesTable.isLeaf,
    stage: capabilitiesTable.valueChainStage,
    score: ceiComponentsTable.consensusScore,
    confidence: ceiComponentsTable.confidence,
    velocity: ceiComponentsTable.velocity,
  }).from(capabilitiesTable)
    .leftJoin(ceiComponentsTable, eq(ceiComponentsTable.capabilityId, capabilitiesTable.id))
    .where(eq(capabilitiesTable.industryId, industryId));

  const points = rows.map(r => {
    const score = r.score ?? 50;
    const vel = r.velocity ?? 0;
    let quadrant: "hot" | "emerging" | "cooling" | "table_stakes";
    if (score >= 60 && vel >= 0) quadrant = "hot";
    else if (score < 60 && vel >= 0) quadrant = "emerging";
    else if (score >= 60 && vel < 0) quadrant = "cooling";
    else quadrant = "table_stakes";
    return {
      id: r.id,
      name: r.name,
      stage: r.stage,
      isLeaf: r.isLeaf,
      score: Math.round(score * 10) / 10,
      velocity: Math.round(vel * 1000) / 1000,
      confidence: Math.round((r.confidence ?? 0.5) * 100) / 100,
      quadrant,
    };
  });
  res.json({ industryId, points });
});

export default router;
