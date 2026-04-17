import { db, capabilitiesTable, industriesTable, sourceTriangulationsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { triangulateCapability } from "../services/triangulation";

const CONCURRENCY = 4;

async function main() {
  const all = await db.select({
    id: capabilitiesTable.id,
    name: capabilitiesTable.name,
    industryId: capabilitiesTable.industryId,
    parentId: capabilitiesTable.parentCapabilityId,
  }).from(capabilitiesTable);
  const industries = await db.select().from(industriesTable);
  const indMap = new Map(industries.map(i => [i.id, i.name]));

  const tri = await db.select({ capId: sourceTriangulationsTable.capabilityId }).from(sourceTriangulationsTable);
  const haveTri = new Set(tri.map(t => t.capId));

  const targets = all.filter(c => c.parentId !== null && !haveTri.has(c.id));
  console.log(`[tri-backfill] ${targets.length} children to triangulate (concurrency=${CONCURRENCY})`);

  let done = 0, failed = 0;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (cap) => {
      const industryName = indMap.get(cap.industryId) || "Unknown";
      try {
        await triangulateCapability(industryName, cap.name, cap.industryId, cap.id);
        done++;
        if (done % 10 === 0) console.log(`[tri-backfill] ${done}/${targets.length} done (${failed} failed)`);
      } catch (err) {
        failed++;
        console.error(`[tri-backfill] ✗ ${industryName} / ${cap.name}: ${err instanceof Error ? err.message : err}`);
      }
    }));
  }
  console.log(`[tri-backfill] complete: ${done} ok, ${failed} failed`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
