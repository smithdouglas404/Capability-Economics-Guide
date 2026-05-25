-- 0018_recover_messages_and_create_direct_messages.sql
--
-- Defends against drizzle-kit push --force mis-detecting the new
-- direct_messages table as a rename of the existing `messages` table.
--
-- The 2026-05-25 deploy at commit 9ce154c triggered this interactive
-- prompt at 11:58:15:
--
--   Is direct_messages table created or renamed from another table?
--   ❯ + direct_messages                 create table
--     ~ conversations › direct_messages rename table
--     ~ messages › direct_messages      rename table   ← defaulted here
--   [deploy-migrate] schema push complete in 16634ms
--
-- --force bypasses the destructive-data confirmation but NOT the rename
-- prompt. After ~10s without input drizzle defaulted into the messages
-- → direct_messages rename, which is wrong: direct_messages is a
-- BRAND-NEW table for member-to-member 1:1 messaging (defined in
-- lib/db/src/schema/member-profiles.ts), not a rename of the chat
-- `messages` table (lib/db/src/schema/messages.ts, role/content rows
-- tied to a `conversations` row).
--
-- The two schemas are shape-disjoint enough that a column inspection
-- can tell us whether the table in prod is the real direct_messages or
-- the mis-renamed messages:
--
--   real direct_messages:  conversation_key (text), from_user_id,
--                          to_user_id, body, read_at, created_at
--   mis-renamed messages:  conversation_id (int), role, content, created_at
--
-- Recovery logic, runs in Phase 1 before drizzle-kit push:
--   1. If `direct_messages` exists AND has `role`/`content` columns AND
--      `messages` does NOT exist → that's the symptom. Rename it back.
--   2. CREATE TABLE IF NOT EXISTS direct_messages with the proper shape
--      so drizzle's heuristic stops firing on subsequent pushes.
--   3. CREATE TABLE IF NOT EXISTS messages with the proper shape, since
--      the rename-back may not have happened (e.g. a fresh DB) and
--      drizzle may have skipped the rest of its diff after the prompt.
--
-- After this migration runs once, both tables exist with their proper
-- shapes; drizzle-push in Phase 2 sees no diff and no longer prompts.
-- CREATE TABLE IF NOT EXISTS keeps the whole file idempotent.

DO $$
DECLARE
  dm_cols TEXT[];
  has_messages_shape BOOLEAN;
BEGIN
  IF to_regclass('public.direct_messages') IS NOT NULL
     AND to_regclass('public.messages') IS NULL THEN
    -- Inspect direct_messages columns to decide if it's actually the
    -- mis-renamed messages table.
    SELECT array_agg(column_name::TEXT)
      INTO dm_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'direct_messages';

    has_messages_shape :=
      'role' = ANY(dm_cols) AND
      'content' = ANY(dm_cols) AND
      'conversation_id' = ANY(dm_cols);

    IF has_messages_shape THEN
      RAISE NOTICE '[0018] direct_messages has messages-shape columns and messages is missing — renaming back';
      ALTER TABLE direct_messages RENAME TO messages;
    END IF;
  END IF;
END $$;

-- Ensure the conversations table exists (FK target for messages).
CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure the messages table exists with its proper shape. If the
-- recovery rename above ran, this is a no-op; if direct_messages was
-- the real thing (so the rename-back didn't fire), this creates the
-- messages table from scratch.
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create direct_messages with its proper shape. This satisfies
-- drizzle's "table already exists" check, so the rename heuristic
-- stops firing on subsequent pushes.
CREATE TABLE IF NOT EXISTS direct_messages (
  id SERIAL PRIMARY KEY,
  conversation_key TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS direct_messages_conversation_idx
  ON direct_messages (conversation_key, created_at);
CREATE INDEX IF NOT EXISTS direct_messages_to_idx
  ON direct_messages (to_user_id, read_at);
