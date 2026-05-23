/**
 * Forum routes — Move 8 of the strategic UX overhaul.
 *
 *   GET   /api/forums/:industrySlug/threads        — list of threads in industry
 *   POST  /api/forums/:industrySlug/threads        — create thread (auth)
 *   GET   /api/forums/threads/:id                  — thread + posts
 *   POST  /api/forums/threads/:id/posts            — reply (auth, not-locked)
 *   PATCH /api/forums/threads/:id/lock             — author or admin locks the thread
 *
 * Author display names are captured at write time from Clerk so the list
 * view doesn't need a Clerk lookup per row.
 */
import { Router, type IRouter } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, forumThreadsTable, forumPostsTable, industriesTable, memberProfilesTable, capabilitiesTable } from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { autoTagCapabilities } from "../services/capability-autotag";

const router: IRouter = Router();

async function resolveDisplayName(userId: string): Promise<string> {
  // Prefer the member-profile display name (canonical) over the Clerk
  // attributes — keeps the forum identity consistent with /member/:slug.
  const [profile] = await db.select({ displayName: memberProfilesTable.displayName }).from(memberProfilesTable).where(eq(memberProfilesTable.userId, userId)).limit(1);
  if (profile?.displayName) return profile.displayName;
  try {
    const user = await clerkClient.users.getUser(userId);
    const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    return full || user.username || user.primaryEmailAddress?.emailAddress || userId;
  } catch {
    return userId;
  }
}

router.get("/forums/:industrySlug/threads", async (req, res) => {
  const slug = String(req.params.industrySlug);
  // Optional capability filter — narrows the thread list to threads whose
  // auto-tagged `capabilityTags` array contains this slug. Used by the
  // "Filter by capability" dropdown on /forum/:industrySlug.
  const capabilitySlug = typeof req.query.capabilitySlug === "string"
    ? req.query.capabilitySlug.trim().slice(0, 200)
    : "";
  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.slug, slug)).limit(1);
  if (!industry) { res.status(404).json({ error: "industry not found" }); return; }

  const whereClause = capabilitySlug
    ? and(
        eq(forumThreadsTable.industryId, industry.id),
        sql`${forumThreadsTable.capabilityTags} ?| ARRAY[${capabilitySlug}]::text[]`,
      )
    : eq(forumThreadsTable.industryId, industry.id);

  const threads = await db
    .select({
      id: forumThreadsTable.id,
      title: forumThreadsTable.title,
      body: forumThreadsTable.body,
      authorUserId: forumThreadsTable.authorUserId,
      authorDisplayName: forumThreadsTable.authorDisplayName,
      lockedAt: forumThreadsTable.lockedAt,
      postCount: forumThreadsTable.postCount,
      lastPostAt: forumThreadsTable.lastPostAt,
      createdAt: forumThreadsTable.createdAt,
      capabilityTags: forumThreadsTable.capabilityTags,
    })
    .from(forumThreadsTable)
    .where(whereClause)
    .orderBy(desc(forumThreadsTable.lastPostAt))
    .limit(100);

  // Hydrate {slug → name} for chip labels so the client doesn't need a
  // second round-trip. Restricted to slugs that actually appear in this
  // industry's thread set — keeps the payload bounded.
  const allTagSlugs = Array.from(new Set(threads.flatMap(t => t.capabilityTags ?? [])));
  const tagCaps = allTagSlugs.length > 0
    ? await db.select({ id: capabilitiesTable.id, slug: capabilitiesTable.slug, name: capabilitiesTable.name })
        .from(capabilitiesTable)
        .where(inArray(capabilitiesTable.slug, allTagSlugs))
    : [];
  const capLookup = Object.fromEntries(tagCaps.map(c => [c.slug, { id: c.id, name: c.name }]));

  // Distinct capability dropdown options for the filter — only capabilities
  // that at least one thread in this industry actually mentions.
  const filterOptions = tagCaps.map(c => ({ slug: c.slug, name: c.name, id: c.id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({
    industry: { id: industry.id, slug: industry.slug, name: industry.name },
    threads,
    capabilityLookup: capLookup,
    filterOptions,
    activeCapabilityFilter: capabilitySlug || null,
  });
});

router.post("/forums/:industrySlug/threads", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const slug = String(req.params.industrySlug);
  const [industry] = await db.select().from(industriesTable).where(eq(industriesTable.slug, slug)).limit(1);
  if (!industry) { res.status(404).json({ error: "industry not found" }); return; }
  const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 280) : "";
  const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 8000) : "";
  const capabilityIdRaw = req.body?.capabilityId;
  const capabilityId = Number.isFinite(Number(capabilityIdRaw)) ? Number(capabilityIdRaw) : null;
  if (title.length < 4 || body.length < 4) { res.status(400).json({ error: "Title and body are required (min 4 chars each)." }); return; }
  const authorDisplayName = await resolveDisplayName(auth.userId);

  // Auto-tag capabilities mentioned in the OP. Scan title + body together so
  // a one-word title like "Underwriting" still maps. Best-effort — never
  // block thread creation on autotag failure.
  let capabilityTags: string[] = [];
  try {
    capabilityTags = await autoTagCapabilities(`${title}\n${body}`);
  } catch {
    capabilityTags = [];
  }

  const [row] = await db.insert(forumThreadsTable).values({
    industryId: industry.id,
    capabilityId,
    authorUserId: auth.userId,
    authorDisplayName,
    title,
    body,
    capabilityTags,
  }).returning();
  res.json({ thread: row });
});

router.get("/forums/threads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [thread] = await db.select({
    id: forumThreadsTable.id,
    industryId: forumThreadsTable.industryId,
    industrySlug: industriesTable.slug,
    industryName: industriesTable.name,
    capabilityId: forumThreadsTable.capabilityId,
    title: forumThreadsTable.title,
    body: forumThreadsTable.body,
    authorUserId: forumThreadsTable.authorUserId,
    authorDisplayName: forumThreadsTable.authorDisplayName,
    lockedAt: forumThreadsTable.lockedAt,
    postCount: forumThreadsTable.postCount,
    lastPostAt: forumThreadsTable.lastPostAt,
    createdAt: forumThreadsTable.createdAt,
    capabilityTags: forumThreadsTable.capabilityTags,
  })
    .from(forumThreadsTable)
    .innerJoin(industriesTable, eq(industriesTable.id, forumThreadsTable.industryId))
    .where(eq(forumThreadsTable.id, id))
    .limit(1);
  if (!thread) { res.status(404).json({ error: "thread not found" }); return; }
  const posts = await db.select().from(forumPostsTable).where(eq(forumPostsTable.threadId, id)).orderBy(forumPostsTable.createdAt);

  // Resolve {slug → {id, name}} so the detail-view chips link to /capability/:id.
  const tagSlugs = thread.capabilityTags ?? [];
  const tagCaps = tagSlugs.length > 0
    ? await db.select({ id: capabilitiesTable.id, slug: capabilitiesTable.slug, name: capabilitiesTable.name })
        .from(capabilitiesTable)
        .where(inArray(capabilitiesTable.slug, tagSlugs))
    : [];
  const capabilityLookup = Object.fromEntries(tagCaps.map(c => [c.slug, { id: c.id, name: c.name }]));

  res.json({ thread, posts, capabilityLookup });
});

router.post("/forums/threads/:id/posts", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const body = typeof req.body?.body === "string" ? req.body.body.trim().slice(0, 8000) : "";
  if (body.length < 4) { res.status(400).json({ error: "Body required (min 4 chars)." }); return; }
  const [thread] = await db.select({ lockedAt: forumThreadsTable.lockedAt }).from(forumThreadsTable).where(eq(forumThreadsTable.id, id)).limit(1);
  if (!thread) { res.status(404).json({ error: "thread not found" }); return; }
  if (thread.lockedAt) { res.status(403).json({ error: "thread is locked" }); return; }
  const authorDisplayName = await resolveDisplayName(auth.userId);
  const [post] = await db.insert(forumPostsTable).values({
    threadId: id,
    authorUserId: auth.userId,
    authorDisplayName,
    body,
  }).returning();
  // Denormalize: bump postCount + lastPostAt so the list view stays accurate
  // without a count(*) on every list render.
  await db.update(forumThreadsTable).set({
    postCount: sql`${forumThreadsTable.postCount} + 1`,
    lastPostAt: new Date(),
  }).where(eq(forumThreadsTable.id, id));
  res.json({ post });
});

router.patch("/forums/threads/:id/lock", async (req, res) => {
  const auth = getAuth(req);
  if (!auth.userId) { res.status(401).json({ error: "Sign in" }); return; }
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "bad id" }); return; }
  const [thread] = await db.select({ authorUserId: forumThreadsTable.authorUserId, lockedAt: forumThreadsTable.lockedAt }).from(forumThreadsTable).where(eq(forumThreadsTable.id, id)).limit(1);
  if (!thread) { res.status(404).json({ error: "thread not found" }); return; }
  // Only the original author can lock for now (admin override is a follow-up).
  if (thread.authorUserId !== auth.userId) { res.status(403).json({ error: "Only the thread author can lock this thread." }); return; }
  await db.update(forumThreadsTable).set({ lockedAt: thread.lockedAt ? null : new Date() }).where(eq(forumThreadsTable.id, id));
  res.json({ ok: true, lockedAt: thread.lockedAt ? null : new Date().toISOString() });
});

export default router;
