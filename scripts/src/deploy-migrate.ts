/**
 * Production deploy migration.
 *
 * Runs `drizzle-kit push --force` against the live DATABASE_URL on every
 * boot of the Railway service, before the api-server accepts traffic. This
 * is the bridge that turns "schema edit committed to a branch" into "tables
 * exist in production" automatically — without it, every schema change
 * required a manual `drizzle-kit push` against prod.
 *
 * Idempotent by design: drizzle-kit push is a no-op when the live schema
 * already matches the source-of-truth schema files. Safe to run on every
 * container restart.
 *
 * Exit codes:
 *   0  — schema is in sync (already or after a successful push)
 *   1  — push failed; the api-server start command checks this and aborts
 *        boot so a deploy with a broken schema does NOT serve traffic.
 *
 * Skip mechanism: set `SKIP_MIGRATE=1` to bypass (e.g. for read-only deploy
 * environments or when running drizzle-kit push externally).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function log(msg: string): void {
  console.log(`[deploy-migrate] ${msg}`);
}

function fail(msg: string, exitCode = 1): never {
  console.error(`[deploy-migrate] FAIL: ${msg}`);
  process.exit(exitCode);
}

async function main(): Promise<void> {
  if (process.env.SKIP_MIGRATE === "1" || process.env.SKIP_MIGRATE === "true") {
    log("SKIP_MIGRATE set — skipping schema push");
    return;
  }
  if (!process.env.DATABASE_URL) {
    fail("DATABASE_URL not set — cannot push schema. (Set SKIP_MIGRATE=1 to bypass intentionally.)");
  }

  const dbPackageDir = path.resolve(__dirname, "../../lib/db");
  log(`pushing schema from ${dbPackageDir}`);

  // We shell out to the existing pnpm script rather than invoking drizzle-kit
  // programmatically. drizzle-kit's programmatic API is not stable; the CLI
  // is. Use `--force` because production already accepts breaking changes
  // (we never schedule destructive migrations without coordination).
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

main().catch(err => fail(`unexpected error: ${err instanceof Error ? err.message : String(err)}`));
