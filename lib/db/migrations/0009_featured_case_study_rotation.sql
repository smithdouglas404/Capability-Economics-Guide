-- Featured case study scheduling + auto-rotation (2026-05-18).
-- - featured_case_study_policy: 1-row config governing the rotation cron
-- - featured_case_study_schedule: queue of one-off scheduled feature changes
-- See services/featured-case-study-rotation.ts for the cron logic.

CREATE TABLE IF NOT EXISTS featured_case_study_policy (
  id               SERIAL PRIMARY KEY,
  mode             TEXT NOT NULL DEFAULT 'manual',
  rotation_days    INTEGER,
  rotation_source  TEXT,
  industry_filter  TEXT,
  last_rotated_at  TIMESTAMP,
  next_rotation_at TIMESTAMP,
  updated_by       TEXT,
  updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Seed a single default row (mode=manual) so the cron has something to read.
INSERT INTO featured_case_study_policy (id, mode)
VALUES (1, 'manual')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS featured_case_study_schedule (
  id                          SERIAL PRIMARY KEY,
  scheduled_for               TIMESTAMP NOT NULL,
  case_study_id               INTEGER REFERENCES case_studies(id) ON DELETE SET NULL,
  generate_for_industry_id    INTEGER REFERENCES industries(id) ON DELETE SET NULL,
  generate_company_name       TEXT,
  status                      TEXT NOT NULL DEFAULT 'pending',
  executed_at                 TIMESTAMP,
  result_case_study_id        INTEGER REFERENCES case_studies(id) ON DELETE SET NULL,
  error_message               TEXT,
  created_by                  TEXT,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS featured_case_study_schedule_pending_idx
  ON featured_case_study_schedule (scheduled_for)
  WHERE status = 'pending';
