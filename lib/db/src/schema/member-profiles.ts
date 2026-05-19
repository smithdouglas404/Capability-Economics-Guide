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
    headline: text("headline"),
    bio: text("bio"),
    avatarUrl: text("avatar_url"),
    /** Banner / hero image on the profile page. 1584x396 recommended. */
    coverImageUrl: text("cover_image_url"),
    /** Optional location string — "San Francisco, CA" / "Remote". */
    location: text("location"),
    /** Current role line — "VP Product at Acme · ex-Stripe". Distinct from
     *  bio (the long-form story) and headline (the elevator pitch). */
    currentRole: text("current_role"),
    /** Status badges the member wants to advertise: e.g. ["hiring", "consulting",
     *  "investing", "collaborating"]. Limited set; UI maps each to a chip. */
    openTo: jsonb("open_to").$type<string[]>().notNull().default([]),
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
 * Work experience entries — standard résumé timeline shape. Sorted client-side
 * by start_date descending; end_date null means "current role" (the most-recent
 * entry's end_date is the conventional anchor for currentRole / headline).
 */
export const memberExperienceTable = pgTable(
  "member_experience",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    company: text("company").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    employmentType: text("employment_type"), // "full-time" | "contract" | "founder" | "advisor" | "other"
    startDate: text("start_date").notNull(), // ISO date "YYYY-MM"
    endDate: text("end_date"),               // null = current
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("member_experience_user_idx").on(table.userId),
  ],
);

/** Education timeline. Same shape as experience but for schools / programs. */
export const memberEducationTable = pgTable(
  "member_education",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    school: text("school").notNull(),
    degree: text("degree"),
    field: text("field"),
    startYear: integer("start_year"),
    endYear: integer("end_year"),
    activities: text("activities"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("member_education_user_idx").on(table.userId),
  ],
);

/**
 * Self-declared skills. Endorsement count is denormalized for the
 * profile-page render — kept in sync by the endorsement create handler.
 */
export const memberSkillsTable = pgTable(
  "member_skills",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    endorsementCount: integer("endorsement_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("member_skills_user_idx").on(table.userId),
    uniqueIndex("member_skills_user_name_unique").on(table.userId, table.name),
  ],
);

/**
 * Skill endorsements — one row per (skill, endorser). Unique index prevents
 * duplicate endorsements; recreating an endorsement is a no-op (idempotent
 * conflict-do-nothing in the route handler).
 */
export const memberSkillEndorsementsTable = pgTable(
  "member_skill_endorsements",
  {
    id: serial("id").primaryKey(),
    skillId: integer("skill_id").notNull().references(() => memberSkillsTable.id, { onDelete: "cascade" }),
    endorserUserId: text("endorser_user_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("member_skill_endorsements_skill_idx").on(table.skillId),
    uniqueIndex("member_skill_endorsements_unique").on(table.skillId, table.endorserUserId),
  ],
);

/**
 * Member posts — the activity-feed primitive. Plain markdown body, optional
 * link / image, tagged with capabilities or industries for feed routing.
 * Like + comment counts denormalized to skip count(*) on the feed render.
 */
export const memberPostsTable = pgTable(
  "member_posts",
  {
    id: serial("id").primaryKey(),
    authorUserId: text("author_user_id").notNull(),
    body: text("body").notNull(),
    linkUrl: text("link_url"),
    imageUrl: text("image_url"),
    capabilityTags: jsonb("capability_tags").$type<string[]>().notNull().default([]),
    industrySlugs: jsonb("industry_slugs").$type<string[]>().notNull().default([]),
    likeCount: integer("like_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("member_posts_author_idx").on(table.authorUserId, table.createdAt),
    index("member_posts_created_idx").on(table.createdAt),
    index("member_posts_industries_idx").on(table.industrySlugs),
  ],
);

export const memberPostReactionsTable = pgTable(
  "member_post_reactions",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull().references(() => memberPostsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("member_post_reactions_unique").on(table.postId, table.userId),
  ],
);

export const memberPostCommentsTable = pgTable(
  "member_post_comments",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull().references(() => memberPostsTable.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("member_post_comments_post_idx").on(table.postId, table.createdAt),
  ],
);

/**
 * Connections — mutual relationship between two members. Stored once per
 * pair with the canonical `(userA, userB)` ordering enforced at write time
 * (userA < userB lexicographically), so the unique index catches duplicate
 * requests regardless of who initiated. `status` flips from "pending" to
 * "accepted" via the accept handler.
 */
export const memberConnectionsTable = pgTable(
  "member_connections",
  {
    id: serial("id").primaryKey(),
    userA: text("user_a").notNull(),
    userB: text("user_b").notNull(),
    requestedBy: text("requested_by").notNull(), // either userA or userB
    status: text("status").notNull().default("pending"), // "pending" | "accepted"
    createdAt: timestamp("created_at").defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at"),
  },
  (table) => [
    uniqueIndex("member_connections_pair_unique").on(table.userA, table.userB),
    index("member_connections_user_a_idx").on(table.userA),
    index("member_connections_user_b_idx").on(table.userB),
  ],
);

/** Canonical ordering for the (userA, userB) pair so a request from B→A and
 *  a duplicate later from A→B collide on the unique index. */
export function connectionPairFor(userA: string, userB: string): { userA: string; userB: string } {
  return userA < userB ? { userA, userB } : { userA: userB, userB: userA };
}

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
export type MemberExperience = typeof memberExperienceTable.$inferSelect;
export type MemberEducation = typeof memberEducationTable.$inferSelect;
export type MemberSkill = typeof memberSkillsTable.$inferSelect;
export type MemberSkillEndorsement = typeof memberSkillEndorsementsTable.$inferSelect;
export type MemberPost = typeof memberPostsTable.$inferSelect;
export type MemberPostComment = typeof memberPostCommentsTable.$inferSelect;
export type MemberConnection = typeof memberConnectionsTable.$inferSelect;

/** Compute the deterministic conversation key for any two user ids. */
export function conversationKeyFor(userA: string, userB: string): string {
  return userA < userB ? `${userA}:${userB}` : `${userB}:${userA}`;
}
