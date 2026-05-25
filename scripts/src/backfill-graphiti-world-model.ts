/**
 * Backfill Postgres → Graphiti+FalkorDB (Phase A of the world-model migration).
 *
 * Two paths, picked per the plan in /home/runner/.claude/plans/humble-bouncing-milner.md:
 *
 *   1. STRUCTURAL data (industries, capabilities, capability_dependencies,
 *      value_chain_stages where applicable) — direct FalkorDB Cypher writes
 *      via the Graphiti MCP server's query_cypher tool. Skips Graphiti's
 *      LLM-based entity extraction (would be cost-prohibitive for ~349 caps
 *      + ~300 dependencies). Loses bitemporal helpers for these structural
 *      records but preserves data fidelity at zero LLM cost.
 *
 *   2. CVI SNAPSHOTS — as Graphiti episodes via the add_episode tool. One
 *      episode per snapshot describing "CVI for capability X was Y on date Z
 *      based on N triangulations." Gets bitemporal queries working for
 *      historical CVI (the main reason for moving to Graphiti at all). LLM
 *      cost is bounded by the number of historical snapshots × ~Haiku call.
 *
 * Usage:
 *   GRAPHITI_MCP_URL=… GRAPHITI_MCP_API_KEY=… \
 *     pnpm --filter @workspace/scripts run backfill:graphiti-world-model
 *
 * Skip flags (run subsets when iterating):
 *   SKIP_STRUCTURAL=1   — don't backfill industries/capabilities/dependencies
 *   SKIP_CVI=1          — don't backfill cvi_snapshots
 *   CVI_LIMIT=N         — only backfill the most recent N snapshots (cost cap)
 *
 * Modes:
 *   DRY_RUN=1           — log what would be sent without calling Graphiti
 *
 * Idempotent — re-runnable. Structural writes use MERGE; CVI episodes are
 * keyed on (capability_id, snapshot_id) so re-running won't duplicate them
 * (relies on Graphiti's source_description matching).
 *
 * Exit codes
 *   0 — success or graceful skip
 *   1 — catastrophic error (Graphiti unreachable, Postgres unreachable)
 */

import { db, capabilitiesTable, capabilityDependenciesTable, industriesTable, cviSnapshotsTable } from "@workspace/db";
import { asc, gt, desc } from "drizzle-orm";

const BASE_URL = process.env.GRAPHITI_MCP_URL?.replace(/\/+$/, "");
const API_KEY = process.env.GRAPHITI_MCP_API_KEY;
const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_STRUCTURAL = process.env.SKIP_STRUCTURAL === "1";
const SKIP_CVI = process.env.SKIP_CVI === "1";
const CVI_LIMIT = process.env.CVI_LIMIT ? parseInt(process.env.CVI_LIMIT, 10) : null;
// CVI_OFFSET is now an OVERRIDE — the script auto-skips snapshots already in
// FalkorDB by default (see fetchExistingCviSnapshotIds below). Use this only
// when you want to force a specific starting offset for debugging.
const CVI_OFFSET = process.env.CVI_OFFSET ? parseInt(process.env.CVI_OFFSET, 10) : null;
// STOP_FILE lets an operator gracefully halt the script at the next batch
// boundary by `touch`ing a file. Cleaner than `kill` for long-running runs
// (pnpm doesn't forward signals to its tsx child, so `kill <pnpm-pid>` leaves
// orphan workers — known footgun, hit it 2026-05-25).
const STOP_FILE = process.env.STOP_FILE ?? null;

const STRUCT_BATCH = 500;
const CVI_BATCH = 100;

// ── Safety gate ───────────────────────────────────────────────────────────
// Pass 2 (CVI episodes) makes one LLM call per snapshot via OpenRouter+OpenAI.
// At ~$0.001-0.005 per snapshot × ~800 historical snapshots that's $0.80-$4
// in real spend. Refuse to start the CVI pass without an explicit
// BACKFILL_CONFIRMED=1 — protects against accidental kick-off from a stale
// shell or a re-run-on-deploy hook. Structural pass + DRY_RUN are exempt.
if (!DRY_RUN && !SKIP_CVI && process.env.BACKFILL_CONFIRMED !== "1") {
  console.error(
    "[backfill:graphiti] REFUSING TO RUN — CVI pass calls the LLM per snapshot " +
    "(real OpenRouter spend). Set BACKFILL_CONFIRMED=1 to acknowledge, or " +
    "SKIP_CVI=1 to run only the structural pass (zero LLM cost), or DRY_RUN=1 " +
    "to preview without writing.",
  );
  process.exit(1);
}

if (!BASE_URL || !API_KEY) {
  if (DRY_RUN) {
    console.warn("[backfill:graphiti] GRAPHITI_MCP_URL/GRAPHITI_MCP_API_KEY not set — DRY_RUN will skip RPC calls but still walk Postgres");
  } else {
    console.error("[backfill:graphiti] GRAPHITI_MCP_URL + GRAPHITI_MCP_API_KEY required (set DRY_RUN=1 to walk Postgres without calling Graphiti)");
    process.exit(1);
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────
// SIGTERM / SIGINT set a flag; the CVI loop checks it at every batch boundary
// and exits cleanly. Together with STOP_FILE this gives operators two ways to
// halt without leaving orphan worker processes mid-LLM-call.
let stopRequested = false;
let stopReason: string | null = null;

function requestStop(reason: string): void {
  if (stopRequested) return;
  stopRequested = true;
  stopReason = reason;
  console.log(`\n[backfill:graphiti] stop requested (${reason}) — finishing current snapshot, then exiting cleanly`);
}

process.on("SIGTERM", () => requestStop("SIGTERM"));
process.on("SIGINT", () => requestStop("SIGINT"));

console.log(`[backfill:graphiti] pid=${process.pid} — kill with: kill -SIGTERM ${process.pid}  (or touch ${STOP_FILE ?? "$STOP_FILE"} if STOP_FILE is set)`);

// ── Minimal MCP-over-HTTP RPC (avoids dependency on api-server's client) ──

let rpcId = 0;

async function callTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  if (DRY_RUN && !BASE_URL) {
    return { ok: true, _dryRun: true };
  }
  const body = {
    jsonrpc: "2.0" as const,
    id: ++rpcId,
    method: "tools/call",
    params: { name, arguments: args },
  };
  const res = await fetch(`${BASE_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-API-Key": API_KEY!,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 240)}` };
  }
  const ct = res.headers.get("content-type") || "";
  let parsed: { result?: { content?: Array<{ type: string; text: string }> }; error?: { message: string } };
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    const dataLine = text.split("\n").find((l) => l.startsWith("data:"));
    if (!dataLine) return { ok: false, error: "SSE response missing data line" };
    parsed = JSON.parse(dataLine.slice("data:".length).trim());
  } else {
    parsed = (await res.json()) as typeof parsed;
  }
  if (parsed.error) return { ok: false, error: parsed.error.message };
  const textContent = parsed.result?.content?.[0]?.text;
  if (!textContent) return { ok: false, error: "no content in tool result" };
  try {
    return JSON.parse(textContent);
  } catch {
    return { ok: false, error: `non-JSON tool result: ${textContent.slice(0, 240)}` };
  }
}

async function runCypher(cypher: string, params: Record<string, unknown> = {}): Promise<void> {
  if (DRY_RUN) {
    console.log(`[dry-run] cypher: ${cypher.replace(/\s+/g, " ").trim().slice(0, 120)}… params: ${Object.keys(params).join(",")}`);
    return;
  }
  const result = await callTool("query_cypher", { cypher, params });
  if (!result.ok) {
    throw new Error(`Cypher failed: ${result.error}`);
  }
}

async function addEpisode(args: { name: string; episodeBody: string; groupId?: string; sourceDescription?: string; referenceTime?: string }): Promise<void> {
  if (DRY_RUN) {
    console.log(`[dry-run] episode: ${args.name} (group=${args.groupId ?? "global"}, ref=${args.referenceTime ?? "now"}, ${args.episodeBody.length}ch)`);
    return;
  }
  const result = await callTool("add_episode", {
    name: args.name,
    episode_body: args.episodeBody,
    group_id: args.groupId ?? "global",
    source_description: args.sourceDescription ?? "backfill-graphiti-world-model",
    reference_time: args.referenceTime ?? null,
  });
  if (!result.ok) {
    throw new Error(`add_episode failed: ${result.error}`);
  }
}

// ── Pass 1: structural data via direct Cypher MERGE ───────────────────────

async function backfillStructural(): Promise<{ industries: number; capabilities: number; dependencies: number }> {
  // Indexes first (idempotent — IF NOT EXISTS).
  await runCypher("CREATE INDEX FOR (i:Industry) ON (i.pgId)");
  await runCypher("CREATE INDEX FOR (c:Capability) ON (c.pgId)");
  await runCypher("CREATE INDEX FOR (c:Capability) ON (c.slug)");

  let industries = 0;
  console.log("[backfill:graphiti] pass 1a: industries");
  {
    const rows = await db.select().from(industriesTable);
    if (rows.length > 0) {
      await runCypher(
        `UNWIND $rows AS r
         MERGE (i:Industry { pgId: r.pgId })
         SET i.name = r.name, i.slug = r.slug, i.icon = r.icon, i.updatedAt = timestamp()`,
        { rows: rows.map((r) => ({ pgId: r.id, name: r.name, slug: r.slug, icon: r.icon ?? null })) },
      );
      industries = rows.length;
    }
  }

  let capabilities = 0;
  console.log("[backfill:graphiti] pass 1b: capabilities");
  {
    let lastId = 0;
    while (true) {
      const rows = await db.select().from(capabilitiesTable)
        .where(gt(capabilitiesTable.id, lastId))
        .orderBy(asc(capabilitiesTable.id))
        .limit(STRUCT_BATCH);
      if (rows.length === 0) break;
      await runCypher(
        `UNWIND $rows AS r
         MERGE (c:Capability { pgId: r.pgId })
         SET c.slug = r.slug,
             c.name = r.name,
             c.industryId = r.industryId,
             c.parentCapabilityId = r.parentId,
             c.isLeaf = r.isLeaf,
             c.reviewStatus = r.reviewStatus,
             c.benchmarkScore = r.benchmarkScore,
             c.valueChainStage = r.valueChainStage,
             c.updatedAt = timestamp()
         WITH c, r
         MATCH (i:Industry { pgId: r.industryId })
         MERGE (c)-[:BELONGS_TO]->(i)`,
        { rows: rows.map((r) => ({
          pgId: r.id, slug: r.slug, name: r.name,
          industryId: r.industryId,
          parentId: r.parentCapabilityId ?? null,
          isLeaf: r.isLeaf, reviewStatus: r.reviewStatus,
          benchmarkScore: r.benchmarkScore ?? null,
          valueChainStage: r.valueChainStage ?? null,
        })) },
      );
      capabilities += rows.length;
      lastId = rows[rows.length - 1]!.id;
    }
  }

  let dependencies = 0;
  console.log("[backfill:graphiti] pass 1c: capability dependencies");
  {
    let lastId = 0;
    while (true) {
      const rows = await db.select().from(capabilityDependenciesTable)
        .where(gt(capabilityDependenciesTable.id, lastId))
        .orderBy(asc(capabilityDependenciesTable.id))
        .limit(STRUCT_BATCH);
      if (rows.length === 0) break;
      await runCypher(
        `UNWIND $rows AS r
         MATCH (src:Capability { pgId: r.srcId })
         MATCH (dst:Capability { pgId: r.dstId })
         MERGE (src)-[d:DEPENDS_ON]->(dst)
         SET d.pgId = r.pgId, d.strength = r.strength, d.updatedAt = timestamp()`,
        { rows: rows.map((r) => ({
          pgId: r.id, srcId: r.capabilityId, dstId: r.dependsOnId,
          strength: r.strength ?? "moderate",
        })) },
      );
      dependencies += rows.length;
      lastId = rows[rows.length - 1]!.id;
    }
  }

  return { industries, capabilities, dependencies };
}

// ── Pass 2: CVI snapshots as bitemporal episodes ──────────────────────────

/**
 * Query FalkorDB for the CVI snapshot IDs we've already written as Episodic
 * nodes. Each episode was written with name=`cvi-snapshot-{pgId}`, so we can
 * derive the source PG id by parsing the name. Returns a Set so the caller
 * can skip them in O(1) per snapshot.
 *
 * If the MCP call fails, fall back to an empty set + log a warning. The
 * caller will then re-process everything (paying the LLM cost again) — but
 * that's better than silently halving the actual work done.
 */
async function fetchExistingCviSnapshotIds(): Promise<Set<number>> {
  if (DRY_RUN) {
    console.log("[backfill:graphiti] (dry-run) skipping existing-id query — assuming empty");
    return new Set();
  }
  try {
    const result = await callTool("query_cypher", {
      cypher: "MATCH (e:Episodic) WHERE e.name STARTS WITH 'cvi-snapshot-' RETURN e.name AS name",
      params: {},
    });
    if (!result.ok) {
      console.warn(`[backfill:graphiti] could not query existing episodes (${result.error}) — will process all snapshots; may create duplicates`);
      return new Set();
    }
    const rows = ((result.rows as Array<{ row?: unknown }>) ?? []);
    const ids = new Set<number>();
    for (const r of rows) {
      // FalkorDB row shape from our wrapper is `{row: [{name: "cvi-snapshot-123"}]}`
      const cell = Array.isArray(r.row) ? r.row[0] : null;
      const name = cell && typeof cell === "object" && "name" in cell ? (cell as { name?: string }).name : null;
      if (typeof name === "string") {
        const m = name.match(/^cvi-snapshot-(\d+)$/);
        if (m) ids.add(parseInt(m[1], 10));
      }
    }
    return ids;
  } catch (err) {
    console.warn(`[backfill:graphiti] existing-id query threw (${err instanceof Error ? err.message : String(err)}) — will process all snapshots; may create duplicates`);
    return new Set();
  }
}

async function backfillCviEpisodes(): Promise<{ snapshots: number; skipped: number; stopped: boolean }> {
  const existing = await fetchExistingCviSnapshotIds();
  const parts = [
    CVI_LIMIT ? `limit ${CVI_LIMIT}` : null,
    CVI_OFFSET != null ? `offset override ${CVI_OFFSET}` : null,
    existing.size > 0 ? `${existing.size} already in FalkorDB (auto-skip)` : null,
  ].filter(Boolean);
  const suffix = parts.length ? ` (${parts.join(", ")})` : "";
  console.log(`[backfill:graphiti] pass 2: CVI snapshots → episodes${suffix}`);

  let snapshots = 0;
  let skipped = 0;
  let offset = CVI_OFFSET ?? 0;
  while (true) {
    if (stopRequested) {
      console.log(`[backfill:graphiti] stop honored (${stopReason}) at ${snapshots} new snapshots`);
      return { snapshots, skipped, stopped: true };
    }
    if (STOP_FILE) {
      try {
        const fs = await import("node:fs/promises");
        await fs.access(STOP_FILE);
        requestStop(`STOP_FILE=${STOP_FILE} exists`);
        return { snapshots, skipped, stopped: true };
      } catch { /* file not present — keep going */ }
    }

    const remaining = CVI_LIMIT ? Math.max(0, CVI_LIMIT - snapshots) : Infinity;
    if (remaining === 0) break;
    const take = Math.min(CVI_BATCH, remaining);
    const rows = await db.select().from(cviSnapshotsTable)
      .orderBy(desc(cviSnapshotsTable.snapshotAt))
      .limit(take)
      .offset(offset);
    if (rows.length === 0) break;
    for (const r of rows) {
      if (existing.has(r.id)) {
        skipped++;
        continue;
      }
      // cvi_snapshots is GLOBAL (GDP-weighted overall index + per-industry
      // breakdowns); per-capability scores live in cvi_components. We
      // backfill the overall snapshot as one episode here — it's what
      // anchors the bitemporal "what was the CVI of the platform on date X"
      // query that's the main reason for moving to Graphiti.
      const ts = r.snapshotAt instanceof Date ? r.snapshotAt : new Date(r.snapshotAt as unknown as string);
      const industryParts = Object.entries(r.industryBreakdowns ?? {}).slice(0, 8).map(
        ([_slug, b]) => `${b.industryName}: ${b.indexValue.toFixed(1)} (Δ${b.velocity >= 0 ? "+" : ""}${b.velocity.toFixed(1)})`,
      ).join("; ");
      const ci = r.overallCiLow != null && r.overallCiHigh != null
        ? ` (95% CI ${r.overallCiLow.toFixed(1)}–${r.overallCiHigh.toFixed(1)})`
        : "";
      const body = `Platform CVI snapshot at ${ts.toISOString()}: overall ${r.overallIndex.toFixed(2)}${ci}. Industries: ${industryParts}. Methodology v${r.methodologyVersion}.`;
      await addEpisode({
        name: `cvi-snapshot-${r.id}`,
        episodeBody: body,
        groupId: "global",
        sourceDescription: `backfill:cvi_snapshots:${r.id}`,
        referenceTime: ts.toISOString(),
      });
      snapshots++;
      // Honor stop between snapshots, not just between batches — keeps the
      // worst-case orphan-spend bounded by ~1 in-flight LLM call.
      if (stopRequested) {
        console.log(`[backfill:graphiti] stop honored (${stopReason}) at ${snapshots} new snapshots (mid-batch)`);
        return { snapshots, skipped, stopped: true };
      }
    }
    offset += rows.length;
    console.log(`  …${snapshots} new, ${skipped} skipped`);
  }
  return { snapshots, skipped, stopped: false };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log(`[backfill:graphiti] starting (DRY_RUN=${DRY_RUN}, target=${BASE_URL ?? "<unset>"})`);

  let structural = { industries: 0, capabilities: 0, dependencies: 0 };
  if (!SKIP_STRUCTURAL) {
    structural = await backfillStructural();
  } else {
    console.log("[backfill:graphiti] skipping structural (SKIP_STRUCTURAL=1)");
  }

  let cvi: { snapshots: number; skipped: number; stopped: boolean } = { snapshots: 0, skipped: 0, stopped: false };
  if (!SKIP_CVI) {
    cvi = await backfillCviEpisodes();
  } else {
    console.log("[backfill:graphiti] skipping CVI (SKIP_CVI=1)");
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(cvi.stopped ? "[backfill:graphiti] stopped" : "[backfill:graphiti] done");
  console.log(`  industries:        ${structural.industries}`);
  console.log(`  capabilities:      ${structural.capabilities}`);
  console.log(`  dependencies:      ${structural.dependencies}`);
  console.log(`  cvi new episodes:  ${cvi.snapshots}`);
  console.log(`  cvi auto-skipped:  ${cvi.skipped}`);
  console.log(`  elapsed:           ${elapsed}s`);
  if (cvi.stopped) process.exit(130);
}

main().catch((err) => {
  console.error("[backfill:graphiti] fatal:", err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
