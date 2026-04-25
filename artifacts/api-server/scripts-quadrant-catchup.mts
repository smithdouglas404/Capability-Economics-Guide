/**
 * One-shot Phase 1 catch-up: classify quadrants for caps the main backfill
 * skipped silently. Sonnet 4.5 truncates the JSON array when classifying
 * full industries, so ~85 of 298 caps got no row even though the function
 * returned successfully. This script:
 *
 *   Pass A: per-industry classify_quadrants on the SMALL subset of missing caps
 *   Pass B: re-query, then one-cap-at-a-time fallback for any stragglers
 *
 * Idempotent — checks DB state before each call. Latest-by-generatedAt wins
 * per the existing read pattern, so duplicate rows are harmless.
 *
 * Safe to run alongside the main backfill (pid 20058) which is on Phase 2/3
 * and does not touch capability_quadrants.
 */
import { db, capabilitiesTable, capabilityQuadrantsTable, industriesTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import { enrichCapabilityQuadrants } from "./src/services/enrichment/index";

const totalStart = Date.now();
const log = (...args: unknown[]) => console.error(`[${new Date().toISOString().slice(11,19)}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`);

type MissingCap = { id: number; name: string; benchmarkScore: number; industryId: number; industryName: string };

async function findMissingCaps(): Promise<MissingCap[]> {
  const rows = await db
    .select({
      id: capabilitiesTable.id,
      name: capabilitiesTable.name,
      benchmarkScore: capabilitiesTable.benchmarkScore,
      industryId: capabilitiesTable.industryId,
      industryName: industriesTable.name,
    })
    .from(capabilitiesTable)
    .leftJoin(capabilityQuadrantsTable, eq(capabilityQuadrantsTable.capabilityId, capabilitiesTable.id))
    .leftJoin(industriesTable, eq(industriesTable.id, capabilitiesTable.industryId))
    .where(isNull(capabilityQuadrantsTable.id));
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    benchmarkScore: r.benchmarkScore ?? 50,
    industryId: r.industryId,
    industryName: r.industryName ?? `industry ${r.industryId}`,
  }));
}

async function countWithRow(capIds: number[]): Promise<number> {
  if (capIds.length === 0) return 0;
  let n = 0;
  for (const id of capIds) {
    const rows = await db.select({ id: capabilityQuadrantsTable.id }).from(capabilityQuadrantsTable).where(eq(capabilityQuadrantsTable.capabilityId, id)).limit(1);
    if (rows.length > 0) n++;
  }
  return n;
}

// ── Pass A: per-industry, only missing caps ────────────────────────────────
log(`STARTING quadrant catch-up`);
const initialMissing = await findMissingCaps();
log(`Initial state: ${initialMissing.length} caps still missing capability_quadrants rows`);

if (initialMissing.length === 0) {
  log(`Nothing to do — exiting`);
  process.exit(0);
}

const byIndustry = new Map<number, MissingCap[]>();
for (const c of initialMissing) {
  const arr = byIndustry.get(c.industryId) ?? [];
  arr.push(c);
  byIndustry.set(c.industryId, arr);
}
log(`Grouped into ${byIndustry.size} industries`);

log(`\n=== PASS A: per-industry classify_quadrants on missing caps only ===`);
const passAStart = Date.now();
for (const [industryId, missing] of byIndustry) {
  const industryName = missing[0]!.industryName;
  log(`  ${industryName} (industryId=${industryId}): ${missing.length} missing caps — calling classify_quadrants...`);
  const t = Date.now();
  const beforeIds = missing.map(c => c.id);
  try {
    const r = await enrichCapabilityQuadrants(
      industryId,
      industryName,
      missing.map(c => ({ id: c.id, name: c.name, benchmarkScore: c.benchmarkScore })),
      null,
    );
    const got = await countWithRow(beforeIds);
    log(`    done in ${Math.round((Date.now()-t)/1000)}s — sent=${missing.length} classified=${r.classified} now-have-row=${got}/${missing.length} errors=${r.errors.length}`);
    if (r.errors.length) log(`    first error: ${r.errors[0]?.slice(0, 200)}`);
  } catch (e) {
    log(`    THREW: ${e instanceof Error ? e.message.slice(0,200) : String(e)}`);
  }
}
log(`PASS A done in ${Math.round((Date.now()-passAStart)/1000)}s`);

// ── Re-check after Pass A ──────────────────────────────────────────────────
const stillMissing = await findMissingCaps();
log(`\nAfter Pass A: ${stillMissing.length} caps still missing (was ${initialMissing.length})`);

if (stillMissing.length === 0) {
  log(`\n=== ALL CAPS NOW HAVE QUADRANTS in ${Math.round((Date.now()-totalStart)/60000)} min ===`);
  process.exit(0);
}

// ── Pass B: one-cap-at-a-time fallback ─────────────────────────────────────
log(`\n=== PASS B: one-cap-at-a-time fallback for ${stillMissing.length} stragglers ===`);
const passBStart = Date.now();
let bSuccess = 0;
let bFailed = 0;
for (let i = 0; i < stillMissing.length; i++) {
  const cap = stillMissing[i]!;
  const t = Date.now();
  try {
    const r = await enrichCapabilityQuadrants(
      cap.industryId,
      cap.industryName,
      [{ id: cap.id, name: cap.name, benchmarkScore: cap.benchmarkScore }],
      null,
    );
    const got = await countWithRow([cap.id]);
    const ok = got > 0;
    if (ok) bSuccess++; else bFailed++;
    log(`  [${i+1}/${stillMissing.length}] ${cap.industryName} :: ${cap.name} (id=${cap.id}) ${ok ? "✓" : "✗"} (${Math.round((Date.now()-t)/1000)}s) — classified=${r.classified} errors=${r.errors.length}`);
    if (!ok && r.errors.length) log(`    first error: ${r.errors[0]?.slice(0, 200)}`);
  } catch (e) {
    bFailed++;
    log(`  [${i+1}/${stillMissing.length}] ${cap.industryName} :: ${cap.name} (id=${cap.id}) THREW: ${e instanceof Error ? e.message.slice(0,200) : String(e)} (${Math.round((Date.now()-t)/1000)}s)`);
  }
}
log(`PASS B done in ${Math.round((Date.now()-passBStart)/1000)}s — success=${bSuccess} failed=${bFailed}`);

// ── Final report ───────────────────────────────────────────────────────────
const finalMissing = await findMissingCaps();
log(`\n=== FINAL: ${finalMissing.length} caps still missing quadrants after both passes ===`);
if (finalMissing.length > 0) {
  log(`  Stragglers (manual rerun candidates):`);
  for (const c of finalMissing) {
    log(`    - capId=${c.id} ${c.industryName} :: ${c.name}`);
  }
}
log(`\n=== TOTAL TIME: ${Math.round((Date.now()-totalStart)/60000)} min ===`);
process.exit(0);
