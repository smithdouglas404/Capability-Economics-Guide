/**
 * Network extras — search, notifications, recommendations, profile views,
 * saved posts, reposts, suggestions. Sits alongside members.ts +
 * member-network.ts; kept in its own file so the network primitive can
 * grow without bloating the others.
 */
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  memberProfilesTable,
  memberConnectionsTable,
  memberRecommendationsTable,
  memberNotificationsTable,
  profileViewsTable,
  memberSavedPostsTable,
  memberPostSharesTable,
  memberPostsTable,
  memberPostReactionsTable,
  memberPostCommentsTable,
  connectionPairFor,
} from "@workspace/db";
import { eq, and, or, desc, sql, isNull, inArray, ilike, ne } from "drizzle-orm";

const router: IRouter = Router();

async function pushNotification(args: {
  userId: string;
  type: string;
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: number | null;
  body: string;
}): Promise<void> {
  if (args.userId === args.actorUserId) return; // never notify self of own actions
  try {
    await db.insert(memberNotificationsTable).values({
      userId: args.userId,
      type: args.type,
      actorUserId: args.actorUserId ?? null,
      targetType: args.targetType ?? null,
      targetId: args.targetId ?? null,
      body: args.body.slice(0, 500),
    });
  } catch { /* non-fatal — notification failures shouldn't break the underlying action */ }
}

// ── SEARCH ──────────────────────────────────────────────────────────────

router.get("/search/members", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const industry = typeof req.query.industry === "string" ? req.query.industry.trim() : "";
  const capability = typeof req.query.capability === "string" ? req.query.capability.trim() : "";
  const location = typeof req.query.location === "string" ? req.query.location.trim() : "";

  const conds: ReturnType<typeof eq>[] = [eq(memberProfilesTable.publicVisibility, true)];
  if (q) {
    conds.push(or(
      ilike(memberProfilesTable.displayName, `%${q}%`),
      ilike(memberProfilesTable.headline, `%${q}%`),
      ilike(memberProfilesTable.bio, `%${q}%`),
    )!);
  }
  if (location) conds.push(ilike(memberProfilesTable.location, `%${location}%`));
  if (industry) conds.push(sql`${memberProfilesTable.industrySlugs} ? ${industry}`);
  if (capability) conds.push(sql`${memberProfilesTable.capabilityTags} ? ${capability}`);

  const rows = await db.select({
    userId: memberProfilesTable.userId,
    slug: memberProfilesTable.slug,
    displayName: memberProfilesTable.displayName,
    headline: memberProfilesTable.headline,
    avatarUrl: memberProfilesTable.avatarUrl,
    location: memberProfilesTable.location,
    industrySlugs: memberProfilesTable.industrySlugs,
    capabilityTags: memberProfilesTable.capabilityTags,
  }).from(memberProfilesTable).where(and(...conds)).limit(50);
  res.json({ results: rows });
});

// ── NOTIFICATIONS ───────────────────────────────────────────────────────

router.get("/me/notifications", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const rows = await db.select().from(memberNotificationsTable)
    .where(eq(memberNotificationsTable.userId, auth.userId))
    .orderBy(desc(memberNotificationsTable.createdAt))
    .limit(50);
  // Hydrate actor display names + slugs in one round-trip
  const actorIds = Array.from(new Set(rows.map(r => r.actorUserId).filter((id): id is string => !!id)));
  const actors = actorIds.length > 0
    ? await db.select({
        userId: memberProfilesTable.userId,
        slug: memberProfilesTable.slug,
        displayName: memberProfilesTable.displayName,
        avatarUrl: memberProfilesTable.avatarUrl,
      }).from(memberProfilesTable).where(inArray(memberProfilesTable.userId, actorIds))
    : [];
  const actorMap = new Map(actors.map(a => [a.userId, a]));
  const [unreadCountRow] = await db.select({ n: sql<number>`count(*)::int` })
    .from(memberNotificationsTable)
    .where(and(eq(memberNotificationsTable.userId, auth.userId), isNull(memberNotificationsTable.readAt)));
  res.json({
    notifications: rows.map(r => ({ ...r, actor: r.actorUserId ? actorMap.get(r.actorUserId) ?? null : null })),
    unreadCount: unreadCountRow?.n ?? 0,
  });
});

router.patch("/me/notifications/read-all", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  await db.update(memberNotificationsTable).set({ readAt: new Date() }).where(and(
    eq(memberNotificationsTable.userId, auth.userId),
    isNull(memberNotificationsTable.readAt),
  ));
  res.json({ ok: true });
});

router.get("/me/notifications/unread-count", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.json({ unreadCount: 0 }); return; }
  const [row] = await db.select({ n: sql<number>`count(*)::int` })
    .from(memberNotificationsTable)
    .where(and(eq(memberNotificationsTable.userId, auth.userId), isNull(memberNotificationsTable.readAt)));
  res.json({ unreadCount: row?.n ?? 0 });
});

// ── RECOMMENDATIONS ─────────────────────────────────────────────────────

router.get("/member/:userId/recommendations", async (req, res) => {
  const userId = String(req.params.userId);
  const rows = await db.select({
    id: memberRecommendationsTable.id,
    giverUserId: memberRecommendationsTable.giverUserId,
    relationship: memberRecommendationsTable.relationship,
    body: memberRecommendationsTable.body,
    createdAt: memberRecommendationsTable.createdAt,
    giverSlug: memberProfilesTable.slug,
    giverDisplayName: memberProfilesTable.displayName,
    giverAvatarUrl: memberProfilesTable.avatarUrl,
    giverHeadline: memberProfilesTable.headline,
  }).from(memberRecommendationsTable)
    .leftJoin(memberProfilesTable, eq(memberProfilesTable.userId, memberRecommendationsTable.giverUserId))
    .where(eq(memberRecommendationsTable.receiverUserId, userId))
    .orderBy(desc(memberRecommendationsTable.createdAt));
  res.json({ recommendations: rows });
});

router.post("/member/:userId/recommendations", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const receiverUserId = String(req.params.userId);
  if (receiverUserId === auth.userId) { res.status(400).json({ error: "Can't recommend yourself" }); return; }
  const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 4000) : "";
  const relationship = typeof req.body?.relationship === "string" ? req.body.relationship.slice(0, 64) : null;
  if (body.length < 20) { res.status(400).json({ error: "Recommendations need at least 20 characters." }); return; }
  const [row] = await db.insert(memberRecommendationsTable).values({
    giverUserId: auth.userId,
    receiverUserId,
    body,
    relationship,
  }).onConflictDoUpdate({
    target: [memberRecommendationsTable.giverUserId, memberRecommendationsTable.receiverUserId],
    set: { body, relationship, updatedAt: sql`NOW()` },
  }).returning();
  const [giver] = await db.select({ displayName: memberProfilesTable.displayName }).from(memberProfilesTable).where(eq(memberProfilesTable.userId, auth.userId)).limit(1);
  await pushNotification({
    userId: receiverUserId,
    type: "recommendation",
    actorUserId: auth.userId,
    targetType: "profile",
    body: `${giver?.displayName ?? "A member"} wrote you a recommendation.`,
  });
  res.json({ recommendation: row });
});

// ── PROFILE VIEWS ───────────────────────────────────────────────────────

router.post("/member/:slug/view", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.json({ ok: true }); return; } // silently ignore anon views
  const slug = String(req.params.slug);
  const [target] = await db.select({ userId: memberProfilesTable.userId }).from(memberProfilesTable).where(eq(memberProfilesTable.slug, slug)).limit(1);
  if (!target || target.userId === auth.userId) { res.json({ ok: true }); return; }
  const today = new Date().toISOString().slice(0, 10);
  await db.insert(profileViewsTable).values({
    viewerUserId: auth.userId,
    viewedUserId: target.userId,
    viewedDate: today,
  }).onConflictDoNothing();
  res.json({ ok: true });
});

router.get("/me/profile-stats", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const [vRow] = await db.select({ n: sql<number>`count(*)::int` })
    .from(profileViewsTable).where(eq(profileViewsTable.viewedUserId, auth.userId));
  const [cRow] = await db.select({ n: sql<number>`count(*)::int` })
    .from(memberConnectionsTable)
    .where(and(
      or(eq(memberConnectionsTable.userA, auth.userId), eq(memberConnectionsTable.userB, auth.userId)),
      eq(memberConnectionsTable.status, "accepted"),
    ));
  const [pRow] = await db.select({ n: sql<number>`count(*)::int` })
    .from(memberPostsTable).where(eq(memberPostsTable.authorUserId, auth.userId));
  res.json({
    profileViews: vRow?.n ?? 0,
    connections: cRow?.n ?? 0,
    posts: pRow?.n ?? 0,
  });
});

// Recent viewers (anonymized except for current connections)
router.get("/me/profile-stats/viewers", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const rows = await db.select({
    viewerUserId: profileViewsTable.viewerUserId,
    viewedDate: profileViewsTable.viewedDate,
  }).from(profileViewsTable)
    .where(eq(profileViewsTable.viewedUserId, auth.userId))
    .orderBy(desc(profileViewsTable.createdAt))
    .limit(30);
  const viewerIds = Array.from(new Set(rows.map(r => r.viewerUserId)));
  // Identify which viewers are connections
  const conns = viewerIds.length > 0
    ? await db.select().from(memberConnectionsTable).where(and(
        or(
          and(eq(memberConnectionsTable.userA, auth.userId), inArray(memberConnectionsTable.userB, viewerIds)),
          and(eq(memberConnectionsTable.userB, auth.userId), inArray(memberConnectionsTable.userA, viewerIds)),
        ),
        eq(memberConnectionsTable.status, "accepted"),
      ))
    : [];
  const connSet = new Set(conns.map(c => c.userA === auth.userId ? c.userB : c.userA));
  // Profiles for connections
  const connProfiles = connSet.size > 0
    ? await db.select({
        userId: memberProfilesTable.userId,
        slug: memberProfilesTable.slug,
        displayName: memberProfilesTable.displayName,
        avatarUrl: memberProfilesTable.avatarUrl,
        headline: memberProfilesTable.headline,
      }).from(memberProfilesTable).where(inArray(memberProfilesTable.userId, Array.from(connSet)))
    : [];
  const profMap = new Map(connProfiles.map(p => [p.userId, p]));
  res.json({
    viewers: rows.map(r => connSet.has(r.viewerUserId)
      ? { date: r.viewedDate, profile: profMap.get(r.viewerUserId) ?? null }
      : { date: r.viewedDate, profile: null /* anonymized */ }),
  });
});

// ── PEOPLE YOU MAY KNOW ────────────────────────────────────────────────

router.get("/me/people-you-may-know", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const [me] = await db.select().from(memberProfilesTable).where(eq(memberProfilesTable.userId, auth.userId)).limit(1);
  // Already-connected ids
  const conns = await db.select().from(memberConnectionsTable).where(
    or(eq(memberConnectionsTable.userA, auth.userId), eq(memberConnectionsTable.userB, auth.userId)),
  );
  const excludeIds = new Set([auth.userId, ...conns.map(c => c.userA === auth.userId ? c.userB : c.userA)]);
  const myIndustries = me?.industrySlugs ?? [];
  // Industry-match first; if too few, fall back to recent profiles.
  let candidates: Array<{
    userId: string; slug: string; displayName: string; headline: string | null; avatarUrl: string | null;
    industrySlugs: string[]; capabilityTags: string[];
  }> = [];
  if (myIndustries.length > 0) {
    candidates = await db.select({
      userId: memberProfilesTable.userId,
      slug: memberProfilesTable.slug,
      displayName: memberProfilesTable.displayName,
      headline: memberProfilesTable.headline,
      avatarUrl: memberProfilesTable.avatarUrl,
      industrySlugs: memberProfilesTable.industrySlugs,
      capabilityTags: memberProfilesTable.capabilityTags,
    }).from(memberProfilesTable).where(and(
      eq(memberProfilesTable.publicVisibility, true),
      sql`${memberProfilesTable.industrySlugs} ?| ${myIndustries}`,
    )).limit(20);
  }
  if (candidates.length < 8) {
    const extras = await db.select({
      userId: memberProfilesTable.userId,
      slug: memberProfilesTable.slug,
      displayName: memberProfilesTable.displayName,
      headline: memberProfilesTable.headline,
      avatarUrl: memberProfilesTable.avatarUrl,
      industrySlugs: memberProfilesTable.industrySlugs,
      capabilityTags: memberProfilesTable.capabilityTags,
    }).from(memberProfilesTable).where(and(
      eq(memberProfilesTable.publicVisibility, true),
      ne(memberProfilesTable.userId, auth.userId),
    )).orderBy(desc(memberProfilesTable.createdAt)).limit(20);
    candidates = [...candidates, ...extras];
  }
  const suggestions = candidates.filter(c => !excludeIds.has(c.userId)).slice(0, 12);
  res.json({ suggestions });
});

// ── SAVED POSTS ────────────────────────────────────────────────────────

router.post("/me/saved-posts/:postId", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const postId = Number(req.params.postId);
  if (!Number.isFinite(postId)) { res.status(400).json({ error: "bad id" }); return; }
  await db.insert(memberSavedPostsTable).values({ userId: auth.userId, postId }).onConflictDoNothing();
  res.json({ ok: true });
});

router.delete("/me/saved-posts/:postId", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const postId = Number(req.params.postId);
  if (!Number.isFinite(postId)) { res.status(400).json({ error: "bad id" }); return; }
  await db.delete(memberSavedPostsTable).where(and(
    eq(memberSavedPostsTable.userId, auth.userId),
    eq(memberSavedPostsTable.postId, postId),
  ));
  res.json({ ok: true });
});

router.get("/me/saved-posts", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const rows = await db.select({
    saveId: memberSavedPostsTable.id,
    post: memberPostsTable,
  }).from(memberSavedPostsTable)
    .innerJoin(memberPostsTable, eq(memberPostsTable.id, memberSavedPostsTable.postId))
    .where(eq(memberSavedPostsTable.userId, auth.userId))
    .orderBy(desc(memberSavedPostsTable.createdAt))
    .limit(50);
  const authorIds = Array.from(new Set(rows.map(r => r.post.authorUserId)));
  const authors = authorIds.length > 0
    ? await db.select({
        userId: memberProfilesTable.userId,
        slug: memberProfilesTable.slug,
        displayName: memberProfilesTable.displayName,
        avatarUrl: memberProfilesTable.avatarUrl,
        headline: memberProfilesTable.headline,
      }).from(memberProfilesTable).where(inArray(memberProfilesTable.userId, authorIds))
    : [];
  const am = new Map(authors.map(a => [a.userId, a]));
  res.json({
    saved: rows.map(r => ({ saveId: r.saveId, ...r.post, author: am.get(r.post.authorUserId) ?? null })),
  });
});

// ── REPOSTS / SHARES ───────────────────────────────────────────────────

router.post("/posts/:id/share", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const postId = Number(req.params.id);
  if (!Number.isFinite(postId)) { res.status(400).json({ error: "bad id" }); return; }
  const comment = typeof req.body?.comment === "string" ? req.body.comment.slice(0, 2000) : null;
  const inserted = await db.insert(memberPostSharesTable).values({
    postId, sharerUserId: auth.userId, comment,
  }).onConflictDoNothing().returning();
  // Notify the original author
  const [orig] = await db.select({ authorUserId: memberPostsTable.authorUserId }).from(memberPostsTable).where(eq(memberPostsTable.id, postId)).limit(1);
  if (orig && inserted.length > 0) {
    const [sharer] = await db.select({ displayName: memberProfilesTable.displayName }).from(memberProfilesTable).where(eq(memberProfilesTable.userId, auth.userId)).limit(1);
    await pushNotification({
      userId: orig.authorUserId,
      type: "post_share",
      actorUserId: auth.userId,
      targetType: "post",
      targetId: postId,
      body: `${sharer?.displayName ?? "A member"} shared your post${comment ? " with a comment" : ""}.`,
    });
  }
  res.json({ ok: true, shared: inserted.length > 0 });
});

export default router;
