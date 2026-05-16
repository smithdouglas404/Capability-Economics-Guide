-- Migration: rename all CEI artifacts to CVI as part of the Inflexcvi brand cutover.
-- See /home/runner/.claude/plans/from-capability-economics-agile-twilight.md (Phase 0.1).
--
-- Idempotent — every statement is wrapped in a conditional that no-ops when the rename
-- has already been applied. Safe to re-run.
--
-- Apply via: pnpm --filter @workspace/scripts run migrate:cvi-rename
-- Or directly: psql "$DATABASE_URL" -f lib/db/migrations/0001_cvi_rename.sql

BEGIN;

-- ── Tables ──────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cei_snapshots') THEN
    ALTER TABLE cei_snapshots RENAME TO cvi_snapshots;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cei_components') THEN
    ALTER TABLE cei_components RENAME TO cvi_components;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cei_capability_history') THEN
    ALTER TABLE cei_capability_history RENAME TO cvi_capability_history;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cei_peer_benchmarks') THEN
    ALTER TABLE cei_peer_benchmarks RENAME TO cvi_peer_benchmarks;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cei_signal_events') THEN
    ALTER TABLE cei_signal_events RENAME TO cvi_signal_events;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cei_signal_outcomes') THEN
    ALTER TABLE cei_signal_outcomes RENAME TO cvi_signal_outcomes;
  END IF;
END $$;

-- ── Columns on companies + agent_runs ───────────────────────────────────

-- NOTE: cei_weighted lives on the company_scores table, NOT companies.
-- Earlier migration revision had this on the wrong table; corrected here.
-- Idempotency still holds because the column may already be renamed.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'company_scores' AND column_name = 'cei_weighted'
  ) THEN
    ALTER TABLE company_scores RENAME COLUMN cei_weighted TO cvi_weighted;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_runs' AND column_name = 'cei_before_index'
  ) THEN
    ALTER TABLE agent_runs RENAME COLUMN cei_before_index TO cvi_before_index;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agent_runs' AND column_name = 'cei_after_index'
  ) THEN
    ALTER TABLE agent_runs RENAME COLUMN cei_after_index TO cvi_after_index;
  END IF;
END $$;

-- ── Indices ─────────────────────────────────────────────────────────────
-- Postgres ALTER INDEX RENAME is also conditional.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_components_cap_industry_idx') THEN
    ALTER INDEX cei_components_cap_industry_idx RENAME TO cvi_components_cap_industry_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_cap_history_cap_ind_at_unique') THEN
    ALTER INDEX cei_cap_history_cap_ind_at_unique RENAME TO cvi_cap_history_cap_ind_at_unique;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_cap_history_cap_idx') THEN
    ALTER INDEX cei_cap_history_cap_idx RENAME TO cvi_cap_history_cap_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_cap_history_snapshot_at_idx') THEN
    ALTER INDEX cei_cap_history_snapshot_at_idx RENAME TO cvi_cap_history_snapshot_at_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_signal_events_cap_idx') THEN
    ALTER INDEX cei_signal_events_cap_idx RENAME TO cvi_signal_events_cap_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_signal_events_window_end_idx') THEN
    ALTER INDEX cei_signal_events_window_end_idx RENAME TO cvi_signal_events_window_end_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_signal_events_severity_idx') THEN
    ALTER INDEX cei_signal_events_severity_idx RENAME TO cvi_signal_events_severity_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_signal_outcomes_event_idx') THEN
    ALTER INDEX cei_signal_outcomes_event_idx RENAME TO cvi_signal_outcomes_event_idx;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_signal_outcomes_ticker_idx') THEN
    ALTER INDEX cei_signal_outcomes_ticker_idx RENAME TO cvi_signal_outcomes_ticker_idx;
  END IF;
END $$;

-- ── Auto-named primary key indices ─────────────────────────────────────
-- Postgres preserves index names when a table is renamed via ALTER TABLE
-- RENAME, so cei_*_pkey constraints stay named with the old prefix even
-- after the table itself is renamed. Rename them explicitly so the
-- introspection in scripts/src/migrate-cvi-rename.ts reports clean.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_snapshots_pkey') THEN
    ALTER INDEX cei_snapshots_pkey RENAME TO cvi_snapshots_pkey;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_components_pkey') THEN
    ALTER INDEX cei_components_pkey RENAME TO cvi_components_pkey;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_capability_history_pkey') THEN
    ALTER INDEX cei_capability_history_pkey RENAME TO cvi_capability_history_pkey;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_peer_benchmarks_pkey') THEN
    ALTER INDEX cei_peer_benchmarks_pkey RENAME TO cvi_peer_benchmarks_pkey;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_signal_events_pkey') THEN
    ALTER INDEX cei_signal_events_pkey RENAME TO cvi_signal_events_pkey;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'cei_signal_outcomes_pkey') THEN
    ALTER INDEX cei_signal_outcomes_pkey RENAME TO cvi_signal_outcomes_pkey;
  END IF;
END $$;

-- ── Auto-named SERIAL sequences ────────────────────────────────────────
-- Same story: ALTER TABLE RENAME doesn't rename the cei_*_id_seq sequences
-- that back SERIAL columns. Catch-all RENAME on each that may exist.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'cei_snapshots_id_seq') THEN
    ALTER SEQUENCE cei_snapshots_id_seq RENAME TO cvi_snapshots_id_seq;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'cei_components_id_seq') THEN
    ALTER SEQUENCE cei_components_id_seq RENAME TO cvi_components_id_seq;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'cei_capability_history_id_seq') THEN
    ALTER SEQUENCE cei_capability_history_id_seq RENAME TO cvi_capability_history_id_seq;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'cei_peer_benchmarks_id_seq') THEN
    ALTER SEQUENCE cei_peer_benchmarks_id_seq RENAME TO cvi_peer_benchmarks_id_seq;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'cei_signal_events_id_seq') THEN
    ALTER SEQUENCE cei_signal_events_id_seq RENAME TO cvi_signal_events_id_seq;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'cei_signal_outcomes_id_seq') THEN
    ALTER SEQUENCE cei_signal_outcomes_id_seq RENAME TO cvi_signal_outcomes_id_seq;
  END IF;
END $$;

COMMIT;
