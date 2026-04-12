import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const capabilityAssessmentsTable = pgTable("capability_assessments", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().unique(),
  companyName: text("company_name"),
  industry: text("industry"),
  opportunity: text("opportunity"),
  voiceTranscript: text("voice_transcript"),
  documentText: text("document_text"),
  clarifyingQuestions: jsonb("clarifying_questions").$type<string[]>(),
  clarifyingAnswers: jsonb("clarifying_answers").$type<string[]>(),
  analysisResult: jsonb("analysis_result"),
  secData: jsonb("sec_data"),
  confidenceScore: integer("confidence_score"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
