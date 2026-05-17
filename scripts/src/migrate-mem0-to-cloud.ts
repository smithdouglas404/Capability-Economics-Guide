/**
 * One-shot: migrate the local Postgres `agent_memories` mirror into
 * Mem0 Cloud (app.mem0.ai). Self-hosted Mem0 IDs already on the row
 * are preserved as historical references; new cloud IDs are stamped
 * into `metadata.cloudMem0Id` so re-runs are idempotent.
 *
 * Why this exists: when you flip MEM0_BASE_URL from the self-hosted
 * Railway URL to https://api.mem0.ai, the agent starts writing into a
 * fresh cloud bucket. Previously-stored memories on the self-hosted
 * instance don't auto-migrate. This script copies the local mirror
 * (which has all 1.3k+ memories) into your cloud account so cycles
 * resume with full history.
 *
 * Env required:
 *   MEM0_CLOUD_API_KEY     starts with m0-... (DIFFERENT from the
 *                          self-hosted ADMIN_API_KEY currently in
 *                          MEM0_API_KEY). Get from app.mem0.ai.
 *   MEM0_CLOUD_BASE_URL    optional, defaults to https://api.mem0.ai
 *   DATABASE_URL           Postgres with the agent_memories table.
 *   MEM0_AGENT_ID          optional, defaults to cvi-autonomous-agent
 *                          (match the runtime so recall surfaces them).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run migrate:mem0-to-cloud -- --dry-run
 *   pnpm --filter @workspace/scripts run migrate:mem0-to-cloud
 *   pnpm --filter @workspace/scripts run migrate:mem0-to-cloud -- --force   # re-migrate even rows already marked
 *   pnpm --filter @workspace/scripts run migrate:mem0-to-cloud -- --limit=500
 *
 * Safety:
 *   - Idempotent: rows whose metadata.cloudMem0Id is already set are
 *     skipped unless --force.
 *   - Rate-limited: 5 req/s by default (BATCH_DELAY_MS = 200), tunable
 *     via MEM0_CLOUD_RATE_MS env.
 *   - Failures are per-row; the loop continues and reports a count.
 */
import { db, agentMemoriesTable } from "@workspace/db";
import { asc, desc, eq } from "drizzle-orm";

const CLOUD_DEFAULT_URL = "https://api.mem0.ai";
const DEFAULT_AGENT_ID = "cvi-autonomous-agent";
const BATCH_DELAY_MS = Number(process.env.MEM0_CLOUD_RATE_MS ?? 200);

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const limitArg = process.argv.find(a => a.startsWith("--limit="));
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1])) : 10_000;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[migrate-mem0-cloud] FAIL: ${name} not set`);
    process.exit(1);
  }
  return v;
}

const CLOUD_API_KEY = requireEnv("MEM0_CLOUD_API_KEY");
if (!CLOUD_API_KEY.startsWith("m0-")) {
  console.warn(`[migrate-mem0-cloud] WARNING: MEM0_CLOUD_API_KEY does not start with "m0-". Cloud keys normally do; continuing anyway in case key format changed.`);
}
const CLOUD_BASE_URL = (process.env.MEM0_CLOUD_BASE_URL ?? CLOUD_DEFAULT_URL).replace(/\/$/, "");
const AGENT_ID = process.env.MEM0_AGENT_ID ?? DEFAULT_AGENT_ID;

interface CloudAddResponse {
  results?: Array<{ id?: string; event?: string }>;
}

/**
 * POST a single memory record to Mem0 Cloud. Returns the new cloud id
 * or null on failure (logged but not thrown).
 */
async function uploadToCloud(row: typeof agentMemoriesTable.$inferSelect): Promise<string | null> {
  // Reconstruct the user/assistant message pair the same way
  // memory.ts:buildConversationalMessages does at runtime. This keeps
  // the embedding shape consistent with what the agent will write
  // post-migration.
  const userPrompt =
    `Logging a historical ${row.memoryType}` +
    (row.category ? ` (${row.category})` : "") +
    ` migrated from the self-hosted Mem0 mirror. Capture the durable facts so future cycles can recall and reason over them.`;
  const messages = [
    { role: "user" as const, content: userPrompt },
    { role: "assistant" as const, content: row.content },
  ];

  const metadata = {
    ...(row.metadata as Record<string, unknown> | null ?? {}),
    memoryType: row.memoryType,
    category: row.category ?? row.memoryType,
    runId: row.agentRunId ?? null,
    migratedFromLocalId: row.id,
    migratedFromMem0Id: row.mem0Id ?? null,
    migratedAt: new Date().toISOString(),
    originalCreatedAt: row.createdAt.toISOString(),
  };

  const body: Record<string, unknown> = {
    messages,
    agent_id: AGENT_ID,
    metadata,
  };
  if (row.runScope) body.run_id = row.runScope;

  const res = await fetch(`${CLOUD_BASE_URL}/v1/memories/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${CLOUD_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    console.warn(`[migrate-mem0-cloud] row #${row.id} upload failed (${res.status}): ${text.slice(0, 200)}`);
    return null;
  }

  const json = (await res.json()) as CloudAddResponse;
  const newId = json?.results?.[0]?.id ?? null;
  return newId;
}

async function main(): Promise<void> {
  console.log(`[migrate-mem0-cloud] config: baseUrl=${CLOUD_BASE_URL} agentId=${AGENT_ID} dryRun=${dryRun} force=${force} limit=${limit} rateMs=${BATCH_DELAY_MS}`);

  // Pull rows oldest-first so the cloud ordering roughly matches the
  // original write order. Restrict to ones not yet migrated unless
  // --force is set.
  const rows = await db.select().from(agentMemoriesTable).orderBy(asc(agentMemoriesTable.createdAt)).limit(limit);
  console.log(`[migrate-mem0-cloud] scanned ${rows.length} agent_memories rows`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let updated = 0;

  for (const [i, row] of rows.entries()) {
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    const alreadyMigrated = typeof meta.cloudMem0Id === "string" && meta.cloudMem0Id.length > 0;
    if (alreadyMigrated && !force) {
      skipped++;
      continue;
    }

    const tag = `[${i + 1}/${rows.length}] row#${row.id} (${row.memoryType}/${row.category ?? "uncategorized"})`;
    if (dryRun) {
      console.log(`${tag} would upload (dry-run)`);
      migrated++;
      continue;
    }

    try {
      const newCloudId = await uploadToCloud(row);
      if (!newCloudId) {
        failed++;
        continue;
      }
      // Stamp the cloud id into local metadata so re-runs skip this row.
      // Preserve the self-hosted mem0Id on the dedicated column for
      // history; the cloudMem0Id lives in metadata since it's a new
      // concept and we don't want a schema change just for the
      // migration window.
      const newMeta = { ...meta, cloudMem0Id: newCloudId, cloudMigratedAt: new Date().toISOString() };
      await db.update(agentMemoriesTable)
        .set({ metadata: newMeta })
        .where(eq(agentMemoriesTable.id, row.id));
      migrated++;
      updated++;
      if (migrated % 25 === 0) {
        console.log(`${tag} ok cloud=${newCloudId.slice(0, 10)}… (${migrated} so far)`);
      }
    } catch (err) {
      failed++;
      console.warn(`${tag} unexpected error:`, err instanceof Error ? err.message : err);
    }

    // Rate-limit between cloud POSTs.
    if (BATCH_DELAY_MS > 0 && i < rows.length - 1) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  console.log(`[migrate-mem0-cloud] DONE: migrated=${migrated} skipped=${skipped} failed=${failed} mirrorUpdated=${updated} dryRun=${dryRun}`);
  if (failed > 0) process.exit(1);
}

main()
  .catch(err => {
    console.error("[migrate-mem0-cloud] fatal:", err instanceof Error ? err.stack : err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
