import { pgTable, serial, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { capabilitiesTable } from "./capabilities";

/**
 * Capability Workbench (Kanban) — the ideation engine surface.
 *
 * Three tables:
 *  - workbench_boards: a kanban board owned by a Clerk user, optionally
 *    promoted to a Clerk org for team-shared access.
 *  - workbench_cards: capability cards within a board, positioned by lane +
 *    position index.
 *  - workbench_card_insights: persisted Claude outputs per card so refresh
 *    doesn't re-bill. Keyed by (cardId, cacheKey) — cacheKey is content-derived
 *    (kind + capability + userPrompt + target).
 *
 * Lanes follow the Double Diamond: scan → frame → ideate → validate → launch.
 * Lane is stored as text rather than enum so the UI can introduce new lanes
 * without a schema migration.
 *
 * Access gating happens at the route layer via services/org-access.ts —
 * the board has clerkUserId (always set on creation) and optionally
 * clerkOrgId (set on share). Reads gate on (clerkUserId = me) OR
 * (clerkOrgId IN myClerkOrgs).
 */
export const workbenchBoardsTable = pgTable(
  "workbench_boards",
  {
    id: serial("id").primaryKey(),
    clerkUserId: text("clerk_user_id").notNull(),
    clerkOrgId: text("clerk_org_id"),
    name: text("name").notNull(),
    description: text("description"),
    // Optional: pin a board so it appears at the top of the user's list.
    pinned: text("pinned"), // ISO date when pinned; null = not pinned
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("workbench_boards_user_idx").on(table.clerkUserId),
    index("workbench_boards_org_idx").on(table.clerkOrgId),
  ],
);

export const workbenchCardsTable = pgTable(
  "workbench_cards",
  {
    id: serial("id").primaryKey(),
    boardId: integer("board_id").notNull().references(() => workbenchBoardsTable.id, { onDelete: "cascade" }),
    capabilityId: integer("capability_id").notNull().references(() => capabilitiesTable.id, { onDelete: "cascade" }),
    lane: text("lane").notNull().default("scan"), // scan | frame | ideate | validate | launch
    position: integer("position").notNull().default(0),
    notes: text("notes"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("workbench_cards_board_idx").on(table.boardId),
    index("workbench_cards_lane_idx").on(table.lane),
    uniqueIndex("workbench_cards_board_cap_unique").on(table.boardId, table.capabilityId),
  ],
);

export const workbenchCardInsightsTable = pgTable(
  "workbench_card_insights",
  {
    id: serial("id").primaryKey(),
    cardId: integer("card_id").notNull().references(() => workbenchCardsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // generate_applications | find_analogues | critique_idea | what_to_invent | lifecycle_outlook
    cacheKey: text("cache_key").notNull(),
    body: text("body").notNull(),
    bullets: jsonb("bullets").$type<string[]>().notNull().default([]),
    modelUsed: text("model_used"),
    fallbackCount: integer("fallback_count").notNull().default(0),
    userPrompt: text("user_prompt"),
    targetIndustryName: text("target_industry_name"),
    targetMarketDescription: text("target_market_description"),
    generatedBy: text("generated_by").notNull(),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
  },
  (table) => [
    index("workbench_insights_card_idx").on(table.cardId),
    index("workbench_insights_kind_idx").on(table.kind),
    uniqueIndex("workbench_insights_card_cachekey_unique").on(table.cardId, table.cacheKey),
  ],
);

export type WorkbenchBoard = typeof workbenchBoardsTable.$inferSelect;
export type WorkbenchCard = typeof workbenchCardsTable.$inferSelect;
export type WorkbenchCardInsight = typeof workbenchCardInsightsTable.$inferSelect;
