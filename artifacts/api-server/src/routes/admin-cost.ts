import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, perplexityCacheTable, systemFlagsTable } from "@workspace/db";
import { sql, desc, like } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";
import { getUsageSummary } from "../services/llm-usage";
import { invalidateTtlLookupCache } from "../services/perplexity-cache";

const router: Router = Router();

const PERPLEXITY_PRICING: Record<string, { input: number; output: number }> = {
  "sonar": { input: 1, output: 1 },
  "sonar-pro": { input: 3, output: 15 },
  "sonar-reasoning": { input: 1, output: 5 },
  "sonar-reasoning-pro": { input: 2, output: 8 },
  "sonar-deep-research": { input: 2, output: 8 },
};

const AVG_TOKENS_PER_QUERY = { input: 1500, output: 2500 };

function estimateSavedUsd(model: string, hits: number): number {
  const p = PERPLEXITY_PRICING[model] ?? PERPLEXITY_PRICING["sonar-pro"];
  const perCall = (AVG_TOKENS_PER_QUERY.input / 1_000_000) * p.input + (AVG_TOKENS_PER_QUERY.output / 1_000_000) * p.output;
  return perCall * hits;
}

router.get("/admin/cache-stats", requireAdmin, async (_req, res) => {
  try {
    const [totals] = await db
      .select({
        rows: sql<number>`COUNT(*)::int`,
        totalHits: sql<number>`COALESCE(SUM(${perplexityCacheTable.hitCount}), 0)::int`,
        active: sql<number>`COUNT(*) FILTER (WHERE ${perplexityCacheTable.expiresAt} > NOW())::int`,
        expired: sql<number>`COUNT(*) FILTER (WHERE ${perplexityCacheTable.expiresAt} <= NOW())::int`,
      })
      .from(perplexityCacheTable);

    const byModel = await db
      .select({
        model: perplexityCacheTable.model,
        rows: sql<number>`COUNT(*)::int`,
        hits: sql<number>`COALESCE(SUM(${perplexityCacheTable.hitCount}), 0)::int`,
      })
      .from(perplexityCacheTable)
      .groupBy(perplexityCacheTable.model);

    const hotQueries = await db
      .select({
        key: perplexityCacheTable.key,
        model: perplexityCacheTable.model,
        hits: perplexityCacheTable.hitCount,
        createdAt: perplexityCacheTable.createdAt,
        expiresAt: perplexityCacheTable.expiresAt,
        lastHitAt: perplexityCacheTable.lastHitAt,
      })
      .from(perplexityCacheTable)
      .orderBy(desc(perplexityCacheTable.hitCount))
      .limit(20);

    const modelBreakdown = byModel.map((m) => ({
      model: m.model,
      rows: m.rows,
      hits: m.hits,
      estimatedSavedUsd: estimateSavedUsd(m.model, m.hits),
    }));
    const totalSavedUsd = modelBreakdown.reduce((acc, m) => acc + m.estimatedSavedUsd, 0);

    const llmUsage7d = await getUsageSummary(24 * 7);
    const llmUsage24h = await getUsageSummary(24);

    res.json({
      perplexityCache: {
        rows: totals?.rows ?? 0,
        active: totals?.active ?? 0,
        expired: totals?.expired ?? 0,
        totalHits: totals?.totalHits ?? 0,
        totalSavedUsd,
        byModel: modelBreakdown,
        hotQueries: hotQueries.map((q) => ({
          key: q.key.slice(0, 12),
          model: q.model,
          hits: q.hits,
          createdAt: q.createdAt,
          expiresAt: q.expiresAt,
          lastHitAt: q.lastHitAt,
        })),
      },
      llmUsage: { last24h: llmUsage24h, last7d: llmUsage7d },
      assumptions: {
        avgInputTokensPerQuery: AVG_TOKENS_PER_QUERY.input,
        avgOutputTokensPerQuery: AVG_TOKENS_PER_QUERY.output,
        pricing: PERPLEXITY_PRICING,
        note: "Savings estimate = per-model token-price × hit_count. Actual savings ±20% depending on prompt size.",
      },
    });
  } catch (e) {
    res.status(500).json({ error: "cache-stats failed", message: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/admin/openrouter-balance", requireAdmin, async (_req, res) => {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) {
    res.status(503).json({ error: "OPENROUTER_API_KEY not set" });
    return;
  }
  try {
    const r = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) {
      res.status(r.status).json({ error: `OpenRouter HTTP ${r.status}`, body: await r.text().catch(() => "") });
      return;
    }
    const data = (await r.json()) as { data?: { label?: string; usage?: number; limit?: number | null; limit_remaining?: number | null; is_free_tier?: boolean } };
    const d = data.data ?? {};
    res.json({
      label: d.label ?? null,
      usageUsd: typeof d.usage === "number" ? d.usage : null,
      limitUsd: typeof d.limit === "number" ? d.limit : null,
      remainingUsd: typeof d.limit_remaining === "number" ? d.limit_remaining : null,
      isFreeTier: d.is_free_tier ?? null,
    });
  } catch (e) {
    res.status(500).json({ error: "openrouter check failed", message: e instanceof Error ? e.message : String(e) });
  }
});

router.get("/admin/cache-ttl", requireAdmin, async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(systemFlagsTable)
      .where(like(systemFlagsTable.flagName, "ppx_cache_ttl_%"))
      .orderBy(systemFlagsTable.flagName);
    res.json({
      flags: rows.map((r) => ({
        name: r.flagName,
        endpointKey: r.flagName.replace(/^ppx_cache_ttl_/, ""),
        hours: parseInt(r.flagValue, 10) || 168,
        description: r.description ?? "",
        updatedAt: r.updatedAt,
        updatedBy: r.updatedBy,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: "cache-ttl read failed", message: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/admin/cache-ttl", requireAdmin, async (req, res) => {
  const { endpointKey, hours, description } = req.body as { endpointKey?: string; hours?: number; description?: string };
  if (!endpointKey || typeof endpointKey !== "string" || !/^[a-zA-Z0-9_.:-]+$/.test(endpointKey)) {
    res.status(400).json({ error: "endpointKey required (alphanumeric + . : _ - only)" });
    return;
  }
  const h = Number(hours);
  if (!Number.isFinite(h) || h < 1 || h > 8760) {
    res.status(400).json({ error: "hours must be 1..8760 (1h..1yr)" });
    return;
  }
  const flagName = `ppx_cache_ttl_${endpointKey}`;
  // Audit identity from the authenticated principal (Clerk userId) — falls
  // back to "admin-key" when the break-glass shared key was used.
  let updatedBy = "admin-key";
  try {
    const auth = getAuth(req);
    if (auth?.userId) updatedBy = `clerk:${auth.userId}`;
  } catch { /* ignore */ }
  try {
    await db
      .insert(systemFlagsTable)
      .values({
        flagName,
        flagValue: String(h),
        description: description ?? `Cache TTL hours for ${endpointKey}`,
        updatedBy,
      })
      .onConflictDoUpdate({
        target: systemFlagsTable.flagName,
        set: {
          flagValue: String(h),
          ...(description !== undefined ? { description } : {}),
          updatedAt: new Date(),
          updatedBy,
        },
      });
    invalidateTtlLookupCache();
    res.json({ ok: true, flagName, hours: h });
  } catch (e) {
    res.status(500).json({ error: "cache-ttl write failed", message: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
