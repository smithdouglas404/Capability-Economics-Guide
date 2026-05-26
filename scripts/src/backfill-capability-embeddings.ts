/**
 * Backfill OpenAI embeddings for every :Capability node in FalkorDB.
 *
 * Reads narrative fields directly from FalkorDB (no Postgres hop), calls
 * OpenAI's `text-embedding-3-small` (1536-dim, $0.02/1M tokens), and
 * writes the resulting vector back onto the same :Capability node via
 * `SET c.embedding = vecf32($v)`.
 *
 * Why FalkorDB and not Postgres: the previous version of this script
 * walked Postgres via DATABASE_URL, which on Railway is the internal
 * hostname `postgres.railway.internal`. That hostname only resolves
 * inside Railway's private network — running this script from any
 * other shell (developer laptop, Replit Claude Code, CI runner) failed
 * with `getaddrinfo ENOTFOUND postgres.railway.internal`. Reading from
 * FalkorDB instead makes the script portable and removes the Postgres
 * credential dependency entirely. The :Capability nodes already carry
 * `name + description + economicView + traditionalView + valueChainStage`
 * (the rich fields landed via the Neo4j → FalkorDB migration).
 *
 * Idempotent: any :Capability node already carrying an `embedding`
 * property is skipped unless `REEMBED=1` is set.
 *
 * Cost: ~492 caps × ~100 tokens each ≈ 49,200 tokens ≈ $0.001 total.
 *
 * Usage:
 *
 *   BACKFILL_CONFIRMED=1 \
 *     GRAPHITI_MCP_URL=https://… \
 *     GRAPHITI_MCP_API_KEY=… \
 *     OPENAI_API_KEY=sk-… \
 *     pnpm --filter @workspace/scripts run backfill:capability-embeddings
 *
 * From a Railway shell on `capabilityeconomics`, the three URL/key
 * env vars are already set as Railway service variables, so the
 * command simplifies to just `BACKFILL_CONFIRMED=1 pnpm --filter
 * @workspace/scripts run backfill:capability-embeddings`.
 *
 * Env vars:
 *   GRAPHITI_MCP_URL          — required, the MCP server URL
 *   GRAPHITI_MCP_API_KEY      — required
 *   OPENAI_API_KEY            — required for embedding generation
 *   BACKFILL_CONFIRMED=1      — required guard (matches the world-model
 *                               backfill's safety pattern)
 *   REEMBED=1                 — re-embed caps that already have a vector
 *   DRY_RUN=1                 — walk + log, no OpenAI/Graphiti writes
 *   LIMIT=N                   — cap the number of caps processed (debug)
 *
 * Exit codes
 *   0 — completed (with non-fatal embedding errors logged)
 *   1 — catastrophic (Graphiti unreachable, OpenAI unauthorized, etc.)
 */

// Force TypeScript module scope (otherwise this file shares globals with
// other no-import scripts in this package and `main()` collides).
export {};

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
  console.error("[backfill:embeddings] GRAPHITI_MCP_URL + GRAPHITI_MCP_API_KEY required");
  process.exit(1);
}

if (!OPENAI_KEY && !DRY_RUN) {
  console.error("[backfill:embeddings] OPENAI_API_KEY required (or set DRY_RUN=1)");
  process.exit(1);
}

interface CypherResult {
  ok: boolean;
  rows?: Array<Record<string, unknown>>;
  error?: string;
}

async function mcpCypher(cypher: string, params: Record<string, unknown> = {}): Promise<CypherResult> {
  const payload = {
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "query_cypher", arguments: { cypher, params } },
  };
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "X-API-Key": API_KEY!,
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
        const parsed = JSON.parse(inner) as { ok?: boolean; rows?: unknown; error?: string };
        // Unwrap the FalkorDB driver's 3-row block:
        //   rows: [{ row: [...records...] }, { row: [...headers...] }, { row: null }]
        const raw = parsed.rows;
        let flat: Array<Record<string, unknown>> = [];
        if (Array.isArray(raw) && raw.length > 0) {
          const first = raw[0];
          if (first && typeof first === "object" && "row" in first) {
            const inner2 = (first as { row: unknown }).row;
            if (Array.isArray(inner2)) {
              flat = inner2.filter(
                (r): r is Record<string, unknown> => r !== null && typeof r === "object" && !Array.isArray(r),
              );
            }
          } else {
            flat = (raw as unknown[]).filter(
              (r): r is Record<string, unknown> => r !== null && typeof r === "object",
            );
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
  if (DRY_RUN) return new Array(EMBED_DIM).fill(0);
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY!}`,
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

interface CapRow {
  pgId: number;
  name: string;
  description?: string;
  economicView?: string;
  traditionalView?: string;
  valueChainStage?: string;
}

async function fetchCapsToEmbed(): Promise<CapRow[]> {
  const cypher = REEMBED
    ? "MATCH (c:Capability) RETURN c.pgId AS pgId, c.name AS name, c.description AS description, c.economicView AS economicView, c.traditionalView AS traditionalView, c.valueChainStage AS valueChainStage ORDER BY c.pgId ASC"
    : "MATCH (c:Capability) WHERE c.embedding IS NULL RETURN c.pgId AS pgId, c.name AS name, c.description AS description, c.economicView AS economicView, c.traditionalView AS traditionalView, c.valueChainStage AS valueChainStage ORDER BY c.pgId ASC";
  const result = await mcpCypher(cypher);
  if (!result.ok) {
    console.error(`[backfill:embeddings] fetchCapsToEmbed failed: ${result.error}`);
    return [];
  }
  return (result.rows ?? [])
    .map((r): CapRow | null => {
      const pgId = Number(r.pgId);
      const name = typeof r.name === "string" ? r.name : "";
      if (!Number.isFinite(pgId) || !name) return null;
      return {
        pgId,
        name,
        description: typeof r.description === "string" ? r.description : undefined,
        economicView: typeof r.economicView === "string" ? r.economicView : undefined,
        traditionalView: typeof r.traditionalView === "string" ? r.traditionalView : undefined,
        valueChainStage: typeof r.valueChainStage === "string" ? r.valueChainStage : undefined,
      };
    })
    .filter((r): r is CapRow => r !== null);
}

function buildEmbeddingText(cap: CapRow): string {
  const parts: string[] = [cap.name];
  if (cap.description) parts.push(cap.description);
  if (cap.economicView) parts.push(cap.economicView);
  if (cap.traditionalView) parts.push(cap.traditionalView);
  if (cap.valueChainStage) parts.push(`Value chain stage: ${cap.valueChainStage}`);
  // OpenAI's 8K token limit; ~4K chars is safe for text-embedding-3-small.
  return parts.join(" — ").slice(0, 4000);
}

async function main() {
  // Ensure index exists (idempotent — FalkorDB may error on re-create which we ignore).
  const idx = await mcpCypher(
    `CREATE VECTOR INDEX FOR (n:Capability) ON (n.embedding) OPTIONS {dimension: ${EMBED_DIM}, similarityFunction: 'cosine'}`,
  );
  if (idx.ok) {
    console.log("[backfill:embeddings] vector index ready");
  } else if (/already/i.test(idx.error ?? "")) {
    console.log("[backfill:embeddings] vector index already exists");
  } else {
    console.warn(`[backfill:embeddings] index create returned: ${idx.error} (continuing — may already exist)`);
  }

  const caps = await fetchCapsToEmbed();
  const slice = LIMIT ? caps.slice(0, LIMIT) : caps;
  console.log(`[backfill:embeddings] ${slice.length} caps to embed (${caps.length} pending, REEMBED=${REEMBED ? "1" : "0"})`);

  let okCount = 0;
  let failCount = 0;
  let skipCount = 0;
  for (const [i, cap] of slice.entries()) {
    const text = buildEmbeddingText(cap);
    if (text.length < cap.name.length + 5) {
      skipCount++;
      continue;
    }
    const vec = await embedText(text);
    if (!vec) {
      failCount++;
      continue;
    }
    if (DRY_RUN) {
      okCount++;
      continue;
    }
    const write = await mcpCypher(
      "MATCH (c:Capability {pgId: $pgId}) SET c.embedding = vecf32($v) RETURN c.pgId AS pgId",
      { pgId: cap.pgId, v: vec },
    );
    if (!write.ok || !write.rows?.length) {
      console.warn(`[backfill:embeddings] write failed for pgId=${cap.pgId}: ${write.error ?? "no rows"}`);
      failCount++;
      continue;
    }
    okCount++;
    if ((i + 1) % 25 === 0 || i + 1 === slice.length) {
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
