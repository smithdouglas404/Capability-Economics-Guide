-- Phase 1 migration: defends against drizzle-kit push --force mis-detecting
-- the new marketplace_reviews table as a rename of the existing messages
-- table. Drizzle's heuristic fires on shape similarity (both have id +
-- foreign key + body-ish text + created_at), and --force suppresses the
-- interactive prompt, so without this guard drizzle WILL rename messages
-- → marketplace_reviews and silently destroy the messages table.
--
-- This migration runs BEFORE drizzle-kit push in phase 2 (per deploy-
-- migrate.ts ordering). It:
--
--   1. If marketplace_reviews exists AND has messages-shape columns AND
--      messages does NOT exist → that's the symptom: drizzle previously
--      mis-renamed. Rename it back to messages.
--   2. CREATE TABLE IF NOT EXISTS marketplace_reviews with the proper
--      schema. This satisfies drizzle's "table already exists" check so
--      the rename heuristic doesn't fire.
--
-- After this migration runs in phase 1, drizzle-kit push in phase 2 sees
-- both tables already exist with their proper schemas and does nothing.
-- Re-running is a no-op.

DO $$
DECLARE
  reviews_cols TEXT[];
  has_messages_shape BOOLEAN;
BEGIN
  IF to_regclass('public.marketplace_reviews') IS NOT NULL
     AND to_regclass('public.messages') IS NULL THEN
    -- Inspect marketplace_reviews columns to decide if it's actually the
    -- mis-renamed messages table.
    SELECT array_agg(column_name::TEXT)
      INTO reviews_cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'marketplace_reviews';

    has_messages_shape :=
      'conversation_id' = ANY(reviews_cols) AND
      'role' = ANY(reviews_cols) AND
      'content' = ANY(reviews_cols);

    IF has_messages_shape THEN
      RAISE NOTICE '[0016] marketplace_reviews has messages-shape columns and messages is missing — renaming back';
      ALTER TABLE marketplace_reviews RENAME TO messages;
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS marketplace_reviews (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL REFERENCES marketplace_listings(id) ON DELETE CASCADE,
  buyer_user_id TEXT NOT NULL,
  buyer_display_name TEXT,
  rating INTEGER NOT NULL,
  body TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS marketplace_reviews_listing_idx ON marketplace_reviews (listing_id);
CREATE INDEX IF NOT EXISTS marketplace_reviews_buyer_idx ON marketplace_reviews (buyer_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_reviews_listing_buyer_unique ON marketplace_reviews (listing_id, buyer_user_id);
