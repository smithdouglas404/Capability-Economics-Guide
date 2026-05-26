-- 0020_agent_tuning_cvi_episode_throttle.sql
--
-- Adds the cvi_episode_min_interval_minutes column to agent_tuning so the
-- platform-CVI :Episodic write cadence is an operator-tunable runtime knob
-- (PATCH /api/admin/tunables/system) instead of a hardcoded constant.
--
-- Why a hand-written SQL migration: the schema change is a simple ADD
-- COLUMN with NOT NULL DEFAULT, which drizzle-kit push --force *should*
-- pick up automatically — but on the 2026-05-26 04:37 prod deploy it
-- did not (the api-server immediately 500'd on "select ... cvi_episode_
-- min_interval_minutes ... from agent_tuning"). Adding the column here
-- in phase 1 of deploy-migrate makes the next deploy unblock saveTuning
-- regardless of what drizzle-kit decides to do.
--
-- Idempotent — uses IF NOT EXISTS so re-runs of phase 1 are no-ops.

ALTER TABLE agent_tuning
  ADD COLUMN IF NOT EXISTS cvi_episode_min_interval_minutes integer NOT NULL DEFAULT 10;
