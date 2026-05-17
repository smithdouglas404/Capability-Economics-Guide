-- Migration 0003: Convert system_secrets.id from fixed integer default(1) to serial.
--
-- The original schema used id integer DEFAULT 1, which was a singleton pattern
-- that only allowed one row. The foundry_token row requires a second row, so
-- the column must become a proper auto-incrementing serial.
--
-- Safe to run on an existing table:
--   - If the table is empty, it simply changes the column type.
--   - If a row with id=1 already exists (the admin_api_key row), the sequence
--     is seeded at 2 so the next insert gets id=2 without a conflict.

-- Step 1: Create the sequence if it doesn't already exist.
CREATE SEQUENCE IF NOT EXISTS system_secrets_id_seq;

-- Step 2: Attach the sequence to the column and set it as the default.
ALTER TABLE system_secrets
  ALTER COLUMN id SET DEFAULT nextval('system_secrets_id_seq');

-- Step 3: Set the sequence owner so it is dropped with the table.
ALTER SEQUENCE system_secrets_id_seq OWNED BY system_secrets.id;

-- Step 4: Seed the sequence so it starts after the highest existing id.
-- Using COALESCE so it works on an empty table too (seeds at 1).
SELECT setval('system_secrets_id_seq', COALESCE((SELECT MAX(id) FROM system_secrets), 0) + 1, false);
