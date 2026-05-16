import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * User-uploaded business cases (PDF / DOCX / TXT). The agent extracts the
 * capabilities the case relies on, fuzzy-maps them against the
 * capabilities table, looks up current CVI + DVX scores, and produces a
 * red-team report (weaknesses / wedges / recommendations).
 *
 * Lifecycle: uploaded → parsing → analyzing → complete | failed.
 * Stored extractedText is capped at ~50KB to bound Sonnet input cost.
 */
export const businessCasesTable = pgTable(
  "business_cases",
  {
    id: serial("id").primaryKey(),
    /** Clerk userId of the uploader. */
    userId: text("user_id").notNull(),
    /** Optional org context (uploader's billing org id). */
    orgId: integer("org_id"),
    title: text("title").notNull(),
    sourceFilename: text("source_filename").notNull(),
    /** Storage path (Railway volume / S3 key). Optional for paste-as-text. */
    sourceFileKey: text("source_file_key"),
    /** Cleaned plaintext extracted from the uploaded file (capped 50KB). */
    extractedText: text("extracted_text"),
    /** [{name, mappedCapabilityId?, confidence}]. Populated by analyzer step 1. */
    extractedCapabilities: jsonb("extracted_capabilities").$type<Array<{
      name: string;
      description?: string;
      criticality?: "low" | "medium" | "high";
      mappedCapabilityId?: number;
      mappingConfidence?: number;
    }>>(),
    /** Full structured red-team output. */
    analysisJson: jsonb("analysis_json").$type<{
      weaknesses: Array<{ capabilityName: string; mappedCapabilityId?: number; cviScore?: number; dvxScore?: number; concern: string }>;
      wedges: Array<{ capabilityName: string; mappedCapabilityId?: number; cviScore?: number; advantage: string }>;
      recommendations: Array<{ action: string; rationale: string; priority: "immediate" | "near" | "watch" }>;
      summary?: string;
    }>(),
    status: text("status").notNull().default("uploaded"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("business_cases_user_idx").on(table.userId),
    index("business_cases_status_idx").on(table.status),
  ],
);

export type BusinessCase = typeof businessCasesTable.$inferSelect;
export type NewBusinessCase = typeof businessCasesTable.$inferInsert;
