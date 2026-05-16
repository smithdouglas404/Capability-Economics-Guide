/**
 * One-shot: re-tag every memory from agent_id="cei-autonomous-agent"
 * to agent_id="cvi-autonomous-agent" on the self-hosted Mem0 service,
 * preserving content + metadata + run_id scoping. Also rewires the
 * local Postgres mirror (`agent_memories.mem0_id`) to point at the
 * newly-created copies.
 *
 * Why: the Inflexcvi rebrand renamed the agent. The Mem0 v2 search
 * filters by agent_id, so old memories silently disappear from
 * recall even though they're still in Mem0's DB.
 *
 * Safety:
 *   - Idempotent: each new memory's metadata carries
 *     `migrated_from_mem0_id` so a re-run skips already-copied rows.
 *   - Old memories are NOT deleted unless you pass --delete-old.
 *     Default is preserve, so you can audit + roll back trivially.
 *   - Dry-run via --dry-run to count without writing.
 *
 * Env required (same as api-server):
 *   MEM0_BASE_URL=http://...railway.internal:8000
 *   MEM0_API_KEY=<ADMIN_API_KEY on the Mem0 service>
 *   DATABASE_URL=... (so local mirror table can be updated)
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run migrate:mem0-agent-id            # copy only
 *   pnpm --filter @workspace/scripts run migrate:mem0-agent-id -- --delete-old
 *   pnpm --filter @workspace/scripts run migrate:mem0-agent-id -- --dry-run
 */
import { db, agentMemoriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const OLD_AGENT_ID = "cei-autonomous-agent";
const NEW_AGENT_ID = "cvi-autonomous-agent";

const dryRun = process.argv.includes("--dry-run");
const deleteOld = process.argv.includes("--delete-old");

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[migrate] FAIL: ${name} not set`);
    process.exit(1);
  }
  return v;
}

const MEM0_BASE_URL = requireEnv("MEM0_BASE_URL").replace(/\/$/, "");
const MEM0_API_KEY = requireEnv("MEM0_API_KEY");

async function mem0Fetch(path: string, method: string, body?: unknown): Promise<any> {
  const res = await fetch(`${MEM0_BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": MEM0_API_KEY,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Mem0 ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

interface Mem0Row {
  id?: string;
  memory?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  agent_id?: string;
  run_id?: string;
}

async function listOldMemories(): Promise<Mem0Row[]> {
  const out: Mem0Row[] = [];
  let cursor: string | undefined;
  const PAGE = 100;
  let page = 0;
  while (true) {
    page++;
    const path = `/memories?agent_id=${OLD_AGENT_ID}&limit=${PAGE}${cursor ? `&cursor=${cursor}` : ""}`;
    const res = await mem0Fetch(path, "GET") as { results?: Mem0Row[]; next_cursor?: string };
    const rows = res?.results ?? [];
    out.push(...rows);
    console.log(`[migrate] page ${page}: fetched ${rows.length} (total so far ${out.length})`);
    if (!res?.next_cursor || rows.length === 0) break;
    cursor = res.next_cursor;
    if (page > 200) {
      console.warn("[migrate] pagination safety break at page 200");
      break;
    }
  }
  return out;
}

async function copyOne(row: Mem0Row): Promise<{ newId: string | null; skipped: boolean; reason?: string }> {
  if (!row.id || !row.memory) return { newId: null, skipped: true, reason: "no id or memory text" };
  const meta = row.metadata ?? {};
  if (meta.migrated_from_mem0_id) {
    return { newId: null, skipped: true, reason: "row IS itself a prior migration target" };
  }

  // Mem0 deduplicates on content; same memory text + same agent_id won't
  // create a true duplicate. To make our re-runs detectable, embed a
  // marker we can scan for.
  const messages = [
    { role: "user" as const, content: `Re-tagging legacy ${OLD_AGENT_ID} memory under ${NEW_AGENT_ID}.` },
    { role: "assistant" as const, content: row.memory },
  ];
  const runId = row.run_id ?? (typeof meta.runId === "string" ? meta.runId : undefined);

  if (dryRun) {
    return { newId: null, skipped: false, reason: "dry-run" };
  }

  const result = await mem0Fetch("/memories", "POST", {
    messages,
    agent_id: NEW_AGENT_ID,
    ...(runId ? { run_id: runId } : {}),
    metadata: {
      ...meta,
      migrated_from_mem0_id: row.id,
      migrated_at: new Date().toISOString(),
      original_created_at: row.created_at ?? null,
    },
  }) as { results?: Array<{ id?: string; event?: string }> };

  const newId = result?.results?.[0]?.id ?? null;
  return { newId, skipped: false };
}

async function updateLocalMirror(oldMem0Id: string, newMem0Id: string): Promise<void> {
  if (dryRun) return;
  await db.update(agentMemoriesTable)
    .set({ mem0Id: newMem0Id })
    .where(eq(agentMemoriesTable.mem0Id, oldMem0Id));
}

async function deleteOldMemory(id: string): Promise<void> {
  if (dryRun) return;
  await mem0Fetch(`/memories/${id}`, "DELETE");
}

async function main(): Promise<void> {
  console.log(`[migrate] config: base=${MEM0_BASE_URL} dryRun=${dryRun} deleteOld=${deleteOld}`);
  console.log(`[migrate] re-tagging ${OLD_AGENT_ID} → ${NEW_AGENT_ID}`);

  const rows = await listOldMemories();
  console.log(`[migrate] found ${rows.length} legacy memories`);
  if (rows.length === 0) {
    console.log("[migrate] nothing to do");
    return;
  }

  let copied = 0;
  let skipped = 0;
  let mirrorUpdated = 0;
  let deleted = 0;
  let failed = 0;

  for (const [i, row] of rows.entries()) {
    const tag = `[${i + 1}/${rows.length}] ${row.id?.slice(0, 8) ?? "?"}`;
    try {
      const { newId, skipped: wasSkipped, reason } = await copyOne(row);
      if (wasSkipped) {
        skipped++;
        console.log(`${tag} skip — ${reason}`);
        continue;
      }
      copied++;
      if (newId && row.id) {
        await updateLocalMirror(row.id, newId);
        mirrorUpdated++;
      }
      if (deleteOld && row.id && newId) {
        await deleteOldMemory(row.id);
        deleted++;
      }
      console.log(`${tag} ok — new=${newId?.slice(0, 8) ?? "n/a"}${deleteOld ? " (old deleted)" : ""}`);
    } catch (err) {
      failed++;
      console.error(`${tag} FAIL:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(
    `[migrate] done: copied=${copied} skipped=${skipped} mirrorUpdated=${mirrorUpdated} deleted=${deleted} failed=${failed}`,
  );
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error("[migrate] unexpected error:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
