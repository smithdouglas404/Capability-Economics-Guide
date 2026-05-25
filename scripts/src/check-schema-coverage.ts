/**
 * Schema coverage audit — fails fast if any table declared in
 * lib/db/src/schema/*.ts is missing from the live Postgres DB.
 *
 * Why this exists — drizzle-kit push --force has a well-documented
 * failure mode in non-interactive environments (Railway containers,
 * CI): when it detects a new schema table with shape-similarity to an
 * existing DB table, it opens an interactive "is this a rename?"
 * prompt. --force only bypasses the destructive-data confirm, NOT the
 * rename prompt. With no stdin attached, drizzle waits ~10s, picks
 * SOMETHING (often the wrong rename), then aborts the rest of the
 * schema diff and reports success. Tables later in iteration order
 * silently fail to materialize. The deploy looks green; the affected
 * features die in prod with "relation does not exist".
 *
 * This script makes that failure mode loud:
 *   - Parse every `pgTable("name", …)` declaration in the schema
 *     source (multi-line-aware: name may be on the next line).
 *   - Query information_schema.tables for the actual prod table set.
 *   - If anything declared is missing in the DB, print the list and
 *     exit 1. deploy-migrate.ts treats non-zero as a fatal phase,
 *     which aborts the deploy before the api-server starts serving
 *     half-broken routes.
 *
 * Notes:
 *   - prod-only tables (exist in DB but not in any schema file) are
 *     reported as INFO, never as a failure — those are legacy /
 *     historical / intentionally-decoupled tables. The audit's job is
 *     "did drizzle do its job?", not "is the DB pristine?".
 *   - Bypass with SKIP_SCHEMA_COVERAGE_AUDIT=1 if you absolutely must
 *     ship past a known mismatch (e.g. a table you're about to drop in
 *     the same deploy). The skip will log a loud warning so it's
 *     visible in deploy logs.
 *   - Safe to run manually too: `pnpm --filter @workspace/scripts run
 *     check:schema-coverage` — uses the same DATABASE_URL as the
 *     deploy. Read-only against information_schema, no row data
 *     touched.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function log(msg: string): void {
  console.log(`[schema-coverage] ${msg}`);
}

function warn(msg: string): void {
  console.warn(`[schema-coverage] WARN: ${msg}`);
}

function fail(msg: string): never {
  console.error(`[schema-coverage] FAIL: ${msg}`);
  process.exit(1);
}

/**
 * Extract `pgTable("name", …)` table names from a schema file's
 * source. Multi-line-aware: the name literal may be on the same line
 * as `pgTable(` or on the next line (the typical drizzle style for
 * tables with longer column lists).
 */
function extractTableNames(source: string): string[] {
  // Match pgTable( optionally followed by whitespace / newline, then a
  // double-quoted lowercase_snake_case name. Captures the name.
  const re = /pgTable\(\s*"([a-z][a-z0-9_]*)"/g;
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    names.push(m[1]!);
  }
  return names;
}

function loadSchemaTableSet(): { names: Set<string>; perFile: Map<string, string[]> } {
  const schemaDir = path.resolve(__dirname, "../../lib/db/src/schema");
  const files = readdirSync(schemaDir).filter((f) => f.endsWith(".ts"));
  const names = new Set<string>();
  const perFile = new Map<string, string[]>();
  for (const file of files) {
    const source = readFileSync(path.join(schemaDir, file), "utf-8");
    const tables = extractTableNames(source);
    if (tables.length > 0) perFile.set(file, tables);
    for (const t of tables) names.add(t);
  }
  return { names, perFile };
}

async function loadProdTableSet(): Promise<Set<string>> {
  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  return new Set(rows.map((r) => r.table_name));
}

async function main(): Promise<void> {
  if (process.env.SKIP_SCHEMA_COVERAGE_AUDIT === "1" || process.env.SKIP_SCHEMA_COVERAGE_AUDIT === "true") {
    warn("SKIP_SCHEMA_COVERAGE_AUDIT set — skipping audit. This is your only safety net against drizzle-push silent drops; only use in an emergency.");
    return;
  }
  if (!process.env.DATABASE_URL) {
    fail("DATABASE_URL not set — cannot audit. (Set SKIP_SCHEMA_COVERAGE_AUDIT=1 to bypass intentionally.)");
  }

  log("loading schema table declarations…");
  const { names: schemaTables, perFile } = loadSchemaTableSet();
  log(`  → ${schemaTables.size} tables declared across ${perFile.size} schema files`);

  log("querying live DB table set…");
  const prodTables = await loadProdTableSet();
  log(`  → ${prodTables.size} tables present in public schema`);

  const missing: Array<{ name: string; file: string }> = [];
  for (const name of schemaTables) {
    if (!prodTables.has(name)) {
      const file = [...perFile.entries()].find(([, ts]) => ts.includes(name))?.[0] ?? "unknown";
      missing.push({ name, file });
    }
  }

  const orphans: string[] = [];
  for (const name of prodTables) {
    if (!schemaTables.has(name)) orphans.push(name);
  }

  if (orphans.length > 0) {
    log(`  → ${orphans.length} prod-only tables (no schema declaration) — informational, NOT a failure:`);
    for (const o of orphans.slice(0, 5)) log(`      ${o}`);
    if (orphans.length > 5) log(`      …and ${orphans.length - 5} more (run \`psql -c "\\dt"\` to see all)`);
  }

  if (missing.length === 0) {
    log("✓ all schema-declared tables present in prod");
    return;
  }

  // Fatal — emit a clear, actionable error
  console.error("");
  console.error(`[schema-coverage] FAIL: ${missing.length} schema-declared table(s) MISSING from prod:`);
  console.error("");
  for (const { name, file } of missing) {
    console.error(`    ✗ ${name.padEnd(40)} (declared in lib/db/src/schema/${file})`);
  }
  console.error("");
  console.error("This means drizzle-kit push --force silently dropped these tables during");
  console.error("its schema diff — usually because it hit an interactive rename prompt and");
  console.error("aborted. To fix:");
  console.error("");
  console.error("  1. Write a defensive SQL migration in lib/db/migrations/00XX_<name>.sql");
  console.error("     using CREATE TABLE IF NOT EXISTS with the table's column shape from");
  console.error("     the schema file. Phase 1 of deploy-migrate runs SQL migrations BEFORE");
  console.error("     drizzle-push, so the table is guaranteed to exist regardless of what");
  console.error("     drizzle decides. See 0017_perplexity_cache.sql / 0019_backfill_*.sql");
  console.error("     for the pattern.");
  console.error("");
  console.error("  2. Optionally re-deploy. The migration will create the missing tables,");
  console.error("     this audit will go green on the next boot.");
  console.error("");
  console.error("Bypass in an emergency: SKIP_SCHEMA_COVERAGE_AUDIT=1 (not recommended —");
  console.error("the deploy will continue with these features broken in prod).");
  process.exit(1);
}

main().catch((err) => fail(`unexpected error: ${err instanceof Error ? err.message : String(err)}`));
