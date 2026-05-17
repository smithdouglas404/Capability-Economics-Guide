-- Migration 0006: Pre-create memory_relation_snapshots.
--
-- Following the same pattern as 0001-0005: drizzle-kit push's interactive
-- "is this a new table or rename?" prompt is NOT bypassed by --force. In a
-- non-TTY container the prompt times out and silently no-ops the table.
-- Pre-creating it here means drizzle-kit sees it already and skips the
-- prompt entirely on the subsequent push step.
--
-- This table feeds services/agent/temporal-shift-detector.ts so it can
-- compute REAL 30-day momentum by looking up the snapshot closest to
-- (now - 30 days), instead of linearly extrapolating from a fictional 0.1
-- baseline. A row is appended per (relationId, calendar day) by the daily
-- cron in scheduler.ts. The unique (relation_id, snapshot_at) constraint is
-- intentionally permissive — the writer normalises snapshot_at to date-only
-- so two firings on the same day are idempotent without ON CONFLICT.
--
-- Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS memory_relation_snapshots (
  id SERIAL PRIMARY KEY,
  relation_id INTEGER NOT NULL,
  weight REAL NOT NULL,
  observed_count INTEGER NOT NULL,
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memory_relation_snapshots_relation_idx
  ON memory_relation_snapshots (relation_id);

CREATE INDEX IF NOT EXISTS memory_relation_snapshots_snapshot_at_idx
  ON memory_relation_snapshots (snapshot_at);

CREATE UNIQUE INDEX IF NOT EXISTS memory_relation_snapshots_relation_day_uniq
  ON memory_relation_snapshots (relation_id, snapshot_at);
