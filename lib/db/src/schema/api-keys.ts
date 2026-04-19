import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * API keys for programmatic access. The raw key is only shown once at creation;
 * we store a SHA-256 hash so the value can never be recovered from the DB.
 *
 * Key format: ce_live_<32 random bytes base64url> — 43-char body, 51 total length.
 * The `prefix` column stores the first 12 chars for display in the admin UI
 * ("ce_live_abCd...") without exposing the full secret.
 */
export const apiKeysTable = pgTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    label: text("label").notNull(), // human description: "Staging integration", "Python script", etc.
    prefix: text("prefix").notNull(), // e.g. "ce_live_abCd" (first 12 chars)
    hashedKey: text("hashed_key").notNull().unique(), // sha256(rawKey) hex
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdBy: text("created_by"), // actor (admin userId) if issued on behalf of user
  },
  (table) => [
    index("api_keys_user_idx").on(table.userId),
    index("api_keys_hash_idx").on(table.hashedKey),
  ],
);

export type ApiKey = typeof apiKeysTable.$inferSelect;
