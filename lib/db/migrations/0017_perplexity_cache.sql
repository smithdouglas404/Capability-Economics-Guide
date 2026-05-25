-- 0017_perplexity_cache.sql
--
-- Creates the perplexity_cache table explicitly via SQL migration instead
-- of relying on drizzle-kit push to materialize it.
--
-- Why this exists — the 2026-05-25 deploy at commit 9ce154c built and
-- ran deploy-migrate Phase 2 (drizzle-kit push --force) successfully on
-- the surface, but the drizzle log shows the push hit an interactive
-- rename prompt about `direct_messages` (asking whether it was a new
-- table or a rename of conversations/messages). --force does NOT bypass
-- the rename prompt — only the destructive-data confirmation. The push
-- sat blocked for ~10s, defaulted into a rename, and may have aborted
-- the remainder of the schema diff. Any table added after that point in
-- drizzle's iteration order (including perplexity_cache from this same
-- commit) silently did not get created. psql confirmed the absence post-
-- deploy.
--
-- Phase 1 SQL migrations run BEFORE drizzle-kit push, so a CREATE TABLE
-- IF NOT EXISTS here guarantees the cache table exists on the next boot
-- regardless of what drizzle decides.
--
-- Mirrors lib/db/src/schema/perplexity-cache.ts. Keep in sync if columns
-- change — drizzle-kit push will reconcile any drift on a healthy run.

CREATE TABLE IF NOT EXISTS perplexity_cache (
  key text PRIMARY KEY,
  model text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT NOW(),
  expires_at timestamp NOT NULL,
  hit_count integer NOT NULL DEFAULT 0,
  last_hit_at timestamp
);

CREATE INDEX IF NOT EXISTS perplexity_cache_expires_at_idx
  ON perplexity_cache (expires_at);
