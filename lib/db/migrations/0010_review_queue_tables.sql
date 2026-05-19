-- 0010_review_queue_tables.sql
--
-- Creates the regulations_proposed + regulation_requirements_proposed
-- tables explicitly, BEFORE drizzle-kit's --force schema push runs. This
-- is required because drizzle-kit --force can't answer the interactive
-- rename prompt correctly in a container, and was guessing
-- "rename scheduler_kill_switches → regulation_requirements_proposed",
-- which (a) broke the kill switches table and (b) never created
-- regulations_proposed at all.
--
-- This migration is idempotent and self-healing:
--   1. If the previous deploy mis-renamed scheduler_kill_switches to
--      regulation_requirements_proposed (detected by the column shape),
--      rename it back. Drop instead if a new kill_switches table already
--      took the original name.
--   2. CREATE TABLE IF NOT EXISTS for both proposed tables with the exact
--      schema review-queue.ts declares, so drizzle-kit's diff is a no-op
--      and it stops asking about renames.
--   3. CREATE INDEX IF NOT EXISTS for the unique indexes.

DO $$
BEGIN
  -- Detect the mis-rename: table named regulation_requirements_proposed
  -- but carrying the scheduler_kill_switches columns (has `disabled`).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'regulation_requirements_proposed'
      AND column_name = 'disabled'
  ) THEN
    -- If the original kill_switches table doesn't exist (because the rename
    -- moved it), rename our mis-renamed copy back. Otherwise drop the bogus
    -- copy and keep the proper kill_switches table.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'scheduler_kill_switches'
    ) THEN
      ALTER TABLE regulation_requirements_proposed RENAME TO scheduler_kill_switches;
    ELSE
      DROP TABLE regulation_requirements_proposed;
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS regulations_proposed (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  short_code          TEXT NOT NULL,
  description         TEXT,
  jurisdiction        TEXT NOT NULL DEFAULT 'global',
  effective_date      TIMESTAMP,
  industries          JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed_by         TEXT NOT NULL,
  proposed_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  source_url          TEXT,
  source_citation     TEXT,
  verification_notes  TEXT,
  review_status       TEXT NOT NULL DEFAULT 'pending',
  reviewer_notes      TEXT,
  reviewed_by         TEXT,
  reviewed_at         TIMESTAMP,
  promoted_to_live_id INTEGER REFERENCES regulations(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS reg_proposed_shortcode_idx
  ON regulations_proposed (short_code, proposed_by);

CREATE TABLE IF NOT EXISTS regulation_requirements_proposed (
  id                  SERIAL PRIMARY KEY,
  regulation_id       INTEGER NOT NULL REFERENCES regulations(id) ON DELETE CASCADE,
  capability_id       INTEGER NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
  required_maturity   REAL NOT NULL,
  priority            TEXT NOT NULL DEFAULT 'required',
  evidence_notes      TEXT,
  article             TEXT,
  proposed_by         TEXT NOT NULL,
  proposed_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  source_url          TEXT,
  source_citation     TEXT,
  verification_notes  TEXT,
  review_status       TEXT NOT NULL DEFAULT 'pending',
  reviewer_notes      TEXT,
  reviewed_by         TEXT,
  reviewed_at         TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS reg_req_proposed_unique_idx
  ON regulation_requirements_proposed (regulation_id, capability_id, proposed_by);
