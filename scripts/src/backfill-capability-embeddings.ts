/**
 * Backfill OpenAI embeddings for every :Capability node in FalkorDB.
 *
 * Walks Postgres `capabilities`, joins each row's name + description +
 * any narrative fields from the Neo4j migration, calls OpenAI's
 * `text-embedding-3-small` (1536-dim, $0.02/1M tokens), and writes the
 * resulting vector onto the corresponding :Capability node in FalkorDB
 * via `SET c.embedding = vecf32($v)`.
 *
 * Idempotent: any :Capability node already carrying an `embedding`
 * property is skipped unless `REEMBED=1` is set.
 *
 * Cost: ~492 caps × ~100 tokens each ≈ 49,200 tokens ≈ $0.001 total.
 * Per the project pattern, a confirmation flag is still required:
 *
 *   BACKFILL_CONFIRMED=1 \
 *     pnpm --filter @workspace/scripts run backfill:capability-embeddings
 *
 * Env vars:
 *   GRAPHITI_MCP_URL          — required, the MCP server URL
 *   GRAPHITI_MCP_API_KEY      — required
 *   OPENAI_API_KEY            — required for embedding generation
 *   BACKFILL_CONFIRMED=1      — required guard (matches the world-model
 *                               backfill's safety pattern)
 *   REEMBED=1                 — re-embed caps that already have a vector
 *   DRY_RUN=1                 — walk + log, no Graphiti writes, no
 *                               OpenAI calls (uses dummy zero vectors)
 *   LIMIT=N                   — cap the number of caps processed (debug)
 *
 * Exit codes
 *   0 — completed (with non-fatal embedding errors logged)
 *   1 — catastrophic (Graphiti unreachable, OpenAI unauthorized, etc.)
 */

import { db, capabilitiesTable } from "@workspace/db";
import { asc } from "drizzle-orm";

const BASE_URL = process.env.GRAPHITI_MCP_URL?.replace(/\/+$/, "");
const API_KEY = process.env.GRAPHITI_MCP_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const DRY_RUN = process.env.DRY_RUN === "1";
const REEMBED = process.env.REEMBED === "1";
const BACKFILL_CONFIRMED = process.env.BACKFILL_CONFIRMED === "1";
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : null;

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIM = 1536;

if (!BACKFILL_CONFIRMED && !DRY_RUN) {
  console.error(
    "[backfill:embeddings] BACKFILL_CONFIRMED=1 required (this calls OpenAI ~492 times). Set DRY_RUN=1 to walk without calling OpenAI/Graphiti.",
  );
  process.exit(1);
}

if (!BASE_URL || !API_KEY) {
  if (!DRY_RUN) {
    console.error("[backfill:embeddings] GRAPHITI_MCP_URL + GRAPHITI_MCP_API_KEY required (or set DRY_RUN=1)");
    process.exit(1);
  }
  console.warn("[backfill:embeddings] GRAPHITI vars not set — DRY_RUN will skip writes but still call OpenAI if OPENAI_API_KEY set");
}

if (!OPENAI_KEY && !DRY_RUN) {
  console.error("[backfill:embeddings] OPENAI_API_KEY required (or set DRY_RUN=1)");
  process.exit(1);
}

async function mcpCypher(cypher: string, params: Record<string, unknown> = {}): Promise<{ ok: boolean; rows?: Array<Record<string, unknown>>; error?: string }> {
  if (DRY_RUN || !BASE_URL || !API_KEY) return { ok: true, rows: [] };
  const payload = {
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "query_cypher", arguments: { cypher, params } },
  };
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  const text = await res.text();
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      const data = JSON.parse(line.slice(6));
      if (data.error) return { ok: false, error: JSON.stringify(data.error).slice(0, 200) };
      const inner = data?.result?.structuredContent?.result;
      if (inner) {
        const parsed = JSON.parse(inner);
        // Apply same wrap-handling as queryCypher in graphiti-client.ts
        const raw = parsed.rows;
        let flat: Array<Record<string, unknown>> = [];
        if (Array.isArray(raw) && raw.length > 0) {
          const first = raw[0];
          if (first && typeof first === "object" && "row" in first) {
            const inner2 = (first as { row: unknown }).row;
            if (Array.isArray(inner2)) {
              flat = inner2.filter((r): r is Record<string, unknown> => r !== null && typeof r === "object" && !Array.isArray(r));
            }
          } else {
            flat = raw.filter((r: unknown): r is Record<string, unknown> => r !== null && typeof r === "object");
          }
        }
        return { ok: parsed.ok ?? true, rows: flat, error: parsed.error };
      }
    }
  }
  return { ok: false, error: "no data line in SSE response" };
}

async function embedText(text: string): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (DRY_RUN || !OPENAI_KEY) return new Array(EMBED_DIM).fill(0);
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: trimmed }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[backfill:embeddings] OpenAI ${res.status}: ${body.slice(0, 200)}`);
    return null;
  }
  const data = (await res.json()) as { data?: Array<{ embedding?: number[] }>; error?: unknown };
  if (data.error) {
    console.warn(`[backfill:embeddings] OpenAI error: ${JSON.stringify(data.error).slice(0, 200)}`);
    return null;
  }
  const vec = data.data?.[0]?.embedding;
  if (!Array.isArray(vec) || vec.length !== EMBED_DIM) return null;
  return vec;
}

async function fetchExistingEmbedded(): Promise<Set<number>> {
  const result = await mcpCypher(
    "MATCH (c:Capability) WHERE c.embedding IS NOT NULL RETURN c.pgId AS pgId",
  );
  if (!result.ok) return new Set();
  const ids = new Set<number>();
  for (const r of result.rows ?? []) {
    const pg = Number(r.pgId);
    if (Number.isFinite(pg)) ids.add(pg);
  }
  return ids;
}

async function buildEmbeddingText(pgId: number, name: string): Promise<string> {
  // Pull rich fields from FalkorDB (where the v3 Neo4j migration added
  // description / economicView / traditionalView / valueChainStage).
  const result = await mcpCypher(
    "MATCH (c:Capability {pgId: $pgId}) " +
    "RETURN c.description AS d, c.economicView AS e, c.traditionalView AS t, c.valueChainStage AS s",
    { pgId },
  );
  const first = result.rows?.[0] ?? {};
  const parts: string[] = [name];
  const description = String(first.d ?? "").trim();
  const economic = String(first.e ?? "").trim();
  const traditional = String(first.t ?? "").trim();
  const stage = String(first.s ?? "").trim();
  if (description) parts.push(description);
  if (economic) parts.push(economic);
  if (traditional) parts.push(traditional);
  if (stage) parts.push(`Value chain stage: ${stage}`);
  return parts.join(" — ").slice(0, 4000); // OpenAI's 8K token limit; ~4K chars is safe
}

async function main() {
  // Ensure index exists (idempotent).
  const idx = await mcpCypher(
    `CREATE VECTOR INDEX FOR (n:Capability) ON (n.embedding) OPTIONS {dimension: ${EMBED_DIM}, similarityFunction: 'cosine'}`,
  );
  if (idx.ok) {
    console.log("[backfill:embeddings] vector index ready (created or already existed)");
  } else if (/already/i.test(idx.error ?? "")) {
    console.log("[backfill:embeddings] vector index already exists");
  } else {
    console.warn(`[backfill:embeddings] index create failed: ${idx.error} (continuing anyway — may still work if index pre-existed)`);
  }

  const existing = REEMBED ? new Set<number>() : await fetchExistingEmbedded();
  console.log(`[backfill:embeddings] ${existing.size} caps already have embeddings (skipping unless REEMBED=1)`);

  const all = await db.select({ id: capabilitiesTable.id, name: capabilitiesTable.name }).from(capabilitiesTable).orderBy(asc(capabilitiesTable.id));
  const todo = all.filter((r) => !existing.has(r.id));
  const slice = LIMIT ? todo.slice(0, LIMIT) : todo;
  console.log(`[backfill:embeddings] ${slice.length} caps to embed (of ${todo.length} pending, ${all.length} total in Postgres)`);

  let okCount = 0;
  let failCount = 0;
  let skipCount = 0;
  for (const [i, cap] of slice.entries()) {
    const text = await buildEmbeddingText(cap.id, cap.name);
    if (!text || text.length < cap.name.length + 5) {
      skipCount++;
      continue;
    }
    const vec = await embedText(text);
    if (!vec) {
      failCount++;
      continue;
    }
    const write = await mcpCypher(
      "MATCH (c:Capability {pgId: $pgId}) SET c.embedding = vecf32($v) RETURN c.pgId AS pgId",
      { pgId: cap.id, v: vec },
    );
    if (!write.ok || !write.rows?.length) {
      console.warn(`[backfill:embeddings] write failed for pgId=${cap.id}: ${write.error ?? "no rows"}`);
      failCount++;
      continue;
    }
    okCount++;
    if ((i + 1) % 25 === 0) {
      console.log(`[backfill:embeddings] progress ${i + 1}/${slice.length}  (ok=${okCount} fail=${failCount} skip=${skipCount})`);
    }
  }
  console.log(`[backfill:embeddings] done — ok=${okCount} fail=${failCount} skip=${skipCount}`);
  process.exit(failCount > 0 && okCount === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[backfill:embeddings] fatal:", err);
  process.exit(1);
});
