import {
  pgTable,
  text,
  serial,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Maps each Dify workflow slug we maintain in `dify-workflows/*.yml` to the
 * live Dify app id it was imported as. Populated by the one-shot import
 * script (`scripts/src/dify-workflow-import.ts`). The TS-side trigger
 * (`services/dify/workflows.ts:resolveAppId`) reads from this so we never
 * hardcode UUIDs that could change if a workflow is re-imported.
 *
 * `versionHash` is the SHA-256 of the YAML at import time; the import
 * script skips re-importing identical versions.
 */
export const difyWorkflowRegistry = pgTable("dify_workflow_registry", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  difyAppId: text("dify_app_id").notNull(),
  versionHash: text("version_hash").notNull(),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
});

/**
 * Audit + idempotency record for every Dify→inflexcvi callback. The HMAC
 * gate (`services/dify/hmac.ts`) verifies the signature, then the route
 * checks this table for a prior `clientRequestId` — if found, the cached
 * `responsePayload` is returned without re-executing the side effect.
 *
 * `status` is `received | succeeded | failed | duplicate`.
 */
export const difyCallbackLog = pgTable(
  "dify_callback_log",
  {
    id: serial("id").primaryKey(),
    endpoint: text("endpoint").notNull(), // e.g. "/api/dify/callback/seed-board"
    clientRequestId: text("client_request_id").notNull(),
    difyWorkflowId: text("dify_workflow_id"),
    difyRunId: text("dify_run_id"),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    requestPayload: jsonb("request_payload"),
    responsePayload: jsonb("response_payload"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    clientRequestIdIdx: uniqueIndex("dify_callback_log_client_request_id_idx").on(
      t.clientRequestId,
    ),
  }),
);

/**
 * Persistent record of every tier recommendation produced by the
 * `tier-selector` Chatflow. Doesn't gate access — the user still picks
 * what they want in the membership UI — but lets us measure recommendation
 * quality (did the user pick what we suggested? did they upgrade later?).
 */
export const tierRecommendationsTable = pgTable("tier_recommendations", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  recommendedTier: text("recommended_tier").notNull(), // "discovery" | "briefing" | "console" | "platform"
  rationale: text("rationale"),
  signals: jsonb("signals"), // qualifying-question answers + any usage features fed into the chatflow
  difyRunId: text("dify_run_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Structured KYC appeal captured by the `kyc-failure-counselor` Chatflow
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
  difyRunId: text("dify_run_id"),
  status: text("status").notNull().default("submitted"), // "submitted" | "under_review" | "resolved"
  reviewerNote: text("reviewer_note"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Records the chosen rescue path from the `payment-recovery` Chatflow.
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
  difyRunId: text("dify_run_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Generic sink for research artifacts produced by the `research-pipeline`
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
  difyRunId: text("dify_run_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
