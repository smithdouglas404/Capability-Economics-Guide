-- 0019_backfill_missing_tables_drizzle_dropped.sql
--
-- Backfills 5 tables that exist in lib/db/src/schema/*.ts but were
-- silently dropped from prod by the drizzle-kit push --force rename
-- prompt across multiple deploys (the same class of bug 0016 + 0018
-- patched for marketplace_reviews ↔ messages and direct_messages ↔
-- messages, but on new victims).
--
-- Discovered via audit: comparing the 173 `pgTable("name", …)` declarations
-- in lib/db/src/schema/*.ts against `information_schema.tables` on the
-- prod DB after the 2026-05-25 12:25 deploy returned these 5 missing
-- tables:
--
--   disruption_simulations   — disruption-simulations.ts:46
--   member_post_shares       — member-profiles.ts:303
--   member_recommendations   — member-profiles.ts:220
--   member_saved_posts       — member-profiles.ts:285
--   profile_views            — member-profiles.ts:269
--
-- Each represents a feature that has been completely dead in prod since
-- the schema was added (any INSERT on these routes throws "relation does
-- not exist"). The 4 member_* tables all came in the same member-profiles
-- change and were dropped together — drizzle's shape heuristic on the
-- pre-existing `messages` table prompted for a rename on each of them in
-- sequence across deploys, defaulted to the wrong answer, and aborted
-- the rest of the schema diff.
--
-- Recovery vs create:
--   - member_post_shares has the recovery DO block since deploy logs
--     showed drizzle prompted `messages › member_post_shares` on the
--     2026-05-25 12:25 deploy. If a future deploy re-triggers the same
--     rename, this migration in Phase 1 will detect it (messages-shape
--     columns present in member_post_shares while messages table is
--     missing) and rename it back.
--   - The other 4 tables just need CREATE TABLE IF NOT EXISTS — no
--     historical evidence that drizzle aliased them to messages, so no
--     recovery branch needed. Column shapes mirror their .ts schemas
--     exactly; future drizzle-push runs will see them and no-op.

-- Recovery for member_post_shares (the one drizzle flagged in deploy logs)
DO $$
DECLARE
  mps_cols TEXT[];
  has_messages_shape BOOLEAN;
BEGIN
  IF to_regclass('public.member_post_shares') IS NOT NULL
     AND to_regclass('public.messages') IS NULL THEN
    SELECT array_agg(column_name::TEXT)
      INTO mps_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'member_post_shares';

    has_messages_shape :=
      'role' = ANY(mps_cols) AND
      'content' = ANY(mps_cols) AND
      'conversation_id' = ANY(mps_cols);

    IF has_messages_shape THEN
      RAISE NOTICE '[0019] member_post_shares has messages-shape columns and messages is missing — renaming back';
      ALTER TABLE member_post_shares RENAME TO messages;
    END IF;
  END IF;
END $$;

-- member_recommendations (member-profiles.ts:220)
CREATE TABLE IF NOT EXISTS member_recommendations (
  id SERIAL PRIMARY KEY,
  giver_user_id TEXT NOT NULL,
  receiver_user_id TEXT NOT NULL,
  relationship TEXT,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS member_recommendations_receiver_idx
  ON member_recommendations (receiver_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS member_recommendations_pair_unique
  ON member_recommendations (giver_user_id, receiver_user_id);

-- profile_views (member-profiles.ts:269)
CREATE TABLE IF NOT EXISTS profile_views (
  id SERIAL PRIMARY KEY,
  viewer_user_id TEXT NOT NULL,
  viewed_user_id TEXT NOT NULL,
  viewed_date TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS profile_views_dedupe
  ON profile_views (viewer_user_id, viewed_user_id, viewed_date);
CREATE INDEX IF NOT EXISTS profile_views_viewed_idx
  ON profile_views (viewed_user_id, created_at);

-- member_saved_posts (member-profiles.ts:285) — FK to member_posts(id)
CREATE TABLE IF NOT EXISTS member_saved_posts (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  post_id INTEGER NOT NULL REFERENCES member_posts(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS member_saved_posts_unique
  ON member_saved_posts (user_id, post_id);
CREATE INDEX IF NOT EXISTS member_saved_posts_user_idx
  ON member_saved_posts (user_id, created_at);

-- member_post_shares (member-profiles.ts:303) — FK to member_posts(id)
CREATE TABLE IF NOT EXISTS member_post_shares (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES member_posts(id) ON DELETE CASCADE,
  sharer_user_id TEXT NOT NULL,
  comment TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS member_post_shares_unique
  ON member_post_shares (post_id, sharer_user_id);
CREATE INDEX IF NOT EXISTS member_post_shares_sharer_idx
  ON member_post_shares (sharer_user_id, created_at);

-- disruption_simulations (disruption-simulations.ts:46)
-- Wide table — saved /disruption-simulator scenarios with full
-- 60-month trajectory + cascade + defender-counterfactual JSON blobs.
CREATE TABLE IF NOT EXISTS disruption_simulations (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,

  entrant_name TEXT NOT NULL,
  entrant_jtbd TEXT NOT NULL,
  entrant_tech_ids JSONB NOT NULL DEFAULT '[]'::JSONB,

  target_capability_ids JSONB NOT NULL DEFAULT '[]'::JSONB,

  adoption_curve TEXT NOT NULL DEFAULT 'standard_b2b_saas',
  capital_tier TEXT NOT NULL DEFAULT 'seed',
  regulatory_friction_months INTEGER NOT NULL DEFAULT 0,
  horizon_months INTEGER NOT NULL DEFAULT 36,
  substitution_factor REAL NOT NULL DEFAULT 0.7,
  defender_response TEXT NOT NULL DEFAULT 'none',

  crossover_month INTEGER,
  final_entrant_share REAL NOT NULL DEFAULT 0,
  total_dollars_disrupted_mm REAL NOT NULL DEFAULT 0,

  trajectory JSONB NOT NULL DEFAULT '[]'::JSONB,
  cascade JSONB NOT NULL DEFAULT '[]'::JSONB,
  defender_options JSONB NOT NULL DEFAULT '[]'::JSONB,

  top_playbook_id INTEGER,
  pitch_source TEXT,
  origin TEXT NOT NULL DEFAULT 'manual',
  parent_simulation_id INTEGER,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS disruption_simulations_user_idx
  ON disruption_simulations (user_id);
CREATE INDEX IF NOT EXISTS disruption_simulations_created_idx
  ON disruption_simulations (created_at);
