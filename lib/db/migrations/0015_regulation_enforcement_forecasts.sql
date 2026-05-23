-- 0015_regulation_enforcement_forecasts.sql
--
-- Idempotent CREATE TABLE IF NOT EXISTS for regulation_enforcement_forecasts.
-- Stores the AI-generated forward-looking enforcement-intensity signal per
-- regulation. Refreshed weekly by the regulation-enforcement-forecaster
-- service. One row "wins" per regulation — readers pick the most-recent
-- forecast whose validUntil is still in the future.
--
-- Materializes the table BEFORE drizzle-kit's --force schema push runs so
-- the push doesn't risk hitting the legacy vce_* interactive prompt and
-- silently skipping this addition (same pattern as 0010-0014).
--
-- The column shape mirrors lib/db/src/schema/regulation-enforcement-forecasts.ts.

CREATE TABLE IF NOT EXISTS regulation_enforcement_forecasts (
  id                  SERIAL PRIMARY KEY,
  regulation_id       INTEGER NOT NULL REFERENCES regulations(id) ON DELETE CASCADE,
  forecasted_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  direction           TEXT NOT NULL,
  confidence          REAL NOT NULL,
  summary             TEXT NOT NULL,
  source_citations    JSONB NOT NULL DEFAULT '[]'::jsonb,
  valid_until         TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS regulation_enforcement_forecasts_reg_idx
  ON regulation_enforcement_forecasts (regulation_id);

CREATE INDEX IF NOT EXISTS regulation_enforcement_forecasts_valid_idx
  ON regulation_enforcement_forecasts (regulation_id, valid_until DESC);
