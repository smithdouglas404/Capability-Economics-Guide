-- Migration 0004: Create reference_org_selection_rule table BEFORE drizzle-push.
--
-- This is a pre-rename / pre-create fix following the same pattern as 0001 and
-- 0002. drizzle-kit's `push --force` does NOT bypass the interactive
-- "is this a new table or a rename?" prompt. In a non-TTY container (Railway
-- boot), the prompt times out after ~10s and silently no-ops the table.
--
-- The new `reference_org_selection_rule` table triggers this prompt because
-- drizzle-kit's similarity heuristic offers the existing `store` and
-- `store_migrations` tables (LangGraph PostgresStore) as potential renames.
-- The first prod deploy of commit b931b85 hit exactly this and crashlooped
-- because the seed script then failed with `relation … does not exist`.
--
-- Pre-creating the table here means drizzle-kit sees it already and skips the
-- prompt entirely on the subsequent push step. Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS reference_org_selection_rule (
  id                    serial      PRIMARY KEY,
  rule_text             text        NOT NULL,
  rule_version          integer     NOT NULL DEFAULT 1,
  perplexity_model      text        NOT NULL DEFAULT 'sonar',
  refresh_interval_days integer     NOT NULL DEFAULT 90,
  last_applied_at       timestamp,
  created_at            timestamp   NOT NULL DEFAULT now(),
  updated_at            timestamp   NOT NULL DEFAULT now()
);
