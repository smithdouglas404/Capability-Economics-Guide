import { pgTable, text, serial, integer, real, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * KYC levels by tier:
 *   discovery  → "email"       (email OTP only)
 *   briefing   → "identity"    (email OTP + ID document)
 *   workbench  → "biometric"   (email OTP + ID document + passive liveness)
 *   platform   → "full"        (email OTP + ID document + passive liveness + AML screening)
 */
export const KYC_LEVELS_BY_TIER: Record<string, string> = {
  discovery: "email",
  briefing: "identity",
  workbench: "biometric",
  platform: "full",
};

export const kycVerificationsTable = pgTable("kyc_verifications", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  userEmail: text("user_email"),
  kycLevel: text("kyc_level").notNull(), // "email" | "identity" | "biometric" | "full"
  tierSlug: text("tier_slug").notNull(), // tier that triggered this verification

  // Overall status
  status: text("status").notNull().default("pending"), // "pending" | "approved" | "declined" | "expired"

  // Step 1: Email OTP
  emailVerified: text("email_verified"), // "verified" | "failed" | null (not attempted)
  emailRequestId: text("email_request_id"),

  // Step 2: ID Document (briefing+)
  idSessionToken: text("id_session_token"), // Didit session token for ID verification
  idRequestId: text("id_request_id"),
  idVerificationUrl: text("id_verification_url"),
  idStatus: text("id_status"), // "Approved" | "Declined" | "Pending" | null
  firstName: text("first_name"),
  lastName: text("last_name"),
  dateOfBirth: text("date_of_birth"),
  documentType: text("document_type"),
  documentNumber: text("document_number"),
  nationality: text("nationality"),
  idWorkflowResults: jsonb("id_workflow_results"),

  // Step 3: Passive Liveness (workbench+)
  livenessStatus: text("liveness_status"), // "Approved" | "Declined" | null
  livenessScore: real("liveness_score"),
  livenessRequestId: text("liveness_request_id"),

  // Step 4: AML Screening (platform only)
  amlStatus: text("aml_status"), // "Clear" | "Hit" | null
  amlScore: real("aml_score"),
  amlHits: integer("aml_hits"),
  amlDetails: jsonb("aml_details").$type<Array<{ type: string; name: string; matchScore: number }>>(),
  amlRequestId: text("aml_request_id"),

  declineReasons: jsonb("decline_reasons").$type<string[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type KycVerification = typeof kycVerificationsTable.$inferSelect;
