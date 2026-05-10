// Audit harness: hits all 10 Alpha tab endpoints across 3 industries
// (Insurance, Manufacturing, Residential Solar) and asserts non-empty
// payload invariants. Exit code 0 = pass; non-zero = fail.
//
// Run: cd artifacts/api-server && ./node_modules/.bin/tsx scripts-audit-alpha-tabs.mts
import { db } from "@workspace/db";
import { industriesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:8080";
const TARGET_SLUGS = ["insurance", "manufacturing", "residential-solar"];

const inds = await db.select().from(industriesTable);
const targets = TARGET_SLUGS.map((slug) => {
  const i = inds.find((x) => x.slug === slug);
  if (!i) throw new Error(`Industry "${slug}" not found in DB`);
  return { id: i.id, slug: i.slug, name: i.name };
});

type CheckResult = { tab: string; industry: string; ok: boolean; detail: string };
const results: CheckResult[] = [];

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return (await r.json()) as T;
}

function record(tab: string, industry: string, ok: boolean, detail: string) {
  results.push({ tab, industry, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${tab.padEnd(18)} ${industry.padEnd(20)} ${detail}`);
}

// Industry-agnostic tabs (run once)
type Generic = { items?: unknown[] };
for (const path of [
  "/api/alpha/evar",
  "/api/alpha/moat",
  "/api/alpha/fragility",
  "/api/alpha/cascade",
  "/api/alpha/arbitrage",
  "/api/alpha/talent",
  "/api/alpha/narrative-delta",
  "/api/alpha/flows",
  "/api/alpha/economics",
]) {
  try {
    const d = await get<Generic>(path);
    const n = Array.isArray(d.items) ? d.items.length : Object.keys(d).length;
    record(path.split("/").pop()!, "ALL", n > 0, `payload size=${n}`);
  } catch (e) {
    record(path.split("/").pop()!, "ALL", false, (e as Error).message);
  }
}

// Per-industry deep checks: EVaR + Moat + Fragility + Talent must be non-empty
for (const t of targets) {
  for (const tab of ["evar", "moat", "fragility", "talent"]) {
    try {
      const d = await get<Generic>(`/api/alpha/${tab}?industryId=${t.id}`);
      const items = Array.isArray(d.items) ? d.items : [];
      record(tab, t.name, items.length > 0, `${items.length} rows`);
    } catch (e) {
      record(tab, t.name, false, (e as Error).message);
    }
  }
}

const failed = results.filter((r) => !r.ok);
const totalCaps = (await db.execute(sql`SELECT COUNT(*)::int AS c FROM capabilities`)).rows[0] as { c: number };

console.log("\n=== summary ===");
console.log(JSON.stringify({
  base: BASE,
  industriesAudited: targets.map((t) => t.name),
  totalCapabilities: totalCaps.c,
  checks: results.length,
  failed: failed.length,
  failures: failed,
}, null, 2));

process.exit(failed.length === 0 ? 0 : 1);
