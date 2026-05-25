import { db } from "@workspace/db";
import {
  companiesTable,
  companyCapabilityFingerprintTable,
  companyScoresTable,
  capabilitiesTable,
  industriesTable,
  macroEventsTable,
  cviComponentsTable,
} from "@workspace/db/schema";
import { and, eq, gt, sql, desc } from "drizzle-orm";
import { logLlmCall } from "./llm-usage";
import { maybeStepAiWrap } from "../inngest/step-context";

async function getIndustryCapMetrics(industryId: number) {
  return db.select({
    id: capabilitiesTable.id,
    name: capabilitiesTable.name,
    score: cviComponentsTable.consensusScore,
    confidence: cviComponentsTable.confidence,
    velocity: cviComponentsTable.velocity,
  }).from(capabilitiesTable)
    .leftJoin(cviComponentsTable, eq(cviComponentsTable.capabilityId, capabilitiesTable.id))
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
 * Normalize a capability name for fuzzy comparison: lowercase, drop
 * everything that isn't a letter or digit, collapse to a single string.
 * "Risk Management & Analytics" → "riskmanagementanalytics"
 * "AML / KYC Compliance"        → "amlkyccompliance"
 */
function normalizeCapName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

type CapResolver = (providedName: string) => { cap: typeof capabilitiesTable.$inferSelect; matchKind: "exact" | "normalized" | "substring" | "tokens" } | null;

/** Tokenize on whitespace/punctuation. Drops stop words ("and", "the", "of") that
 *  the LLM and the menu may render inconsistently. */
function tokenizeCapName(s: string): Set<string> {
  const stop = new Set(["and", "the", "of", "for", "in", "to", "a", "an", "&"]);
  const tokens = s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1 && !stop.has(t));
  return new Set(tokens);
}

/**
 * Build a resolver that maps a Perplexity-supplied capability name to one of
 * the industry's actual capability rows. LLMs paraphrase the menu constantly
 * ("Risk Analytics" instead of "Risk Management & Analytics"), so we do three
 * passes in priority order — exact lowercase, normalized (strip punct/space),
 * then substring containment in either direction. Returns null if nothing
 * resolves so the caller can log the unmatched name as an error.
 */
function buildCapResolver(industryCaps: ReadonlyArray<typeof capabilitiesTable.$inferSelect>): CapResolver {
  const byLower = new Map(industryCaps.map(c => [c.name.toLowerCase(), c]));
  const byNorm = new Map(industryCaps.map(c => [normalizeCapName(c.name), c]));
  const indexed = industryCaps.map(c => ({
    cap: c,
    norm: normalizeCapName(c.name),
    tokens: tokenizeCapName(c.name),
  }));

  return (providedName: string) => {
    if (!providedName) return null;
    const lower = providedName.toLowerCase();
    const exact = byLower.get(lower);
    if (exact) return { cap: exact, matchKind: "exact" };

    const norm = normalizeCapName(providedName);
    if (!norm) return null;
    const normHit = byNorm.get(norm);
    if (normHit) return { cap: normHit, matchKind: "normalized" };

    // Substring containment in either direction — catches the "Payments" →
    // "Payments Infrastructure" case cheaply. Pick the longest matching menu
    // name (most specific) when several would qualify.
    let subBest: { cap: typeof capabilitiesTable.$inferSelect; len: number } | null = null;
    for (const { cap, norm: menuNorm } of indexed) {
      if (menuNorm.includes(norm) || norm.includes(menuNorm)) {
        if (!subBest || menuNorm.length > subBest.len) subBest = { cap, len: menuNorm.length };
      }
    }
    if (subBest) return { cap: subBest.cap, matchKind: "substring" };

    // Token-set match — handles "Risk Analytics" ↔ "Risk Management &
    // Analytics" where neither normalized string contains the other but they
    // share meaningful tokens. Require ≥2 shared tokens (or all tokens of
    // the shorter side when the shorter side has fewer than 2 meaningful
    // tokens), then rank by Jaccard so the closest menu entry wins. Skips
    // single-token provided names entirely — too ambiguous to match safely.
    const provTokens = tokenizeCapName(providedName);
    if (provTokens.size < 2) return null;
    let tokBest: { cap: typeof capabilitiesTable.$inferSelect; jaccard: number } | null = null;
    for (const { cap, tokens: menuTokens } of indexed) {
      let shared = 0;
      for (const t of provTokens) if (menuTokens.has(t)) shared++;
      if (shared < 2) continue;
      const union = new Set([...provTokens, ...menuTokens]).size;
      const jaccard = shared / union;
      if (!tokBest || jaccard > tokBest.jaccard) tokBest = { cap, jaccard };
    }
    // 0.4 threshold — empirically tight enough to avoid "Tax" matching every
    // tax-adjacent capability, loose enough to bridge LLM paraphrasing.
    if (tokBest && tokBest.jaccard >= 0.4) return { cap: tokBest.cap, matchKind: "tokens" };

    return null;
  };
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
  if (!caps.length) return { inserted: 0, updated: 0, companies: [], errors: [`no capabilities seeded for industry ${industryId} — run the capability seed first`] };
  const resolveCap = buildCapResolver(caps);
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

  let data: { choices: Array<{ message: { content: string } }>; citations?: string[] };
  try {
    const { perplexityChat } = await import("./perplexity");
    data = await perplexityChat({
      model: "sonar",
      endpoint: "companies.ingest",
      timeoutMs: 120_000,
      messages: [{ role: "system", content: sysPrompt }, { role: "user", content: userPrompt }],
    });
  } catch (err) {
    return { inserted: 0, updated: 0, companies: [], errors: [err instanceof Error ? err.message : String(err)] };
  }
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

  let skippedNoCapabilities = 0;
  const unmatchedCapNames = new Set<string>();
  for (const co of parsed) {
    if (!co?.name || !Array.isArray(co.capabilities) || co.capabilities.length === 0) {
      skippedNoCapabilities++;
      continue;
    }
    const slug = slugify(co.name);
    const fpRows: Array<{ cap: typeof capabilitiesTable.$inferSelect; weight: number; evidence?: string }> = [];
    for (const fp of co.capabilities) {
      const resolved = resolveCap(fp.name || "");
      if (!resolved) {
        if (fp.name) unmatchedCapNames.add(fp.name);
        continue;
      }
      fpRows.push({
        cap: resolved.cap,
        weight: typeof fp.weight === "number" ? Math.max(0, Math.min(1, fp.weight)) : 0.3,
        evidence: fp.evidence,
      });
    }
    if (!fpRows.length) {
      skippedNoCapabilities++;
      continue;
    }

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
          capabilityId: fp.cap.id,
          weight: fp.weight,
          evidenceUrl: null,
          evidenceNote: fp.evidence ?? null,
        }).onConflictDoNothing();
      }
    } catch (e) {
      errors.push(`${co.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (skippedNoCapabilities > 0) {
    errors.push(`${skippedNoCapabilities} companies skipped — no capability tag from the menu resolved`);
  }
  if (unmatchedCapNames.size > 0) {
    // Most useful diagnostic: which Perplexity-supplied names didn't resolve.
    // Truncate to the first 10 so the error array stays readable.
    const sample = Array.from(unmatchedCapNames).slice(0, 10);
    errors.push(`unmatched capability names from Perplexity (${unmatchedCapNames.size} total): ${sample.join(" | ")}`);
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

  const cviCaps = await getIndustryCapMetrics(company.industryId);
  const cviByCap = new Map(cviCaps.map(c => [c.id, c]));

  let weightSum = 0;
  let cviNumerator = 0;
  let confidenceSum = 0;
  let velocityNumerator = 0;
  let coveredHighCvi = 0;
  let totalHighCvi = 0;
  for (const c of cviCaps) {
    if ((c.score ?? 0) >= 60) totalHighCvi++;
  }
  for (const r of fpRows) {
    const m = cviByCap.get(r.cap.id);
    if (!m) continue;
    weightSum += r.fp.weight;
    cviNumerator += r.fp.weight * (m.score ?? 50);
    confidenceSum += m.confidence ?? 0.5;
    velocityNumerator += r.fp.weight * (m.velocity ?? 0);
    if ((m.score ?? 0) >= 60) coveredHighCvi++;
  }
  const cviWeighted = weightSum ? cviNumerator / weightSum : 0;
  const avgConf = fpRows.length ? confidenceSum / fpRows.length : 0;
  const avgVelocity = weightSum ? velocityNumerator / weightSum : 0;
  const capabilityCoverage = totalHighCvi ? Math.min(100, (coveredHighCvi / totalHighCvi) * 100 * 2) : 0;

  // Aged Index: 100 = freshly formed (≤3y); 0 = ≥40y. Lower aged index = "younger / hungrier" upside.
  const yrs = company.foundedYear ? new Date().getFullYear() - company.foundedYear : 15;
  const agedIndex = Math.max(0, Math.min(100, 100 - ((Math.max(0, yrs - 3) / 37) * 100)));

  // Awareness: scaled by citation count + revenue presence + public-ticker boost.
  const awarenessScore = Math.max(0, Math.min(100,
    (company.citationsCount ?? 0) * 6 +
    (company.publicTicker ? 25 : 0) +
    (company.revenueUsd ? Math.min(25, Math.log10((company.revenueUsd ?? 1) + 1) * 5) : 0)
  ));

  // Moat: average CVI of caps where confidence > 0.65 AND velocity > 0; weighted.
  let moatNum = 0; let moatDen = 0;
  for (const r of fpRows) {
    const m = cviByCap.get(r.cap.id);
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

  // Quality of Asset: composite of CVI-weighted + confidence + moat.
  const qualityOfAsset = Math.max(0, Math.min(100, cviWeighted * 0.5 + avgConf * 100 * 0.3 + moatScore * 0.2));

  // Forecasted Value: cviWeighted + 12 × velocity (one-year extrapolation).
  const forecastedValue = Math.max(0, Math.min(100, cviWeighted + avgVelocity * 12));

  // Risk Profile: inverse of confidence + AI disruptability.
  const riskProfile = Math.max(0, Math.min(100, (1 - avgConf) * 60 + aiDisruptability * 0.4));

  // Sensitivity: how much the firm's score moves per unit shock to its top cap.
  const topWeight = fpRows.reduce((m, r) => Math.max(m, r.fp.weight), 0);
  const sensitivityProfile = Math.max(0, Math.min(100, topWeight * 100));

  // Composite ("FEVI" = Forecasted Enterprise Value Index — transparent weighting):
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
    cviWeighted,
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
      capabilityCoverage, cviWeighted, agedIndex, awarenessScore, moatScore,
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

/**
 * Batch version of findSimilarCompanies — for every company in the industry
 * that has a capability fingerprint, return its top-N closest peers (cosine
 * similarity over the same fingerprint vectors).
 *
 * One SQL pull, then O(C²·K) in-memory where C = #companies-with-fingerprints
 * and K = avg fingerprint length. The pairwise loop is intentionally simple —
 * realistic per-industry counts are <200 companies × <30 caps, so this is
 * sub-millisecond. Keeps the /companies page from issuing C separate /similar
 * calls.
 */
export async function findClosestPeersByIndustry(
  industryId: number,
  opts: { perCompanyLimit?: number } = {},
): Promise<Record<number, Array<{ company: typeof companiesTable.$inferSelect; similarity: number; sharedCaps: number }>>> {
  const perCompanyLimit = opts.perCompanyLimit ?? 3;
  const rows = await db.select({
    fp: companyCapabilityFingerprintTable,
    company: companiesTable,
  }).from(companyCapabilityFingerprintTable)
    .innerJoin(companiesTable, eq(companiesTable.id, companyCapabilityFingerprintTable.companyId))
    .where(eq(companiesTable.industryId, industryId));

  const byCompany = new Map<number, { company: typeof companiesTable.$inferSelect; vec: Map<number, number>; norm: number }>();
  for (const row of rows) {
    let entry = byCompany.get(row.company.id);
    if (!entry) {
      entry = { company: row.company, vec: new Map(), norm: 0 };
      byCompany.set(row.company.id, entry);
    }
    entry.vec.set(row.fp.capabilityId, row.fp.weight);
  }
  for (const entry of byCompany.values()) {
    entry.norm = Math.sqrt(Array.from(entry.vec.values()).reduce((s, v) => s + v * v, 0));
  }

  const entries = Array.from(byCompany.values());
  const out: Record<number, Array<{ company: typeof companiesTable.$inferSelect; similarity: number; sharedCaps: number }>> = {};
  for (const target of entries) {
    if (!target.norm) { out[target.company.id] = []; continue; }
    const peers: Array<{ company: typeof companiesTable.$inferSelect; similarity: number; sharedCaps: number }> = [];
    for (const peer of entries) {
      if (peer.company.id === target.company.id) continue;
      if (!peer.norm) continue;
      let dot = 0;
      let sharedCaps = 0;
      for (const [capId, w] of peer.vec) {
        const tw = target.vec.get(capId);
        if (tw !== undefined) { dot += tw * w; sharedCaps++; }
      }
      if (!sharedCaps) continue;
      const similarity = dot / (target.norm * peer.norm);
      if (similarity > 0) peers.push({ company: peer.company, similarity, sharedCaps });
    }
    peers.sort((a, b) => b.similarity - a.similarity);
    out[target.company.id] = peers.slice(0, perCompanyLimit);
  }
  return out;
}
