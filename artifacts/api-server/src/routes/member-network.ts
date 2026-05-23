/**
 * Extended member-network routes — experience, education, skills, posts,
 * connections. Builds on the basic profile + DM routes in members.ts.
 *
 * All write routes auth-gated to the owning Clerk user (only you can edit
 * your own experience). All read routes are public (profile visibility
 * gate enforced at the profile lookup).
 */
import { Router, type IRouter } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import {
  db,
  memberProfilesTable,
  memberExperienceTable,
  memberEducationTable,
  memberSkillsTable,
  memberSkillEndorsementsTable,
  memberPostsTable,
  memberPostReactionsTable,
  memberPostCommentsTable,
  memberConnectionsTable,
  memberNotificationsTable,
  connectionPairFor,
} from "@workspace/db";
import { eq, and, or, desc, sql, inArray, ilike } from "drizzle-orm";
import { autoTagCapabilities } from "../services/capability-autotag";

const router: IRouter = Router();

async function resolveDisplayName(userId: string): Promise<string> {
  const [profile] = await db.select({ displayName: memberProfilesTable.displayName }).from(memberProfilesTable).where(eq(memberProfilesTable.userId, userId)).limit(1);
  if (profile?.displayName) return profile.displayName;
  try {
    const user = await clerkClient.users.getUser(userId);
    const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    return full || user.username || userId;
  } catch {
    return userId;
  }
}

// ── EXPERIENCE ──────────────────────────────────────────────────────────

router.get("/member/:userId/experience", async (req, res) => {
  const userId = String(req.params.userId);
  const rows = await db.select().from(memberExperienceTable).where(eq(memberExperienceTable.userId, userId)).orderBy(desc(memberExperienceTable.startDate));
  res.json({ experience: rows });
});

router.post("/me/experience", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const b = req.body ?? {};
  if (typeof b.company !== "string" || typeof b.title !== "string" || typeof b.startDate !== "string") {
    res.status(400).json({ error: "company, title, startDate required" }); return;
  }
  const [row] = await db.insert(memberExperienceTable).values({
    userId: auth.userId,
    company: b.company.slice(0, 200),
    title: b.title.slice(0, 200),
    location: typeof b.location === "string" ? b.location.slice(0, 200) : null,
    employmentType: typeof b.employmentType === "string" ? b.employmentType.slice(0, 32) : null,
    startDate: b.startDate.slice(0, 10),
    endDate: typeof b.endDate === "string" && b.endDate ? b.endDate.slice(0, 10) : null,
    description: typeof b.description === "string" ? b.description.slice(0, 4000) : null,
  }).returning();
  res.json({ experience: row });
});

router.delete("/me/experience/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  await db.delete(memberExperienceTable).where(and(
    eq(memberExperienceTable.id, id),
    eq(memberExperienceTable.userId, auth.userId),
  ));
  res.json({ ok: true });
});

// ── EDUCATION ───────────────────────────────────────────────────────────

router.get("/member/:userId/education", async (req, res) => {
  const userId = String(req.params.userId);
  const rows = await db.select().from(memberEducationTable).where(eq(memberEducationTable.userId, userId)).orderBy(desc(memberEducationTable.endYear));
  res.json({ education: rows });
});

router.post("/me/education", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const b = req.body ?? {};
  if (typeof b.school !== "string") { res.status(400).json({ error: "school required" }); return; }
  const [row] = await db.insert(memberEducationTable).values({
    userId: auth.userId,
    school: b.school.slice(0, 200),
    degree: typeof b.degree === "string" ? b.degree.slice(0, 200) : null,
    field: typeof b.field === "string" ? b.field.slice(0, 200) : null,
    startYear: Number.isFinite(Number(b.startYear)) ? Number(b.startYear) : null,
    endYear: Number.isFinite(Number(b.endYear)) ? Number(b.endYear) : null,
    activities: typeof b.activities === "string" ? b.activities.slice(0, 2000) : null,
  }).returning();
  res.json({ education: row });
});

router.delete("/me/education/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  await db.delete(memberEducationTable).where(and(
    eq(memberEducationTable.id, id),
    eq(memberEducationTable.userId, auth.userId),
  ));
  res.json({ ok: true });
});

// ── SKILLS + ENDORSEMENTS ───────────────────────────────────────────────

router.get("/member/:userId/skills", async (req, res) => {
  const userId = String(req.params.userId);
  const rows = await db.select().from(memberSkillsTable).where(eq(memberSkillsTable.userId, userId)).orderBy(desc(memberSkillsTable.endorsementCount));
  res.json({ skills: rows });
});

router.post("/me/skills", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const name = typeof req.body?.name === "string" ? req.body.name.trim().slice(0, 100) : "";
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const [row] = await db.insert(memberSkillsTable).values({
    userId: auth.userId,
    name,
  }).onConflictDoNothing().returning();
  if (row) { res.json({ skill: row }); return; }
  const [existing] = await db.select().from(memberSkillsTable).where(and(
    eq(memberSkillsTable.userId, auth.userId),
    eq(memberSkillsTable.name, name),
  )).limit(1);
  res.json({ skill: existing });
});

router.delete("/me/skills/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  await db.delete(memberSkillsTable).where(and(
    eq(memberSkillsTable.id, id),
    eq(memberSkillsTable.userId, auth.userId),
  ));
  res.json({ ok: true });
});

router.post("/skills/:skillId/endorse", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const skillId = Number(req.params.skillId);
  if (!Number.isFinite(skillId)) { res.status(400).json({ error: "bad id" }); return; }
  // No self-endorsement.
  const [skill] = await db.select().from(memberSkillsTable).where(eq(memberSkillsTable.id, skillId)).limit(1);
  if (!skill) { res.status(404).json({ error: "skill not found" }); return; }
  if (skill.userId === auth.userId) { res.status(400).json({ error: "Cannot endorse your own skill" }); return; }
  // Idempotent — duplicate endorsements no-op via unique index.
  const inserted = await db.insert(memberSkillEndorsementsTable).values({
    skillId,
    endorserUserId: auth.userId,
  }).onConflictDoNothing().returning();
  if (inserted.length > 0) {
    await db.update(memberSkillsTable).set({
      endorsementCount: sql`${memberSkillsTable.endorsementCount} + 1`,
    }).where(eq(memberSkillsTable.id, skillId));
  }
  res.json({ ok: true });
});

// ── POSTS / FEED ────────────────────────────────────────────────────────

router.get("/member/:userId/posts", async (req, res) => {
  const userId = String(req.params.userId);
  const rows = await db.select().from(memberPostsTable).where(eq(memberPostsTable.authorUserId, userId)).orderBy(desc(memberPostsTable.createdAt)).limit(50);
  res.json({ posts: rows });
});

router.post("/posts", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (body.length < 1) { res.status(400).json({ error: "body required" }); return; }
  if (body.length > 8000) { res.status(400).json({ error: "body too long" }); return; }

  // Explicit tags from the composer win; auto-detect runs only when the
  // composer sent an empty array. Cap at 10 either way (column constraint).
  const explicitTags: string[] = Array.isArray(req.body?.capabilityTags)
    ? req.body.capabilityTags.slice(0, 10).map(String)
    : [];
  let capabilityTags = explicitTags;
  if (capabilityTags.length === 0) {
    try {
      capabilityTags = await autoTagCapabilities(body);
    } catch {
      // Auto-tag is best-effort — never block the post creation.
      capabilityTags = [];
    }
  }

  const [row] = await db.insert(memberPostsTable).values({
    authorUserId: auth.userId,
    body,
    linkUrl: typeof req.body?.linkUrl === "string" ? req.body.linkUrl.slice(0, 500) : null,
    imageUrl: typeof req.body?.imageUrl === "string" ? req.body.imageUrl.slice(0, 500) : null,
    capabilityTags,
    industrySlugs: Array.isArray(req.body?.industrySlugs) ? req.body.industrySlugs.slice(0, 5).map(String) : [],
  }).returning();

  // Parse @mentions from the body. Slugs match member_profiles.slug shape:
  // [a-z0-9-]+. Resolve to user ids and push notifications. Dedupe so the
  // same handle appearing twice doesn't notify twice. Author of the post
  // never gets a self-mention notification (filtered in pushNotification).
  try {
    const mentionMatches: string[] = body.match(/@[a-z0-9-]{2,}/gi) ?? [];
    const slugs: string[] = Array.from(new Set(mentionMatches.map((m: string) => m.slice(1).toLowerCase())));
    if (slugs.length > 0) {
      const mentioned = await db.select({
        userId: memberProfilesTable.userId,
        slug: memberProfilesTable.slug,
        displayName: memberProfilesTable.displayName,
      }).from(memberProfilesTable).where(inArray(memberProfilesTable.slug, slugs));
      const [authorProfile] = await db.select({ displayName: memberProfilesTable.displayName })
        .from(memberProfilesTable).where(eq(memberProfilesTable.userId, auth.userId)).limit(1);
      const authorName = authorProfile?.displayName ?? "A member";
      for (const m of mentioned) {
        if (m.userId === auth.userId) continue;
        await db.insert(memberNotificationsTable).values({
          userId: m.userId,
          type: "mention",
          actorUserId: auth.userId,
          targetType: "post",
          targetId: row.id,
          body: `${authorName} mentioned you in a post.`,
        }).catch(() => {});
      }
    }
  } catch { /* mention parsing failures are non-fatal */ }

  res.json({ post: row });
});

/**
 * GET /hashtag/:tag — all posts whose body contains #<tag>. Case-insensitive
 * match via ILIKE. Returns hydrated author profiles, like the feed handler.
 * No write here; this is purely a discoverability surface for clicking a
 * #tag in any rendered post.
 */
router.get("/hashtag/:tag", async (req, res) => {
  const tag = String(req.params.tag).replace(/[^a-z0-9_-]/gi, "").slice(0, 60);
  if (!tag) { res.status(400).json({ error: "bad tag" }); return; }
  const rows = await db.select().from(memberPostsTable)
    .where(ilike(memberPostsTable.body, `%#${tag}%`))
    .orderBy(desc(memberPostsTable.createdAt))
    .limit(50);
  const authorIds = Array.from(new Set(rows.map(p => p.authorUserId)));
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
    tag,
    posts: rows.map(p => ({ ...p, author: am.get(p.authorUserId) ?? null })),
  });
});

router.delete("/posts/:id", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  await db.delete(memberPostsTable).where(and(
    eq(memberPostsTable.id, id),
    eq(memberPostsTable.authorUserId, auth.userId),
  ));
  res.json({ ok: true });
});

router.post("/posts/:id/react", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const inserted = await db.insert(memberPostReactionsTable).values({
    postId: id,
    userId: auth.userId,
  }).onConflictDoNothing().returning();
  if (inserted.length > 0) {
    await db.update(memberPostsTable).set({
      likeCount: sql`${memberPostsTable.likeCount} + 1`,
    }).where(eq(memberPostsTable.id, id));
    res.json({ ok: true, reacted: true });
    return;
  }
  // already reacted — toggle off
  const deleted = await db.delete(memberPostReactionsTable).where(and(
    eq(memberPostReactionsTable.postId, id),
    eq(memberPostReactionsTable.userId, auth.userId),
  )).returning();
  if (deleted.length > 0) {
    await db.update(memberPostsTable).set({
      likeCount: sql`GREATEST(${memberPostsTable.likeCount} - 1, 0)`,
    }).where(eq(memberPostsTable.id, id));
  }
  res.json({ ok: true, reacted: false });
});

router.get("/posts/:id/comments", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const rows = await db.select().from(memberPostCommentsTable).where(eq(memberPostCommentsTable.postId, id)).orderBy(memberPostCommentsTable.createdAt);
  res.json({ comments: rows });
});

router.post("/posts/:id/comments", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 4000) : "";
  if (body.length < 1) { res.status(400).json({ error: "body required" }); return; }
  const [row] = await db.insert(memberPostCommentsTable).values({
    postId: id,
    authorUserId: auth.userId,
    body,
  }).returning();
  await db.update(memberPostsTable).set({
    commentCount: sql`${memberPostsTable.commentCount} + 1`,
  }).where(eq(memberPostsTable.id, id));
  res.json({ comment: row });
});

/**
 * GET /feed
 * Returns the signed-in user's home feed: posts from accepted connections +
 * posts tagged with industries in their profile, ordered by recency. Falls
 * back to global recent if they have no connections or industries yet.
 *
 * Optional `?filter=followed-capabilities` narrows results to posts whose
 * capabilityTags overlap with the caller's profile capabilityTags (treated
 * as the user's followed-capabilities list). Returns the empty list when
 * the user hasn't followed any capabilities yet.
 */
router.get("/feed", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const filterMode = typeof req.query.filter === "string" ? req.query.filter : "";
  // Connections
  const conns = await db.select().from(memberConnectionsTable).where(and(
    or(eq(memberConnectionsTable.userA, auth.userId), eq(memberConnectionsTable.userB, auth.userId)),
    eq(memberConnectionsTable.status, "accepted"),
  ));
  const connectionIds = conns.map(c => c.userA === auth.userId ? c.userB : c.userA);
  // Profile (for industry filter + followed-capabilities filter)
  const [profile] = await db.select().from(memberProfilesTable).where(eq(memberProfilesTable.userId, auth.userId)).limit(1);
  const myIndustries = profile?.industrySlugs ?? [];
  const myCapabilities = profile?.capabilityTags ?? [];

  let postRows: typeof memberPostsTable.$inferSelect[];

  if (filterMode === "followed-capabilities") {
    // Narrow mode: only posts whose capabilityTags overlap the caller's
    // followed-capabilities. JSON ?| operator over the jsonb array column.
    if (myCapabilities.length === 0) {
      postRows = [];
    } else {
      postRows = await db.select().from(memberPostsTable)
        .where(sql`${memberPostsTable.capabilityTags} ?| ${myCapabilities}`)
        .orderBy(desc(memberPostsTable.createdAt))
        .limit(40);
    }
  } else if (connectionIds.length === 0 && myIndustries.length === 0) {
    postRows = await db.select().from(memberPostsTable).orderBy(desc(memberPostsTable.createdAt)).limit(40);
  } else {
    const conditions: ReturnType<typeof sql>[] = [];
    if (connectionIds.length > 0) {
      conditions.push(sql`${memberPostsTable.authorUserId} IN ${connectionIds}`);
    }
    if (myIndustries.length > 0) {
      conditions.push(sql`${memberPostsTable.industrySlugs} ?| ${myIndustries}`);
    }
    postRows = await db.select().from(memberPostsTable)
      .where(sql`(${sql.join(conditions, sql` OR `)})`)
      .orderBy(desc(memberPostsTable.createdAt))
      .limit(40);
  }
  // Hydrate author profiles for the feed render.
  const authorIds = Array.from(new Set(postRows.map(p => p.authorUserId)));
  const authors = authorIds.length > 0
    ? await db.select({
        userId: memberProfilesTable.userId,
        slug: memberProfilesTable.slug,
        displayName: memberProfilesTable.displayName,
        avatarUrl: memberProfilesTable.avatarUrl,
        headline: memberProfilesTable.headline,
      }).from(memberProfilesTable).where(inArray(memberProfilesTable.userId, authorIds))
    : [];
  const authorMap = new Map(authors.map(a => [a.userId, a]));
  res.json({
    posts: postRows.map(p => ({ ...p, author: authorMap.get(p.authorUserId) ?? null })),
    followedCapabilities: myCapabilities,
    filterMode: filterMode || "default",
  });
});

// ── CONNECTIONS ─────────────────────────────────────────────────────────

router.post("/connections/request", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const toUserId = typeof req.body?.toUserId === "string" ? req.body.toUserId : "";
  if (!toUserId || toUserId === auth.userId) { res.status(400).json({ error: "bad target" }); return; }
  const pair = connectionPairFor(auth.userId, toUserId);
  const [existing] = await db.select().from(memberConnectionsTable).where(and(
    eq(memberConnectionsTable.userA, pair.userA),
    eq(memberConnectionsTable.userB, pair.userB),
  )).limit(1);
  if (existing) {
    if (existing.status === "accepted") { res.json({ ok: true, alreadyConnected: true }); return; }
    res.json({ ok: true, alreadyPending: true });
    return;
  }
  await db.insert(memberConnectionsTable).values({
    userA: pair.userA,
    userB: pair.userB,
    requestedBy: auth.userId,
    status: "pending",
  });
  res.json({ ok: true });
});

router.post("/connections/accept", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const fromUserId = typeof req.body?.fromUserId === "string" ? req.body.fromUserId : "";
  if (!fromUserId) { res.status(400).json({ error: "bad source" }); return; }
  const pair = connectionPairFor(auth.userId, fromUserId);
  // Caller must be the recipient (not the requester) to accept.
  await db.update(memberConnectionsTable).set({
    status: "accepted",
    acceptedAt: new Date(),
  }).where(and(
    eq(memberConnectionsTable.userA, pair.userA),
    eq(memberConnectionsTable.userB, pair.userB),
    eq(memberConnectionsTable.status, "pending"),
    sql`${memberConnectionsTable.requestedBy} = ${fromUserId}`,
  ));
  res.json({ ok: true });
});

router.delete("/connections/:otherUserId", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const otherUserId = String(req.params.otherUserId);
  const pair = connectionPairFor(auth.userId, otherUserId);
  await db.delete(memberConnectionsTable).where(and(
    eq(memberConnectionsTable.userA, pair.userA),
    eq(memberConnectionsTable.userB, pair.userB),
  ));
  res.json({ ok: true });
});

router.get("/connections", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const rows = await db.select().from(memberConnectionsTable).where(
    or(eq(memberConnectionsTable.userA, auth.userId), eq(memberConnectionsTable.userB, auth.userId)),
  );
  const accepted = rows.filter(r => r.status === "accepted");
  const incoming = rows.filter(r => r.status === "pending" && r.requestedBy !== auth.userId);
  const outgoing = rows.filter(r => r.status === "pending" && r.requestedBy === auth.userId);
  const otherIds = Array.from(new Set([...accepted, ...incoming, ...outgoing].map(r => r.userA === auth.userId ? r.userB : r.userA)));
  const profiles = otherIds.length > 0
    ? await db.select({
        userId: memberProfilesTable.userId,
        slug: memberProfilesTable.slug,
        displayName: memberProfilesTable.displayName,
        avatarUrl: memberProfilesTable.avatarUrl,
        headline: memberProfilesTable.headline,
      }).from(memberProfilesTable).where(inArray(memberProfilesTable.userId, otherIds))
    : [];
  const pm = new Map(profiles.map(p => [p.userId, p]));
  const decorate = (rs: typeof rows) => rs.map(r => {
    const other = r.userA === auth.userId ? r.userB : r.userA;
    return { ...r, otherUserId: other, otherProfile: pm.get(other) ?? null };
  });
  res.json({
    accepted: decorate(accepted),
    incoming: decorate(incoming),
    outgoing: decorate(outgoing),
  });
});

/**
 * GET /connections/status/:otherUserId — quick check whether the signed-in
 * user has a connection with otherUserId. Used by the profile page Connect
 * button to render state.
 */
router.get("/connections/status/:otherUserId", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.json({ status: "none" }); return; }
  const otherUserId = String(req.params.otherUserId);
  if (otherUserId === auth.userId) { res.json({ status: "self" }); return; }
  const pair = connectionPairFor(auth.userId, otherUserId);
  const [row] = await db.select().from(memberConnectionsTable).where(and(
    eq(memberConnectionsTable.userA, pair.userA),
    eq(memberConnectionsTable.userB, pair.userB),
  )).limit(1);
  if (!row) { res.json({ status: "none" }); return; }
  if (row.status === "accepted") { res.json({ status: "connected" }); return; }
  res.json({ status: "pending", requestedByMe: row.requestedBy === auth.userId });
});

export default router;
