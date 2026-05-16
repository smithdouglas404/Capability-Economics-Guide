/**
 * Production deploy migration.
 *
 * Runs on every Railway container boot, BEFORE the api-server accepts
 * traffic. Two phases:
 *
 *   1. Apply any SQL migrations from lib/db/migrations/*.sql via the pg
 *      pool. These are pre-rename / pre-drizzle-push corrections (table
 *      renames, column renames, etc.) that drizzle-kit cannot infer
 *      automatically — drizzle's interactive prompt cannot be answered
 *      in a container, so without these the schema push silently no-ops
 *      and the live DB falls out of sync.
 *
 *   2. Run `drizzle-kit push --force` against the now-aligned DATABASE_URL.
 *      Idempotent — no-op when the live schema matches the source-of-truth
 *      schema files.
 *
 * Both phases are idempotent. Safe to run on every container restart.
 *
 * Exit codes:
 *   0  — schema is in sync (already or after a successful push)
 *   1  — phase 1 or 2 failed; the api-server start command checks this
 *        and aborts boot so a deploy with a broken schema does NOT serve
 *        traffic.
 *
 * Skip mechanism: set `SKIP_MIGRATE=1` to bypass entirely.
 * Skip just the SQL phase: `SKIP_SQL_MIGRATIONS=1` (useful when the SQL
 * files have already been applied manually).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { pool } from "@workspace/db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function log(msg: string): void {
  console.log(`[deploy-migrate] ${msg}`);
}

function fail(msg: string, exitCode = 1): never {
  console.error(`[deploy-migrate] FAIL: ${msg}`);
  process.exit(exitCode);
}

/**
 * Phase 1 — apply every .sql file in lib/db/migrations/, in lexicographic
 * order. Idempotent: each migration uses DO blocks guarded by IF EXISTS /
 * IF NOT EXISTS, so re-running is a no-op.
 *
 * We use a single pool connection inside a transaction-per-file. If any
 * file fails, we hard-stop the deploy.
 */
async function applySqlMigrations(): Promise<void> {
  if (process.env.SKIP_SQL_MIGRATIONS === "1") {
    log("SKIP_SQL_MIGRATIONS set — skipping SQL phase");
    return;
  }
  const migrationsDir = path.resolve(__dirname, "../../lib/db/migrations");
  if (!existsSync(migrationsDir)) {
    log("no migrations directory — skipping SQL phase");
    return;
  }
  const files = readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    log("no .sql files in migrations dir — skipping SQL phase");
    return;
  }

  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), "utf-8");
    const start = Date.now();
    log(`applying ${file}…`);
    try {
      await pool.query(sql);
      log(`  ✓ ${file} applied in ${Date.now() - start}ms`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(`migration ${file} failed: ${msg}`);
    }
  }
  // Don't close the pool — drizzle-kit push runs as a child process with its
  // own connection, and api-server boot will reuse this pool. Leaving open.
}

async function runDrizzlePush(): Promise<void> {
  const dbPackageDir = path.resolve(__dirname, "../../lib/db");
  log(`pushing schema from ${dbPackageDir}`);

  // We shell out to the existing pnpm script rather than invoking drizzle-kit
  // programmatically. drizzle-kit's programmatic API is not stable; the CLI
  // is. --force because we already pre-applied the rename via phase 1, so
  // drizzle-kit's interactive rename prompt should no longer trigger.
  const start = Date.now();
  const result = spawnSync("pnpm", ["run", "push-force"], {
    cwd: dbPackageDir,
    stdio: "inherit",
    env: process.env,
  });
  const elapsedMs = Date.now() - start;

  if (result.error) {
    fail(`spawn error: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`drizzle-kit push exited with status ${result.status} after ${elapsedMs}ms`);
  }
  log(`schema push complete in ${elapsedMs}ms`);
}

async function main(): Promise<void> {
  if (process.env.SKIP_MIGRATE === "1" || process.env.SKIP_MIGRATE === "true") {
    log("SKIP_MIGRATE set — skipping schema push");
    return;
  }
  if (!process.env.DATABASE_URL) {
    fail("DATABASE_URL not set — cannot migrate. (Set SKIP_MIGRATE=1 to bypass intentionally.)");
  }

  // Phase 1: SQL migrations (idempotent renames)
  await applySqlMigrations();

  // Phase 2: drizzle-kit push (idempotent schema sync)
  await runDrizzlePush();
}

main().catch(err => fail(`unexpected error: ${err instanceof Error ? err.message : String(err)}`));
