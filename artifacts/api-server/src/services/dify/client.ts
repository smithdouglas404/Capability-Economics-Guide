/**
 * Dify Service API client — thin fetch wrapper with bearer auth.
 *
 * Self-hosted Dify exposes a `/v1/*` Service API for programmatic access to
 * Knowledge bases (RAG datasets) + chat/completion apps. Endpoint paths
 * verified from upstream source at langgenius/dify
 * (api/controllers/service_api/{__init__.py, dataset/{dataset.py,
 * document.py, hit_testing.py}}).
 *
 * The Dify Cloud (cloud.dify.ai) and self-hosted variants speak the same
 * Service API protocol, so this client works against either. We deploy
 * self-hosted; the env vars below point at the self-hosted host.
 *
 * Endpoints we use (relative to `${DIFY_BASE_URL}/v1`):
 *   POST   /datasets                                              create KB
 *   GET    /datasets                                              list KBs
 *   POST   /datasets/<id>/document/create-by-text                 add doc from text (singular `document`)
 *   POST   /datasets/<id>/documents/<doc_id>/update-by-text       update doc text (plural)
 *   DELETE /datasets/<id>/documents/<doc_id>                      delete doc
 *   GET    /datasets/<id>/documents                               list docs (paginated)
 *   POST   /datasets/<id>/retrieve                                semantic search (alias of /hit-testing)
 *
 * Auth: `Authorization: Bearer <DIFY_API_KEY>` on every request. The API
 * key is workspace-scoped (one Dify workspace → one Service API key) and
 * generated from the Dify admin UI after Phase 2 bootstrap.
 *
 * Graceful-degrade contract: every callable here returns null / empty on
 * misconfiguration so the calling code paths (marketplace approval,
 * search endpoint) don't crash when Dify is unset. Mirrors the
 * Mem0/Letta/Foundry pattern.
 */

import pino from "pino";

const logger = pino({ name: "dify-client" });

interface DifyConfig {
  baseUrl: string;
  apiKey: string;
}

/**
 * Resolve Dify connection config from env. Returns null when either env var
 * is unset — callers should treat null as "Dify integration disabled".
 */
export function getDifyConfig(): DifyConfig | null {
  const baseUrl = (process.env.DIFY_BASE_URL ?? "").replace(/\/+$/, "");
  const apiKey = process.env.DIFY_API_KEY ?? "";
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

export function isDifyAvailable(): boolean {
  return getDifyConfig() !== null;
}

/**
 * Marketplace Knowledge dataset id — created once in Phase 4 setup, stored
 * as env so the sync code knows where to write. Distinct from the API key
 * so a single key can drive multiple KBs (e.g. a future "support docs" KB).
 */
export function getMarketplaceDatasetId(): string | null {
  return process.env.DIFY_MARKETPLACE_DATASET_ID || null;
}

/**
 * Lower-level fetch wrapper. Adds the auth header, prefixes /v1, and turns
 * any non-2xx response into a thrown Error with the upstream status + body.
 * Callers in sync.ts wrap this in try/catch with a logger.warn so a Dify
 * outage degrades gracefully (marketplace approval still commits to
 * Postgres; the doc just doesn't get indexed until the next backfill).
 */
async function difyFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const cfg = getDifyConfig();
  if (!cfg) throw new Error("Dify not configured (DIFY_BASE_URL and DIFY_API_KEY required)");

  const url = `${cfg.baseUrl}/v1${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${cfg.apiKey}`);
  if (init.body && !headers.has("Content-Type") && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  const resp = await fetch(url, { ...init, headers });
  if (!resp.ok) {
    const body = await resp.text().catch(() => resp.statusText);
    throw new Error(`Dify ${init.method ?? "GET"} ${path} ${resp.status}: ${body.slice(0, 500)}`);
  }
  return resp;
}

async function difyJson<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const resp = await difyFetch(path, init);
  return resp.json() as Promise<T>;
}

// ── Dataset (Knowledge Base) operations ──────────────────────────────────

export interface DifyDataset {
  id: string;
  name: string;
  description: string | null;
  document_count?: number;
}

/**
 * Create a Knowledge Base. Called once during Phase 4 setup to provision
 * the `marketplace-listings` dataset. The returned id is what gets stored
 * in DIFY_MARKETPLACE_DATASET_ID.
 */
export async function createDataset(
  name: string,
  description: string,
  options: { indexing_technique?: "high_quality" | "economy" } = {},
): Promise<DifyDataset> {
  return difyJson<DifyDataset>("/datasets", {
    method: "POST",
    body: JSON.stringify({
      name,
      description,
      indexing_technique: options.indexing_technique ?? "high_quality",
      permission: "only_me",
    }),
  });
}

export async function listDatasets(page = 1, limit = 50): Promise<{ data: DifyDataset[]; total: number }> {
  return difyJson<{ data: DifyDataset[]; total: number }>(
    `/datasets?page=${page}&limit=${limit}`,
  );
}

// ── Document operations ──────────────────────────────────────────────────

export interface DifyDocumentCreated {
  document: { id: string; name: string };
  batch: string;
}

/**
 * Create a document from a text blob. Used for marketplace listings whose
 * sole content is title + description (no attached file). The `name` shows
 * up in Dify's admin UI as the document title.
 *
 * Important: indexing is ASYNCHRONOUS in Dify — this call returns
 * immediately with a `batch` id, and the actual embedding + storage
 * happens in Dify's worker. We don't block on indexing completion; the
 * marketplace listing is immediately searchable in Postgres regardless,
 * and the RAG path catches up within seconds of doc creation.
 */
export async function createDocumentByText(
  datasetId: string,
  name: string,
  text: string,
  metadata: Record<string, unknown> = {},
): Promise<DifyDocumentCreated> {
  return difyJson<DifyDocumentCreated>(
    `/datasets/${datasetId}/document/create-by-text`,
    {
      method: "POST",
      body: JSON.stringify({
        name,
        text,
        indexing_technique: "high_quality",
        process_rule: { mode: "automatic" },
        doc_metadata: metadata,
      }),
    },
  );
}

/**
 * Replace the text body of an existing document. Used when a marketplace
 * seller edits their listing's title / description after approval.
 */
export async function updateDocumentByText(
  datasetId: string,
  documentId: string,
  name: string,
  text: string,
): Promise<DifyDocumentCreated> {
  return difyJson<DifyDocumentCreated>(
    `/datasets/${datasetId}/documents/${documentId}/update-by-text`,
    {
      method: "POST",
      body: JSON.stringify({
        name,
        text,
        process_rule: { mode: "automatic" },
      }),
    },
  );
}

/**
 * Delete a document. Used when a marketplace listing is archived / rejected
 * / has its approval revoked.
 */
export async function deleteDocument(datasetId: string, documentId: string): Promise<void> {
  await difyFetch(`/datasets/${datasetId}/documents/${documentId}`, {
    method: "DELETE",
  });
}

/**
 * Find an existing document by metadata.listing_id. Dify doesn't expose a
 * metadata-filter on the document list endpoint as of v0.15, so we list +
 * filter client-side. For marketplace scale (~100s of listings) this is
 * fine; revisit if doc count grows past ~5k.
 */
export async function findDocumentByListingId(
  datasetId: string,
  listingId: number,
): Promise<{ id: string; name: string } | null> {
  try {
    const res = await difyJson<{
      data: Array<{ id: string; name: string; doc_metadata?: { listing_id?: number } }>;
    }>(`/datasets/${datasetId}/documents?page=1&limit=100`);
    const match = res.data.find((d) => d.doc_metadata?.listing_id === listingId);
    return match ? { id: match.id, name: match.name } : null;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err, listingId }, "[dify] findDocumentByListingId failed");
    return null;
  }
}

// ── Retrieval (RAG search) ───────────────────────────────────────────────

export interface DifyRetrievalRecord {
  segment: {
    id: string;
    document: { id: string; name: string; doc_metadata?: Record<string, unknown> };
    content: string;
  };
  score: number;
}

/**
 * Semantic search against a Knowledge Base. Used by the marketplace search
 * endpoint to translate a buyer's natural-language query into ranked
 * listing matches. Returns segments (chunks of indexed documents) with
 * scores; the route handler maps `segment.document.doc_metadata.listing_id`
 * back to Postgres rows.
 */
export async function retrieve(
  datasetId: string,
  query: string,
  options: { top_k?: number; score_threshold?: number } = {},
): Promise<DifyRetrievalRecord[]> {
  const buildBody = (search_method: "hybrid_search" | "keyword_search") => ({
    query,
    retrieval_model: {
      search_method,
      reranking_enable: false,
      top_k: options.top_k ?? 8,
      score_threshold_enabled: typeof options.score_threshold === "number",
      score_threshold: options.score_threshold ?? 0.4,
    },
  });
  // Try hybrid_search first (best quality when an embedding model is
  // configured). If Dify returns the "Default model not found for
  // text-embedding" 400 — which happens on economy-indexed KBs or when no
  // embedding provider is installed — fall back to keyword_search (BM25)
  // so search still works.
  try {
    const res = await difyJson<{ records: DifyRetrievalRecord[] }>(
      `/datasets/${datasetId}/retrieve`,
      { method: "POST", body: JSON.stringify(buildBody("hybrid_search")) },
    );
    return res.records ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/Default model not found for text-embedding/i.test(msg)) throw err;
    const res = await difyJson<{ records: DifyRetrievalRecord[] }>(
      `/datasets/${datasetId}/retrieve`,
      { method: "POST", body: JSON.stringify(buildBody("keyword_search")) },
    );
    return res.records ?? [];
  }
}

// ── Health ────────────────────────────────────────────────────────────────

/**
 * Liveness probe used by /api/health/services. Hits the cheapest authed
 * read available (list 1 dataset). Throws on any non-2xx so callers can
 * classify the failure.
 */
export async function difyPing(): Promise<void> {
  if (!isDifyAvailable()) throw new Error("Dify not configured");
  await difyFetch("/datasets?page=1&limit=1");
}
