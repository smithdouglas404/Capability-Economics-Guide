/**
 * Trade-thesis generator for /comparables/:companyId.
 *
 * For a target company, generates 3 trade ideas (long / short / pair-trade)
 * grounded in the company's capability fingerprint, peer cohort moat scores,
 * disruption velocity, and EVaR-derived sizing range.
 *
 * Caching: results are kept in-memory for 24h per companyId since the
 * underlying signals (CVI components, alpha rows, fingerprint weights) move
 * slowly and a Sonnet call costs ~$0.04. Cache is process-local; survives
 * for the lifetime of the api-server.
 */
import { db } from "@workspace/db";
import {
  companiesTable,
  companyCapabilityFingerprintTable,
  companyScoresTable,
  capabilitiesTable,
  cviComponentsTable,
  capabilityAlphaTable,
} from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { sonnet, generateObject, NoObjectGeneratedError } from "../workflows/models";
import { findSimilarCompanies } from "../companies";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const TradeThesisSchema = z.object({
  theses: z.array(z.object({
    kind: z.enum(["long", "short", "pair"]),
    headline: z.string().describe("One-line trade idea — e.g. 'Long ACME: undervalued underwriting moat'."),
    rationale: z.string().describe("One paragraph (3-5 sentences) explaining the trade, anchored to the company's capability fingerprint and the named capabilities driving the call."),
    sizing: z.string().describe("EVaR-backed sizing range as text — e.g. '1.5-3% of book' — calibrated to the EVaR figure provided in the prompt."),
    capabilities: z.array(z.string()).describe("Names of the capabilities driving this thesis."),
  })).length(3),
});

export type TradeThesis = z.infer<typeof TradeThesisSchema>["theses"][number];

export interface TradeThesesResult {
  companyId: number;
  companyName: string;
  generatedAt: string;
  cached: boolean;
  evarPortfolioMm: number | null;
  theses: TradeThesis[];
}

interface CacheEntry { result: TradeThesesResult; expiresAt: number }
const cache = new Map<number, CacheEntry>();

/**
 * Compute portfolio-level EVaR(12m) for the target company by summing
 * its capability fingerprint × per-cap EVaR. Returns null if no signals.
 */
async function computeEvarForCompany(companyId: number): Promise<{ evarMm: number | null; topCaps: Array<{ name: string; evarMm: number }> }> {
  const fp = await db.select({
    capId: companyCapabilityFingerprintTable.capabilityId,
    weight: companyCapabilityFingerprintTable.weight,
    name: capabilitiesTable.name,
  })
    .from(companyCapabilityFingerprintTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, companyCapabilityFingerprintTable.capabilityId))
    .where(eq(companyCapabilityFingerprintTable.companyId, companyId));
  if (fp.length === 0) return { evarMm: null, topCaps: [] };
  const capIds = fp.map(r => r.capId);
  const alphas = await db.select().from(capabilityAlphaTable).where(inArray(capabilityAlphaTable.capabilityId, capIds));
  const alphaMap = new Map(alphas.map(a => [a.capabilityId, a]));
  const perCap: Array<{ name: string; evarMm: number }> = [];
  for (const r of fp) {
    const a = alphaMap.get(r.capId);
    if (!a?.revenueExposureMm || !a.marginStructurePct || !a.halfLifeMonths) continue;
    const halfLife = Math.max(6, a.halfLifeMonths);
    const evar = a.revenueExposureMm * (a.marginStructurePct / 100) * (1 - Math.pow(0.5, 12 / halfLife));
    perCap.push({ name: r.name, evarMm: evar * r.weight });
  }
  const evarMm = perCap.reduce((s, r) => s + r.evarMm, 0);
  perCap.sort((a, b) => b.evarMm - a.evarMm);
  return { evarMm: evarMm > 0 ? evarMm : null, topCaps: perCap.slice(0, 5) };
}

export async function getOrGenerateTradeTheses(
  companyId: number,
  opts: { forceFresh?: boolean } = {},
): Promise<TradeThesesResult | null> {
  if (!opts.forceFresh) {
    const hit = cache.get(companyId);
    if (hit && hit.expiresAt > Date.now()) {
      return { ...hit.result, cached: true };
    }
  }

  const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!co) return null;
  const [scores] = await db.select().from(companyScoresTable).where(eq(companyScoresTable.companyId, companyId)).limit(1);
  const { evarMm, topCaps } = await computeEvarForCompany(companyId);
  const fp = await db.select({
    capId: companyCapabilityFingerprintTable.capabilityId,
    weight: companyCapabilityFingerprintTable.weight,
    name: capabilitiesTable.name,
    cvi: cviComponentsTable.consensusScore,
    velocity: cviComponentsTable.velocity,
  })
    .from(companyCapabilityFingerprintTable)
    .innerJoin(capabilitiesTable, eq(capabilitiesTable.id, companyCapabilityFingerprintTable.capabilityId))
    .leftJoin(cviComponentsTable, eq(cviComponentsTable.capabilityId, companyCapabilityFingerprintTable.capabilityId))
    .where(eq(companyCapabilityFingerprintTable.companyId, companyId));

  // Closest peer for the pair-trade leg.
  const peers = await findSimilarCompanies(companyId, { limit: 5 });
  const closestPeer = peers[0] ?? null;

  const fpSummary = fp
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8)
    .map(r => `- ${r.name}: weight=${r.weight.toFixed(2)}, CVI=${r.cvi?.toFixed(0) ?? "n/a"}, velocity=${r.velocity?.toFixed(2) ?? "n/a"}`)
    .join("\n");
  const evarLine = evarMm != null ? `Portfolio EVaR(12m): $${evarMm.toFixed(1)}M` : "EVaR not computable (insufficient alpha rows).";
  const topEvarCaps = topCaps.length ? `Top EVaR contributors: ${topCaps.map(c => `${c.name} ($${c.evarMm.toFixed(1)}M)`).join("; ")}` : "";
  const peerLine = closestPeer ? `Closest peer (cap-fingerprint cosine ${(closestPeer.similarity * 100).toFixed(0)}%): ${closestPeer.company.name}${closestPeer.company.publicTicker ? ` (${closestPeer.company.publicTicker})` : ""}` : "No close peer with overlapping fingerprint.";

  const system = `You are a buy-side analyst writing concise trade theses for a capability-economics platform. Each thesis must reference SPECIFIC capabilities from the provided fingerprint by name. Avoid generic finance jargon. Sizing must be a percent-of-book range (e.g. "1-2.5%") calibrated to the EVaR figure: a smaller EVaR ⇒ smaller sizing, a larger EVaR with high conviction ⇒ up to ~5%. Output exactly 3 theses in this order: long, short, pair.`;
  const prompt = `Target: ${co.name}${co.publicTicker ? ` (${co.publicTicker})` : ""}
Industry: ${co.industryId}
Composite score: ${scores?.composite?.toFixed(0) ?? "n/a"}
Moat score: ${scores?.moatScore?.toFixed(0) ?? "n/a"}
AI-disruptability: ${scores?.aiDisruptability?.toFixed(0) ?? "n/a"}
${evarLine}
${topEvarCaps}
${peerLine}

Capability fingerprint (top 8 by weight):
${fpSummary || "(no fingerprint on file)"}

Now produce three trade theses:
1. LONG ${co.name}: anchor to the company's strongest moat capability.
2. SHORT: anchor to a below-cohort capability + rising disruption velocity.
3. PAIR: long ${co.name} / short ${closestPeer?.company.name ?? "closest fingerprint peer"} based on capability divergence.`;

  try {
    const { object } = await generateObject({
      model: sonnet,
      schema: TradeThesisSchema,
      system,
      prompt,
      temperature: 0.3,
      maxTokens: 2000,
    });
    const result: TradeThesesResult = {
      companyId,
      companyName: co.name,
      generatedAt: new Date().toISOString(),
      cached: false,
      evarPortfolioMm: evarMm,
      theses: object.theses,
    };
    cache.set(companyId, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    if (err instanceof NoObjectGeneratedError) {
      // Schema-validation failure after the SDK's auto-retry — return null
      // and let the caller render an empty state rather than 5xx.
      return null;
    }
    throw err;
  }
}
