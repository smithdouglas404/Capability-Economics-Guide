/**
 * Apply the Inflexcvi cutover migration: renames every cei_* table, column,
 * and index to cvi_*. See lib/db/migrations/0001_cvi_rename.sql.
 *
 * Idempotent — every statement guards against the rename having already
 * happened. Safe to re-run.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run migrate:cvi-rename
 *
 * After this completes successfully, the schema files in lib/db/src/schema/
 * (cei.ts, cei-capability-history.ts, peer-benchmarks.ts, cvi-signals.ts,
 * companies.ts agent.ts) can be updated to reference the new cvi_* names
 * and drizzle-kit push will be a no-op.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const sqlPath = join(__dirname, "../../lib/db/migrations/0001_cvi_rename.sql");
  const migration = readFileSync(sqlPath, "utf-8");
  console.log(`Applying CVI rename migration from ${sqlPath}…`);
  await db.execute(sql.raw(migration));
  console.log("Migration applied. Verifying…");

  const stillThere = await db.execute(sql.raw(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_name LIKE 'cei_%'
    ORDER BY table_name
  `));
  const stillColumns = await db.execute(sql.raw(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE column_name LIKE 'cei_%'
    ORDER BY table_name, column_name
  `));
  const stillIndices = await db.execute(sql.raw(`
    SELECT indexname FROM pg_indexes WHERE indexname LIKE 'cei_%' ORDER BY indexname
  `));

  const tableRows = (stillThere.rows ?? stillThere) as Array<{ table_name: string }>;
  const colRows = (stillColumns.rows ?? stillColumns) as Array<{ table_name: string; column_name: string }>;
  const idxRows = (stillIndices.rows ?? stillIndices) as Array<{ indexname: string }>;

  if (tableRows.length > 0) {
    console.warn("⚠️  Tables still starting with cei_:", tableRows.map(r => r.table_name).join(", "));
  } else {
    console.log("✓ No tables starting with cei_");
  }
  if (colRows.length > 0) {
    console.warn("⚠️  Columns still starting with cei_:", colRows.map(r => `${r.table_name}.${r.column_name}`).join(", "));
  } else {
    console.log("✓ No columns starting with cei_");
  }
  if (idxRows.length > 0) {
    console.warn("⚠️  Indices still starting with cei_:", idxRows.map(r => r.indexname).join(", "));
  } else {
    console.log("✓ No indices starting with cei_");
  }

  const cviTables = await db.execute(sql.raw(`
    SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'cvi_%' ORDER BY table_name
  `));
  const cviRows = (cviTables.rows ?? cviTables) as Array<{ table_name: string }>;
  console.log(`\ncvi_ tables now in DB: ${cviRows.map(r => r.table_name).join(", ") || "(none yet)"}`);
}

main().catch(err => {
  console.error("CVI rename migration failed:", err);
  process.exit(1);
});
