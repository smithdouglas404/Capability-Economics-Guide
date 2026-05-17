-- Migration 0005: Pre-create bot_workflow_runs + bot_workflow_steps tables.
--
-- Following the same pattern as 0004 (and previously 0001-0003): drizzle-kit
-- push's interactive "is this a new table or rename?" prompt is NOT bypassed
-- by --force. In a non-TTY container the prompt times out and silently no-ops
-- the table. Pre-creating it here means drizzle-kit sees it already and skips
-- the prompt entirely on the subsequent push step.
--
-- These tables back the bot workflow framework
-- (services/bots/workflows/) — multi-step LangGraph workflows that
-- orchestrate cross-action investigations per persona (PE Weekly Diligence,
-- VC Thesis Build, etc.) and system-wide aggregations (Cross-Bot Consensus
-- Map, Bot-to-CVI Calibration).
--
-- Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS bot_workflow_runs (
  id                          serial      PRIMARY KEY,
  bot_id                      integer     REFERENCES bots(id) ON DELETE SET NULL,
  workflow_key                text        NOT NULL,
  trigger                     text        NOT NULL DEFAULT 'scheduled',
  status                      text        NOT NULL DEFAULT 'pending',
  state                       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  artifact_ids                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  cost_cents                  integer     NOT NULL DEFAULT 0,
  budget_cap_cents_at_start   integer,
  error_message               text,
  started_at                  timestamp   NOT NULL DEFAULT now(),
  completed_at                timestamp,
  duration_ms                 integer
);

CREATE INDEX IF NOT EXISTS bot_workflow_runs_bot_idx     ON bot_workflow_runs(bot_id);
CREATE INDEX IF NOT EXISTS bot_workflow_runs_key_idx     ON bot_workflow_runs(workflow_key);
CREATE INDEX IF NOT EXISTS bot_workflow_runs_started_idx ON bot_workflow_runs(started_at);

CREATE TABLE IF NOT EXISTS bot_workflow_steps (
  id              serial      PRIMARY KEY,
  run_id          integer     NOT NULL REFERENCES bot_workflow_runs(id) ON DELETE CASCADE,
  step_name       text        NOT NULL,
  step_index      integer     NOT NULL,
  status          text        NOT NULL,
  cost_cents      integer     NOT NULL DEFAULT 0,
  duration_ms     integer     NOT NULL,
  payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  error_message   text,
  started_at      timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bot_workflow_steps_run_idx ON bot_workflow_steps(run_id);
