import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * API keys for programmatic access. The raw key is only shown once at creation;
 * we store a SHA-256 hash so the value can never be recovered from the DB.
 *
 * Key format: ce_live_<32 random bytes base64url> — 43-char body, 51 total length.
 * The `prefix` column stores the first 12 chars for display in the admin UI
 * ("ce_live_abCd...") without exposing the full secret.
 *
 * Scopes (jsonb string[]): controls which v1 endpoint families a key may call.
 * Recognised values: "read:industries", "read:capabilities", "read:cvi",
 * "read:macro-events", "read:value-chain". A key without a matching scope on
 * a request gets a 403. Defaults to all read scopes for backwards compat with
 * legacy keys minted before the v1 surface existed. "read:cei" is accepted
 * as a backward-compat alias for "read:cvi" by the requireApiKey middleware.
 *
 * rateLimitPerMin (int, nullable): per-key sliding-minute ceiling enforced by
 * the v1 middleware via Redis. Null = use the tier default (1500/min for
 * Console tier, see v1 middleware).
 *
 * monthlyQuota (int, nullable): hard ceiling on requests per UTC calendar
 * month. Null = unlimited (the metering counter still increments). When the
 * counter exceeds quota the v1 middleware returns 429 with reason "quota".
 *
 * monthlyUsageCount + quotaResetAt: rolling counter; reset to 0 on the first
 * request that lands after quotaResetAt has passed. Atomic SQL increment.
 *
 * orgId: optional billing-org association so enterprise customers can audit
 * which keys belong to which org. Null for personal keys.
 */
export const apiKeysTable = pgTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    orgId: text("org_id"),
    label: text("label").notNull(), // human description: "Staging integration", "Python script", etc.
    prefix: text("prefix").notNull(), // e.g. "ce_live_abCd" (first 12 chars)
    hashedKey: text("hashed_key").notNull().unique(), // sha256(rawKey) hex
    scopes: jsonb("scopes").$type<string[]>().notNull().default([
      "read:industries",
      "read:capabilities",
      "read:cvi",
      "read:macro-events",
      "read:value-chain",
    ]),
    rateLimitPerMin: integer("rate_limit_per_min"),
    monthlyQuota: integer("monthly_quota"),
    monthlyUsageCount: integer("monthly_usage_count").notNull().default(0),
    quotaResetAt: timestamp("quota_reset_at"),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    createdBy: text("created_by"), // actor (admin userId) if issued on behalf of user
  },
  (table) => [
    index("api_keys_user_idx").on(table.userId),
    index("api_keys_hash_idx").on(table.hashedKey),
    index("api_keys_org_idx").on(table.orgId),
  ],
);

export type ApiKey = typeof apiKeysTable.$inferSelect;

/**
 * Per-request log of v1 API calls. Append-only, lightweight — used for the
 * /developers usage panel and to drive the audit trail required by the
 * Public Data License contract. Rotated by a background job (out of scope
 * here) to keep the table bounded.
 */
export const apiRequestLogTable = pgTable(
  "api_request_log",
  {
    id: serial("id").primaryKey(),
    keyId: integer("key_id").notNull().references(() => apiKeysTable.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    path: text("path").notNull(),
    statusCode: integer("status_code").notNull(),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("api_req_log_key_idx").on(table.keyId, table.createdAt),
    index("api_req_log_created_idx").on(table.createdAt),
  ],
);

export type ApiRequestLog = typeof apiRequestLogTable.$inferSelect;
