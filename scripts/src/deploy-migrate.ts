/**
 * Production deploy migration + seed orchestrator.
 *
 * Runs on every Railway container boot, BEFORE the api-server accepts
 * traffic. Three phases:
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
 *      schema files. Creates any new tables added since last deploy
 *      (dvx_*, csuite_recommendations, business_cases, disruption_events,
 *      etc.).
 *
 *   3. Run every idempotent seed in dependency order. Each seed is a
 *      separate tsx-launched script; failures fail the whole deploy
 *      (api-server start won't proceed). Seeds are upserts on slug/title,
 *      safe to re-run on every restart.
 *
 *      Previously the seed chain lived in the Dockerfile CMD; consolidated
 *      here so the order is in version-controlled TypeScript instead of
 *      a shell && chain, and so local `pnpm run start` matches Railway
 *      boot exactly.
 *
 *      Seed order matters:
 *        seed                       — knowledge graph base (industries,
 *                                     capabilities). Everything below
 *                                     depends on these rows existing.
 *        seed:gdp-weights           — Perplexity-cited GDP shares for the
 *                                     CVI weighted rollup. Graceful-degrade:
 *                                     no PERPLEXITY_API_KEY → skip (exit 0),
 *                                     per-industry Perplexity failures are
 *                                     logged but never fail the deploy. The
 *                                     CVI engine excludes industries with no
 *                                     weight from the overall index.
 *        seed:reference-org-rule    — single-row criterion ("top 10 per
 *                                     industry by revenue, mixing public +
 *                                     private, intl coverage…") that the
 *                                     populator below applies. Editable
 *                                     later via admin UI.
 *        seed:reference-orgs        — Perplexity-driven populator that reads
 *                                     the rule and inserts reference orgs
 *                                     into `organizations` with source URLs.
 *                                     Replaces the previous hardcoded 12-org
 *                                     list. Refresh-window guarded
 *                                     (default 90d); override with
 *                                     FORCE_REFERENCE_ORGS_REFRESH=1.
 *                                     Graceful-degrade if no PERPLEXITY_API_KEY.
 *        seed:organizations         — per-capability Perplexity scoring of
 *                                     the reference orgs (reads from DB,
 *                                     no longer owns the list).
 *        seed:marketplace           — legacy marketplace listings
 *                                     (back-compat).
 *        seed:patterns              — Uber/Stripe/OpenAI design-thinking
 *                                     exemplars (workbench priming).
 *        seed:reports               — 8 marketplace research listings.
 *        seed:alpha-config          — quadrant→EV multiples for /alpha.
 *        seed:payg-tier             — payg membership tier + 4 credit
 *                                     packs.
 *        seed:disruption-patterns   — 10 historical playbook patterns
 *                                     (Uber, Airbnb, etc.) for DVX
 *                                     pattern matching.
 *        seed:disruption-events     — 25 historical disruption events
 *                                     across industries.
 *
 *      Per-seed skip flags (set in env to bypass):
 *        SKIP_KNOWLEDGE_GRAPH_SEED, SKIP_GDP_WEIGHTS_SEED,
 *        SKIP_REFERENCE_ORG_RULE_SEED, SKIP_REFERENCE_ORGS_SEED,
 *        SKIP_MARKETPLACE_SEED, SKIP_ORGANIZATIONS_SEED,
 *        SKIP_PATTERNS_SEED, SKIP_REPORTS_SEED,
 *        SKIP_ALPHA_CONFIG_SEED, SKIP_PAYG_SEED,
 *        SKIP_DISRUPTION_PATTERN_SEED, SKIP_DISRUPTION_EVENT_SEED
 *      Each individual seed script honors its own flag.
 *
 *      Force flags (override idempotency / refresh windows):
 *        FORCE_REFERENCE_ORGS_REFRESH=1  re-run reference-orgs even if
 *                                        within the refresh window.
 *        RESET_REFERENCE_ORGS=1          DESTRUCTIVE — deletes all rows
 *                                        with sessionToken LIKE
 *                                        'seed:reference:%' before re-populating.
 *                                        Customer-added orgs are NOT touched.
 *
 *      Whole-phase skip: SKIP_SEEDS=1.
 *
 * All three phases are idempotent. Safe to run on every container restart.
 *
 * Exit codes:
 *   0  — phases all succeeded (already-in-sync counts as success)
 *   1  — any phase failed; the api-server start command checks this
 *        and aborts boot so a deploy with a broken schema or missing
 *        seeded data does NOT serve traffic.
 *
 * Skip mechanism:
 *   SKIP_MIGRATE=1            — bypass everything (use very cautiously)
 *   SKIP_SQL_MIGRATIONS=1     — skip phase 1 only
 *   SKIP_SEEDS=1              — skip phase 3 only
 *   SKIP_<NAME>_SEED=1        — skip a specific seed (script-by-script)
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

/**
 * Phase 3 — every idempotent seed, in dependency order.
 *
 * Each seed is its own tsx script. We invoke each via `pnpm run`. Failures
 * fail-fast: if a seed errors, the whole deploy aborts and the api-server
 * won't start. Use SKIP_SEEDS=1 to bypass this phase entirely; individual
 * seeds also honor their own SKIP_<NAME>_SEED env var.
 */
const SEED_CHAIN: Array<{ name: string; script: string }> = [
  { name: "knowledge graph", script: "seed" },
  { name: "industry GDP weights (Perplexity-cited)", script: "seed:gdp-weights" },
  { name: "reference-org selection rule (default criterion)", script: "seed:reference-org-rule" },
  { name: "reference orgs populated from rule (Perplexity-cited)", script: "seed:reference-orgs" },
  { name: "reference org capability scoring (Perplexity-cited)", script: "seed:organizations" },
  { name: "marketplace listings (legacy)", script: "seed:marketplace" },
  { name: "design-thinking patterns", script: "seed:patterns" },
  { name: "marketplace reports", script: "seed:reports" },
  { name: "alpha config", script: "seed:alpha-config" },
  { name: "payg tier + credit packs", script: "seed:payg-tier" },
  { name: "DVX disruption patterns", script: "seed:disruption-patterns" },
  { name: "disruption events catalog", script: "seed:disruption-events" },
  { name: "economic rules (Letta block source)", script: "seed:economic-rules" },
];

async function runSeeds(): Promise<void> {
  if (process.env.SKIP_SEEDS === "1" || process.env.SKIP_SEEDS === "true") {
    log("SKIP_SEEDS set — skipping seed phase");
    return;
  }
  log(`running ${SEED_CHAIN.length} seeds in dependency order…`);
  const overallStart = Date.now();
  const scriptsDir = path.resolve(__dirname, "..");
  for (const seed of SEED_CHAIN) {
    const start = Date.now();
    log(`  → ${seed.script} (${seed.name})`);
    const result = spawnSync("pnpm", ["run", seed.script], {
      cwd: scriptsDir,
      stdio: "inherit",
      env: process.env,
    });
    const elapsed = Date.now() - start;
    if (result.error) {
      fail(`seed ${seed.script}: spawn error: ${result.error.message}`);
    }
    if (result.status !== 0) {
      fail(`seed ${seed.script} exited with status ${result.status} after ${elapsed}ms`);
    }
    log(`    ✓ ${seed.script} done in ${elapsed}ms`);
  }
  log(`all seeds applied in ${Date.now() - overallStart}ms`);
}

/**
 * Phase 4 — Neo4j MIRRORS (NOT seeds).
 *
 * These scripts are pure Postgres → Neo4j mirrors. They have NO external
 * source — they read existing Postgres rows and idempotently MERGE the
 * matching shape into Neo4j. They CANNOT create rows that don't already
 * exist in Postgres. If Postgres is empty, Neo4j stays empty.
 *
 * Treated as a SEPARATE chain from `SEED_CHAIN` (above) because:
 *   - Seeds may insert data from external sources (Perplexity, config).
 *   - Mirrors only ever copy already-accepted Postgres data sideways.
 *   - Conflating them in docs/logs is exactly the confusion that caused
 *     the May 17 audit gap (Neo4j thought to be "populated" when only
 *     dual-writes from ongoing ops touched it, leaving prior data dark).
 *
 * Mirrors silently skip when:
 *   - NEO4J_URI is not set (no graph backend wired)
 *   - SKIP_NEO4J_MIRROR=1 is set
 *
 * Failures here NEVER fail the deploy — Neo4j is a downstream optimization.
 * The api-server's customer-facing reads still hit Postgres directly,
 * so a missing or partial Neo4j mirror only impacts the opt-in Cypher
 * read paths (USE_NEO4J_CAPABILITY_GRAPH=1).
 */
const NEO4J_MIRROR_CHAIN: Array<{ name: string; script: string }> = [
  { name: "memory_entities + memory_relations → :Entity nodes", script: "backfill:memory-to-neo4j" },
  { name: "capabilities + capability_dependencies → :Capability nodes + :DEPENDS_ON", script: "backfill:capability-graph-to-neo4j" },
];

async function runNeo4jMirrors(): Promise<void> {
  if (process.env.SKIP_NEO4J_MIRROR === "1" || process.env.SKIP_NEO4J_MIRROR === "true") {
    log("SKIP_NEO4J_MIRROR set — skipping Neo4j mirror phase");
    return;
  }
  if (!process.env.NEO4J_URI) {
    log("NEO4J_URI not set — skipping Neo4j mirror phase (Postgres reads continue to serve all customer-facing paths)");
    return;
  }
  log(`running ${NEO4J_MIRROR_CHAIN.length} Neo4j mirrors (Postgres → Neo4j, idempotent, never creates fake data)…`);
  const overallStart = Date.now();
  const scriptsDir = path.resolve(__dirname, "..");
  for (const mirror of NEO4J_MIRROR_CHAIN) {
    const start = Date.now();
    log(`  → ${mirror.script} (${mirror.name})`);
    const result = spawnSync("pnpm", ["run", mirror.script], {
      cwd: scriptsDir,
      stdio: "inherit",
      env: process.env,
    });
    const elapsed = Date.now() - start;
    // Mirror failures NEVER fail the deploy — Neo4j is downstream.
    if (result.error) {
      log(`    ⚠ ${mirror.script} spawn error: ${result.error.message} (non-fatal — Postgres reads unaffected)`);
      continue;
    }
    if (result.status !== 0) {
      log(`    ⚠ ${mirror.script} exited with status ${result.status} after ${elapsed}ms (non-fatal — Postgres reads unaffected)`);
      continue;
    }
    log(`    ✓ ${mirror.script} done in ${elapsed}ms`);
  }
  log(`all Neo4j mirrors complete in ${Date.now() - overallStart}ms`);
}

async function main(): Promise<void> {
  if (process.env.SKIP_MIGRATE === "1" || process.env.SKIP_MIGRATE === "true") {
    log("SKIP_MIGRATE set — skipping ALL phases (migrations + drizzle push + seeds + mirrors)");
    return;
  }
  if (!process.env.DATABASE_URL) {
    fail("DATABASE_URL not set — cannot migrate. (Set SKIP_MIGRATE=1 to bypass intentionally.)");
  }

  // Phase 1: SQL migrations (idempotent renames)
  await applySqlMigrations();

  // Phase 2: drizzle-kit push (idempotent schema sync)
  await runDrizzlePush();

  // Phase 3: idempotent seed chain (must run AFTER schema is current)
  await runSeeds();

  // Phase 4: Neo4j mirrors (Postgres → Neo4j, pure mirror, never fatal)
  await runNeo4jMirrors();
}

main().catch(err => fail(`unexpected error: ${err instanceof Error ? err.message : String(err)}`));
