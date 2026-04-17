/**
 * One-shot backfill: for every leaf capability that has no parent and no children,
 * generate 4-6 factual sub-capabilities via Haiku and insert them.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx src/scripts/backfill-sub-capabilities.ts
 */
import { db, capabilitiesTable, industriesTable } from "@workspace/db";
import { isNull, eq } from "drizzle-orm";
import { decomposeCapability } from "../services/sub-capability-generator";

const CONCURRENCY = 4;
const CHILDREN_PER_PARENT = 5;

async function main() {
  const all = await db.select().from(capabilitiesTable);
  const industries = await db.select().from(industriesTable);
  const indMap = new Map(industries.map(i => [i.id, i.name]));

  // Targets: top-level (no parent), currently leaf (no children themselves) — these are the 51 we need to expand.
  const childParentIds = new Set(all.filter(c => c.parentCapabilityId).map(c => c.parentCapabilityId!));
  const targets = all.filter(c => !c.parentCapabilityId && !childParentIds.has(c.id) && c.isLeaf);

  console.log(`[backfill] ${targets.length} capabilities need sub-cap decomposition`);
  if (targets.length === 0) { console.log("[backfill] nothing to do"); return; }

  let done = 0, failed = 0;
  const results: Array<{ parent: string; industry: string; ok: boolean; children?: number; error?: string }> = [];

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (cap) => {
      const industry = indMap.get(cap.industryId) || "Unknown";
      try {
        const out = await decomposeCapability(cap.id, { count: CHILDREN_PER_PARENT, triangulateNow: false });
        done++;
        console.log(`[backfill] ✓ ${industry} / ${cap.name} → ${out.childIds.length} children`);
        results.push({ parent: cap.name, industry, ok: true, children: out.childIds.length });
      } catch (err) {
        failed++;
        const msg = String(err instanceof Error ? err.message : err);
        console.error(`[backfill] ✗ ${industry} / ${cap.name}: ${msg}`);
        results.push({ parent: cap.name, industry, ok: false, error: msg });
      }
    }));
  }

  console.log(`\n[backfill] complete: ${done} succeeded, ${failed} failed`);
  console.log(`[backfill] new children rely on next scheduler triangulation cycle for factual scores.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
