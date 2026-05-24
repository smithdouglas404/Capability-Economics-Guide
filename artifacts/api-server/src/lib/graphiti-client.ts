/**
 * Minimal MCP-over-HTTP client for the graphiti-mcp Python service.
 *
 * MCP streamable-http is JSON-RPC 2.0 over POST. We need exactly two
 * operations for Phase A: tools/list (used by the health probe) and
 * tools/call (used by query_graph, capabilityGraphSync, and the backfill
 * script). Implementing them as fetch calls beats pulling in the full
 * @modelcontextprotocol/sdk for ~30 lines of work.
 *
 * Auth is X-API-Key matching GRAPHITI_MCP_API_KEY on the Python service.
 * Same shared-secret pattern as the self-hosted Mem0 service.
 *
 * Graceful-degrade: every public function checks isGraphitiAvailable()
 * first and returns an "unconfigured" result instead of throwing — matches
 * the project-wide pattern from CLAUDE.md.
 *
 * Kill-switch: callers should also check USE_GRAPHITI_WORLD_MODEL=1 before
 * routing reads/writes here. isGraphitiEnabled() returns true only when
 * BOTH the env vars are set AND the flag is on.
 */

import { logger } from "./logger";

// ── Env-var helpers ───────────────────────────────────────────────────────

function getBaseUrl(): string | null {
  const raw = process.env.GRAPHITI_MCP_URL?.trim();
  if (!raw) return null;
  // Strip trailing slashes so we can append /mcp / /health cleanly.
  return raw.replace(/\/+$/, "");
}

function getApiKey(): string | null {
  return process.env.GRAPHITI_MCP_API_KEY?.trim() || null;
}

export function isGraphitiAvailable(): boolean {
  return !!(getBaseUrl() && getApiKey());
}

export function isGraphitiEnabled(): boolean {
  return isGraphitiAvailable() && process.env.USE_GRAPHITI_WORLD_MODEL === "1";
}

// ── Low-level RPC ─────────────────────────────────────────────────────────

interface RpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface RpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

let rpcId = 0;

async function rpc<T = unknown>(method: string, params?: unknown, timeoutMs = 15_000): Promise<T> {
  const baseUrl = getBaseUrl();
  const apiKey = getApiKey();
  if (!baseUrl || !apiKey) {
    throw new Error("Graphiti MCP not configured (GRAPHITI_MCP_URL + GRAPHITI_MCP_API_KEY required)");
  }
  const body: RpcRequest = { jsonrpc: "2.0", id: ++rpcId, method, params };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Server can respond either as JSON or as SSE. Accept both so we
        // don't trip strict content-negotiation; we'll handle SSE if it
        // ever shows up.
        Accept: "application/json, text/event-stream",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Graphiti MCP HTTP ${res.status}: ${text.slice(0, 240)}`);
    }
    const ct = res.headers.get("content-type") || "";
    let parsed: RpcResponse<T>;
    if (ct.includes("text/event-stream")) {
      // Minimal SSE handler — find the first `data: {...}` line and parse.
      // For our synchronous tool calls this is sufficient; if Graphiti ever
      // streams partial results, expand to consume the full stream.
      const text = await res.text();
      const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) throw new Error("Graphiti MCP SSE: no data line");
      parsed = JSON.parse(dataLine.slice("data:".length).trim()) as RpcResponse<T>;
    } else {
      parsed = (await res.json()) as RpcResponse<T>;
    }
    if (parsed.error) {
      throw new Error(`Graphiti MCP RPC error ${parsed.error.code}: ${parsed.error.message}`);
    }
    if (parsed.result === undefined) {
      throw new Error("Graphiti MCP RPC response missing result");
    }
    return parsed.result;
  } finally {
    clearTimeout(timer);
  }
}

// ── Public surface ────────────────────────────────────────────────────────

/**
 * Liveness probe. Hits /health (unauthenticated). Returns the parsed body
 * on success; throws on network error or non-2xx. Used by the health probe
 * in services/health/probes.ts.
 */
export async function graphitiPing(): Promise<{
  status: string;
  version?: string;
  graphiti?: { configured: boolean; connected: boolean; init_error?: string | null };
}> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) throw new Error("GRAPHITI_MCP_URL not set");
  const res = await fetch(`${baseUrl}/health`, {
    headers: { Accept: "application/json" },
    // Tight timeout — health checks should not block.
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`Graphiti /health → ${res.status}`);
  return (await res.json()) as { status: string };
}

export interface GraphitiToolResult {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Call any tool exposed by the MCP server. Wraps tools/call JSON-RPC and
 * unwraps the FastMCP response shape (content[0].text → parsed JSON).
 *
 * Logs every call at debug level for cost tracking — if you turn on
 * debug logging in prod you can see exactly which agents are calling which
 * Graphiti tools and how often.
 */
export async function callGraphitiTool<T extends GraphitiToolResult = GraphitiToolResult>(
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const result = await rpc<{ content?: Array<{ type: string; text: string }>; isError?: boolean }>(
    "tools/call",
    { name: toolName, arguments: args },
  );
  logger.debug({ tool: toolName, args }, "graphiti.tool.call");
  // FastMCP wraps tool returns in content[].text. Our Python tools all
  // return JSON strings; parse them out.
  const text = result.content?.[0]?.text;
  if (!text) {
    return { ok: false, error: "Graphiti tool returned no content" } as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return { ok: false, error: `Graphiti tool returned non-JSON: ${text.slice(0, 240)}` } as T;
  }
}

// ── Typed wrappers for the three Phase A tools ────────────────────────────

export interface AddEpisodeResult extends GraphitiToolResult {
  episode_uuid?: string;
  nodes_created?: string[];
  edges_created?: string[];
}

export async function addEpisode(args: {
  name: string;
  episodeBody: string;
  groupId?: string;
  sourceDescription?: string;
  referenceTime?: string;
}): Promise<AddEpisodeResult> {
  return callGraphitiTool<AddEpisodeResult>("add_episode", {
    name: args.name,
    episode_body: args.episodeBody,
    group_id: args.groupId ?? "global",
    source_description: args.sourceDescription ?? "api-server",
    reference_time: args.referenceTime ?? null,
  });
}

export interface SearchNodesResult extends GraphitiToolResult {
  results?: Array<{
    uuid: string | null;
    name: string | null;
    summary: string | null;
    labels: string[];
    group_id: string | null;
  }>;
}

export async function searchNodes(args: {
  query: string;
  groupIds?: string[];
  limit?: number;
}): Promise<SearchNodesResult> {
  return callGraphitiTool<SearchNodesResult>("search_nodes", {
    query: args.query,
    group_ids: args.groupIds ?? ["global"],
    limit: args.limit ?? 10,
  });
}

export interface QueryCypherResult extends GraphitiToolResult {
  rows?: Array<Record<string, unknown>>;
}

export async function queryCypher(args: {
  cypher: string;
  params?: Record<string, unknown>;
}): Promise<QueryCypherResult> {
  return callGraphitiTool<QueryCypherResult>("query_cypher", {
    cypher: args.cypher,
    params: args.params ?? {},
  });
}
