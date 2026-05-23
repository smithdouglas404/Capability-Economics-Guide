import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const platformSignupRequestsTable = pgTable(
  "platform_signup_requests",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    organization: text("organization").notNull(),
    message: text("message"),
    status: text("status").notNull().default("pending"), // "pending" | "approved" | "rejected"
    inviteToken: text("invite_token").unique(),
    inviteTokenExpiresAt: timestamp("invite_token_expires_at"),
    rejectionReason: text("rejection_reason"),
    requestedAt: timestamp("requested_at").defaultNow().notNull(),
    decidedAt: timestamp("decided_at"),
    decidedBy: text("decided_by"),
    completedSignupAt: timestamp("completed_signup_at"),
    completedSignupUserId: text("completed_signup_user_id"),
  },
  (t) => ({
    statusIdx: index("platform_signup_requests_status_idx").on(t.status),
    emailIdx: index("platform_signup_requests_email_idx").on(t.email),
  }),
);

export const insertPlatformSignupRequestSchema = createInsertSchema(platformSignupRequestsTable).omit({
  id: true,
  status: true,
  inviteToken: true,
  inviteTokenExpiresAt: true,
  rejectionReason: true,
  requestedAt: true,
  decidedAt: true,
  decidedBy: true,
  completedSignupAt: true,
  completedSignupUserId: true,
});
export type InsertPlatformSignupRequest = z.infer<typeof insertPlatformSignupRequestSchema>;
export type PlatformSignupRequest = typeof platformSignupRequestsTable.$inferSelect;
