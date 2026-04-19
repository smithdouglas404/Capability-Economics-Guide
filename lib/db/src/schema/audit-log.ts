import { pgTable, serial, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Append-only log of admin actions. Every mutation triggered from the admin
 * dashboard should insert a row here so there's an auditable trail independent
 * of the notes field on individual records.
 *
 * Targets are loosely-typed (targetType + targetId) so we can log across many
 * entity types (membership, credit_account, user, tier, api_key, etc.) without
 * schema churn when new capabilities land.
 */
export const adminAuditLogTable = pgTable(
  "admin_audit_log",
  {
    id: serial("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull(),
    actorEmail: text("actor_email"),
    action: text("action").notNull(), // e.g. "membership.approve", "membership.change_tier", "credits.grant"
    targetType: text("target_type"),  // e.g. "membership", "user", "credit_account"
    targetId: text("target_id"),       // stringified — numeric ids and clerk userIds both fit
    details: jsonb("details"),         // structured payload: { from: ..., to: ..., reason: ... }
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_actor_idx").on(table.actorUserId),
    index("audit_target_idx").on(table.targetType, table.targetId),
    index("audit_created_idx").on(table.createdAt),
  ],
);

export const insertAdminAuditLogSchema = createInsertSchema(adminAuditLogTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAdminAuditLog = z.infer<typeof insertAdminAuditLogSchema>;
export type AdminAuditLog = typeof adminAuditLogTable.$inferSelect;
