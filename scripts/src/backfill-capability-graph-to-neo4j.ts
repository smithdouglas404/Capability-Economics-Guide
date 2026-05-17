/**
 * Backfill Postgres capabilities + capability_dependencies → Neo4j.
 *
 * Companion to backfill-memory-to-neo4j.ts but for the capability graph
 * (NOT the agent's memory graph). Reads every capabilities row and every
 * capability_dependencies row, idempotently MERGEs into Neo4j as
 * :Capability nodes + :DEPENDS_ON relationships.
 *
 * Required first time Neo4j is wired up (otherwise the graph is empty
 * even though Postgres has all the data), and any time Neo4j drift is
 * suspected. Safe to re-run.
 *
 * Usage
 *   NEO4J_URI=… NEO4J_PASSWORD=… \
 *     pnpm --filter @workspace/scripts run backfill:capability-graph-to-neo4j
 *
 * Skip flags
 *   SKIP_CAPABILITIES=1
 *   SKIP_DEPENDENCIES=1
 *   DRY_RUN=1
 *
 * Exit codes
 *   0 — success or graceful skip
 *   1 — catastrophic error
 */
import { db, capabilitiesTable, capabilityDependenciesTable } from "@workspace/db";
import { gt, asc } from "drizzle-orm";

if (!process.env.NEO4J_URI) {
  console.warn("[backfill:capability-graph] NEO4J_URI not set — skipping");
  process.exit(0);
}

const BATCH_SIZE = 500;
const DRY_RUN = process.env.DRY_RUN === "1";
const SKIP_CAPS = process.env.SKIP_CAPABILITIES === "1";
const SKIP_DEPS = process.env.SKIP_DEPENDENCIES === "1";

async function main(): Promise<void> {
  const neo4j = await import("neo4j-driver");
  const user = process.env.NEO4J_USER ?? "neo4j";
  const password = process.env.NEO4J_PASSWORD;
  if (!password) {
    console.error("[backfill:capability-graph] NEO4J_PASSWORD not set");
    process.exit(1);
  }
  const driver = neo4j.default.driver(process.env.NEO4J_URI!, neo4j.default.auth.basic(user, password));
  try { await driver.verifyConnectivity(); } catch (err) {
    console.error("[backfill:capability-graph] Neo4j unreachable:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  console.log("[backfill:capability-graph] Neo4j connected");

  if (!DRY_RUN) {
    const session = driver.session();
    try {
      await session.run("CREATE INDEX cap_pgid IF NOT EXISTS FOR (c:Capability) ON (c.pgId)");
      await session.run("CREATE INDEX cap_slug IF NOT EXISTS FOR (c:Capability) ON (c.slug)");
      await session.run("CREATE INDEX cap_industry IF NOT EXISTS FOR (c:Capability) ON (c.industryId)");
    } finally {
      await session.close();
    }
  }

  let capsProcessed = 0;
  if (!SKIP_CAPS) {
    console.log("[backfill:capability-graph] pass 1: capabilities");
    let lastId = 0;
    while (true) {
      const rows = await db.select().from(capabilitiesTable)
        .where(gt(capabilitiesTable.id, lastId))
        .orderBy(asc(capabilitiesTable.id))
        .limit(BATCH_SIZE);
      if (rows.length === 0) break;
      if (!DRY_RUN) {
        const session = driver.session();
        try {
          await session.run(
            `UNWIND $rows AS r
             MERGE (c:Capability { pgId: r.pgId })
             SET c.slug = r.slug,
                 c.name = r.name,
                 c.industryId = r.industryId,
                 c.parentCapabilityId = r.parentCapabilityId,
                 c.isLeaf = r.isLeaf,
                 c.reviewStatus = r.reviewStatus,
                 c.benchmarkScore = r.benchmarkScore,
                 c.updatedAt = timestamp()`,
            { rows: rows.map(r => ({
                pgId: r.id, slug: r.slug, name: r.name,
                industryId: r.industryId,
                parentCapabilityId: r.parentCapabilityId ?? null,
                isLeaf: r.isLeaf, reviewStatus: r.reviewStatus,
                benchmarkScore: r.benchmarkScore,
              })) },
          );
        } finally {
          await session.close();
        }
      }
      capsProcessed += rows.length;
      lastId = rows[rows.length - 1]!.id;
      if (capsProcessed % (BATCH_SIZE * 4) === 0) console.log(`  caps processed=${capsProcessed}`);
      if (rows.length < BATCH_SIZE) break;
    }
    console.log(`[backfill:capability-graph] pass 1 done. processed=${capsProcessed} (DRY_RUN=${DRY_RUN ? "yes" : "no"})`);
  }

  let depsProcessed = 0;
  let depsUpserted = 0;
  let depsSkippedMissing = 0;
  if (!SKIP_DEPS) {
    console.log("[backfill:capability-graph] pass 2: dependencies");
    let lastId = 0;
    while (true) {
      const rows = await db.select().from(capabilityDependenciesTable)
        .where(gt(capabilityDependenciesTable.id, lastId))
        .orderBy(asc(capabilityDependenciesTable.id))
        .limit(BATCH_SIZE);
      if (rows.length === 0) break;
      if (!DRY_RUN) {
        const session = driver.session();
        try {
          const result = await session.run(
            `UNWIND $rows AS r
             MATCH (from:Capability { pgId: r.capabilityId })
             MATCH (to:Capability { pgId: r.dependsOnId })
             MERGE (from)-[rel:DEPENDS_ON]->(to)
             SET rel.strength = r.strength, rel.updatedAt = timestamp()
             RETURN count(rel) AS n`,
            { rows: rows.map(r => ({
                capabilityId: r.capabilityId,
                dependsOnId: r.dependsOnId,
                strength: r.strength,
              })) },
          );
          const matched = Number(result.records[0]?.get("n") ?? 0);
          depsUpserted += matched;
          depsSkippedMissing += rows.length - matched;
        } finally {
          await session.close();
        }
      }
      depsProcessed += rows.length;
      lastId = rows[rows.length - 1]!.id;
      if (rows.length < BATCH_SIZE) break;
    }
    console.log(`[backfill:capability-graph] pass 2 done. processed=${depsProcessed} upserted=${depsUpserted} skipped_missing_endpoint=${depsSkippedMissing}`);
  }

  await driver.close();
  console.log("[backfill:capability-graph] complete");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[backfill:capability-graph] catastrophic error:", err);
  process.exit(1);
});
