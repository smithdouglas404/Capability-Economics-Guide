/**
 * Semantic-ish capability search.
 *
 * Two backends, selected at runtime:
 *  - BM25 lexical scorer over capability name + description + traditionalView +
 *    economicView. Always available, zero dependencies. Handles the
 *    "find capabilities similar to X" question well when X is a phrase /
 *    sentence.
 *  - (placeholder) embedding-based cosine similarity. Requires OPENAI_API_KEY
 *    + a capability_embeddings table populated by a background job. Until that
 *    lands, we fall back to BM25.
 *
 * Scope: leaf + rollup capabilities (or just leaves when leafOnly=1).
 * Approved-only by default; admins can pass includePending=1.
 */
import { db } from "@workspace/db";
import { capabilitiesTable, industriesTable } from "@workspace/db";

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","by","for","from","has","have","i","in","is","it","of","on","or","that","the","to","was","were","will","with","this","these","those","not","but","you","your","they","their","our","we","do","does","did","done","done.","its","also","more","most","than","then","such","into","over","under","across","via","through","up","down","out",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

// BM25 parameters — k1 controls term-frequency saturation, b controls
// length normalization. Standard mid-of-the-road defaults.
const K1 = 1.5;
const B = 0.75;

interface IndexEntry {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  slug: string;
  isLeaf: boolean;
  reviewStatus: string;
  tokens: string[];
  termFreq: Map<string, number>;
  docLen: number;
}

let cachedIndex: { at: number; entries: IndexEntry[]; avgDocLen: number; docFreq: Map<string, number> } | null = null;
const INDEX_TTL_MS = 5 * 60 * 1000;

async function buildIndex(): Promise<NonNullable<typeof cachedIndex>> {
  const [caps, industries] = await Promise.all([
    db.select().from(capabilitiesTable),
    db.select().from(industriesTable),
  ]);
  const indById = new Map(industries.map(i => [i.id, i]));

  const entries: IndexEntry[] = caps.map(c => {
    const blob = [c.name, c.slug, c.description, c.traditionalView, c.economicView].join(" ");
    const tokens = tokenize(blob);
    const termFreq = new Map<string, number>();
    for (const t of tokens) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
    return {
      capabilityId: c.id,
      capabilityName: c.name,
      industryId: c.industryId,
      industryName: indById.get(c.industryId)?.name ?? "Unknown",
      slug: c.slug,
      isLeaf: c.isLeaf,
      reviewStatus: c.reviewStatus,
      tokens,
      termFreq,
      docLen: tokens.length,
    };
  });
  const avgDocLen = entries.length === 0 ? 0 : entries.reduce((s, e) => s + e.docLen, 0) / entries.length;

  const docFreq = new Map<string, number>();
  for (const e of entries) {
    const unique = new Set(e.termFreq.keys());
    for (const t of unique) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }

  return { at: Date.now(), entries, avgDocLen, docFreq };
}

async function getIndex() {
  if (cachedIndex && Date.now() - cachedIndex.at < INDEX_TTL_MS) return cachedIndex;
  cachedIndex = await buildIndex();
  return cachedIndex;
}

function bm25(entry: IndexEntry, queryTokens: string[], idx: NonNullable<typeof cachedIndex>): number {
  let score = 0;
  for (const q of queryTokens) {
    const df = idx.docFreq.get(q) ?? 0;
    if (df === 0) continue;
    const N = idx.entries.length;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    const tf = entry.termFreq.get(q) ?? 0;
    if (tf === 0) continue;
    const norm = tf * (K1 + 1) / (tf + K1 * (1 - B + B * (entry.docLen / Math.max(1, idx.avgDocLen))));
    score += idf * norm;
  }
  // Boost: exact name token overlap.
  const nameTokens = new Set(tokenize(entry.capabilityName));
  let exactBonus = 0;
  for (const q of queryTokens) if (nameTokens.has(q)) exactBonus += 1;
  return score + 0.5 * exactBonus;
}

export interface SearchResult {
  capabilityId: number;
  capabilityName: string;
  industryId: number;
  industryName: string;
  slug: string;
  isLeaf: boolean;
  score: number;
  matchedTerms: string[];
}

export async function searchCapabilities(args: {
  query: string;
  limit?: number;
  leafOnly?: boolean;
  includePending?: boolean;
  industryId?: number;
}): Promise<{ results: SearchResult[]; backend: "bm25" | "embeddings" }> {
  const qTokens = tokenize(args.query);
  if (qTokens.length === 0) return { results: [], backend: "bm25" };

  const idx = await getIndex();
  let pool = idx.entries;
  if (!args.includePending) pool = pool.filter(e => e.reviewStatus === "approved");
  if (args.leafOnly) pool = pool.filter(e => e.isLeaf);
  if (args.industryId !== undefined) pool = pool.filter(e => e.industryId === args.industryId);

  const scored = pool
    .map(e => ({
      entry: e,
      score: bm25(e, qTokens, idx),
    }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, args.limit ?? 25)
    .map(r => ({
      capabilityId: r.entry.capabilityId,
      capabilityName: r.entry.capabilityName,
      industryId: r.entry.industryId,
      industryName: r.entry.industryName,
      slug: r.entry.slug,
      isLeaf: r.entry.isLeaf,
      score: Math.round(r.score * 1000) / 1000,
      matchedTerms: qTokens.filter(q => r.entry.termFreq.has(q)),
    }));

  return { results: scored, backend: "bm25" };
}

export interface SimilarCapability {
  capabilityId: number;
  capabilityName: string;
  industryName: string;
  score: number;
}

export async function findSimilarToCapability(capabilityId: number, limit = 10): Promise<SimilarCapability[]> {
  const idx = await getIndex();
  const seed = idx.entries.find(e => e.capabilityId === capabilityId);
  if (!seed) return [];

  // Use the seed's top-weighted tokens (by tf) as a synthetic query so we
  // find docs that share the most distinctive terms.
  const topTerms = [...seed.termFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([t]) => t);

  const scored = idx.entries
    .filter(e => e.capabilityId !== capabilityId && e.reviewStatus === "approved")
    .map(e => ({ entry: e, score: bm25(e, topTerms, idx) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(r => ({
      capabilityId: r.entry.capabilityId,
      capabilityName: r.entry.capabilityName,
      industryName: r.entry.industryName,
      score: Math.round(r.score * 1000) / 1000,
    }));

  return scored;
}

export function _resetSemanticIndexForTest(): void {
  cachedIndex = null;
}
