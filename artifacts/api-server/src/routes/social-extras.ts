/**
 * Social-extras — capability-aware overlay routes powering the collaboration,
 * member-microsite, expert-search, inbox, and network-graph pages.
 *
 * Sits alongside members.ts + member-network.ts + network-extras.ts and
 * exposes only *read* endpoints that aggregate existing data sources (member
 * posts, forum threads, watchlists, connections, strategy decisions). No new
 * tables; everything is composed at query time so it stays in sync.
 *
 *   GET /api/social/experts-by-capability?capability=<slug>
 *   GET /api/member/:userId/expertise
 *   GET /api/member/:userId/activity-feed
 *   GET /api/member/:userId/watched-capabilities
 *   GET /api/network/graph
 *   GET /api/collaboration/boards            — capabilities grouped + member count
 *   GET /api/collaboration/activity          — recent comments + decisions, grouped
 *   GET /api/social/capabilities-lookup      — slim id/name/slug list for autotag UI
 */
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import {
  db,
  memberProfilesTable,
  memberPostsTable,
  memberConnectionsTable,
  capabilitiesTable,
  forumThreadsTable,
  strategyCommentsTable,
  strategyDecisionsTable,
  watchlistsTable,
  watchlistItemsTable,
} from "@workspace/db";
import { eq, and, or, desc, sql, inArray } from "drizzle-orm";

const router: IRouter = Router();

// ── EXPERTS BY CAPABILITY ───────────────────────────────────────────────
//
// "Find members who have substantive activity in capability X."
// Expert score = 3×(posts tagged with cap) + 2×(forum threads tagged with cap)
//                + 1×(profile lists cap as expertise tag).
// Returns top 25 by score.

router.get("/social/experts-by-capability", async (req, res) => {
  const capability = typeof req.query.capability === "string" ? req.query.capability.trim() : "";
  if (!capability) { res.json({ capability: "", experts: [] }); return; }

  // 1) Profile expertise hits — direct list-membership.
  const profileHits = await db.select({
    userId: memberProfilesTable.userId,
    slug: memberProfilesTable.slug,
    displayName: memberProfilesTable.displayName,
    headline: memberProfilesTable.headline,
    avatarUrl: memberProfilesTable.avatarUrl,
    industrySlugs: memberProfilesTable.industrySlugs,
    capabilityTags: memberProfilesTable.capabilityTags,
  }).from(memberProfilesTable).where(and(
    eq(memberProfilesTable.publicVisibility, true),
    sql`${memberProfilesTable.capabilityTags} ? ${capability}`,
  )).limit(200);

  // 2) Post author hits — count posts tagged with this capability per author.
  const postCounts = await db.execute(sql`
    SELECT author_user_id AS user_id, COUNT(*)::int AS post_count
    FROM member_posts
    WHERE capability_tags ? ${capability}
    GROUP BY author_user_id
  `);
  const postCountMap = new Map<string, number>();
  for (const r of ((postCounts.rows ?? postCounts) as Array<{ user_id: string; post_count: number }>)) {
    postCountMap.set(r.user_id, r.post_count);
  }

  // 3) Forum thread starter hits — count forum threads tagged with cap per starter.
  const forumCounts = await db.execute(sql`
    SELECT author_user_id AS user_id, COUNT(*)::int AS forum_count
    FROM forum_threads
    WHERE capability_tags ? ${capability}
    GROUP BY author_user_id
  `);
  const forumCountMap = new Map<string, number>();
  for (const r of ((forumCounts.rows ?? forumCounts) as Array<{ user_id: string; forum_count: number }>)) {
    forumCountMap.set(r.user_id, r.forum_count);
  }

  // Merge candidate set.
  const candidateIds = new Set<string>([
    ...profileHits.map(p => p.userId),
    ...Array.from(postCountMap.keys()),
    ...Array.from(forumCountMap.keys()),
  ]);
  if (candidateIds.size === 0) { res.json({ capability, experts: [] }); return; }

  const idsArr = Array.from(candidateIds);
  // Bulk-fetch any profile rows for candidates not already in profileHits.
  const profileMap = new Map(profileHits.map(p => [p.userId, p]));
  const missing = idsArr.filter(id => !profileMap.has(id));
  if (missing.length > 0) {
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
      inArray(memberProfilesTable.userId, missing),
    ));
    for (const e of extras) profileMap.set(e.userId, e);
  }

  const experts = idsArr.flatMap((id) => {
    const profile = profileMap.get(id);
    if (!profile) return [];
    const postCount = postCountMap.get(id) ?? 0;
    const forumCount = forumCountMap.get(id) ?? 0;
    const profileMatch = profile.capabilityTags.includes(capability) ? 1 : 0;
    const score = 3 * postCount + 2 * forumCount + profileMatch;
    if (score === 0) return [];
    return [{
      ...profile,
      postCount,
      forumCount,
      profileMatch: profileMatch === 1,
      expertScore: score,
    }];
  });
  experts.sort((a, b) => b.expertScore - a.expertScore);
  res.json({ capability, experts: experts.slice(0, 25) });
});

// ── MEMBER EXPERTISE (auto-derived) ─────────────────────────────────────
// Aggregates capability hits across the member's posts + forum threads, then
// merges with their explicit capabilityTags. Returns top capabilities with a
// per-cap signal volume (used by the member microsite expertise panel).

router.get("/member/:userId/expertise", async (req, res) => {
  const userId = String(req.params.userId);

  const [profile] = await db.select({
    capabilityTags: memberProfilesTable.capabilityTags,
  }).from(memberProfilesTable).where(eq(memberProfilesTable.userId, userId)).limit(1);
  const declaredTags = new Set(profile?.capabilityTags ?? []);

  // Tally capability_tags occurrences across the member's posts.
  const postRows = await db.select({
    capabilityTags: memberPostsTable.capabilityTags,
  }).from(memberPostsTable).where(eq(memberPostsTable.authorUserId, userId));
  const forumRows = await db.select({
    capabilityTags: forumThreadsTable.capabilityTags,
  }).from(forumThreadsTable).where(eq(forumThreadsTable.authorUserId, userId));

  const tally = new Map<string, { postHits: number; forumHits: number }>();
  for (const row of postRows) {
    for (const tag of row.capabilityTags ?? []) {
      const cur = tally.get(tag) ?? { postHits: 0, forumHits: 0 };
      cur.postHits += 1;
      tally.set(tag, cur);
    }
  }
  for (const row of forumRows) {
    for (const tag of row.capabilityTags ?? []) {
      const cur = tally.get(tag) ?? { postHits: 0, forumHits: 0 };
      cur.forumHits += 1;
      tally.set(tag, cur);
    }
  }
  // Include declared tags even if they have no activity yet.
  for (const tag of declaredTags) {
    if (!tally.has(tag)) tally.set(tag, { postHits: 0, forumHits: 0 });
  }

  const allSlugs = Array.from(tally.keys());
  // Resolve display names from the catalog for known slugs.
  const catalogRows = allSlugs.length > 0
    ? await db.select({
        slug: capabilitiesTable.slug,
        name: capabilitiesTable.name,
        id: capabilitiesTable.id,
      }).from(capabilitiesTable).where(inArray(capabilitiesTable.slug, allSlugs))
    : [];
  const catalogMap = new Map(catalogRows.map(r => [r.slug, r]));

  const expertise = allSlugs.map(slug => {
    const t = tally.get(slug)!;
    const cat = catalogMap.get(slug);
    const score = 3 * t.postHits + 2 * t.forumHits + (declaredTags.has(slug) ? 1 : 0);
    return {
      slug,
      name: cat?.name ?? slug,
      capabilityId: cat?.id ?? null,
      postHits: t.postHits,
      forumHits: t.forumHits,
      declared: declaredTags.has(slug),
      score,
    };
  });
  expertise.sort((a, b) => b.score - a.score);
  res.json({ userId, expertise: expertise.slice(0, 20) });
});

// ── MEMBER ACTIVITY FEED ────────────────────────────────────────────────
// Unified stream of the member's posts + forum threads, newest first. Used
// by the member microsite "recent activity" panel.

router.get("/member/:userId/activity-feed", async (req, res) => {
  const userId = String(req.params.userId);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25));

  const posts = await db.select().from(memberPostsTable)
    .where(eq(memberPostsTable.authorUserId, userId))
    .orderBy(desc(memberPostsTable.createdAt))
    .limit(limit);
  const threads = await db.select().from(forumThreadsTable)
    .where(eq(forumThreadsTable.authorUserId, userId))
    .orderBy(desc(forumThreadsTable.createdAt))
    .limit(limit);

  type FeedItem = {
    kind: "post" | "forum-thread";
    id: number;
    title: string | null;
    body: string;
    capabilityTags: string[];
    industrySlugs: string[];
    likeCount: number;
    commentCount: number;
    createdAt: string;
    href: string;
  };
  const items: FeedItem[] = [];
  for (const p of posts) {
    items.push({
      kind: "post",
      id: p.id,
      title: null,
      body: p.body,
      capabilityTags: p.capabilityTags ?? [],
      industrySlugs: p.industrySlugs ?? [],
      likeCount: p.likeCount ?? 0,
      commentCount: p.commentCount ?? 0,
      createdAt: typeof p.createdAt === "string" ? p.createdAt : new Date(p.createdAt as Date).toISOString(),
      href: `/feed#post-${p.id}`,
    });
  }
  for (const t of threads) {
    items.push({
      kind: "forum-thread",
      id: t.id,
      title: t.title,
      body: t.body ?? "",
      capabilityTags: t.capabilityTags ?? [],
      industrySlugs: [],
      likeCount: 0,
      commentCount: t.postCount ?? 0,
      createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date(t.createdAt as Date).toISOString(),
      href: `/forum/threads/${t.id}`,
    });
  }
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ userId, items: items.slice(0, limit) });
});

// ── MEMBER WATCHED CAPABILITIES ─────────────────────────────────────────
// Returns the union of:
//   1) Declared capabilityTags on the member profile (acts as a public
//      "I'm watching this" list).
//   2) Watchlist items belonging to the *current signed-in user*, if they
//      happen to be viewing their own profile.
// Other users only see the declared list — we don't expose another member's
// session-scoped watchlist.

router.get("/member/:userId/watched-capabilities", async (req, res) => {
  const auth = getAuth(req);
  const userId = String(req.params.userId);

  const [profile] = await db.select({
    userId: memberProfilesTable.userId,
    capabilityTags: memberProfilesTable.capabilityTags,
  }).from(memberProfilesTable).where(eq(memberProfilesTable.userId, userId)).limit(1);
  const declared = profile?.capabilityTags ?? [];
  const isSelf = !!auth.userId && auth.userId === userId;

  const slugs = new Set<string>(declared);
  // Resolve slugs through the catalog so we can label them.
  const catalogRows = slugs.size > 0
    ? await db.select({
        slug: capabilitiesTable.slug,
        name: capabilitiesTable.name,
        id: capabilitiesTable.id,
      }).from(capabilitiesTable).where(inArray(capabilitiesTable.slug, Array.from(slugs)))
    : [];
  type WatchedItem = {
    capabilityId: number;
    name: string;
    slug: string;
    source: "profile" | "watchlist";
  };
  const items: WatchedItem[] = catalogRows.map(c => ({
    capabilityId: c.id,
    name: c.name,
    slug: c.slug,
    source: "profile",
  }));

  // Self-only: also surface any session-watchlist items they've created. We
  // look these up via the session token header (same pattern used on /watchlist).
  if (isSelf) {
    const token = typeof req.headers["x-session-token"] === "string"
      ? req.headers["x-session-token"]
      : typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
    if (token) {
      const [wl] = await db.select().from(watchlistsTable).where(eq(watchlistsTable.sessionToken, token)).limit(1);
      if (wl) {
        const wlItems = await db.select({
          capabilityId: watchlistItemsTable.capabilityId,
          name: capabilitiesTable.name,
          slug: capabilitiesTable.slug,
        }).from(watchlistItemsTable)
          .leftJoin(capabilitiesTable, eq(watchlistItemsTable.capabilityId, capabilitiesTable.id))
          .where(eq(watchlistItemsTable.watchlistId, wl.id));
        for (const it of wlItems) {
          if (it.capabilityId && it.slug && !items.find(x => x.capabilityId === it.capabilityId)) {
            items.push({ capabilityId: it.capabilityId, name: it.name ?? it.slug, slug: it.slug, source: "watchlist" });
          }
        }
      }
    }
  }
  res.json({ userId, watched: items });
});

// ── NETWORK GRAPH ───────────────────────────────────────────────────────
// Lightweight node-link payload for the /network visualization. Returns the
// caller's first-degree connections plus the *shared connections* among them
// (second-degree edges that close a triangle). Capped at 60 nodes so the
// SVG render stays sub-1k DOM nodes.

router.get("/network/graph", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }

  // 1st-degree
  const myConns = await db.select().from(memberConnectionsTable).where(and(
    or(eq(memberConnectionsTable.userA, auth.userId), eq(memberConnectionsTable.userB, auth.userId)),
    eq(memberConnectionsTable.status, "accepted"),
  ));
  const connIds = myConns.map(c => c.userA === auth.userId ? c.userB : c.userA);
  if (connIds.length === 0) {
    res.json({ nodes: [], edges: [], rootUserId: auth.userId });
    return;
  }

  // 2nd-degree edges — find all accepted connections among the 1st-degree set.
  const peerConns = await db.select().from(memberConnectionsTable).where(and(
    eq(memberConnectionsTable.status, "accepted"),
    or(
      inArray(memberConnectionsTable.userA, connIds),
      inArray(memberConnectionsTable.userB, connIds),
    ),
  ));
  const connIdSet = new Set(connIds);
  const triangleEdges: Array<{ a: string; b: string }> = [];
  for (const c of peerConns) {
    if (c.userA === auth.userId || c.userB === auth.userId) continue;
    if (connIdSet.has(c.userA) && connIdSet.has(c.userB)) {
      triangleEdges.push({ a: c.userA, b: c.userB });
    }
  }

  // Hydrate node profiles for the graph render.
  const allIds = Array.from(new Set([auth.userId, ...connIds]));
  const profiles = await db.select({
    userId: memberProfilesTable.userId,
    slug: memberProfilesTable.slug,
    displayName: memberProfilesTable.displayName,
    avatarUrl: memberProfilesTable.avatarUrl,
    headline: memberProfilesTable.headline,
    capabilityTags: memberProfilesTable.capabilityTags,
    industrySlugs: memberProfilesTable.industrySlugs,
  }).from(memberProfilesTable).where(inArray(memberProfilesTable.userId, allIds));
  const profileMap = new Map(profiles.map(p => [p.userId, p]));

  // Cluster nodes by their primary capability tag — lets the front-end colour
  // them by expertise cluster.
  function primaryCap(id: string): string | null {
    const p = profileMap.get(id);
    return p?.capabilityTags?.[0] ?? null;
  }

  const nodes = allIds.slice(0, 60).map(id => {
    const p = profileMap.get(id);
    return {
      id,
      slug: p?.slug ?? null,
      displayName: p?.displayName ?? "Member",
      avatarUrl: p?.avatarUrl ?? null,
      headline: p?.headline ?? null,
      isRoot: id === auth.userId,
      primaryCapability: primaryCap(id),
      capabilityCount: (p?.capabilityTags ?? []).length,
    };
  });

  const nodeIdSet = new Set(nodes.map(n => n.id));
  const edges: Array<{ a: string; b: string; strength: number }> = [];
  // first-degree edges from root
  for (const id of connIds) {
    if (!nodeIdSet.has(id)) continue;
    edges.push({ a: auth.userId, b: id, strength: 1 });
  }
  for (const t of triangleEdges) {
    if (!nodeIdSet.has(t.a) || !nodeIdSet.has(t.b)) continue;
    edges.push({ a: t.a, b: t.b, strength: 0.4 });
  }

  // Cluster summary — count nodes per capability slug.
  const clusterCounts = new Map<string, number>();
  for (const n of nodes) {
    if (!n.primaryCapability) continue;
    clusterCounts.set(n.primaryCapability, (clusterCounts.get(n.primaryCapability) ?? 0) + 1);
  }
  const clusters = Array.from(clusterCounts.entries())
    .map(([slug, count]) => ({ slug, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Density: |E_actual| / |E_possible| for the first-degree subgraph (excluding
  // root). Gives the front-end one honest number to surface.
  const n = connIds.length;
  const possible = n * (n - 1) / 2;
  const density = possible > 0 ? triangleEdges.length / possible : 0;

  res.json({
    rootUserId: auth.userId,
    nodes,
    edges,
    clusters,
    density,
    firstDegreeCount: connIds.length,
    triangleCount: triangleEdges.length,
  });
});

// ── COLLABORATION BOARDS ────────────────────────────────────────────────
// Aggregates strategy comments + decisions per capability for the caller's
// session. Each "board" is the activity for one capability the team has
// engaged with.

router.get("/collaboration/boards", async (req, res) => {
  const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
  if (!token) { res.json({ boards: [] }); return; }

  // Capabilities the session has commented on or recorded a decision against.
  const commentRows = await db.execute(sql`
    SELECT target_id AS capability_id, COUNT(*)::int AS comment_count,
           MAX(created_at) AS last_activity
    FROM strategy_comments
    WHERE session_token = ${token} AND target_type = 'capability'
    GROUP BY target_id
  `);
  const decisionRows = await db.execute(sql`
    SELECT capability_id, COUNT(*)::int AS decision_count,
           MAX(created_at) AS last_activity
    FROM strategy_decisions
    WHERE session_token = ${token} AND capability_id IS NOT NULL
    GROUP BY capability_id
  `);

  type Agg = { capabilityId: number; commentCount: number; decisionCount: number; lastActivity: string };
  const agg = new Map<number, Agg>();
  for (const r of ((commentRows.rows ?? commentRows) as Array<{ capability_id: number; comment_count: number; last_activity: string }>)) {
    const cur = agg.get(r.capability_id) ?? { capabilityId: r.capability_id, commentCount: 0, decisionCount: 0, lastActivity: r.last_activity };
    cur.commentCount = r.comment_count;
    cur.lastActivity = cur.lastActivity > r.last_activity ? cur.lastActivity : r.last_activity;
    agg.set(r.capability_id, cur);
  }
  for (const r of ((decisionRows.rows ?? decisionRows) as Array<{ capability_id: number; decision_count: number; last_activity: string }>)) {
    const cur = agg.get(r.capability_id) ?? { capabilityId: r.capability_id, commentCount: 0, decisionCount: 0, lastActivity: r.last_activity };
    cur.decisionCount = r.decision_count;
    cur.lastActivity = cur.lastActivity > r.last_activity ? cur.lastActivity : r.last_activity;
    agg.set(r.capability_id, cur);
  }

  const capIds = Array.from(agg.keys());
  if (capIds.length === 0) { res.json({ boards: [] }); return; }
  const caps = await db.select({
    id: capabilitiesTable.id,
    name: capabilitiesTable.name,
    slug: capabilitiesTable.slug,
    industryId: capabilitiesTable.industryId,
  }).from(capabilitiesTable).where(inArray(capabilitiesTable.id, capIds));
  const capMap = new Map(caps.map(c => [c.id, c]));

  // Roster — distinct (authorName, authorRole) seen on this session.
  const roster = await db.execute(sql`
    SELECT DISTINCT author_name, author_role
    FROM strategy_comments
    WHERE session_token = ${token}
    UNION
    SELECT DISTINCT decided_by AS author_name, decided_by_role AS author_role
    FROM strategy_decisions
    WHERE session_token = ${token}
  `);
  const members = ((roster.rows ?? roster) as Array<{ author_name: string; author_role: string }>).map(r => ({
    name: r.author_name,
    role: r.author_role,
  }));

  const boards = capIds.map(id => {
    const a = agg.get(id)!;
    const cap = capMap.get(id);
    return {
      capabilityId: id,
      name: cap?.name ?? `Capability ${id}`,
      slug: cap?.slug ?? null,
      commentCount: a.commentCount,
      decisionCount: a.decisionCount,
      lastActivity: a.lastActivity,
    };
  }).sort((x, y) => y.lastActivity.localeCompare(x.lastActivity));

  res.json({ boards, members });
});

// ── COLLABORATION ACTIVITY ──────────────────────────────────────────────
// Returns the latest 40 comments + decisions across the caller's session,
// already grouped by capability. Used by the right-rail "Recent activity"
// panel on /collaboration.

router.get("/collaboration/activity", async (req, res) => {
  const token = typeof req.query.sessionToken === "string" ? req.query.sessionToken : "";
  if (!token) { res.json({ activity: [] }); return; }

  const comments = await db.select({
    id: strategyCommentsTable.id,
    targetType: strategyCommentsTable.targetType,
    targetId: strategyCommentsTable.targetId,
    authorRole: strategyCommentsTable.authorRole,
    authorName: strategyCommentsTable.authorName,
    body: strategyCommentsTable.body,
    resolved: strategyCommentsTable.resolved,
    createdAt: strategyCommentsTable.createdAt,
  }).from(strategyCommentsTable)
    .where(eq(strategyCommentsTable.sessionToken, token))
    .orderBy(desc(strategyCommentsTable.createdAt))
    .limit(40);

  const decisions = await db.select({
    id: strategyDecisionsTable.id,
    capabilityId: strategyDecisionsTable.capabilityId,
    decision: strategyDecisionsTable.decision,
    rationale: strategyDecisionsTable.rationale,
    decidedBy: strategyDecisionsTable.decidedBy,
    decidedByRole: strategyDecisionsTable.decidedByRole,
    createdAt: strategyDecisionsTable.createdAt,
  }).from(strategyDecisionsTable)
    .where(eq(strategyDecisionsTable.sessionToken, token))
    .orderBy(desc(strategyDecisionsTable.createdAt))
    .limit(40);

  const capIds = Array.from(new Set([
    ...comments.filter(c => c.targetType === "capability").map(c => c.targetId),
    ...decisions.map(d => d.capabilityId).filter((v): v is number => v != null),
  ]));
  const caps = capIds.length > 0
    ? await db.select({
        id: capabilitiesTable.id,
        name: capabilitiesTable.name,
        slug: capabilitiesTable.slug,
      }).from(capabilitiesTable).where(inArray(capabilitiesTable.id, capIds))
    : [];
  const capMap = new Map(caps.map(c => [c.id, c]));

  type ActivityItem = {
    kind: "comment" | "decision";
    id: number;
    capabilityId: number | null;
    capabilityName: string | null;
    capabilitySlug: string | null;
    authorName: string;
    authorRole: string;
    body: string;
    decision: string | null;
    resolved: boolean;
    createdAt: string;
  };

  const items: ActivityItem[] = [];
  for (const c of comments) {
    const isCap = c.targetType === "capability";
    const cap = isCap ? capMap.get(c.targetId) : undefined;
    items.push({
      kind: "comment",
      id: c.id,
      capabilityId: isCap ? c.targetId : null,
      capabilityName: cap?.name ?? null,
      capabilitySlug: cap?.slug ?? null,
      authorName: c.authorName,
      authorRole: c.authorRole,
      body: c.body,
      decision: null,
      resolved: c.resolved,
      createdAt: typeof c.createdAt === "string" ? c.createdAt : new Date(c.createdAt as Date).toISOString(),
    });
  }
  for (const d of decisions) {
    const cap = d.capabilityId ? capMap.get(d.capabilityId) : undefined;
    items.push({
      kind: "decision",
      id: d.id,
      capabilityId: d.capabilityId ?? null,
      capabilityName: cap?.name ?? null,
      capabilitySlug: cap?.slug ?? null,
      authorName: d.decidedBy,
      authorRole: d.decidedByRole,
      body: d.rationale,
      decision: d.decision,
      resolved: false,
      createdAt: typeof d.createdAt === "string" ? d.createdAt : new Date(d.createdAt as Date).toISOString(),
    });
  }
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ activity: items.slice(0, 40) });
});

// ── CAPABILITIES LOOKUP — slim list for client-side autotagging ──────────
// Used by the inbox composer to highlight capability mentions inline.
// Returns just slug + name + id; lightweight and cacheable.

router.get("/social/capabilities-lookup", async (_req, res) => {
  const rows = await db.select({
    id: capabilitiesTable.id,
    slug: capabilitiesTable.slug,
    name: capabilitiesTable.name,
  }).from(capabilitiesTable).where(eq(capabilitiesTable.reviewStatus, "approved"));
  res.json({ capabilities: rows });
});

export default router;
