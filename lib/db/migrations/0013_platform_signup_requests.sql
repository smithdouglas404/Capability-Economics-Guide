-- 0013_platform_signup_requests.sql
--
-- Idempotent CREATE TABLE IF NOT EXISTS for platform_signup_requests, added
-- in this session. Ensures the table exists in Postgres BEFORE drizzle-kit's
-- --force schema push runs, so drizzle-kit sees it as already-present and
-- doesn't risk hitting the interactive "create vs rename" prompt that has
-- silently aborted drizzle-kit push on prior deploys (see 0010-0012 for the
-- same pattern).
--
-- The column shape mirrors lib/db/src/schema/platform-signup-requests.ts.

CREATE TABLE IF NOT EXISTS platform_signup_requests (
  id                          SERIAL PRIMARY KEY,
  email                       TEXT NOT NULL,
  name                        TEXT NOT NULL,
  organization                TEXT NOT NULL,
  message                     TEXT,
  status                      TEXT NOT NULL DEFAULT 'pending',
  invite_token                TEXT UNIQUE,
  invite_token_expires_at     TIMESTAMP,
  rejection_reason            TEXT,
  requested_at                TIMESTAMP NOT NULL DEFAULT NOW(),
  decided_at                  TIMESTAMP,
  decided_by                  TEXT,
  completed_signup_at         TIMESTAMP,
  completed_signup_user_id    TEXT
);

CREATE INDEX IF NOT EXISTS platform_signup_requests_status_idx
  ON platform_signup_requests (status);

CREATE INDEX IF NOT EXISTS platform_signup_requests_email_idx
  ON platform_signup_requests (email);
