/**
 * Idempotent CREATE TABLE migration for `scheduled_exports`. Mirrors the
 * Drizzle schema in lib/db/src/schema/scheduled-exports.ts.
 *
 * Prod's deploy-migrate ran drizzle-kit push but the table didn't land
 * (drizzle-kit silently no-op'd or the run was killed mid-stream). The
 * weekly export scheduler sweeps every cron tick and spams
 * "relation scheduled_exports does not exist" errors; the sweep then
 * returns nothing and the loop continues.
 *
 * This endpoint runs CREATE TABLE IF NOT EXISTS so it's safe to call once
 * or many times. Same DDL drizzle would have emitted.
 *
 *   POST /api/admin/migrate/scheduled-exports
 *     headers: x-admin-key: $ADMIN_API_KEY
 *     response: { ok, created, alreadyExisted }
 */
import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router = Router();

/**
 * Idempotent CREATE TABLE migration for the 5 disruption-index tables.
 * Mirrors lib/db/src/schema/disruption-index.ts. Drizzle-kit push handles
 * this on every deploy, but the admin endpoint exists for the same
 * defensive reason as scheduled_exports — drizzle-kit push has been
 * observed silently no-op'ing during long deploys.
 */
router.post("/admin/migrate/disruption-index", requireAdmin, async (_req: Request, res: Response) => {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS disruption_enabling_tech (
        id SERIAL PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        maturity_year INTEGER NOT NULL,
        example_disruptors JSONB NOT NULL DEFAULT '[]'::jsonb,
        citations JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS disruption_enabling_tech_category_idx ON disruption_enabling_tech (category)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS disruption_playbook_archetypes (
        id SERIAL PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        summary TEXT NOT NULL,
        subscore_profile JSONB NOT NULL,
        canonical_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
        example_companies JSONB NOT NULL DEFAULT '[]'::jsonb,
        narrative_template TEXT NOT NULL,
        citations JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS capability_disruption_index (
        id SERIAL PRIMARY KEY,
        capability_id INTEGER NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
        asset_friction REAL NOT NULL,
        jtbd_abstractability REAL NOT NULL,
        enabling_tech_strength REAL NOT NULL,
        trust_replaceability REAL NOT NULL,
        latent_supply_multiplier REAL NOT NULL,
        margin_asymmetry REAL NOT NULL,
        composite_di REAL NOT NULL,
        rationale JSONB,
        narrative TEXT,
        top_playbook_id INTEGER,
        top_playbook_similarity REAL,
        top_enabling_tech_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        candidate_disruptors JSONB NOT NULL DEFAULT '[]'::jsonb,
        computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        computed_by_run_id INTEGER
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS capability_disruption_index_cap_idx ON capability_disruption_index (capability_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS capability_disruption_index_composite_idx ON capability_disruption_index (composite_di)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS capability_disruption_index_playbook_idx ON capability_disruption_index (top_playbook_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS disruption_playbook_matches (
        id SERIAL PRIMARY KEY,
        capability_id INTEGER NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
        playbook_id INTEGER NOT NULL REFERENCES disruption_playbook_archetypes(id) ON DELETE CASCADE,
        similarity REAL NOT NULL,
        computed_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS disruption_playbook_matches_cap_play_idx ON disruption_playbook_matches (capability_id, playbook_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS disruption_playbook_matches_similarity_idx ON disruption_playbook_matches (similarity)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS disruption_lab_scenarios (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        target_capability_id INTEGER NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
        applied_tech_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        resolved_subscores JSONB NOT NULL,
        resolved_composite_di REAL NOT NULL,
        resolved_top_playbook_id INTEGER,
        pitch_source TEXT,
        origin TEXT NOT NULL DEFAULT 'manual',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS disruption_lab_scenarios_user_idx ON disruption_lab_scenarios (user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS disruption_lab_scenarios_target_idx ON disruption_lab_scenarios (target_capability_id)`);

    res.json({ ok: true, tables: 5 });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/admin/migrate/scheduled-exports", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const existed = await db.execute(sql`SELECT to_regclass('public.scheduled_exports') AS exists`);
    const exists = (existed.rows?.[0] ?? (existed as unknown as Array<{ exists: string | null }>)[0])?.exists != null;

    if (exists) {
      res.json({ ok: true, created: false, alreadyExisted: true });
      return;
    }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS scheduled_exports (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT true,
        frequency TEXT NOT NULL DEFAULT 'weekly',
        format TEXT NOT NULL DEFAULT 'markdown',
        scope TEXT NOT NULL DEFAULT 'all',
        last_sent_at TIMESTAMP,
        last_error TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS scheduled_exports_user_idx ON scheduled_exports (user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS scheduled_exports_active_idx ON scheduled_exports (active, last_sent_at)`);

    res.json({ ok: true, created: true, alreadyExisted: false });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
