/**
 * Public Data License v1 API surface.
 *
 * Mounted at `/v1` (NOT under `/api`) so customers integrate against stable,
 * versioned URLs that won't shift when the in-app `/api` namespace evolves.
 * Every route requires a Bearer key with the matching scope; metering and
 * rate limiting live in `requireApiKey` middleware.
 *
 * All routes are read-only. Mutations stay on `/api/admin/*`.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  industriesTable,
  capabilitiesTable,
  ceiSnapshotsTable,
  macroEventsTable,
  valueChainStagesTable,
} from "@workspace/db";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { requireApiKey } from "../middlewares/requireApiKey";
import { buildOpenApiSpec } from "../services/openapi-spec";

const router: IRouter = Router();

// ---------- helpers ----------
function parseLimit(req: Request, def = 100, max = 500): number {
  const n = Number(req.query.limit);
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(max, Math.floor(n)));
}
function parseOffset(req: Request): number {
  const n = Number(req.query.offset);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}
function asInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}
function asDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

// ---------- OpenAPI / docs ----------
// Public — no auth — so customers can fetch the spec without first having a key.
router.get("/openapi.json", (req: Request, res: Response) => {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? req.protocol;
  const host = req.headers.host ?? "localhost";
  const serverUrl = `${proto}://${host}`;
  res.json(buildOpenApiSpec(serverUrl));
});

// Convenience HTML — embeds Swagger UI from the public CDN. The SPA also has
// a richer /developers page; this is the API-side fallback.
router.get("/docs", (_req: Request, res: Response) => {
  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Capability Economics — v1 API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({ url: "/v1/openapi.json", dom_id: "#swagger-ui", deepLinking: true });
  </script>
</body>
</html>`);
});

// ---------- /v1/me ----------
router.get("/me", requireApiKey("read:industries"), (req: Request, res: Response) => {
  const k = req.apiKey!;
  res.json({
    keyId: k.keyId,
    scopes: k.scopes,
    rateLimitPerMin: k.rateLimitPerMin,
    monthlyQuota: k.monthlyQuota,
    monthlyUsageCount: k.monthlyUsageCount,
    quotaResetAt: k.quotaResetAt,
  });
});

// ---------- Industries ----------
router.get("/industries", requireApiKey("read:industries"), async (req, res) => {
  const limit = parseLimit(req);
  const offset = parseOffset(req);
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(industriesTable).orderBy(industriesTable.id).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(industriesTable),
  ]);
  res.json({ data: rows, total: count });
});

router.get("/industries/:slug", requireApiKey("read:industries"), async (req, res) => {
  const slug = String(req.params.slug);
  const [row] = await db.select().from(industriesTable).where(eq(industriesTable.slug, slug)).limit(1);
  if (!row) { res.status(404).json({ error: "not_found" }); return; }
  res.json(row);
});

// ---------- Capabilities ----------
router.get("/capabilities", requireApiKey("read:capabilities"), async (req, res) => {
  const limit = parseLimit(req);
  const offset = parseOffset(req);
  const industryId = asInt(req.query.industryId);
  const industrySlug = typeof req.query.industrySlug === "string" ? req.query.industrySlug : null;

  let resolvedIndustryId = industryId;
  if (resolvedIndustryId == null && industrySlug) {
    const [ind] = await db.select({ id: industriesTable.id }).from(industriesTable).where(eq(industriesTable.slug, industrySlug)).limit(1);
    if (!ind) { res.json({ data: [], total: 0 }); return; }
    resolvedIndustryId = ind.id;
  }

  const conditions: SQL[] = [];
  if (resolvedIndustryId != null) conditions.push(eq(capabilitiesTable.industryId, resolvedIndustryId));
  // Only return approved capabilities to public consumers.
  conditions.push(eq(capabilitiesTable.reviewStatus, "approved"));
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [{ count }]] = await Promise.all([
    db.select({
      id: capabilitiesTable.id,
      industryId: capabilitiesTable.industryId,
      slug: capabilitiesTable.slug,
      name: capabilitiesTable.name,
      description: capabilitiesTable.description,
      traditionalView: capabilitiesTable.traditionalView,
      economicView: capabilitiesTable.economicView,
      benchmarkScore: capabilitiesTable.benchmarkScore,
      valueChainStage: capabilitiesTable.valueChainStage,
      patentCount: capabilitiesTable.patentCount,
      startupCount: capabilitiesTable.startupCount,
      vcCapitalUsd: capabilitiesTable.vcCapitalUsd,
    }).from(capabilitiesTable).where(where).orderBy(capabilitiesTable.id).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(capabilitiesTable).where(where),
  ]);
  res.json({ data: rows, total: count });
});

router.get("/capabilities/:id", requireApiKey("read:capabilities"), async (req, res) => {
  const id = asInt(req.params.id);
  if (id == null) { res.status(400).json({ error: "bad_id" }); return; }
  const [row] = await db.select({
    id: capabilitiesTable.id,
    industryId: capabilitiesTable.industryId,
    slug: capabilitiesTable.slug,
    name: capabilitiesTable.name,
    description: capabilitiesTable.description,
    traditionalView: capabilitiesTable.traditionalView,
    economicView: capabilitiesTable.economicView,
    benchmarkScore: capabilitiesTable.benchmarkScore,
    valueChainStage: capabilitiesTable.valueChainStage,
    patentCount: capabilitiesTable.patentCount,
    startupCount: capabilitiesTable.startupCount,
    vcCapitalUsd: capabilitiesTable.vcCapitalUsd,
    reviewStatus: capabilitiesTable.reviewStatus,
  }).from(capabilitiesTable).where(eq(capabilitiesTable.id, id)).limit(1);
  if (!row || row.reviewStatus !== "approved") { res.status(404).json({ error: "not_found" }); return; }
  res.json(row);
});

// ---------- CEI ----------
router.get("/cei/current", requireApiKey("read:cei"), async (_req, res) => {
  const [row] = await db.select().from(ceiSnapshotsTable).orderBy(desc(ceiSnapshotsTable.snapshotAt)).limit(1);
  if (!row) { res.status(404).json({ error: "no_snapshot" }); return; }
  res.json(row);
});

router.get("/cei/history", requireApiKey("read:cei"), async (req, res) => {
  const limit = parseLimit(req, 100, 1000);
  const from = asDate(req.query.from);
  const to = asDate(req.query.to);
  const conditions: SQL[] = [];
  if (from) conditions.push(gte(ceiSnapshotsTable.snapshotAt, from));
  if (to) conditions.push(lte(ceiSnapshotsTable.snapshotAt, to));
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db.select().from(ceiSnapshotsTable).where(where).orderBy(desc(ceiSnapshotsTable.snapshotAt)).limit(limit);
  res.json({ data: rows });
});

// ---------- Macro events ----------
router.get("/macro-events", requireApiKey("read:macro-events"), async (req, res) => {
  const limit = parseLimit(req);
  const offset = parseOffset(req);
  const since = asDate(req.query.since);
  const industryId = asInt(req.query.industryId);

  const conditions: SQL[] = [];
  if (since) conditions.push(gte(macroEventsTable.startedAt, since));
  // industryId filter happens client-side via jsonb @> check.
  if (industryId != null) {
    conditions.push(sql`${macroEventsTable.affectedIndustryIds} @> ${JSON.stringify([industryId])}::jsonb`);
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [{ count }]] = await Promise.all([
    db.select().from(macroEventsTable).where(where).orderBy(desc(macroEventsTable.startedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(macroEventsTable).where(where),
  ]);
  res.json({ data: rows, total: count });
});

// ---------- Value-chain stages ----------
router.get("/value-chain-stages", requireApiKey("read:value-chain"), async (req, res) => {
  const limit = parseLimit(req);
  const offset = parseOffset(req);
  const industryId = asInt(req.query.industryId);
  const where = industryId != null ? eq(valueChainStagesTable.industryId, industryId) : undefined;

  const [rows, [{ count }]] = await Promise.all([
    db.select({
      id: valueChainStagesTable.id,
      industryId: valueChainStagesTable.industryId,
      stageName: valueChainStagesTable.stageName,
      stageOrder: valueChainStagesTable.stageOrder,
      disruptionSummary: valueChainStagesTable.disruptionSummary,
      hhiScore: valueChainStagesTable.hhiScore,
      patentCount: valueChainStagesTable.patentCount,
      startupCount: valueChainStagesTable.startupCount,
      capitalFlowMm: valueChainStagesTable.capitalFlowMm,
      shifts: valueChainStagesTable.shifts,
      risks: valueChainStagesTable.risks,
    }).from(valueChainStagesTable)
      .where(where)
      .orderBy(valueChainStagesTable.industryId, valueChainStagesTable.stageOrder)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(valueChainStagesTable).where(where),
  ]);
  res.json({ data: rows, total: count });
});

export default router;
