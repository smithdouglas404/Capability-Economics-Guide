// Audit harness for the 10 user-facing CE Alpha tabs.
//
// The 10 tabs (frontend `pages/alpha.tsx` TabsTrigger values mapped to
// backend routes):
//   1. evar           → GET /api/alpha/evar
//   2. cascade        → GET /api/alpha/cascade
//   3. narrative      → GET /api/alpha/narrative-delta
//   4. moat           → GET /api/alpha/moat
//   5. fragility      → GET /api/alpha/fragility
//   6. arbitrage      → GET /api/alpha/arbitrage
//   7. flows          → GET /api/alpha/flows
//   8. talent         → GET /api/alpha/talent
//   9. twin           → GET /api/alpha/twin?industryAId=..&industryBId=..
//  10. thesis         → POST /api/alpha/thesis (admin-only + paid; cannot
//                        be hit unauthenticated, so we check the
//                        precondition: a capability with both economics
//                        and quadrant rows MUST exist for each target
//                        industry, since `generateThesisMemo` reads from
//                        those tables).
//
// For each endpoint we run an endpoint-specific non-empty validator
// (NOT a generic Object.keys length check). Per-industry coverage is
// asserted for evar, moat, fragility, talent, twin, and thesis (the
// six tabs whose rendering is industry-scoped).
//
// Exit code 0 = all checks pass; non-zero = at least one failure.
// Run: cd artifacts/api-server && ./node_modules/.bin/tsx scripts-audit-alpha-tabs.mts
import { db } from "@workspace/db";
import {
  industriesTable,
  capabilitiesTable,
  capabilityEconomicsTable,
  capabilityQuadrantsTable,
} from "@workspace/db";
import { eq, sql, and, inArray } from "drizzle-orm";

const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:8080";
const TARGET_SLUGS = ["insurance", "manufacturing", "residential-solar"];

type Industry = { id: number; slug: string; name: string };

const inds = await db.select().from(industriesTable);
const targets: Industry[] = TARGET_SLUGS.map((slug) => {
  const i = inds.find((x) => x.slug === slug);
  if (!i) throw new Error(`Industry "${slug}" not found in DB`);
  return { id: i.id, slug: i.slug, name: i.name };
});

type CheckResult = { tab: string; industry: string; ok: boolean; detail: string };
const results: CheckResult[] = [];

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return (await r.json()) as T;
}

function record(tab: string, industry: string, ok: boolean, detail: string) {
  results.push({ tab, industry, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${tab.padEnd(16)} ${industry.padEnd(20)} ${detail}`);
}

// ── Endpoint-specific validators ───────────────────────────────────────────

async function checkEvar(scope: string, q: string) {
  try {
    const d = await getJson<{ items: unknown[]; totals: { count: number }; coverage: { scored: number } }>(
      `/api/alpha/evar${q}`,
    );
    const ok = d.items.length > 0 && d.coverage.scored > 0 && d.totals.count > 0;
    record("evar", scope, ok, `items=${d.items.length} scored=${d.coverage.scored}`);
  } catch (e) { record("evar", scope, false, (e as Error).message); }
}

async function checkMoat(scope: string, q: string) {
  try {
    const d = await getJson<{ items: unknown[]; coverage: { scored: number } }>(`/api/alpha/moat${q}`);
    const ok = d.items.length > 0 && d.coverage.scored > 0;
    record("moat", scope, ok, `items=${d.items.length}`);
  } catch (e) { record("moat", scope, false, (e as Error).message); }
}

async function checkFragility(scope: string, q: string) {
  try {
    const d = await getJson<{ items: unknown[]; coverage: { scored: number } }>(`/api/alpha/fragility${q}`);
    const ok = d.items.length > 0 && d.coverage.scored > 0;
    record("fragility", scope, ok, `items=${d.items.length}`);
  } catch (e) { record("fragility", scope, false, (e as Error).message); }
}

async function checkTalent(scope: string, q: string) {
  try {
    const d = await getJson<{ items: Array<{ topCompanies?: unknown[] }> }>(`/api/alpha/talent${q}`);
    const withCompanies = d.items.filter((x) => Array.isArray(x.topCompanies) && x.topCompanies.length > 0);
    const ok = withCompanies.length > 0;
    record("talent", scope, ok, `items=${d.items.length} populated=${withCompanies.length}`);
  } catch (e) { record("talent", scope, false, (e as Error).message); }
}

async function checkCascade() {
  try {
    const d = await getJson<{ roots: Array<{ totalDownstreamImpactMm: number }> }>(`/api/alpha/cascade`);
    const nonzero = d.roots.filter((r) => r.totalDownstreamImpactMm > 0);
    const ok = d.roots.length > 0 && nonzero.length > 0;
    record("cascade", "ALL", ok, `roots=${d.roots.length} nonzero=${nonzero.length}`);
  } catch (e) { record("cascade", "ALL", false, (e as Error).message); }
}

async function checkNarrative() {
  try {
    const d = await getJson<{ items: unknown[] }>(`/api/alpha/narrative-delta`);
    record("narrative", "ALL", d.items.length > 0, `items=${d.items.length}`);
  } catch (e) { record("narrative", "ALL", false, (e as Error).message); }
}

async function checkArbitrage() {
  try {
    const d = await getJson<{ items: Array<{ ceQuadrant?: string; consensusQuadrant?: string }> }>(
      `/api/alpha/arbitrage`,
    );
    const cooling = d.items.filter((x) => x.ceQuadrant === "cooling" || x.consensusQuadrant === "cooling");
    const ok = d.items.length > 0;
    record("arbitrage", "ALL", ok, `items=${d.items.length} cooling-touching=${cooling.length}`);
  } catch (e) { record("arbitrage", "ALL", false, (e as Error).message); }
}

async function checkFlows() {
  try {
    const d = await getJson<{ items?: unknown[]; capital?: unknown[]; talent?: unknown[]; stages?: unknown[] }>(
      `/api/alpha/flows`,
    );
    // Flows responds with rich shape — accept if any meaningful array is non-empty.
    const lens = [d.items, d.capital, d.talent, d.stages]
      .filter(Array.isArray)
      .map((a) => (a as unknown[]).length);
    const ok = lens.some((n) => n > 0);
    record("flows", "ALL", ok, `arrays=${JSON.stringify(lens)}`);
  } catch (e) { record("flows", "ALL", false, (e as Error).message); }
}

async function checkTwin(aName: string, bName: string, aId: number, bId: number) {
  try {
    const d = await getJson<{ summary: { sharedCount: number }; synergies: unknown[] }>(
      `/api/alpha/twin?industryAId=${aId}&industryBId=${bId}`,
    );
    const ok = d.summary.sharedCount > 0 && d.synergies.length > 0;
    record("twin", `${aName}↔${bName}`, ok, `shared=${d.summary.sharedCount} synergies=${d.synergies.length}`);
  } catch (e) { record("twin", `${aName}↔${bName}`, false, (e as Error).message); }
}

// Thesis is admin-only POST; we cannot exercise it unauthenticated. Instead
// assert the precondition `generateThesisMemo` requires: at least one
// capability per target industry has BOTH an economics row AND a quadrant
// row. If not, the thesis tab cannot render anything anyway.
async function checkThesisPrecondition(t: Industry) {
  const caps = await db.select({ id: capabilitiesTable.id }).from(capabilitiesTable).where(eq(capabilitiesTable.industryId, t.id));
  const capIds = caps.map((c) => c.id);
  if (capIds.length === 0) { record("thesis", t.name, false, "no capabilities"); return; }
  const econ = await db.select({ id: capabilityEconomicsTable.capabilityId }).from(capabilityEconomicsTable).where(inArray(capabilityEconomicsTable.capabilityId, capIds));
  const quad = await db.select({ id: capabilityQuadrantsTable.capabilityId }).from(capabilityQuadrantsTable).where(inArray(capabilityQuadrantsTable.capabilityId, capIds));
  const econSet = new Set(econ.map((e) => e.id));
  const both = quad.filter((q) => econSet.has(q.id)).length;
  record("thesis", t.name, both > 0, `caps_with_econ+quadrant=${both} (precondition for thesis memo)`);
}

// ── Run all 10 tabs ────────────────────────────────────────────────────────

console.log(`audit base = ${BASE}`);
console.log(`industries  = ${targets.map((t) => t.name).join(", ")}\n`);

console.log("--- global tabs ---");
await checkCascade();
await checkNarrative();
await checkArbitrage();
await checkFlows();

console.log("\n--- per-industry tabs ---");
for (const t of targets) {
  const q = `?industryId=${t.id}`;
  await checkEvar(t.name, q);
  await checkMoat(t.name, q);
  await checkFragility(t.name, q);
  await checkTalent(t.name, q);
  await checkThesisPrecondition(t);
}

console.log("\n--- twin (cross-industry) ---");
await checkTwin(targets[0]!.name, targets[1]!.name, targets[0]!.id, targets[1]!.id);
await checkTwin(targets[0]!.name, targets[2]!.name, targets[0]!.id, targets[2]!.id);
await checkTwin(targets[1]!.name, targets[2]!.name, targets[1]!.id, targets[2]!.id);

const failed = results.filter((r) => !r.ok);
const totalCaps = (await db.execute(sql`SELECT COUNT(*)::int AS c FROM capabilities`)).rows[0] as { c: number };
const tabsCovered = new Set(results.map((r) => r.tab));

console.log("\n=== summary ===");
console.log(JSON.stringify({
  base: BASE,
  industriesAudited: targets.map((t) => t.name),
  totalCapabilities: totalCaps.c,
  tabsCovered: [...tabsCovered].sort(),
  tabsCoveredCount: tabsCovered.size,
  totalChecks: results.length,
  failed: failed.length,
  failures: failed,
}, null, 2));

process.exit(failed.length === 0 ? 0 : 1);
