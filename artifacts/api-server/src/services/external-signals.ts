import { db } from "@workspace/db";
import { logLlmCall } from "./llm-usage";
import { capabilitiesTable, industriesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

const STAGES = ["extract", "design", "make", "test", "service", "dispose", "monitor", "enable"] as const;
type Stage = typeof STAGES[number];

const STAGE_KEYWORDS: Record<Stage, string[]> = {
  extract: ["sourcing", "raw material", "mining", "extraction", "procurement", "supply", "data ingest", "data acquisition", "feedstock"],
  design: ["design", "modeling", "architecture", "engineering", "r&d", "research", "blueprint", "underwriting", "policy design"],
  make: ["manufactur", "production", "assembly", "fabricat", "build", "develop", "code", "deploy", "implement", "originate", "claim"],
  test: ["test", "qa", "quality", "validation", "audit", "compliance", "certif"],
  service: ["service", "support", "operation", "maintain", "service delivery", "care", "delivery", "fulfill", "cx", "customer"],
  dispose: ["recycl", "dispose", "decommission", "end-of-life", "salvage", "wind-down"],
  monitor: ["monitor", "observ", "telemetr", "analytic", "reporting", "dashboard", "fraud detect", "risk monitor", "surveillance"],
  enable: ["security", "infrastructure", "data", "cloud", "platform", "governance", "talent", "ai/ml", "ai operations"],
};

export function inferValueChainStage(name: string, description: string): Stage {
  const hay = (`${name} ${description}`).toLowerCase();
  let best: Stage = "enable";
  let bestHits = 0;
  for (const stage of STAGES) {
    let hits = 0;
    for (const kw of STAGE_KEYWORDS[stage]) if (hay.includes(kw)) hits++;
    if (hits > bestHits) { best = stage; bestHits = hits; }
  }
  return best;
}

export async function backfillValueChainStages(industryId?: number): Promise<{ updated: number }> {
  const where = industryId ? eq(capabilitiesTable.industryId, industryId) : undefined;
  const caps = where
    ? await db.select().from(capabilitiesTable).where(where)
    : await db.select().from(capabilitiesTable);
  let updated = 0;
  for (const c of caps) {
    const stage = inferValueChainStage(c.name, c.description ?? "");
    if (c.valueChainStage === stage) continue;
    await db.update(capabilitiesTable).set({ valueChainStage: stage }).where(eq(capabilitiesTable.id, c.id));
    updated++;
  }
  return { updated };
}

type ExternalSignals = {
  patent_count_5y?: number;
  vc_capital_usd_5y?: number;
  startup_count_5y?: number;
};

/**
 * Perplexity-driven external-signal scrape: per capability return USPTO patent
 * count, VC capital deployed, and net startup count over the past 5 years.
 */
export async function ingestExternalSignalsForCapability(capId: number): Promise<{ ok: boolean; data?: ExternalSignals; error?: string }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { ok: false, error: "PERPLEXITY_API_KEY not set" };
  const cap = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.id, capId)).limit(1);
  if (!cap.length) return { ok: false, error: `cap ${capId} not found` };
  const ind = await db.select().from(industriesTable).where(eq(industriesTable.id, cap[0].industryId)).limit(1);
  const industryName = ind[0]?.name ?? "";

  const sysPrompt = "You are a quantitative analyst. Return ONLY one JSON object — no prose.";
  const userPrompt = `For the capability "${cap[0].name}" in the ${industryName} industry, estimate over the past 5 years:
{
  "patent_count_5y": <integer USPTO + EPO patents granted, your best estimate>,
  "vc_capital_usd_5y": <total VC capital deployed in USD, integer>,
  "startup_count_5y": <integer net new startups founded>,
  "rationale": "<one line>"
}
If unknown for any field, use null. Return one JSON object only.`;

  const _esStart = Date.now();
  try {
    const resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) {
      logLlmCall({ provider: "perplexity", model: "sonar", endpoint: "external-signals", startedAt: _esStart, httpStatus: resp.status, errorMessage: `HTTP ${resp.status}` });
      return { ok: false, error: `perplexity ${resp.status}` };
    }
    const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
    logLlmCall({ provider: "perplexity", model: "sonar", endpoint: "external-signals", startedAt: _esStart, httpStatus: resp.status, responseJson: data });
    const content = data.choices[0]?.message?.content ?? "";
    const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) return { ok: false, error: "no JSON object" };
    const parsed = JSON.parse(cleaned.substring(start, end + 1)) as ExternalSignals;

    await db.update(capabilitiesTable).set({
      patentCount: typeof parsed.patent_count_5y === "number" ? parsed.patent_count_5y : 0,
      vcCapitalUsd: typeof parsed.vc_capital_usd_5y === "number" ? parsed.vc_capital_usd_5y : 0,
      startupCount: typeof parsed.startup_count_5y === "number" ? parsed.startup_count_5y : 0,
      externalSignalsUpdatedAt: new Date(),
    }).where(eq(capabilitiesTable.id, capId));

    return { ok: true, data: parsed };
  } catch (err) {
    logLlmCall({ provider: "perplexity", model: "sonar", endpoint: "external-signals", startedAt: _esStart, errorMessage: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function ingestExternalSignalsForIndustry(industryId: number, opts: { concurrency?: number; staleDays?: number } = {}): Promise<{ scanned: number; succeeded: number; errors: string[] }> {
  const concurrency = opts.concurrency ?? 3;
  const staleDays = opts.staleDays ?? 30;
  const cutoff = new Date(Date.now() - staleDays * 86400 * 1000);
  const caps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId));
  const todo = caps.filter(c => !c.externalSignalsUpdatedAt || c.externalSignalsUpdatedAt < cutoff);

  let succeeded = 0;
  const errors: string[] = [];
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const idx = i++;
      const c = todo[idx];
      const r = await ingestExternalSignalsForCapability(c.id);
      if (r.ok) succeeded++;
      else if (r.error) errors.push(`${c.name}: ${r.error}`);
      await new Promise(r => setTimeout(r, 300));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { scanned: todo.length, succeeded, errors: errors.slice(0, 10) };
}

/**
 * Roll up patents / VC / startup counts to value-chain-stage level for an
 * industry. Standard industry-research table shape (patents, VC funding,
 * startups per stage).
 */
export async function valueChainStageProfile(industryId: number) {
  const caps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId));
  const byStage = new Map<string, { stage: string; capCount: number; patents: number; vcUsd: number; startups: number; capabilityIds: number[] }>();
  for (const c of caps) {
    const stage = c.valueChainStage ?? "enable";
    if (!byStage.has(stage)) byStage.set(stage, { stage, capCount: 0, patents: 0, vcUsd: 0, startups: 0, capabilityIds: [] });
    const row = byStage.get(stage)!;
    row.capCount++;
    row.patents += c.patentCount ?? 0;
    row.vcUsd += c.vcCapitalUsd ?? 0;
    row.startups += c.startupCount ?? 0;
    row.capabilityIds.push(c.id);
  }
  return Array.from(byStage.values()).sort((a, b) => STAGES.indexOf(a.stage as Stage) - STAGES.indexOf(b.stage as Stage));
}
