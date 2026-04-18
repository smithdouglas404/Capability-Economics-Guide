import { pgTable, text, serial, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const kycVerificationsTable = pgTable("kyc_verifications", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  userEmail: text("user_email"),
  sessionToken: text("session_token"), // Didit session token
  requestId: text("request_id"), // Didit request ID
  verificationUrl: text("verification_url"), // URL to redirect user
  workflowId: text("workflow_id").notNull(),
  status: text("status").notNull().default("pending"), // "pending" | "approved" | "declined" | "expired"
  firstName: text("first_name"),
  lastName: text("last_name"),
  dateOfBirth: text("date_of_birth"),
  documentType: text("document_type"),
  nationality: text("nationality"),
  amlStatus: text("aml_status"), // "clear" | "hit" | null
  amlHits: integer("aml_hits"),
  workflowResults: jsonb("workflow_results"),
  declineReasons: jsonb("decline_reasons").$type<string[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type KycVerification = typeof kycVerificationsTable.$inferSelect;
