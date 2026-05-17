/**
 * Backfill Postgres memory_entities + memory_relations into Neo4j.
 *
 * Why this exists
 * ───────────────
 * `services/agent/graphMemory.ts` uses a dual-write pattern: every
 * `upsertEntity()` / `recordRelation()` call writes to Postgres first (source
 * of truth) then fire-and-forgets to Neo4j. That works for ongoing operations
 * but does NOT cover:
 *
 *   1. Fresh Railway deploys where Neo4j starts empty but Postgres already
 *      has thousands of memory_entities from prior agent cycles.
 *   2. Drift recovery when the Neo4j service was offline / unreachable for
 *      a stretch and dual-writes silently failed (logged, not retried).
 *   3. One-time bootstrap when Neo4j is first wired up to an existing system.
 *
 * This script reads every row from both tables in Postgres and idempotently
 * MERGEs into Neo4j. Safe to re-run.
 *
 * Usage
 * ─────
 *   # Local
 *   PERPLEXITY_API_KEY=… NEO4J_URI=… NEO4J_PASSWORD=… \
 *     pnpm --filter @workspace/scripts run backfill:memory-to-neo4j
 *
 *   # Against prod (from a Shell tab with prod env vars):
 *   pnpm --filter @workspace/scripts run backfill:memory-to-neo4j
 *
 * Skip flags
 * ──────────
 *   SKIP_ENTITIES=1     — skip the entities pass
 *   SKIP_RELATIONS=1    — skip the relations pass
 *   DRY_RUN=1           — read + count only; don't write to Neo4j
 *
 * Exit codes
 * ──────────
 *   0  — success (or graceful skip)
 *   1  — catastrophic error (DB or Neo4j connection lost)
 */
import { db, memoryEntitiesTable, memoryRelationsTable } from "@workspace/db";
import { gt, asc } from "drizzle-orm";

if (!process.env.NEO4J_URI) {
  console.warn("[backfill:memory-to-neo4j] NEO4J_URI not set — skipping (Postgres dual-write target unavailable)");
  process.exit(0);
}

const BATCH_SIZE = 500;
const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_ENTITIES = process.env.SKIP_ENTITIES === "1";
const SKIP_RELATIONS = process.env.SKIP_RELATIONS === "1";

async function main(): Promise<void> {
  const neo4j = await import("neo4j-driver");
  const user = process.env.NEO4J_USER ?? "neo4j";
  const password = process.env.NEO4J_PASSWORD;
  if (!password) {
    console.error("[backfill:memory-to-neo4j] NEO4J_PASSWORD not set");
    process.exit(1);
  }
  const driver = neo4j.default.driver(process.env.NEO4J_URI!, neo4j.default.auth.basic(user, password));
  try {
    await driver.verifyConnectivity();
  } catch (err) {
    console.error("[backfill:memory-to-neo4j] Neo4j unreachable:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  console.log("[backfill:memory-to-neo4j] Neo4j connected");

  // Ensure indices exist (same as graphMemory.ts init).
  if (!DRY_RUN) {
    const session = driver.session();
    try {
      await session.run("CREATE INDEX entity_key IF NOT EXISTS FOR (e:Entity) ON (e.normalizedKey)");
      await session.run("CREATE INDEX entity_kind IF NOT EXISTS FOR (e:Entity) ON (e.kind)");
      await session.run("CREATE INDEX entity_industry IF NOT EXISTS FOR (e:Entity) ON (e.industryId)");
      await session.run("CREATE INDEX entity_capability IF NOT EXISTS FOR (e:Entity) ON (e.capabilityId)");
    } finally {
      await session.close();
    }
  }

  // ── Pass 1: entities ────────────────────────────────────────────────
  let entitiesProcessed = 0;
  let entitiesUpserted = 0;
  if (!SKIP_ENTITIES) {
    console.log("[backfill:memory-to-neo4j] pass 1: entities");
    // Stream by id ranges to avoid loading all rows in memory at once.
    let lastId = 0;
    while (true) {
      const remaining = await db.select().from(memoryEntitiesTable)
        .where(gt(memoryEntitiesTable.id, lastId))
        .orderBy(asc(memoryEntitiesTable.id))
        .limit(BATCH_SIZE);
      if (remaining.length === 0) break;
      if (!DRY_RUN) {
        const session = driver.session();
        try {
          // UNWIND batch into a single Cypher call — much faster than per-row.
          await session.run(
            `UNWIND $rows AS r
             MERGE (e:Entity { normalizedKey: r.normalizedKey, kind: r.kind })
             SET e.name = r.name,
                 e.pgId = r.id,
                 e.industryId = r.industryId,
                 e.capabilityId = r.capabilityId,
                 e.mentionCount = r.mentionCount,
                 e.updatedAt = timestamp()`,
            { rows: remaining.map(r => ({
                id: r.id,
                kind: r.kind,
                name: r.name,
                normalizedKey: r.normalizedKey,
                industryId: r.industryId ?? null,
                capabilityId: r.capabilityId ?? null,
                mentionCount: r.mentionCount,
              })) },
          );
          entitiesUpserted += remaining.length;
        } finally {
          await session.close();
        }
      }
      entitiesProcessed += remaining.length;
      lastId = remaining[remaining.length - 1]!.id;
      if (entitiesProcessed % (BATCH_SIZE * 4) === 0) {
        console.log(`  entities processed=${entitiesProcessed} upserted=${entitiesUpserted}`);
      }
      if (remaining.length < BATCH_SIZE) break;
    }
    console.log(`[backfill:memory-to-neo4j] pass 1 done. processed=${entitiesProcessed} upserted=${entitiesUpserted} (DRY_RUN=${DRY_RUN ? "yes" : "no"})`);
  }

  // ── Pass 2: relations ───────────────────────────────────────────────
  let relationsProcessed = 0;
  let relationsUpserted = 0;
  let relationsSkippedMissing = 0;
  if (!SKIP_RELATIONS) {
    console.log("[backfill:memory-to-neo4j] pass 2: relations");
    let lastId = 0;
    while (true) {
      const remaining = await db.select().from(memoryRelationsTable)
        .where(gt(memoryRelationsTable.id, lastId))
        .orderBy(asc(memoryRelationsTable.id))
        .limit(BATCH_SIZE);
      if (remaining.length === 0) break;

      if (!DRY_RUN) {
        // Group by relation kind so we can use a static type in the Cypher
        // (relationship type can't be parameterized in Cypher).
        const byKind = new Map<string, typeof remaining>();
        for (const r of remaining) {
          if (!byKind.has(r.relationKind)) byKind.set(r.relationKind, []);
          byKind.get(r.relationKind)!.push(r);
        }
        for (const [kind, kindRows] of byKind.entries()) {
          const session = driver.session();
          try {
            const result = await session.run(
              `UNWIND $rows AS r
               MATCH (from:Entity { pgId: r.fromEntityId })
               MATCH (to:Entity { pgId: r.toEntityId })
               MERGE (from)-[rel:${kind.toUpperCase()}]->(to)
               SET rel.weight = r.weight,
                   rel.observedCount = r.observedCount,
                   rel.updatedAt = timestamp()
               RETURN count(rel) AS n`,
              { rows: kindRows.map(r => ({
                  fromEntityId: r.fromEntityId,
                  toEntityId: r.toEntityId,
                  weight: r.weight,
                  observedCount: r.observedCount,
                })) },
            );
            const matched = Number(result.records[0]?.get("n") ?? 0);
            relationsUpserted += matched;
            relationsSkippedMissing += kindRows.length - matched;
          } finally {
            await session.close();
          }
        }
      }
      relationsProcessed += remaining.length;
      lastId = remaining[remaining.length - 1]!.id;
      if (remaining.length < BATCH_SIZE) break;
    }
    console.log(`[backfill:memory-to-neo4j] pass 2 done. processed=${relationsProcessed} upserted=${relationsUpserted} skipped_missing_endpoint=${relationsSkippedMissing}`);
  }

  await driver.close();
  console.log("[backfill:memory-to-neo4j] complete");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[backfill:memory-to-neo4j] catastrophic error:", err);
  process.exit(1);
});
