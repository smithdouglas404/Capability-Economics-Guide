/**
 * Learning & personalization endpoints — Phase A2 of the AI learning loop.
 *
 * These endpoints let the frontend log every meaningful user interaction so
 * the AI can reference past behavior across sessions, and let the AI inject
 * personal context into its outputs.
 *
 * Routes:
 *   POST /api/me/log-interaction       — log a page view, AI stream, search, etc.
 *   GET  /api/me/learning-profile      — get the user's learning vector (interests, history count)
 *   GET  /api/me/learning/whats-changed — what's new since the user's last visit
 *   POST /api/me/feedback              — thumbs up/down on an AI output
 *   POST /api/me/learning/sync-persona — sync persona from localStorage to server
 *   POST /api/me/learning/suggest-persona — suggest a persona shift based on behavior
 */
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, userInteractionLogTable, userLearningProfilesTable, aiFeedbackTable } from "@workspace/db";
import { eq, and, desc, sql, gt } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Computes (or refreshes) the user learning profile from the interaction log.
 * Called on every log-interaction write so the profile is always fresh.
 */
async function refreshLearningProfile(userId: string): Promise<void> {
  try {
    // Aggregate top industries
    const industryCounts = await db
      .select({
        slug: sql<string>`metadata->>'industry_slug'`,
        name: sql<string>`metadata->>'industry_name'`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(userInteractionLogTable)
      .where(
        and(
          eq(userInteractionLogTable.userId, userId),
          sql`metadata->>'industry_slug' IS NOT NULL`,
        ),
      )
      .groupBy(sql`metadata->>'industry_slug'`, sql`metadata->>'industry_name'`)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(10);

    // Aggregate top capabilities
    const capCounts = await db
      .select({
        id: sql<number>`(metadata->>'capability_id')::int`,
        name: sql<string>`metadata->>'capability_name'`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(userInteractionLogTable)
      .where(
        and(
          eq(userInteractionLogTable.userId, userId),
          sql`metadata->>'capability_id' IS NOT NULL`,
        ),
      )
      .groupBy(sql`(metadata->>'capability_id')::int`, sql`metadata->>'capability_name'`)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(10);

    // Counts
    const [countRow] = await db
      .select({
        genCount: sql<number>`COUNT(*) FILTER (WHERE type = 'ai_stream')::int`,
        pageCount: sql<number>`COUNT(*) FILTER (WHERE type = 'page_view')::int`,
      })
      .from(userInteractionLogTable)
      .where(eq(userInteractionLogTable.userId, userId));

    // Current persona from the profile
    const [existing] = await db
      .select({ persona: userLearningProfilesTable.persona })
      .from(userLearningProfilesTable)
      .where(eq(userLearningProfilesTable.userId, userId))
      .limit(1);

    await db
      .insert(userLearningProfilesTable)
      .values({
        userId,
        persona: existing?.persona ?? null,
        topIndustries: industryCounts.map(r => ({ slug: r.slug, name: r.name, count: r.count })),
        topCapabilities: capCounts.map(r => ({ id: r.id, name: r.name, count: r.count })),
        topTopics: [],
        totalAiGenerations: countRow?.genCount ?? 0,
        totalPageViews: countRow?.pageCount ?? 0,
        lastVisitedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userLearningProfilesTable.userId,
        set: {
          topIndustries: sql`EXCLUDED.top_industries`,
          topCapabilities: sql`EXCLUDED.top_capabilities`,
          totalAiGenerations: sql`EXCLUDED.total_ai_generations`,
          totalPageViews: sql`EXCLUDED.total_page_views`,
          lastVisitedAt: sql`EXCLUDED.last_visited_at`,
          updatedAt: sql`EXCLUDED.updated_at`,
        },
      });
  } catch (err) {
    logger.error({ err, userId }, "[learning] refreshLearningProfile failed");
  }
}

// ─── POST /api/me/log-interaction ──────────────────────────────────────────

router.post("/me/log-interaction", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { type, label, metadata } = req.body ?? {};
    if (!type || !label) { res.status(400).json({ error: "type and label required" }); return; }

    const [row] = await db
      .insert(userInteractionLogTable)
      .values({
        userId: auth.userId,
        type: String(type).slice(0, 50),
        label: String(label).slice(0, 500),
        metadata: (metadata ?? {}) as Record<string, unknown>,
      })
      .returning({ id: userInteractionLogTable.id });

    // Refresh the learning profile asynchronously — non-blocking so the
    // frontend gets a quick response. The profile is eventually consistent.
    void refreshLearningProfile(auth.userId);

    res.json({ ok: true, id: row.id });
  } catch (err) {
    logger.error({ err }, "[me/log-interaction] failed");
    res.status(500).json({ error: "Failed to log interaction" });
  }
});

// ─── GET /api/me/learning-profile ──────────────────────────────────────────

router.get("/me/learning-profile", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    let [profile] = await db
      .select()
      .from(userLearningProfilesTable)
      .where(eq(userLearningProfilesTable.userId, auth.userId))
      .limit(1);

    if (!profile) {
      // First time — create a bare profile and return it
      const [created] = await db
        .insert(userLearningProfilesTable)
        .values({ userId: auth.userId, lastVisitedAt: new Date() })
        .returning();
      profile = created;
    } else {
      // Touch lastVisitedAt
      await db
        .update(userLearningProfilesTable)
        .set({ lastVisitedAt: new Date() })
        .where(eq(userLearningProfilesTable.userId, auth.userId));
    }

    // Also return recent interactions for the timeline view
    const recentInteractions = await db
      .select()
      .from(userInteractionLogTable)
      .where(eq(userInteractionLogTable.userId, auth.userId))
      .orderBy(desc(userInteractionLogTable.createdAt))
      .limit(100);

    res.json({ profile, recentInteractions });
  } catch (err) {
    logger.error({ err }, "[me/learning-profile] failed");
    res.status(500).json({ error: "Failed to load learning profile" });
  }
});

// ─── POST /api/me/feedback ─────────────────────────────────────────────────

router.post("/me/feedback", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { interactionLogId, liked, comment, endpoint } = req.body ?? {};
    if (interactionLogId == null || liked == null) {
      res.status(400).json({ error: "interactionLogId and liked required" });
      return;
    }

    // Upsert — one feedback per (user, log). If they already gave feedback,
    // update it (allows changing from thumbs up → thumbs down).
    await db
      .insert(aiFeedbackTable)
      .values({
        userId: auth.userId,
        interactionLogId: Number(interactionLogId),
        liked: Boolean(liked),
        comment: comment ? String(comment).slice(0, 2000) : null,
        endpoint: endpoint ? String(endpoint).slice(0, 200) : null,
      })
      .onConflictDoUpdate({
        target: [aiFeedbackTable.userId, aiFeedbackTable.interactionLogId],
        set: {
          liked: sql`EXCLUDED.liked`,
          comment: sql`EXCLUDED.comment`,
        },
      });

    // Log the feedback itself as an interaction so the profile captures it
    await db.insert(userInteractionLogTable).values({
      userId: auth.userId,
      type: "ai_feedback",
      label: liked ? "Liked AI output" : "Disliked AI output",
      metadata: { interactionLogId, liked, endpoint },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[me/feedback] failed");
    res.status(500).json({ error: "Failed to record feedback" });
  }
});

// ─── POST /api/me/learning/sync-persona ────────────────────────────────────

router.post("/me/learning/sync-persona", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { persona } = req.body ?? {};
    const validPersonas = ["pe", "vc", "f500", "student", "professor"];

    if (persona && !validPersonas.includes(persona)) {
      res.status(400).json({ error: "Invalid persona" });
      return;
    }

    await db
      .insert(userLearningProfilesTable)
      .values({
        userId: auth.userId,
        persona: persona ?? null,
        lastVisitedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userLearningProfilesTable.userId,
        set: {
          persona: sql`EXCLUDED.persona`,
          lastVisitedAt: sql`EXCLUDED.last_visited_at`,
          updatedAt: sql`EXCLUDED.updated_at`,
        },
      });

    // Log the persona change as an interaction
    await db.insert(userInteractionLogTable).values({
      userId: auth.userId,
      type: "persona_change",
      label: `Changed persona to ${persona ?? "none"}`,
      metadata: { persona },
    });

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[me/learning/sync-persona] failed");
    res.status(500).json({ error: "Failed to sync persona" });
  }
});

// ─── GET /api/me/learning/whats-changed ────────────────────────────────────

router.get("/me/learning/whats-changed", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    // Get the user's profile with last visit time
    const [profile] = await db
      .select()
      .from(userLearningProfilesTable)
      .where(eq(userLearningProfilesTable.userId, auth.userId))
      .limit(1);

    if (!profile || !profile.lastVisitedAt) {
      // First visit — nothing has "changed"
      res.json({ isNewUser: true, newInteractions: [], newCapabilitiesSeen: [], newIndustriesSeen: [], hasChanges: false });
      return;
    }

    const since = profile.lastVisitedAt;

    // 1. NEW interactions since last visit
    const newInteractions = await db
      .select()
      .from(userInteractionLogTable)
      .where(
        and(
          eq(userInteractionLogTable.userId, auth.userId),
          gt(userInteractionLogTable.createdAt, since),
        ),
      )
      .orderBy(desc(userInteractionLogTable.createdAt))
      .limit(20);

    // 2. New capabilities the user has explored since last visit
    // Compare current topCapabilities against ones they had before
    const capabilitiesBefore = profile.topCapabilities ?? [];
    const capabilitiesNow = await db
      .select({
        id: sql<number>`(metadata->>'capability_id')::int`,
        name: sql<string>`metadata->>'capability_name'`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(userInteractionLogTable)
      .where(
        and(
          eq(userInteractionLogTable.userId, auth.userId),
          sql`metadata->>'capability_id' IS NOT NULL`,
        ),
      )
      .groupBy(sql`(metadata->>'capability_id')::int`, sql`metadata->>'capability_name'`)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(10);

    const beforeIds = new Set(capabilitiesBefore.map(c => c.id));
    const newCapabilities = capabilitiesNow.filter(c => !beforeIds.has(c.id));

    // 3. New industries explored
    const industriesBefore = profile.topIndustries ?? [];
    const industriesNow = await db
      .select({
        slug: sql<string>`metadata->>'industry_slug'`,
        name: sql<string>`metadata->>'industry_name'`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(userInteractionLogTable)
      .where(
        and(
          eq(userInteractionLogTable.userId, auth.userId),
          sql`metadata->>'industry_slug' IS NOT NULL`,
        ),
      )
      .groupBy(sql`metadata->>'industry_slug'`, sql`metadata->>'industry_name'`)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(10);

    const beforeIndustrySlugs = new Set(industriesBefore.map(i => i.slug));
    const newIndustries = industriesNow.filter(i => !beforeIndustrySlugs.has(i.slug));

    // 4. Count of AI generations since last visit
    const [genCountRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(userInteractionLogTable)
      .where(
        and(
          eq(userInteractionLogTable.userId, auth.userId),
          eq(userInteractionLogTable.type, "ai_stream"),
          gt(userInteractionLogTable.createdAt, since),
        ),
      );

    // 5. Count of page views since last visit
    const [pageCountRow] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(userInteractionLogTable)
      .where(
        and(
          eq(userInteractionLogTable.userId, auth.userId),
          eq(userInteractionLogTable.type, "page_view"),
          gt(userInteractionLogTable.createdAt, since),
        ),
      );

    // 6. Feedback summary — how many AI outputs they've liked/disliked
    const [feedbackLiked] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(aiFeedbackTable)
      .where(
        and(
          eq(aiFeedbackTable.userId, auth.userId),
          eq(aiFeedbackTable.liked, true),
          gt(aiFeedbackTable.createdAt, since),
        ),
      );
    const [feedbackDisliked] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(aiFeedbackTable)
      .where(
        and(
          eq(aiFeedbackTable.userId, auth.userId),
          eq(aiFeedbackTable.liked, false),
          gt(aiFeedbackTable.createdAt, since),
        ),
      );

    const hasChanges = newInteractions.length > 0 || genCountRow.count > 0 || pageCountRow.count > 0;

    res.json({
      isNewUser: false,
      hasChanges,
      lastVisitedAt: since.toISOString(),
      newInteractions,
      newCapabilitiesSeen: newCapabilities,
      newIndustriesSeen: newIndustries,
      newAiGenerations: genCountRow?.count ?? 0,
      newPageViews: pageCountRow?.count ?? 0,
      feedbackLiked: feedbackLiked?.count ?? 0,
      feedbackDisliked: feedbackDisliked?.count ?? 0,
    });
  } catch (err) {
    logger.error({ err }, "[me/learning/whats-changed] failed");
    res.status(500).json({ error: "Failed to load changes" });
  }
});

// ─── POST /api/me/learning/suggest-persona ─────────────────────────────────

router.post("/me/learning/suggest-persona", async (req, res) => {
  try {
    const auth = getAuth(req);
    if (!auth.userId) { res.status(401).json({ error: "Unauthorized" }); return; }

    const [profile] = await db
      .select()
      .from(userLearningProfilesTable)
      .where(eq(userLearningProfilesTable.userId, auth.userId))
      .limit(1);

    if (!profile) {
      res.json({ suggestion: null, reason: null });
      return;
    }

    // Analyze behavior patterns to suggest a persona
    const currentPersona = profile.persona;

    // Count how many industries they've explored
    const industryCount = profile.topIndustries?.length ?? 0;
    const capCount = profile.topCapabilities?.length ?? 0;
    const genCount = profile.totalAiGenerations ?? 0;
    const pageViews = profile.totalPageViews ?? 0;

    // Simple heuristic-based persona suggestion
    // If they're exploring many industries/caps, suggest PE/VC
    // If they're deep in one industry, suggest F500
    // If low usage, no suggestion yet
    let suggestion: string | null = null;
    let reason: string | null = null;

    if (currentPersona === "student" && industryCount > 3) {
      suggestion = "pe";
      reason = "You're exploring multiple industries broadly — typical of an investor mindset.";
    } else if (currentPersona === "professor" && genCount > 10) {
      suggestion = "vc";
      reason = "You're generating many strategic briefs — the VC persona's focus on opportunity identification fits.";
    } else if (currentPersona === "f500" && industryCount > 5) {
      suggestion = "pe";
      reason = "You're looking across more industries than typical for a single-company strategist — PE's cross-portfolio view may fit better.";
    } else if (currentPersona === "vc" && industryCount <= 2 && capCount > 10) {
      suggestion = "f500";
      reason = "You're going deep into specific capabilities rather than scanning — the F500 build/buy/partner frame might serve you better.";
    } else if (!currentPersona && pageViews > 20) {
      if (industryCount > 4) {
        suggestion = "pe";
        reason = "You're exploring broadly across industries — the PE deal-sourcing perspective is a great starting point.";
      } else if (capCount > 5) {
        suggestion = "f500";
        reason = "You're diving deep into specific capabilities — the F500 strategic planning view fits.";
      }
    }

    res.json({ suggestion, reason, currentPersona });
  } catch (err) {
    logger.error({ err }, "[me/learning/suggest-persona] failed");
    res.json({ suggestion: null, reason: null, currentPersona: null, error: err instanceof Error ? err.message : "unknown" });
  }
});

export default router;
