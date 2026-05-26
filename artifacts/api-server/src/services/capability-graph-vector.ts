/**
 * Capability vector search — hybrid Cypher + vector queries over the
 * FalkorDB :Capability mirror.
 *
 * Wires three things together:
 *   1. OpenAI's `text-embedding-3-small` (1536-dim, $0.02/M tokens) as
 *      the embedding source. Direct fetch — no SDK dep since this is
 *      the only OpenAI call in the api-server today.
 *   2. FalkorDB's native vector index on (:Capability).embedding —
 *      `CREATE VECTOR INDEX FOR (n:Capability) ON (n.embedding) ...`
 *      and `CALL db.idx.vector.queryNodes(...)` for retrieval.
 *   3. A `searchCapabilitiesByText` wrapper that embeds the query +
 *      hits the vector index in one call, returning top-k caps with
 *      their cosine similarity scores.
 *
 * Why all-in-FalkorDB instead of using pgvector: the win is HYBRID
 * queries — a Cypher MATCH that combines a vector neighbor lookup with
 * graph traversal in one round-trip ("find caps near 'fraud detection'
 * that ALSO have :DEPENDS_ON edges to caps with high CVI"). Pgvector
 * can't do that without two queries + JOIN gymnastics.
 *
 * Graceful degrade: every function returns null / empty / "not
 * configured" instead of throwing when:
 *   - OPENAI_API_KEY is missing
 *   - USE_GRAPHITI_WORLD_MODEL is unset
 *   - The vector index doesn't exist yet (call ensureVectorIndex first)
 *
 * Cost: 492 backfilled caps × ~100 tokens ≈ $0.001 total. Per new cap:
 * ~$0.000002. Negligible. Embedding generation is the only paid call;
 * vector index + search run locally in FalkorDB at sub-ms latency.
 */

import { isGraphitiEnabled, queryCypher, isGraphitiAvailable } from "../lib/graphiti-client";
import { logger } from "../lib/logger";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;

/**
 * Whether we can both embed (OpenAI key) and store/search (Graphiti +
 * flag on). Used by callers as a quick "should I even try" check.
 */
export function isVectorSearchAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY && isGraphitiEnabled();
}

/**
 * Ensure the vector index on (:Capability).embedding exists. Idempotent
 * — if the index already exists FalkorDB returns an error string we
 * recognise and treat as success. Safe to call on every boot.
 */
export async function ensureVectorIndex(): Promise<{ ok: boolean; alreadyExisted: boolean; error?: string }> {
  if (!isGraphitiAvailable()) {
    return { ok: false, alreadyExisted: false, error: "Graphiti MCP not configured" };
  }
  const result = await queryCypher({
    cypher:
      "CREATE VECTOR INDEX FOR (n:Capability) ON (n.embedding) " +
      `OPTIONS {dimension: ${EMBEDDING_DIM}, similarityFunction: 'cosine'}`,
  });
  if (result.ok) return { ok: true, alreadyExisted: false };
  const err = result.error ?? "";
  // FalkorDB returns "Index already exists" or similar when re-creating.
  if (/already exist/i.test(err) || /already indexed/i.test(err)) {
    return { ok: true, alreadyExisted: true };
  }
  logger.warn({ err }, "[capability-graph-vector] ensureVectorIndex failed");
  return { ok: false, alreadyExisted: false, error: err };
}

/**
 * Generate a 1536-dim embedding for a text string via OpenAI's
 * text-embedding-3-small. Returns null when:
 *   - OPENAI_API_KEY is missing
 *   - The text is empty or whitespace-only
 *   - OpenAI returns an error or malformed response
 *
 * Callers should treat null as "skip this cap; try again later" rather
 * than throwing.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn("[capability-graph-vector] OPENAI_API_KEY not set — cannot embed");
    return null;
  }
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const res = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: trimmed }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn({ status: res.status, body: body.slice(0, 200) }, "[capability-graph-vector] OpenAI embeddings non-200");
      return null;
    }
    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
      error?: { message?: string };
    };
    if (data.error) {
      logger.warn({ err: data.error }, "[capability-graph-vector] OpenAI embeddings error");
      return null;
    }
    const vec = data.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
      logger.warn({ length: vec?.length }, "[capability-graph-vector] OpenAI returned wrong-shape embedding");
      return null;
    }
    return vec;
  } catch (err) {
    logger.warn({ err }, "[capability-graph-vector] embedText threw");
    return null;
  }
}

/**
 * Write a precomputed embedding onto a :Capability node (matched by
 * pgId). Idempotent — overwrites any prior embedding. Returns true on
 * success, false if Graphiti is off or the node doesn't exist.
 *
 * `vecf32($v)` constructs FalkorDB's 32-bit float vector type from a
 * Cypher list parameter. Required for the vector index to accept the
 * write.
 */
export async function setCapabilityEmbedding(pgId: number, embedding: number[]): Promise<boolean> {
  if (!isGraphitiEnabled()) return false;
  if (!Number.isFinite(pgId) || embedding.length !== EMBEDDING_DIM) return false;
  const result = await queryCypher({
    cypher: "MATCH (c:Capability {pgId: $pgId}) SET c.embedding = vecf32($v) RETURN c.pgId AS pgId",
    params: { pgId, v: embedding },
  });
  if (!result.ok) {
    logger.warn({ err: result.error, pgId }, "[capability-graph-vector] setCapabilityEmbedding failed");
    return false;
  }
  return (result.rows?.length ?? 0) > 0;
}

export interface VectorSearchHit {
  pgId: number;
  score: number;       // FalkorDB's cosine-distance score (lower = closer)
  name?: string;
}

/**
 * Vector search by a precomputed query embedding. Returns top-k caps by
 * cosine similarity. Empty array on Graphiti off / index missing /
 * no embeddings written yet.
 *
 * The score's meaning depends on FalkorDB's similarity function. We
 * created the index with `cosine` — FalkorDB returns distance-like
 * scores where lower is closer. Callers can convert via
 * `1 - score` to get a familiar 0-1 similarity.
 */
export async function searchCapabilitiesByVector(
  queryEmbedding: number[],
  k = 10,
): Promise<VectorSearchHit[]> {
  if (!isGraphitiEnabled()) return [];
  if (queryEmbedding.length !== EMBEDDING_DIM) return [];
  const result = await queryCypher({
    cypher:
      "CALL db.idx.vector.queryNodes('Capability', 'embedding', $k, vecf32($v)) " +
      "YIELD node, score RETURN node.pgId AS pgId, node.name AS name, score",
    params: { k: Math.max(1, Math.min(50, Math.floor(k))), v: queryEmbedding },
  });
  if (!result.ok || !result.rows) return [];
  return result.rows
    .map((r) => ({
      pgId: Number(r.pgId),
      score: Number(r.score),
      name: typeof r.name === "string" ? r.name : undefined,
    }))
    .filter((r) => Number.isFinite(r.pgId) && Number.isFinite(r.score));
}

/**
 * Convenience: embed a free-text query and immediately search. Returns
 * empty array on embedding failure (logged) so the caller can degrade.
 */
export async function searchCapabilitiesByText(query: string, k = 10): Promise<VectorSearchHit[]> {
  const vec = await embedText(query);
  if (!vec) return [];
  return searchCapabilitiesByVector(vec, k);
}
