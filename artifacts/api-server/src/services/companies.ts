import { db } from "@workspace/db";
import {
  companiesTable,
  companyCapabilityFingerprintTable,
  companyScoresTable,
  capabilitiesTable,
  industriesTable,
  macroEventsTable,
  ceiComponentsTable,
} from "@workspace/db/schema";
import { and, eq, gt, sql, desc } from "drizzle-orm";
import { logLlmCall } from "./llm-usage";

async function getIndustryCapMetrics(industryId: number) {
  return db.select({
    id: capabilitiesTable.id,
    name: capabilitiesTable.name,
    score: ceiComponentsTable.consensusScore,
    confidence: ceiComponentsTable.confidence,
    velocity: ceiComponentsTable.velocity,
  }).from(capabilitiesTable)
    .leftJoin(ceiComponentsTable, eq(ceiComponentsTable.capabilityId, capabilitiesTable.id))
    .where(eq(capabilitiesTable.industryId, industryId));
}

type IngestedCompany = {
  name: string;
  description?: string;
  country?: string;
  hq_city?: string;
  founded_year?: number;
  employee_count?: number;
  revenue_usd?: number;
  funding_usd?: number;
  public_ticker?: string;
  ownership?: string;
  website_url?: string;
  capabilities: Array<{ name: string; weight?: number; evidence?: string }>;
};

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").substring(0, 80);
}

function safeNum(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return v;
}

/**
 * Perplexity-driven ingestion: for an industry, fetch real US-public-record-grade
 * companies with capability fingerprints anchored against the existing CE
 * capability menu so fingerprints align with our hierarchy.
 */
export async function ingestCompaniesForIndustry(industryId: number, opts: { limit?: number } = {}): Promise<{ inserted: number; updated: number; companies: number[]; errors: string[] }> {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return { inserted: 0, updated: 0, companies: [], errors: ["PERPLEXITY_API_KEY not set"] };

  const ind = await db.select().from(industriesTable).where(eq(industriesTable.id, industryId)).limit(1);
  if (!ind.length) return { inserted: 0, updated: 0, companies: [], errors: [`industry ${industryId} not found`] };
  const industryName = ind[0].name;

  const caps = await db.select().from(capabilitiesTable).where(eq(capabilitiesTable.industryId, industryId));
  const capByLower = new Map(caps.map(c => [c.name.toLowerCase(), c]));
  const limit = opts.limit ?? 25;

  const capMenu = caps.map(c => `- ${c.name}`).join("\n");
  const sysPrompt = "You are a deal-sourcing analyst. Return ONLY a JSON array — no prose, no code fences. Cite real US/global firms with verifiable web footprint.";
  const userPrompt = `List the top ${limit} venture-backed and public companies operating in ${industryName} (US + global). For each, return:
{
  "name": "<legal company name>",
  "description": "<one sentence on what they do>",
  "country": "<ISO country>",
  "hq_city": "<city>",
  "founded_year": <year integer>,
  "employee_count": <integer or null>,
  "revenue_usd": <annual revenue in USD or null>,
  "funding_usd": <total funding in USD or null>,
  "public_ticker": "<ticker or null>",
  "ownership": "public|private|pe-backed|vc-backed",
  "website_url": "<https URL>",
  "capabilities": [{"name":"<EXACT name from menu>","weight":<0..1 share of company effort>,"evidence":"<1-line why>"}]
}

Capability menu (use EXACT names — fingerprints must align with this list):
${capMenu}

Tag 2-6 capabilities per company. Skip companies you can't tag with at least one capability from the menu.
Return a JSON array of ${limit} entries.`;

  let resp: Response;
  const _coStart = Date.now();
  try {
    resp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userPrompt }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    logLlmCall({ provider: "perplexity", model: "sonar", endpoint: "companies.ingest", startedAt: _coStart, errorMessage: err instanceof Error ? err.message : String(err) });
    return { inserted: 0, updated: 0, companies: [], errors: [err instanceof Error ? err.message : String(err)] };
  }
  if (!resp.ok) {
    logLlmCall({ provider: "perplexity", model: "sonar", endpoint: "companies.ingest", startedAt: _coStart, httpStatus: resp.status, errorMessage: `HTTP ${resp.status}` });
    return { inserted: 0, updated: 0, companies: [], errors: [`perplexity ${resp.status}`] };
  }

  const data = await resp.json() as { choices: Array<{ message: { content: string } }>; citations?: string[] };
  logLlmCall({ provider: "perplexity", model: "sonar", endpoint: "companies.ingest", startedAt: _coStart, httpStatus: resp.status, responseJson: data });
  const content = data.choices[0]?.message?.content ?? "";
  const citations = data.citations ?? [];
  const cleaned = content.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return { inserted: 0, updated: 0, companies: [], errors: ["no JSON array in response"] };

  let parsed: IngestedCompany[];
  try {
    parsed = JSON.parse(cleaned.substring(start, end + 1)) as IngestedCompany[];
  } catch (e) {
    return { inserted: 0, updated: 0, companies: [], errors: [`parse error: ${e instanceof Error ? e.message : String(e)}`] };
  }

  let inserted = 0;
  let updated = 0;
  const companyIds: number[] = [];
  const errors: string[] = [];

  for (const co of parsed) {
    if (!co?.name || !Array.isArray(co.capabilities) || co.capabilities.length === 0) continue;
    const slug = slugify(co.name);
    const fpRows = co.capabilities
      .map(fp => ({ cap: capByLower.get((fp.name || "").toLowerCase()), weight: typeof fp.weight === "number" ? Math.max(0, Math.min(1, fp.weight)) : 0.3, evidence: fp.evidence }))
      .filter(r => r.cap);
    if (!fpRows.length) continue;

    try {
      const existing = await db.select().from(companiesTable).where(and(eq(companiesTable.industryId, industryId), eq(companiesTable.slug, slug))).limit(1);
      let companyId: number;
      if (existing.length) {
        const u = await db.update(companiesTable).set({
          description: co.description ?? existing[0].description,
          country: co.country ?? existing[0].country,
          hqCity: co.hq_city ?? existing[0].hqCity,
          foundedYear: safeNum(co.founded_year) ?? existing[0].foundedYear,
          employeeCount: safeNum(co.employee_count) ?? existing[0].employeeCount,
          revenueUsd: safeNum(co.revenue_usd) ?? existing[0].revenueUsd,
          fundingUsd: safeNum(co.funding_usd) ?? existing[0].fundingUsd,
          publicTicker: co.public_ticker ?? existing[0].publicTicker,
          ownership: co.ownership ?? existing[0].ownership,
          websiteUrl: co.website_url ?? existing[0].websiteUrl,
          sourceUrls: citations.slice(0, 10),
          citationsCount: citations.length,
          updatedAt: new Date(),
        }).where(eq(companiesTable.id, existing[0].id)).returning({ id: companiesTable.id });
        companyId = u[0].id;
        updated++;
      } else {
        const i = await db.insert(companiesTable).values({
          industryId,
          slug,
          name: co.name,
          description: co.description ?? "",
          country: co.country ?? null,
          hqCity: co.hq_city ?? null,
          foundedYear: safeNum(co.founded_year) ?? null,
          employeeCount: safeNum(co.employee_count) ?? null,
          revenueUsd: safeNum(co.revenue_usd) ?? null,
          fundingUsd: safeNum(co.funding_usd) ?? null,
          publicTicker: co.public_ticker ?? null,
          ownership: co.ownership ?? null,
          websiteUrl: co.website_url ?? null,
          source: "perplexity",
          sourceUrls: citations.slice(0, 10),
          citationsCount: citations.length,
        }).returning({ id: companiesTable.id });
        companyId = i[0].id;
        inserted++;
      }
      companyIds.push(companyId);

      await db.delete(companyCapabilityFingerprintTable).where(eq(companyCapabilityFingerprintTable.companyId, companyId));
      for (const fp of fpRows) {
        await db.insert(companyCapabilityFingerprintTable).values({
          companyId,
          capabilityId: fp.cap!.id,
          weight: fp.weight,
          evidenceUrl: null,
          evidenceNote: fp.evidence ?? null,
        }).onConflictDoNothing();
      }
    } catch (e) {
      errors.push(`${co.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { inserted, updated, companies: companyIds, errors };
}

/**
 * Compute Moneyball-style composite scores for one company, deterministic
 * from CE evidence + macro events. Each score is in [0,100].
 */
export async function computeCompanyScores(companyId: number): Promise<void> {
  const co = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!co.length) return;
  const company = co[0];

  const fpRows = await db.select({
    fp: companyCapabilityFingerprintTable,
    cap: capabilitiesTable,
  }).from(companyCapabilityFingerprintTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, companyCapabilityFingerprintTable.capabilityId))
    .where(eq(companyCapabilityFingerprintTable.companyId, companyId));
  if (!fpRows.length) return;

  const ceiCaps = await getIndustryCapMetrics(company.industryId);
  const ceiByCap = new Map(ceiCaps.map(c => [c.id, c]));

  let weightSum = 0;
  let ceiNumerator = 0;
  let confidenceSum = 0;
  let velocityNumerator = 0;
  let coveredHighCei = 0;
  let totalHighCei = 0;
  for (const c of ceiCaps) {
    if ((c.score ?? 0) >= 60) totalHighCei++;
  }
  for (const r of fpRows) {
    const m = ceiByCap.get(r.cap.id);
    if (!m) continue;
    weightSum += r.fp.weight;
    ceiNumerator += r.fp.weight * (m.score ?? 50);
    confidenceSum += m.confidence ?? 0.5;
    velocityNumerator += r.fp.weight * (m.velocity ?? 0);
    if ((m.score ?? 0) >= 60) coveredHighCei++;
  }
  const ceiWeighted = weightSum ? ceiNumerator / weightSum : 0;
  const avgConf = fpRows.length ? confidenceSum / fpRows.length : 0;
  const avgVelocity = weightSum ? velocityNumerator / weightSum : 0;
  const capabilityCoverage = totalHighCei ? Math.min(100, (coveredHighCei / totalHighCei) * 100 * 2) : 0;

  // Aged Index: 100 = freshly formed (≤3y); 0 = ≥40y. Lower aged index = "younger / hungrier" upside.
  const yrs = company.foundedYear ? new Date().getFullYear() - company.foundedYear : 15;
  const agedIndex = Math.max(0, Math.min(100, 100 - ((Math.max(0, yrs - 3) / 37) * 100)));

  // Awareness: scaled by citation count + revenue presence + public-ticker boost.
  const awarenessScore = Math.max(0, Math.min(100,
    (company.citationsCount ?? 0) * 6 +
    (company.publicTicker ? 25 : 0) +
    (company.revenueUsd ? Math.min(25, Math.log10((company.revenueUsd ?? 1) + 1) * 5) : 0)
  ));

  // Moat: average CEI of caps where confidence > 0.65 AND velocity > 0; weighted.
  let moatNum = 0; let moatDen = 0;
  for (const r of fpRows) {
    const m = ceiByCap.get(r.cap.id);
    if (!m) continue;
    if ((m.confidence ?? 0) > 0.65 && (m.velocity ?? 0) > 0) {
      moatNum += r.fp.weight * (m.score ?? 50);
      moatDen += r.fp.weight;
    }
  }
  const moatScore = moatDen ? moatNum / moatDen : 0;

  // AI Disruptability: how exposed the firm is to active tech_shift macro events
  // tagged on its caps. Higher = MORE disruptable (bad).
  const activeAiEvents = await db.select().from(macroEventsTable)
    .where(and(eq(macroEventsTable.eventType, "tech_shift"), gt(macroEventsTable.startedAt, sql`now() - interval '60 days'`)));
  let disruptHits = 0;
  for (const ev of activeAiEvents) {
    const tagged = (ev.affectedCapabilityIds ?? []) as number[];
    for (const r of fpRows) {
      if (tagged.includes(r.cap.id)) {
        const elapsed = (Date.now() - new Date(ev.startedAt).getTime()) / (86400 * 1000);
        const decay = Math.max(0, 1 - elapsed / Math.max(1, ev.decayDays));
        disruptHits += ev.severity * decay * r.fp.weight;
      }
    }
  }
  const aiDisruptability = Math.max(0, Math.min(100, disruptHits * 5));

  // Actionability: presence of revenue, funding, contact = ready to engage now.
  const actionability = Math.max(0, Math.min(100,
    (company.revenueUsd ? 30 : 0) +
    (company.fundingUsd ? 25 : 0) +
    (company.websiteUrl ? 15 : 0) +
    (company.employeeCount ? 15 : 0) +
    (avgConf * 15)
  ));

  // Acquisition Probability: small + funded + private = more likely target.
  const sizePenalty = company.employeeCount ? Math.min(40, Math.log10(company.employeeCount + 1) * 10) : 10;
  const fundingBoost = company.fundingUsd ? Math.min(30, Math.log10(company.fundingUsd + 1) * 3) : 0;
  const privateBoost = company.publicTicker ? 0 : 25;
  const acquisitionProbability = Math.max(0, Math.min(100, 50 - sizePenalty + fundingBoost + privateBoost));

  // Quality of Asset: composite of CEI-weighted + confidence + moat.
  const qualityOfAsset = Math.max(0, Math.min(100, ceiWeighted * 0.5 + avgConf * 100 * 0.3 + moatScore * 0.2));

  // Forecasted Value: ceiWeighted + 12 × velocity (one-year extrapolation).
  const forecastedValue = Math.max(0, Math.min(100, ceiWeighted + avgVelocity * 12));

  // Risk Profile: inverse of confidence + AI disruptability.
  const riskProfile = Math.max(0, Math.min(100, (1 - avgConf) * 60 + aiDisruptability * 0.4));

  // Sensitivity: how much the firm's score moves per unit shock to its top cap.
  const topWeight = fpRows.reduce((m, r) => Math.max(m, r.fp.weight), 0);
  const sensitivityProfile = Math.max(0, Math.min(100, topWeight * 100));

  // Composite (Sunasi calls this their "FEVI" — we make it transparent):
  // 0.30 forecastedValue + 0.20 quality + 0.15 moat + 0.15 actionability + 0.10 acquisitionProbability + 0.10 (100-risk)
  const composite =
    forecastedValue * 0.30 +
    qualityOfAsset * 0.20 +
    moatScore * 0.15 +
    actionability * 0.15 +
    acquisitionProbability * 0.10 +
    (100 - riskProfile) * 0.10;

  await db.insert(companyScoresTable).values({
    companyId,
    capabilityCoverage,
    ceiWeighted,
    agedIndex,
    awarenessScore,
    moatScore,
    aiDisruptability,
    actionability,
    acquisitionProbability,
    forecastedValue,
    qualityOfAsset,
    riskProfile,
    sensitivityProfile,
    composite,
    details: { capCount: fpRows.length, avgConf, avgVelocity, weightSum },
    lastComputedAt: new Date(),
  }).onConflictDoUpdate({
    target: companyScoresTable.companyId,
    set: {
      capabilityCoverage, ceiWeighted, agedIndex, awarenessScore, moatScore,
      aiDisruptability, actionability, acquisitionProbability, forecastedValue,
      qualityOfAsset, riskProfile, sensitivityProfile, composite,
      details: { capCount: fpRows.length, avgConf, avgVelocity, weightSum },
      lastComputedAt: new Date(),
    },
  });
}

export async function recomputeAllScoresForIndustry(industryId: number): Promise<{ count: number }> {
  const cos = await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.industryId, industryId));
  for (const c of cos) await computeCompanyScores(c.id);
  return { count: cos.length };
}

export async function listCompaniesForIndustry(industryId: number, opts: { limit?: number; sort?: string } = {}) {
  const limit = opts.limit ?? 100;
  const rows = await db.select({
    company: companiesTable,
    scores: companyScoresTable,
  }).from(companiesTable)
    .leftJoin(companyScoresTable, eq(companyScoresTable.companyId, companiesTable.id))
    .where(eq(companiesTable.industryId, industryId))
    .orderBy(desc(companyScoresTable.composite))
    .limit(limit);
  return rows;
}

export async function getCompanyDetail(companyId: number) {
  const co = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!co.length) return null;
  const scores = await db.select().from(companyScoresTable).where(eq(companyScoresTable.companyId, companyId)).limit(1);
  const fp = await db.select({
    fp: companyCapabilityFingerprintTable,
    cap: capabilitiesTable,
  }).from(companyCapabilityFingerprintTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, companyCapabilityFingerprintTable.capabilityId))
    .where(eq(companyCapabilityFingerprintTable.companyId, companyId));
  return { company: co[0], scores: scores[0] ?? null, fingerprint: fp };
}

/**
 * Companies-like search: cosine similarity over capability fingerprint vectors.
 */
export async function findSimilarCompanies(companyId: number, opts: { limit?: number } = {}) {
  const limit = opts.limit ?? 10;
  const target = await db.select().from(companyCapabilityFingerprintTable).where(eq(companyCapabilityFingerprintTable.companyId, companyId));
  if (!target.length) return [];
  const targetVec = new Map(target.map(r => [r.capabilityId, r.weight]));
  const targetNorm = Math.sqrt(Array.from(targetVec.values()).reduce((s, v) => s + v * v, 0));

  const co = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!co.length) return [];
  const peers = await db.select({
    fp: companyCapabilityFingerprintTable,
    company: companiesTable,
  }).from(companyCapabilityFingerprintTable)
    .innerJoin(companiesTable, eq(companiesTable.id, companyCapabilityFingerprintTable.companyId))
    .where(and(eq(companiesTable.industryId, co[0].industryId), sql`${companyCapabilityFingerprintTable.companyId} <> ${companyId}`));

  const grouped = new Map<number, { company: typeof companiesTable.$inferSelect; vec: Map<number, number> }>();
  for (const row of peers) {
    if (!grouped.has(row.company.id)) grouped.set(row.company.id, { company: row.company, vec: new Map() });
    grouped.get(row.company.id)!.vec.set(row.fp.capabilityId, row.fp.weight);
  }

  const sims: Array<{ company: typeof companiesTable.$inferSelect; similarity: number; sharedCaps: number }> = [];
  for (const { company, vec } of grouped.values()) {
    let dot = 0;
    let sharedCaps = 0;
    for (const [capId, w] of vec) {
      const tw = targetVec.get(capId);
      if (tw !== undefined) { dot += tw * w; sharedCaps++; }
    }
    const norm = Math.sqrt(Array.from(vec.values()).reduce((s, v) => s + v * v, 0));
    const similarity = (targetNorm && norm) ? dot / (targetNorm * norm) : 0;
    if (similarity > 0) sims.push({ company, similarity, sharedCaps });
  }
  sims.sort((a, b) => b.similarity - a.similarity);
  return sims.slice(0, limit);
}
