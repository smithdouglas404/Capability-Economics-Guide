import { pgTable, integer, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Server-side managed secrets that admins can rotate without a Railway env-var
 * change. Currently houses the ADMIN_API_KEY (replacing the
 * env-var-as-only-source pattern).
 *
 * One row per key; the singleton row is keyed by `keyName`. The `auditLog`
 * jsonb keeps a tamper-evident history of every rotation event — ready to
 * pipe to a blockchain audit trail when that infra lands.
 */
export const systemSecretsTable = pgTable("system_secrets", {
  id: integer("id").primaryKey().default(1),
  keyName: text("key_name").notNull().unique(),
  keyValue: text("key_value").notNull(),
  rotatedAt: timestamp("rotated_at").defaultNow().notNull(),
  rotatedByUserId: text("rotated_by_user_id"), // Clerk userId of the admin who rotated, or "bootstrap" / "auto"
  auditLog: jsonb("audit_log").$type<Array<{
    rotatedAt: string;
    rotatedByUserId: string | null;
    source: "bootstrap" | "manual_admin_ui" | "scheduled_auto" | "api_call";
    reason: string | null;
    // Hash of the previous value (sha256 hex). Not the value itself.
    previousValueHash: string | null;
  }>>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type SystemSecret = typeof systemSecretsTable.$inferSelect;
export type NewSystemSecret = typeof systemSecretsTable.$inferInsert;
