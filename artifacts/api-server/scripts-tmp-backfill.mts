/**
 * One-shot backfill: bring every capability to "complete" (quadrant +
 * economics + narrative). Idempotent — re-checks state before each call.
 * Writes to whatever DATABASE_URL points to (shared with prod).
 *
 * Phase 1: classify_quadrants per industry — single LLM call writes all caps
 * Phase 2: runAlphaEnrichment per industry — 12 caps per batch
 * Phase 3: runDetailEnrichment per cap — concurrency 3
 */
import { db, capabilitiesTable, capabilityEconomicsTable, capabilityQuadrantsTable, industriesTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { enrichCapabilityQuadrants } from "./src/services/enrichment/runners";
import { runAlphaEnrichment, runDetailEnrichment } from "./src/services/alpha/enrich";

const totalStart = Date.now();
const log = (...args: unknown[]) => console.error(`[${new Date().toISOString().slice(11,19)}] ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`);

const industries = await db.select().from(industriesTable);
const allCaps = await db.select().from(capabilitiesTable);
log(`STARTING — ${allCaps.length} caps across ${industries.length} industries`);

// ── Phase 1: quadrants ─────────────────────────────────────────────────────
log(`\n=== PHASE 1: classify_quadrants per industry ===`);
const phase1Start = Date.now();
for (const ind of industries) {
  const indCaps = allCaps.filter(c => c.industryId === ind.id);
  const existing = await db.select({ capabilityId: capabilityQuadrantsTable.capabilityId }).from(capabilityQuadrantsTable).where(eq(capabilityQuadrantsTable.industryId, ind.id));
  const existingSet = new Set(existing.map(e => e.capabilityId));
  const missing = indCaps.filter(c => !existingSet.has(c.id));
  if (missing.length === 0) { log(`  ${ind.name} (${indCaps.length} caps): all already have quadrants — SKIP`); continue; }
  log(`  ${ind.name} (${indCaps.length} caps, ${missing.length} missing): calling classify_quadrants...`);
  const t = Date.now();
  try {
    const r = await enrichCapabilityQuadrants(ind.id, ind.name, indCaps.map(c => ({ id: c.id, name: c.name, benchmarkScore: c.benchmarkScore ?? 50 })), null);
    log(`    done in ${Math.round((Date.now()-t)/1000)}s — classified=${r.classified} errors=${r.errors.length}`);
    if (r.errors.length) log(`    first error: ${r.errors[0]?.slice(0, 200)}`);
  } catch (e) { log(`    THREW: ${e instanceof Error ? e.message.slice(0,200) : String(e)}`); }
}
log(`PHASE 1 done in ${Math.round((Date.now()-phase1Start)/1000)}s`);

// ── Phase 2: economics alpha ───────────────────────────────────────────────
log(`\n=== PHASE 2: runAlphaEnrichment per industry ===`);
const phase2Start = Date.now();
for (const ind of industries) {
  let pass = 0;
  while (true) {
    pass++;
    const remaining = await db.select({ id: capabilitiesTable.id })
      .from(capabilitiesTable)
      .leftJoin(capabilityEconomicsTable, eq(capabilityEconomicsTable.capabilityId, capabilitiesTable.id))
      .where(and(eq(capabilitiesTable.industryId, ind.id), isNull(capabilityEconomicsTable.id)));
    if (remaining.length === 0) { if (pass === 1) log(`  ${ind.name}: all caps already enriched — SKIP`); else log(`  ${ind.name}: all caps now enriched after ${pass-1} passes`); break; }
    log(`  ${ind.name} pass ${pass}: ${remaining.length} caps remaining, calling runAlphaEnrichment...`);
    const t = Date.now();
    try {
      const r = await runAlphaEnrichment({ industryId: ind.id, limitCapabilities: 12, limitEdges: 0 });
      log(`    pass ${pass} done in ${Math.round((Date.now()-t)/1000)}s — enriched=${r.capabilitiesEnriched} errors=${r.errors.length}`);
      if (r.capabilitiesEnriched === 0) { log(`    no progress — moving on`); break; }
    } catch (e) { log(`    THREW: ${e instanceof Error ? e.message.slice(0,200) : String(e)}`); break; }
  }
}
log(`PHASE 2 done in ${Math.round((Date.now()-phase2Start)/1000)}s`);

// ── Phase 3: detail narratives, concurrency 3 ──────────────────────────────
log(`\n=== PHASE 3: runDetailEnrichment per cap, concurrency 3 ===`);
const phase3Start = Date.now();
const needDetail = await db.select({ capabilityId: capabilityEconomicsTable.capabilityId })
  .from(capabilityEconomicsTable)
  .where(isNull(capabilityEconomicsTable.summaryNarrative));
const ids = needDetail.map(r => r.capabilityId);
log(`  ${ids.length} caps need detail enrichment`);
let completed = 0; let failed = 0;
const CONCURRENCY = 3;
async function worker(id: number, idx: number) {
  const t = Date.now();
  try {
    const r = await runDetailEnrichment({ capabilityId: id, force: true });
    if (r.enriched > 0) completed++; else failed++;
    if ((idx + 1) % 5 === 0 || idx === ids.length - 1) {
      const elapsed = Math.round((Date.now() - phase3Start) / 1000);
      const rate = (idx + 1) / Math.max(1, elapsed);
      const remaining = ids.length - (idx + 1);
      const etaMin = Math.round(remaining / Math.max(0.001, rate) / 60);
      log(`  [${idx + 1}/${ids.length}] cap ${id} ${r.enriched > 0 ? "✓" : "✗"} (${Math.round((Date.now()-t)/1000)}s) — completed=${completed} failed=${failed} ETA=${etaMin}min`);
    }
  } catch (e) {
    failed++;
    log(`  [${idx + 1}/${ids.length}] cap ${id} THREW: ${e instanceof Error ? e.message.slice(0,150) : String(e)}`);
  }
}
for (let i = 0; i < ids.length; i += CONCURRENCY) {
  await Promise.all(ids.slice(i, i + CONCURRENCY).map((id, j) => worker(id, i + j)));
}
log(`PHASE 3 done in ${Math.round((Date.now()-phase3Start)/1000)}s — completed=${completed} failed=${failed}`);

log(`\n=== ALL PHASES COMPLETE in ${Math.round((Date.now()-totalStart)/60000)} min ===`);
process.exit(0);
