import { pgTable, text, serial, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Per-user alert subscriptions. Polymorphic via `condition` jsonb so
 * one row can represent any of:
 *   - capability_threshold: { capabilityId, direction: "above"|"below", threshold }
 *   - lifecycle_change:     { capabilityId }
 *   - velocity_signflip:    { capabilityId }
 *   - macro_event:          { industryId?, minSeverity }
 *   - quadrant_transition:  { capabilityId?, industryId? }  (capability-level)
 *
 * Channels: email | slack | webhook (the latter two are Platform-tier only,
 * gated at the route layer).
 *
 * Frequency: realtime (fire on each evaluation) | daily_digest (queued and
 * delivered by the digest job).
 */
export const userSubscriptionsTable = pgTable("user_subscriptions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  targetType: text("target_type", {
    enum: ["capability_threshold", "lifecycle_change", "velocity_signflip", "macro_event", "quadrant_transition"],
  }).notNull(),
  targetId: integer("target_id"),
  condition: jsonb("condition").$type<Record<string, unknown>>().notNull().default({}),
  channel: text("channel", { enum: ["email", "slack", "webhook"] }).notNull().default("email"),
  channelTarget: text("channel_target"),
  frequency: text("frequency", { enum: ["realtime", "daily_digest"] }).notNull().default("realtime"),
  label: text("label"),
  active: integer("active").notNull().default(1),
  lastTriggeredAt: timestamp("last_triggered_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userIdx: index("user_subscriptions_user_idx").on(t.userId),
  typeIdx: index("user_subscriptions_type_idx").on(t.targetType),
}));

/**
 * Log of every notification we've sent or queued. `status="queued"` rows
 * are aggregated by the daily digest job and re-marked `sent` when emailed.
 */
export const notificationDeliveriesTable = pgTable("notification_deliveries", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").notNull().references(() => userSubscriptionsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  channel: text("channel").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status", { enum: ["queued", "sent", "failed", "skipped"] }).notNull().default("queued"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  sentAt: timestamp("sent_at"),
}, (t) => ({
  userIdx: index("notification_deliveries_user_idx").on(t.userId),
  statusIdx: index("notification_deliveries_status_idx").on(t.status),
  subIdx: index("notification_deliveries_sub_idx").on(t.subscriptionId),
}));

export const insertUserSubscriptionSchema = createInsertSchema(userSubscriptionsTable).omit({ id: true, createdAt: true, lastTriggeredAt: true });
export type InsertUserSubscription = z.infer<typeof insertUserSubscriptionSchema>;
export type UserSubscription = typeof userSubscriptionsTable.$inferSelect;

export type NotificationDelivery = typeof notificationDeliveriesTable.$inferSelect;
