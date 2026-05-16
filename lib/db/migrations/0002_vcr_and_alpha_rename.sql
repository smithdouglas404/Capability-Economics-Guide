-- Migration: rename VCE (Value Chain Economics) → VCR (Value Chain Research)
-- and capability_economics → capability_alpha. Completes the brand cutover
-- started in 0001_cvi_rename.sql — eliminates the last "Economics" terms.
--
-- Idempotent: every statement is conditional. Safe to re-run.
--
-- Applied automatically via scripts/src/deploy-migrate.ts on every boot.

BEGIN;

-- ── VCE → VCR tables ────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vce_assessments') THEN
    ALTER TABLE vce_assessments RENAME TO vcr_assessments;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vce_cycles') THEN
    ALTER TABLE vce_cycles RENAME TO vcr_cycles;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vce_questions') THEN
    ALTER TABLE vce_questions RENAME TO vcr_questions;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vce_research_items') THEN
    ALTER TABLE vce_research_items RENAME TO vcr_research_items;
  END IF;
END $$;

-- ── VCE → VCR pkey indices + sequences ──────────────────────────────────
-- Postgres preserves these names through ALTER TABLE RENAME; rename
-- explicitly so introspection reports clean.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'vce_assessments_pkey') THEN
    ALTER INDEX vce_assessments_pkey RENAME TO vcr_assessments_pkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'vce_cycles_pkey') THEN
    ALTER INDEX vce_cycles_pkey RENAME TO vcr_cycles_pkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'vce_questions_pkey') THEN
    ALTER INDEX vce_questions_pkey RENAME TO vcr_questions_pkey;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'vce_research_items_pkey') THEN
    ALTER INDEX vce_research_items_pkey RENAME TO vcr_research_items_pkey;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'vce_assessments_id_seq') THEN
    ALTER SEQUENCE vce_assessments_id_seq RENAME TO vcr_assessments_id_seq;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'vce_cycles_id_seq') THEN
    ALTER SEQUENCE vce_cycles_id_seq RENAME TO vcr_cycles_id_seq;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'vce_questions_id_seq') THEN
    ALTER SEQUENCE vce_questions_id_seq RENAME TO vcr_questions_id_seq;
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'vce_research_items_id_seq') THEN
    ALTER SEQUENCE vce_research_items_id_seq RENAME TO vcr_research_items_id_seq;
  END IF;
END $$;

-- ── capability_economics → capability_alpha ─────────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'capability_economics') THEN
    ALTER TABLE capability_economics RENAME TO capability_alpha;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'capability_economics_pkey') THEN
    ALTER INDEX capability_economics_pkey RENAME TO capability_alpha_pkey;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'capability_economics_id_seq') THEN
    ALTER SEQUENCE capability_economics_id_seq RENAME TO capability_alpha_id_seq;
  END IF;
END $$;

-- ── Column rename inside the renamed alpha table ────────────────────────
-- The legacy "economic_narrative" column has the noun we're trying to
-- eliminate. Rename to "alpha_narrative" to match the new table name.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'capability_alpha' AND column_name = 'economic_narrative'
  ) THEN
    ALTER TABLE capability_alpha RENAME COLUMN economic_narrative TO alpha_narrative;
  END IF;
END $$;

COMMIT;
