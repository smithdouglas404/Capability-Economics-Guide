import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { industriesTable } from "./industries";
import { capabilitiesTable } from "./capabilities";

/**
 * Industry / capability discussion forums — Move 8 of the strategic UX
 * overhaul. Two tables, one per-industry shaped: threads (the OPs) and
 * posts (the replies). Threads can optionally be scoped to a specific
 * capability for narrower conversations.
 *
 * Moderation primitives we ship now: lockedAt (no more replies) and the
 * author tied to a real user id. Anything richer (pinning, soft-delete,
 * karma) is a follow-up.
 *
 * `postCount` and `lastPostAt` are denormalized for the threads-list view
 * — kept in sync via the route handler that creates a post. Cheaper than
 * a count(*) per render given threads can have many replies.
 */
export const forumThreadsTable = pgTable(
  "forum_threads",
  {
    id: serial("id").primaryKey(),
    industryId: integer("industry_id").notNull().references(() => industriesTable.id, { onDelete: "cascade" }),
    capabilityId: integer("capability_id").references(() => capabilitiesTable.id, { onDelete: "set null" }),
    authorUserId: text("author_user_id").notNull(),
    authorDisplayName: text("author_display_name"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    lockedAt: timestamp("locked_at"),
    postCount: integer("post_count").notNull().default(0),
    lastPostAt: timestamp("last_post_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("forum_threads_industry_idx").on(table.industryId, table.lastPostAt),
    index("forum_threads_capability_idx").on(table.capabilityId),
    index("forum_threads_author_idx").on(table.authorUserId),
  ],
);

export const forumPostsTable = pgTable(
  "forum_posts",
  {
    id: serial("id").primaryKey(),
    threadId: integer("thread_id").notNull().references(() => forumThreadsTable.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").notNull(),
    authorDisplayName: text("author_display_name"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("forum_posts_thread_idx").on(table.threadId, table.createdAt),
    index("forum_posts_author_idx").on(table.authorUserId),
  ],
);

export type ForumThread = typeof forumThreadsTable.$inferSelect;
export type ForumPost = typeof forumPostsTable.$inferSelect;
