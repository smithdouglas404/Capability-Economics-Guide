import { db, llmUsageTable } from "@workspace/db";
import { sql, gte, desc } from "drizzle-orm";

const PRICING: Record<string, { input: number; output: number }> = {
  "sonar": { input: 1, output: 1 },
  "sonar-pro": { input: 3, output: 15 },
  "sonar-reasoning": { input: 1, output: 5 },
  "sonar-reasoning-pro": { input: 2, output: 8 },
  "anthropic/claude-haiku-4.5": { input: 1, output: 5 },
  "anthropic/claude-sonnet-4.5": { input: 3, output: 15 },
  "z-ai/glm-5.1": { input: 0.5, output: 1.5 },
  "openai/gpt-4o": { input: 2.5, output: 10 },
  "openai/gpt-4o-mini": { input: 0.15, output: 0.6 },
};

function priceFor(model: string): { input: number; output: number } {
  if (PRICING[model]) return PRICING[model];
  const lower = model.toLowerCase();
  for (const key of Object.keys(PRICING)) {
    if (lower.includes(key.toLowerCase())) return PRICING[key];
  }
  return { input: 1, output: 3 };
}

export interface LogLlmCallArgs {
  provider: "perplexity" | "openrouter" | "openai" | "anthropic" | string;
  model: string;
  endpoint: string;
  responseJson?: unknown;
  startedAt: number;
  httpStatus?: number;
  errorMessage?: string;
}

export function logLlmCall(args: LogLlmCallArgs): void {
  // Fire-and-forget so the calling code path is never blocked.
  setImmediate(async () => {
    try {
      const durationMs = Date.now() - args.startedAt;
      const r = (args.responseJson ?? {}) as { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }; error?: unknown };
      const usage = r.usage ?? {};
      const inputTokens = Math.max(0, Number(usage.prompt_tokens) || 0);
      const outputTokens = Math.max(0, Number(usage.completion_tokens) || 0);
      const totalTokens = Math.max(0, Number(usage.total_tokens) || inputTokens + outputTokens);

      const price = priceFor(args.model);
      const costUsd = (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;

      let status: string = "ok";
      if (args.errorMessage) status = "error";
      else if (args.httpStatus && args.httpStatus >= 400) status = args.httpStatus === 401 || args.httpStatus === 429 ? "quota" : "error";
      else if (r.error) status = "error";

      await db.insert(llmUsageTable).values({
        provider: args.provider,
        model: args.model,
        endpoint: args.endpoint,
        inputTokens,
        outputTokens,
        totalTokens,
        costUsd: costUsd.toFixed(6),
        status,
        httpStatus: args.httpStatus ?? null,
        durationMs,
      });
    } catch (err) {
      console.warn("[llm-usage] log failed:", err);
    }
  });
}

export async function getUsageSummary(windowHours = 24): Promise<{
  windowHours: number;
  totals: { calls: number; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number; errors: number; quota: number };
  byModel: Array<{ model: string; calls: number; tokens: number; costUsd: number }>;
  byEndpoint: Array<{ endpoint: string; calls: number; tokens: number; costUsd: number }>;
  byProvider: Array<{ provider: string; calls: number; tokens: number; costUsd: number }>;
  monthEstimateUsd: number;
}> {
  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);

  const totalsRow = await db
    .select({
      calls: sql<number>`COUNT(*)::int`,
      inputTokens: sql<number>`COALESCE(SUM(${llmUsageTable.inputTokens}), 0)::int`,
      outputTokens: sql<number>`COALESCE(SUM(${llmUsageTable.outputTokens}), 0)::int`,
      totalTokens: sql<number>`COALESCE(SUM(${llmUsageTable.totalTokens}), 0)::int`,
      costUsd: sql<number>`COALESCE(SUM(${llmUsageTable.costUsd}), 0)::float`,
      errors: sql<number>`COUNT(*) FILTER (WHERE ${llmUsageTable.status} = 'error')::int`,
      quota: sql<number>`COUNT(*) FILTER (WHERE ${llmUsageTable.status} = 'quota')::int`,
    })
    .from(llmUsageTable)
    .where(gte(llmUsageTable.calledAt, cutoff));

  const byModel = await db
    .select({
      model: llmUsageTable.model,
      calls: sql<number>`COUNT(*)::int`,
      tokens: sql<number>`COALESCE(SUM(${llmUsageTable.totalTokens}), 0)::int`,
      costUsd: sql<number>`COALESCE(SUM(${llmUsageTable.costUsd}), 0)::float`,
    })
    .from(llmUsageTable)
    .where(gte(llmUsageTable.calledAt, cutoff))
    .groupBy(llmUsageTable.model)
    .orderBy(desc(sql`SUM(${llmUsageTable.costUsd})`));

  const byEndpoint = await db
    .select({
      endpoint: llmUsageTable.endpoint,
      calls: sql<number>`COUNT(*)::int`,
      tokens: sql<number>`COALESCE(SUM(${llmUsageTable.totalTokens}), 0)::int`,
      costUsd: sql<number>`COALESCE(SUM(${llmUsageTable.costUsd}), 0)::float`,
    })
    .from(llmUsageTable)
    .where(gte(llmUsageTable.calledAt, cutoff))
    .groupBy(llmUsageTable.endpoint)
    .orderBy(desc(sql`SUM(${llmUsageTable.costUsd})`));

  const byProvider = await db
    .select({
      provider: llmUsageTable.provider,
      calls: sql<number>`COUNT(*)::int`,
      tokens: sql<number>`COALESCE(SUM(${llmUsageTable.totalTokens}), 0)::int`,
      costUsd: sql<number>`COALESCE(SUM(${llmUsageTable.costUsd}), 0)::float`,
    })
    .from(llmUsageTable)
    .where(gte(llmUsageTable.calledAt, cutoff))
    .groupBy(llmUsageTable.provider)
    .orderBy(desc(sql`SUM(${llmUsageTable.costUsd})`));

  const totals = totalsRow[0] ?? { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, errors: 0, quota: 0 };
  const hourlyCost = totals.costUsd / windowHours;
  const monthEstimateUsd = hourlyCost * 24 * 30;

  return { windowHours, totals, byModel, byEndpoint, byProvider, monthEstimateUsd };
}

export interface CsuiteEndpointStats {
  endpoint: string;
  /** Slug parsed from the endpoint tag (e.g. "cto" from "csuite_perspective:cto"). */
  roleSlug: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
  lastAttemptAt: string | null;
  lastStatus: string | null;
  modelsUsed: string[];
}

/**
 * Per-CXO success/failure rates over the given window. Used by the admin
 * dashboard to spot which roles are silently failing — e.g. "cto perspective
 * has 0/12 successes in 24h" surfaces a regression that the legacy console.error
 * path would have hidden.
 */
export async function getCsuitePerspectiveStats(windowHours = 24): Promise<{
  windowHours: number;
  perRole: CsuiteEndpointStats[];
  totals: { attempts: number; successes: number; failures: number; successRate: number };
}> {
  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);

  const rows = await db
    .select({
      endpoint: llmUsageTable.endpoint,
      model: llmUsageTable.model,
      status: llmUsageTable.status,
      calledAt: llmUsageTable.calledAt,
    })
    .from(llmUsageTable)
    .where(sql`${llmUsageTable.calledAt} >= ${cutoff} AND ${llmUsageTable.endpoint} LIKE 'csuite_perspective:%'`)
    .orderBy(desc(llmUsageTable.calledAt));

  // Group in JS rather than SQL — array_agg/distinct on string columns gets
  // verbose and the row count here is bounded (a few hundred tops per day).
  const grouped = new Map<string, {
    attempts: number;
    successes: number;
    failures: number;
    lastAttemptAt: Date | null;
    lastStatus: string | null;
    models: Set<string>;
  }>();

  for (const r of rows) {
    const ep = r.endpoint;
    let g = grouped.get(ep);
    if (!g) {
      g = { attempts: 0, successes: 0, failures: 0, lastAttemptAt: null, lastStatus: null, models: new Set() };
      grouped.set(ep, g);
    }
    g.attempts++;
    if (r.status === "ok") g.successes++; else g.failures++;
    g.models.add(r.model);
    if (!g.lastAttemptAt || r.calledAt > g.lastAttemptAt) {
      g.lastAttemptAt = r.calledAt;
      g.lastStatus = r.status;
    }
  }

  const perRole: CsuiteEndpointStats[] = Array.from(grouped.entries()).map(([endpoint, g]) => ({
    endpoint,
    roleSlug: endpoint.replace(/^csuite_perspective:/, ""),
    attempts: g.attempts,
    successes: g.successes,
    failures: g.failures,
    successRate: g.attempts > 0 ? g.successes / g.attempts : 0,
    lastAttemptAt: g.lastAttemptAt ? g.lastAttemptAt.toISOString() : null,
    lastStatus: g.lastStatus,
    modelsUsed: Array.from(g.models),
  })).sort((a, b) => a.roleSlug.localeCompare(b.roleSlug));

  const totals = perRole.reduce(
    (acc, r) => ({
      attempts: acc.attempts + r.attempts,
      successes: acc.successes + r.successes,
      failures: acc.failures + r.failures,
      successRate: 0,
    }),
    { attempts: 0, successes: 0, failures: 0, successRate: 0 },
  );
  totals.successRate = totals.attempts > 0 ? totals.successes / totals.attempts : 0;

  return { windowHours, perRole, totals };
}

export async function getRecentCalls(limit = 50, opts: { endpoint?: string; status?: string } = {}): Promise<Array<typeof llmUsageTable.$inferSelect>> {
  const conds = [] as ReturnType<typeof sql>[];
  if (opts.endpoint) conds.push(sql`${llmUsageTable.endpoint} = ${opts.endpoint}`);
  if (opts.status) conds.push(sql`${llmUsageTable.status} = ${opts.status}`);
  const where = conds.length === 0 ? sql`TRUE` : conds.reduce((acc, c, i) => i === 0 ? c : sql`${acc} AND ${c}`);
  return await db
    .select()
    .from(llmUsageTable)
    .where(where)
    .orderBy(desc(llmUsageTable.calledAt))
    .limit(limit);
}
