import { pgTable, serial, text, timestamp, jsonb, integer, doublePrecision, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * user_interaction_log — every page visit, AI action, and user action gets
 * logged here so the AI can reference past behavior across sessions.
 *
 * Each row is an atomic event. The `metadata` jsonb holds context-specific
 * fields (e.g. { industryId, capabilityId, persona } for page views,
 * { briefEndpoint, responseLength } for AI streams).
 *
 * Queried by userId + type, ordered by createdAt DESC — index supports both.
 */
export const userInteractionLogTable = pgTable(
  "user_interaction_log",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    /**
     * Event type taxonomy:
     * - "page_view"      — visited a page (metadata: path, title)
     * - "ai_stream"      — generated an AI brief (metadata: endpoint, prompt_length, response_length)
     * - "ai_feedback"    — rated an AI output (metadata: liked, log_id)
     * - "search"         — searched capabilities/industries (metadata: query, result_count)
     * - "industry_select" — picked an industry (metadata: industry_id, industry_name)
     * - "capability_view" — viewed a capability detail (metadata: capability_id, capability_name)
     * - "persona_change"  — changed persona (metadata: from, to)
     * - "export"         — exported data (metadata: format, content_type)
     * - "upload"         — uploaded a document (metadata: filename, file_type, size_bytes)
     */
    type: text("type").notNull(),
    /** Short description visible in the learning timeline UI. */
    label: text("label").notNull(),
    /** Arbitrary context payload — shape depends on event type. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("interaction_log_user_type_idx").on(table.userId, table.type, table.createdAt),
    index("interaction_log_user_created_idx").on(table.userId, table.createdAt),
  ],
);

/**
 * user_learning_profiles — server-side learning vector that replaces the
 * static localStorage-only persona system. One row per user, upserted.
 *
 * Stored on every meaningful interaction: page visit, AI brief generated,
 * industry/capability search, persona change. The AI reads this at the
 * start of every streaming generation to tailor its output.
 *
 * `inferredInterests` is computed server-side by analyzing the interaction
 * log: which industries and capabilities the user views most, which persona
 * they use most frequently, etc.
 *
 * `vector` is a dense embedding (2048 floats) of the user's full interaction
 * history — computed weekly, used for content recommendation.
 */
export const userLearningProfilesTable = pgTable(
  "user_learning_profiles",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** The user's current persona selection — synced from localStorage on login. */
    persona: text("persona").$type<"pe" | "vc" | "f500" | "student" | "professor" | null>(),
    /** Industries the user has shown interest in, ranked by frequency. */
    topIndustries: jsonb("top_industries").$type<Array<{ slug: string; name: string; count: number }>>().notNull().default([]),
    /** Capabilities the user has explored, ranked by frequency. */
    topCapabilities: jsonb("top_capabilities").$type<Array<{ id: number; name: string; count: number }>>().notNull().default([]),
    /** Topics the user engages with most. */
    topTopics: jsonb("top_topics").$type<Array<{ topic: string; count: number }>>().notNull().default([]),
    /** Total number of AI briefs generated. */
    totalAiGenerations: integer("total_ai_generations").notNull().default(0),
    /** Total pages visited. */
    totalPageViews: integer("total_page_views").notNull().default(0),
    /** Last visit timestamp — used for returning-user greeting. */
    lastVisitedAt: timestamp("last_visited_at"),
    /** Whether the user has completed onboarding. */
    onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
    /** Dense embedding vector for content recommendation (2048 floats). Null until first scheduled compute. */
    vector: doublePrecision("vector").array().$type<number[]>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("user_learning_profiles_user_unique").on(table.userId),
  ],
);

/**
 * ai_feedback — thumbs up/down on streaming AI outputs.
 * One row per feedback submission (user + log_id = unique).
 * Used by the recommendation-feedback loop (see self-learning doc) to
 * reward/penalize generation strategies that produce good/bad output.
 */
export const aiFeedbackTable = pgTable(
  "ai_feedback",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** FK into user_interaction_log — which AI generation this feedback targets. */
    interactionLogId: integer("interaction_log_id").notNull(),
    liked: boolean("liked").notNull(),
    /** Optional short comment explaining the rating. */
    comment: text("comment"),
    /** Which endpoint generated the output (e.g. "/api/insights/stream"). */
    endpoint: text("endpoint"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("ai_feedback_user_idx").on(table.userId, table.createdAt),
    uniqueIndex("ai_feedback_interaction_unique").on(table.userId, table.interactionLogId),
  ],
);

export type UserInteractionLog = typeof userInteractionLogTable.$inferSelect;
export type UserLearningProfile = typeof userLearningProfilesTable.$inferSelect;
export type AiFeedback = typeof aiFeedbackTable.$inferSelect;
