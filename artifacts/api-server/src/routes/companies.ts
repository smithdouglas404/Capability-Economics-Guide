import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { companiesTable, capabilitiesTable, cviComponentsTable } from "@workspace/db/schema";
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

/**
 * Latest ingestion result per industry. In-memory by design — survives the
 * lifetime of the api-server process, which is the same lifetime the user's
 * tab cares about. On restart, status resets to "idle" and the user can
 * re-trigger. Replaces the previous fire-and-forget pattern that hid every
 * failure mode behind console.log.
 */
type IngestStatus =
  | { state: "running"; industryId: number; startedAt: string }
  | { state: "done"; industryId: number; startedAt: string; finishedAt: string; inserted: number; updated: number; companies: number; errors: string[] }
  | { state: "failed"; industryId: number; startedAt: string; finishedAt: string; error: string };

const ingestStatusByIndustry = new Map<number, IngestStatus>();

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

// Underscore-prefixed control routes MUST come before /:id so Express doesn't
// match them as a company id (which would parseInt to NaN and crash the SQL).
router.post("/workbench/companies/_ingest", async (req, res) => {
  const industryId = parseInt(String(req.body?.industryId ?? ""), 10);
  if (!industryId) {
    res.status(400).json({ error: "industryId required" });
    return;
  }
  const existing = ingestStatusByIndustry.get(industryId);
  if (existing?.state === "running") {
    res.status(409).json({ error: "ingestion already running for this industry", startedAt: existing.startedAt });
    return;
  }
  const limit = Math.min(50, parseInt(String(req.body?.limit ?? "25"), 10) || 25);
  const startedAt = new Date().toISOString();
  ingestStatusByIndustry.set(industryId, { state: "running", industryId, startedAt });
  setImmediate(async () => {
    try {
      const r = await ingestCompaniesForIndustry(industryId, { limit });
      // Flip to "done" as soon as Perplexity ingest returns so the banner
      // transitions within ~60-90s. Scoring is independent; we run it after
      // status is already "done" so the user sees results immediately and
      // scores backfill quietly. Per-company failures here don't roll back
      // the banner state.
      ingestStatusByIndustry.set(industryId, {
        state: "done",
        industryId,
        startedAt,
        finishedAt: new Date().toISOString(),
        inserted: r.inserted,
        updated: r.updated,
        companies: r.companies.length,
        errors: r.errors,
      });
      console.log(`[companies-ingest] industry ${industryId}: +${r.inserted} new, ${r.updated} updated, ${r.errors.length} errors`);
      for (const cid of r.companies) {
        try { await computeCompanyScores(cid); }
        catch (e) { console.error(`[companies-ingest] score failed for ${cid}:`, e); }
      }
      console.log(`[companies-ingest] industry ${industryId}: scored ${r.companies.length} companies (background)`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      ingestStatusByIndustry.set(industryId, {
        state: "failed",
        industryId,
        startedAt,
        finishedAt: new Date().toISOString(),
        error,
      });
      console.error(`[companies-ingest] error:`, e);
    }
  });
  res.json({ ok: true, message: "ingestion started", industryId, startedAt });
});

router.get("/workbench/companies/_ingest-status", async (req, res) => {
  const industryId = parseInt(String(req.query.industryId ?? ""), 10);
  if (!industryId) {
    res.status(400).json({ error: "industryId required" });
    return;
  }
  const status = ingestStatusByIndustry.get(industryId);
  if (!status) {
    res.json({ state: "idle", industryId });
    return;
  }
  res.json(status);
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

router.get("/workbench/companies/:id", async (req, res) => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(String(raw), 10);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const detail = await getCompanyDetail(id);
  if (!detail) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json(detail);
});

router.get("/workbench/companies/:id/similar", async (req, res) => {
  const id = parseInt(String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const limit = Math.min(20, parseInt(String(req.query.limit ?? "10"), 10) || 10);
  const sims = await findSimilarCompanies(id, { limit });
  res.json({ similar: sims });
});

router.post("/workbench/companies/:id/recompute-scores", async (req, res) => {
  const id = parseInt(String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(404).json({ error: "not found" });
    return;
  }
  await computeCompanyScores(id);
  const detail = await getCompanyDetail(id);
  res.json({ ok: true, scores: detail?.scores ?? null });
});

router.get("/workbench/value-chain/:industryId", async (req, res) => {
  const industryId = parseInt(String(Array.isArray(req.params.industryId) ? req.params.industryId[0] : req.params.industryId), 10);
  const profile = await valueChainStageProfile(industryId);
  // Augment with rolled-up CVI per stage.
  const caps = await db.select({
    id: capabilitiesTable.id,
    stage: capabilitiesTable.valueChainStage,
    score: cviComponentsTable.consensusScore,
    confidence: cviComponentsTable.confidence,
    velocity: cviComponentsTable.velocity,
  }).from(capabilitiesTable)
    .leftJoin(cviComponentsTable, eq(cviComponentsTable.capabilityId, capabilitiesTable.id))
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
    score: cviComponentsTable.consensusScore,
    confidence: cviComponentsTable.confidence,
    velocity: cviComponentsTable.velocity,
  }).from(capabilitiesTable)
    .leftJoin(cviComponentsTable, eq(cviComponentsTable.capabilityId, capabilitiesTable.id))
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
