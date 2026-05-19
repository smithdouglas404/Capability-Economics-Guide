import { pgTable, serial, text, timestamp, jsonb, boolean, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Member profiles — the LinkedIn-style identity layer for the marketplace +
 * community. Move 7 of the strategic UX overhaul.
 *
 * One row per Clerk user who opts into a public profile. Slug is the
 * routable URL segment (/member/:slug). Industry + capability tags drive
 * discoverability ("find members who know banking" / "who has experience
 * with Claims Automation").
 *
 * Bio fields intentionally lightweight — this is a marketplace identity,
 * not a full résumé. Anything richer (work history, education) can live
 * on the linked LinkedIn URL.
 */
export const memberProfilesTable = pgTable(
  "member_profiles",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    slug: text("slug").notNull(), // routable URL segment, e.g. "jane-doe" or "ce-7f3a"
    displayName: text("display_name").notNull(),
    headline: text("headline"), // one-line role, e.g. "Capability strategist · ex-Bain"
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    websiteUrl: text("website_url"),
    linkedinUrl: text("linkedin_url"),
    industrySlugs: jsonb("industry_slugs").$type<string[]>().notNull().default([]),
    capabilityTags: jsonb("capability_tags").$type<string[]>().notNull().default([]),
    publicVisibility: boolean("public_visibility").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("member_profiles_user_unique").on(table.userId),
    uniqueIndex("member_profiles_slug_unique").on(table.slug),
    index("member_profiles_industries_idx").on(table.industrySlugs),
  ],
);

/**
 * Direct messages — member-to-member 1:1. `conversationKey` is the
 * deterministic, lexically-sorted pair of user ids (e.g. "user_a:user_b")
 * so queries for "show me my conversation with X" become a single
 * indexed lookup instead of a `(from=A AND to=B) OR (from=B AND to=A)`
 * scan. Computed at the route layer.
 */
export const directMessagesTable = pgTable(
  "direct_messages",
  {
    id: serial("id").primaryKey(),
    conversationKey: text("conversation_key").notNull(),
    fromUserId: text("from_user_id").notNull(),
    toUserId: text("to_user_id").notNull(),
    body: text("body").notNull(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("direct_messages_conversation_idx").on(table.conversationKey, table.createdAt),
    index("direct_messages_to_idx").on(table.toUserId, table.readAt),
  ],
);

export type MemberProfile = typeof memberProfilesTable.$inferSelect;
export type DirectMessage = typeof directMessagesTable.$inferSelect;

/** Compute the deterministic conversation key for any two user ids. */
export function conversationKeyFor(userA: string, userB: string): string {
  return userA < userB ? `${userA}:${userB}` : `${userB}:${userA}`;
}
