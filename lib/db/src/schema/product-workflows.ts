import {
  pgTable,
  text,
  serial,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

// Product-data tables produced by the 14 in-process AI workflows in
// services/workflows/index.ts. Each row stores a real user action or a
// real research artifact — not workflow scaffolding — so the tables stay
// even when the wrappers that populate them are off.

/**
 * Persistent record of every tier recommendation produced by the
 * tier-selector chatflow. Doesn't gate access — the user still picks
 * what they want in the membership UI — but lets us measure recommendation
 * quality (did the user pick what we suggested? did they upgrade later?).
 */
export const tierRecommendationsTable = pgTable("tier_recommendations", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  recommendedTier: text("recommended_tier").notNull(), // "discovery" | "briefing" | "console" | "platform"
  rationale: text("rationale"),
  signals: jsonb("signals"), // qualifying-question answers + any usage features fed into the chatflow
  workflowRunId: text("dify_run_id"), // column kept as `dify_run_id` for backward compat; nullable, no longer populated
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Structured KYC appeal captured by the kyc-failure-counselor chatflow
 * after an AML hit / ID decline / liveness failure. The appeal isn't an
 * automatic override — it's a queue for the compliance reviewer. The
 * existing decline status on `kyc_verifications` stays untouched until a
 * human acts. `status` here is `submitted | under_review | resolved`.
 */
export const kycAppealsTable = pgTable("kyc_appeals", {
  id: serial("id").primaryKey(),
  verificationId: integer("verification_id").notNull(),
  userId: text("user_id").notNull(),
  declineReason: text("decline_reason"),
  structuredAppeal: jsonb("structured_appeal").notNull(),
  workflowRunId: text("dify_run_id"),
  status: text("status").notNull().default("submitted"), // "submitted" | "under_review" | "resolved"
  reviewerNote: text("reviewer_note"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Records the chosen rescue path from the payment-recovery chatflow.
 * Triggered by `invoice.payment_failed` Stripe webhook (in parallel to
 * the existing dunning email). `chosenAction` is one of:
 *   "updated_card" | "switched_method" | "downgraded" | "paused" |
 *   "requested_human" | "abandoned" | "other"
 */
export const paymentRecoveryLog = pgTable("payment_recovery_log", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  subscriptionId: text("subscription_id"),
  failureCode: text("failure_code"),
  chosenAction: text("chosen_action").notNull(),
  actionDetails: jsonb("action_details"),
  workflowRunId: text("dify_run_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Generic sink for research artifacts produced by the research-pipeline
 * workflow (Perplexity → Sonnet synthesis → DB write). The `kind` column
 * distinguishes payload shapes (`quadrant`, `alpha`, `revision_prompts`,
 * etc.) so we don't need a bespoke table per research type. Consumers
 * (e.g. capability-quadrant ingestion) read by `(capabilityId, kind)`.
 */
export const researchArtifactsTable = pgTable("research_artifacts", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id"),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  workflowRunId: text("dify_run_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
