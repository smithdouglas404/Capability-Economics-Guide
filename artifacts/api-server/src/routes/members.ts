/**
 * Members + DMs — Move 7 of the strategic UX overhaul.
 *
 *   GET    /api/me/profile          — current user's profile (creates default on first read)
 *   PATCH  /api/me/profile          — edit fields
 *   GET    /api/member/:slug        — public profile fetch
 *   GET    /api/members/search?q=   — name / headline / capability-tag fuzzy search
 *   POST   /api/messages            — send a DM
 *   GET    /api/messages/conversations — conversation list w/ last-msg preview + unread count
 *   GET    /api/messages/with/:userId — full thread w/ another user
 *   PATCH  /api/messages/mark-read/:userId — bulk mark messages from :userId as read
 */
import { Router, type IRouter } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, memberProfilesTable, directMessagesTable, conversationKeyFor } from "@workspace/db";
import { eq, and, or, ilike, desc, sql, isNull } from "drizzle-orm";

const router: IRouter = Router();

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "member";
}

async function ensureProfile(userId: string): Promise<typeof memberProfilesTable.$inferSelect> {
  const [existing] = await db.select().from(memberProfilesTable).where(eq(memberProfilesTable.userId, userId)).limit(1);
  if (existing) return existing;
  // Build default from Clerk user record.
  let displayName = "Member";
  let avatarUrl: string | null = null;
  try {
    const user = await clerkClient.users.getUser(userId);
    const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    displayName = full || user.username || user.primaryEmailAddress?.emailAddress?.split("@")[0] || "Member";
    avatarUrl = user.imageUrl ?? null;
  } catch { /* graceful */ }
  // Slug uniqueness: derive from name, then suffix on collision.
  let base = slugify(displayName);
  let slug = base;
  for (let i = 0; i < 5; i++) {
    const [hit] = await db.select({ id: memberProfilesTable.id }).from(memberProfilesTable).where(eq(memberProfilesTable.slug, slug)).limit(1);
    if (!hit) break;
    base = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    slug = base;
  }
  const [row] = await db.insert(memberProfilesTable).values({
    userId,
    slug,
    displayName,
    avatarUrl,
    publicVisibility: true,
  }).returning();
  return row;
}

// ── Profile routes ──────────────────────────────────────────────────────

router.get("/me/profile", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const profile = await ensureProfile(auth.userId);
  res.json({ profile });
});

router.patch("/me/profile", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  await ensureProfile(auth.userId);
  const body = req.body as Partial<typeof memberProfilesTable.$inferInsert>;
  // Whitelist editable fields — slug and userId stay read-only after creation.
  const updates: Partial<typeof memberProfilesTable.$inferInsert> = {};
  if (typeof body.displayName === "string") updates.displayName = body.displayName.slice(0, 200);
  if (typeof body.headline === "string") updates.headline = body.headline.slice(0, 280);
  if (typeof body.bio === "string") updates.bio = body.bio.slice(0, 4000);
  if (typeof body.websiteUrl === "string") updates.websiteUrl = body.websiteUrl.slice(0, 500);
  if (typeof body.linkedinUrl === "string") updates.linkedinUrl = body.linkedinUrl.slice(0, 500);
  if (Array.isArray(body.industrySlugs)) updates.industrySlugs = body.industrySlugs.slice(0, 12).map(String);
  if (Array.isArray(body.capabilityTags)) updates.capabilityTags = body.capabilityTags.slice(0, 20).map(s => String(s).slice(0, 100));
  if (typeof body.publicVisibility === "boolean") updates.publicVisibility = body.publicVisibility;
  updates.updatedAt = new Date();
  const [updated] = await db.update(memberProfilesTable).set(updates).where(eq(memberProfilesTable.userId, auth.userId)).returning();
  res.json({ profile: updated });
});

router.get("/member/:slug", async (req, res) => {
  const slug = String(req.params.slug ?? "").trim();
  if (!slug) { res.status(400).json({ error: "bad slug" }); return; }
  const [profile] = await db.select().from(memberProfilesTable).where(and(
    eq(memberProfilesTable.slug, slug),
    eq(memberProfilesTable.publicVisibility, true),
  )).limit(1);
  if (!profile) { res.status(404).json({ error: "not found" }); return; }
  res.json({ profile });
});

router.get("/members/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q || q.length < 2) { res.json({ results: [] }); return; }
  const needle = `%${q}%`;
  const rows = await db.select({
    slug: memberProfilesTable.slug,
    displayName: memberProfilesTable.displayName,
    headline: memberProfilesTable.headline,
    avatarUrl: memberProfilesTable.avatarUrl,
  }).from(memberProfilesTable).where(and(
    eq(memberProfilesTable.publicVisibility, true),
    or(
      ilike(memberProfilesTable.displayName, needle),
      ilike(memberProfilesTable.headline, needle),
      ilike(memberProfilesTable.bio, needle),
    ),
  )).limit(25);
  res.json({ results: rows });
});

// ── DM routes ───────────────────────────────────────────────────────────

router.post("/messages", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const toUserId = typeof req.body?.toUserId === "string" ? req.body.toUserId : "";
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!toUserId || !body) { res.status(400).json({ error: "toUserId and body required" }); return; }
  if (toUserId === auth.userId) { res.status(400).json({ error: "Can't message yourself" }); return; }
  if (body.length > 4000) { res.status(400).json({ error: "body too long (4000 max)" }); return; }
  // Recipient must exist as a profile (prevents sending to random ids).
  const [recipient] = await db.select({ id: memberProfilesTable.id }).from(memberProfilesTable).where(eq(memberProfilesTable.userId, toUserId)).limit(1);
  if (!recipient) { res.status(404).json({ error: "recipient not found" }); return; }
  const [row] = await db.insert(directMessagesTable).values({
    conversationKey: conversationKeyFor(auth.userId, toUserId),
    fromUserId: auth.userId,
    toUserId,
    body,
  }).returning();
  res.json({ message: row });
});

router.get("/messages/conversations", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  // Get the latest message per conversation involving the user. Done in one
  // query via a window function — Postgres has DISTINCT ON which is simpler
  // than a self-join here.
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (conversation_key)
      conversation_key,
      from_user_id,
      to_user_id,
      body,
      read_at,
      created_at
    FROM direct_messages
    WHERE from_user_id = ${auth.userId} OR to_user_id = ${auth.userId}
    ORDER BY conversation_key, created_at DESC
    LIMIT 100
  `);
  // Each row's "other participant" is whichever id isn't auth.userId.
  const conversations = (rows.rows ?? rows) as Array<{
    conversation_key: string;
    from_user_id: string;
    to_user_id: string;
    body: string;
    read_at: string | null;
    created_at: string;
  }>;
  const otherIds = Array.from(new Set(conversations.map(c => c.from_user_id === auth.userId ? c.to_user_id : c.from_user_id)));
  // Bulk-fetch the other side's profiles for the inbox header.
  const profiles = otherIds.length > 0
    ? await db.select({
        userId: memberProfilesTable.userId,
        slug: memberProfilesTable.slug,
        displayName: memberProfilesTable.displayName,
        avatarUrl: memberProfilesTable.avatarUrl,
      }).from(memberProfilesTable).where(or(...otherIds.map(id => eq(memberProfilesTable.userId, id))))
    : [];
  const profileMap = new Map(profiles.map(p => [p.userId, p]));
  // Unread count per conversation (only inbound, only unread).
  const unreadRows = await db.execute(sql`
    SELECT conversation_key, COUNT(*)::int AS unread
    FROM direct_messages
    WHERE to_user_id = ${auth.userId} AND read_at IS NULL
    GROUP BY conversation_key
  `);
  const unreadMap = new Map<string, number>();
  for (const r of ((unreadRows.rows ?? unreadRows) as Array<{ conversation_key: string; unread: number }>)) {
    unreadMap.set(r.conversation_key, r.unread);
  }

  const out = conversations.map(c => {
    const otherUserId = c.from_user_id === auth.userId ? c.to_user_id : c.from_user_id;
    return {
      otherUserId,
      otherProfile: profileMap.get(otherUserId) ?? null,
      lastMessage: { body: c.body, fromMe: c.from_user_id === auth.userId, createdAt: c.created_at },
      unreadCount: unreadMap.get(c.conversation_key) ?? 0,
    };
  });
  res.json({ conversations: out });
});

router.get("/messages/with/:userId", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const otherUserId = String(req.params.userId);
  const key = conversationKeyFor(auth.userId, otherUserId);
  const rows = await db.select().from(directMessagesTable)
    .where(eq(directMessagesTable.conversationKey, key))
    .orderBy(directMessagesTable.createdAt);
  const [other] = await db.select({
    userId: memberProfilesTable.userId,
    slug: memberProfilesTable.slug,
    displayName: memberProfilesTable.displayName,
    avatarUrl: memberProfilesTable.avatarUrl,
    headline: memberProfilesTable.headline,
  }).from(memberProfilesTable).where(eq(memberProfilesTable.userId, otherUserId)).limit(1);
  res.json({ messages: rows, otherProfile: other ?? null });
});

router.patch("/messages/mark-read/:userId", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const otherUserId = String(req.params.userId);
  await db.update(directMessagesTable).set({ readAt: new Date() }).where(and(
    eq(directMessagesTable.fromUserId, otherUserId),
    eq(directMessagesTable.toUserId, auth.userId),
    isNull(directMessagesTable.readAt),
  ));
  res.json({ ok: true });
});

export default router;
