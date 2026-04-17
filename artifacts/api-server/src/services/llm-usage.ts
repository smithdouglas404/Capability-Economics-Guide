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
