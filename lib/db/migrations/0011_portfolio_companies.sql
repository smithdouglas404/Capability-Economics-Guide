-- 0011_portfolio_companies.sql
--
-- Creates portfolio_companies BEFORE drizzle-kit's --force push to avoid
-- the interactive-rename-prompt pitfall that brought down the deploy
-- previously (see 0010_review_queue_tables.sql). Idempotent.

CREATE TABLE IF NOT EXISTS portfolio_companies (
  id                       SERIAL PRIMARY KEY,
  session_token            TEXT NOT NULL,
  company_id               INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  notes                    TEXT,
  alert_fevi_delta         BOOLEAN NOT NULL DEFAULT TRUE,
  alert_capability_decay   BOOLEAN NOT NULL DEFAULT TRUE,
  alert_regulation_change  BOOLEAN NOT NULL DEFAULT TRUE,
  added_at                 TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS portfolio_session_company_idx
  ON portfolio_companies (session_token, company_id);
