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
 * Long-form peer recommendations — distinct from skill endorsements (a count).
 * One row per (giver, receiver) pair; rewriting upserts onto the same row.
 */
export const memberRecommendationsTable = pgTable(
  "member_recommendations",
  {
    id: serial("id").primaryKey(),
    giverUserId: text("giver_user_id").notNull(),
    receiverUserId: text("receiver_user_id").notNull(),
    /** "worked-together" | "managed-them" | "managed-by-them" | "client" | "advisor" | "other" */
    relationship: text("relationship"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("member_recommendations_receiver_idx").on(table.receiverUserId),
    uniqueIndex("member_recommendations_pair_unique").on(table.giverUserId, table.receiverUserId),
  ],
);

/**
 * In-app notifications — written by the various handlers (connection
 * accept, post like, comment, mention, recommendation received).
 * Read state per-recipient; bulk mark-read in the route handler.
 */
export const memberNotificationsTable = pgTable(
  "member_notifications",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(), // recipient
    /** "connection_request" | "connection_accepted" | "post_like" | "post_comment"
     *  | "post_share" | "mention" | "recommendation" | "skill_endorsement" */
    type: text("type").notNull(),
    actorUserId: text("actor_user_id"),
    targetType: text("target_type"), // "post" | "profile" | "skill" | "comment"
    targetId: integer("target_id"),
    body: text("body").notNull(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("member_notifications_user_idx").on(table.userId, table.readAt, table.createdAt),
  ],
);

/**
 * Profile views — track who looked at whom. Deduped to one row per
 * (viewer, viewed) per UTC day so the count doesn't explode on refresh.
 * Recipient sees an aggregate; viewer identity exposed when both are
 * connected (otherwise anonymized in the API response).
 */
export const profileViewsTable = pgTable(
  "profile_views",
  {
    id: serial("id").primaryKey(),
    viewerUserId: text("viewer_user_id").notNull(),
    viewedUserId: text("viewed_user_id").notNull(),
    viewedDate: text("viewed_date").notNull(), // "YYYY-MM-DD" — dedupe key
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("profile_views_dedupe").on(table.viewerUserId, table.viewedUserId, table.viewedDate),
    index("profile_views_viewed_idx").on(table.viewedUserId, table.createdAt),
  ],
);

/** Saved / bookmarked posts. One row per (user, post). */
export const memberSavedPostsTable = pgTable(
  "member_saved_posts",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    postId: integer("post_id").notNull().references(() => memberPostsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("member_saved_posts_unique").on(table.userId, table.postId),
    index("member_saved_posts_user_idx").on(table.userId, table.createdAt),
  ],
);

/**
 * Reposts / shares — one row per (sharer, post) so duplicates collide.
 * Optional sharer commentary turns it into a quote-repost.
 */
export const memberPostSharesTable = pgTable(
  "member_post_shares",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull().references(() => memberPostsTable.id, { onDelete: "cascade" }),
    sharerUserId: text("sharer_user_id").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("member_post_shares_unique").on(table.postId, table.sharerUserId),
    index("member_post_shares_sharer_idx").on(table.sharerUserId, table.createdAt),
  ],
);

export type MemberRecommendation = typeof memberRecommendationsTable.$inferSelect;
export type MemberNotification = typeof memberNotificationsTable.$inferSelect;
export type ProfileView = typeof profileViewsTable.$inferSelect;
export type MemberSavedPost = typeof memberSavedPostsTable.$inferSelect;
export type MemberPostShare = typeof memberPostSharesTable.$inferSelect;

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
