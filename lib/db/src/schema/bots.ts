import { pgTable, serial, text, integer, timestamp, real, jsonb, boolean, index } from "drizzle-orm/pg-core";

/**
 * Synthetic agent (bot) registry. Each row represents a fully-provisioned
 * synthetic user with linked rows across organizations, kyc_verifications,
 * user_memberships, credit_accounts, billing_organizations, and
 * billing_org_members so the bot looks like a real onboarded customer in
 * every dashboard, query, and aggregation.
 *
 * Bots act server-side via services/bots/loop.ts; they never go through the
 * Clerk login flow. clerkUserId is a synthetic string prefixed `bot_` so
 * any route that gates on clerkUserId works naturally without polluting the
 * real Clerk user pool.
 *
 * Hard budget cap is enforced before every action loop tick: if MTD LLM
 * spend across all active bots would exceed monthlyBudgetUsdCap (default
 * $40/mo system-wide), the loop short-circuits and surfaces a warning in
 * the admin dashboard.
 */
export const botsTable = pgTable(
  "bots",
  {
    id: serial("id").primaryKey(),
    personaKey: text("persona_key").notNull(), // "pe_partner" | "vc_associate" | etc.
    displayName: text("display_name").notNull(),
    email: text("email").notNull(), // always .test TLD so it can never accidentally route
    status: text("status").notNull().default("active"), // "active" | "paused" | "disabled"

    // Linked identity rows. Set once at provisioning, never null after.
    clerkUserId: text("clerk_user_id").notNull().unique(), // synthetic, prefix "bot_"
    organizationId: integer("organization_id").notNull(),
    kycVerificationId: integer("kyc_verification_id").notNull(),
    membershipId: integer("membership_id").notNull(),
    billingOrgId: integer("billing_org_id").notNull(),

    // Address (no first-class address table in the schema — store here).
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    region: text("region"),
    postalCode: text("postal_code"),
    country: text("country"),

    // Profile metadata used in marketplace / comments / assessment attribution.
    bio: text("bio"),
    title: text("title"),
    avatarUrl: text("avatar_url"),

    // Budget guard. Default 40 USD/mo system-wide; per-bot overrides allowed.
    monthlyBudgetUsdCap: real("monthly_budget_usd_cap").notNull().default(40),

    // Mem0 namespace for per-bot long-term memory.
    mem0Namespace: text("mem0_namespace").notNull(),

    // Behavioral biases as structured config (read by the action loop).
    biases: jsonb("biases").$type<Record<string, unknown>>().notNull().default({}),

    lastActedAt: timestamp("last_acted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("bots_persona_idx").on(table.personaKey),
    index("bots_status_idx").on(table.status),
  ],
);

/**
 * Append-only log of every bot-initiated action. One row per browse, comment,
 * assessment, marketplace listing, bid, or reflection. Used by:
 *   (a) the budget guard to compute MTD LLM spend per bot,
 *   (b) the admin observability dashboard to show recent activity,
 *   (c) downstream features that need to filter bot-origin content
 *       (e.g. peer-benchmark composition disclosure).
 */
export const botActionsTable = pgTable(
  "bot_actions",
  {
    id: serial("id").primaryKey(),
    botId: integer("bot_id").notNull().references(() => botsTable.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(), // "browse" | "comment" | "assessment" | "marketplace_list" | "marketplace_bid" | "reflection"
    targetType: text("target_type"), // "capability" | "marketplace_item" | "assessment_session" | "memory"
    targetId: text("target_id"),
    summary: text("summary"), // short human-readable description
    payload: jsonb("payload"), // arbitrary structured data (prompt excerpt, response, etc.)
    costCents: integer("cost_cents").notNull().default(0), // cumulative LLM cost for this action
    succeeded: boolean("succeeded").notNull().default(true),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("bot_actions_bot_idx").on(table.botId),
    index("bot_actions_created_idx").on(table.createdAt),
    index("bot_actions_type_idx").on(table.actionType),
  ],
);

export type Bot = typeof botsTable.$inferSelect;
export type NewBot = typeof botsTable.$inferInsert;
export type BotAction = typeof botActionsTable.$inferSelect;
