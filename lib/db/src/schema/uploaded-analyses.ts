import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";

/**
 * Uploaded-analyses table — Move 6 of the strategic UX overhaul.
 *
 * Stores the result of "drag your business plan / pitch deck / PDF here and
 * we'll extract the capability claims and tell you how they line up against
 * the live capability graph." Each row is one upload run by one user.
 *
 * What gets stored:
 *   - `extractedText` — the parsed PDF/docx text (capped at first ~50K chars)
 *   - `claims` — the structured CapabilityClaim[] from the LLM extraction step
 *   - `report` — the matched-and-enriched output (each claim joined to our
 *     catalog with current CVI/DVX/quadrant + a markdown summary)
 *
 * Why a table (not just a one-shot endpoint): the user can revisit their
 * past analyses, share a link to a specific run, and download the report
 * later through the standard Export menu. Also lets us cap free-tier
 * uploads-per-month.
 */
export const uploadedAnalysesTable = pgTable(
  "uploaded_analyses",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    filename: text("filename").notNull(),
    fileType: text("file_type").notNull(), // "pdf" | "docx" | "txt" | "paste"
    fileSizeBytes: integer("file_size_bytes"),
    extractedText: text("extracted_text"),
    claims: jsonb("claims").$type<unknown[]>().default([]),
    report: jsonb("report").$type<unknown>(),
    status: text("status").notNull().default("pending"), // "pending" | "extracting" | "matching" | "complete" | "failed"
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("uploaded_analyses_user_idx").on(table.userId),
    index("uploaded_analyses_created_idx").on(table.createdAt),
  ],
);

export type UploadedAnalysis = typeof uploadedAnalysesTable.$inferSelect;
