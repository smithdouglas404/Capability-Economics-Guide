-- 0014_regulation_watches.sql
--
-- Idempotent CREATE TABLE IF NOT EXISTS for regulation_watches, added in
-- this session to support per-user "watch this regulation" + automated
-- inbox notifications when effective dates pass with compliance < 100.
--
-- Materializes the table BEFORE drizzle-kit's --force schema push runs so
-- the push doesn't risk hitting the legacy vce_* interactive prompt and
-- silently skipping this addition (same pattern as 0010-0013).
--
-- The column shape mirrors lib/db/src/schema/regulation-watches.ts.

CREATE TABLE IF NOT EXISTS regulation_watches (
  id                       SERIAL PRIMARY KEY,
  user_id                  TEXT NOT NULL,
  regulation_id            INTEGER NOT NULL REFERENCES regulations(id) ON DELETE CASCADE,
  last_compliance_score    REAL,
  last_alerted_at          TIMESTAMP,
  created_at               TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS regulation_watches_user_reg_idx
  ON regulation_watches (user_id, regulation_id);

CREATE INDEX IF NOT EXISTS regulation_watches_user_idx
  ON regulation_watches (user_id);
