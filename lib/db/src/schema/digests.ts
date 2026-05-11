import { pgTable, serial, text, timestamp, boolean, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Weekly capability-disruption digest subscriptions.
 *
 * One row per Clerk user who has opted into the digest. Channels and
 * delivery target are stored per-row so a user can route to either email
 * (using Clerk's primary email) or to a Slack incoming-webhook URL.
 *
 * Segments narrow what's in the digest: when industryIds or capabilityIds
 * are populated, only disruption-watch entries and net-new capabilities
 * inside that filter are included. Empty arrays = no filter (all industries).
 *
 * lastSentAt is updated after a successful delivery; the cron walks rows
 * where (active = true) AND (lastSentAt < now - 7d) on its weekly tick.
 */
export const digestSubscriptionsTable = pgTable(
  "digest_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull().unique(),
    active: boolean("active").notNull().default(true),
    /** "email" | "slack" — the digest fires once per (user, channel) per period. */
    channel: text("channel").notNull().default("email"),
    /** When channel = "slack", a user-supplied incoming webhook URL. */
    slackWebhookUrl: text("slack_webhook_url"),
    /** When channel = "email", an override address (falls back to Clerk primary). */
    emailOverride: text("email_override"),
    /** "weekly" | "daily" — daily is gated to admin/preview today. */
    frequency: text("frequency").notNull().default("weekly"),
    industryIds: jsonb("industry_ids").$type<number[]>().notNull().default([]),
    capabilityIds: jsonb("capability_ids").$type<number[]>().notNull().default([]),
    lastSentAt: timestamp("last_sent_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("digest_subs_active_idx").on(t.active),
    index("digest_subs_last_sent_idx").on(t.lastSentAt),
  ],
);

export type DigestSubscription = typeof digestSubscriptionsTable.$inferSelect;
