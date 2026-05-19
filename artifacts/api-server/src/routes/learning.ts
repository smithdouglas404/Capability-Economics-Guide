/**
 * Learning & personalization endpoints — Phase A2 of the AI learning loop.
 *
 * These endpoints let the frontend log every meaningful user interaction so
 * the AI can reference past behavior across sessions, and let the AI inject
 * personal context into its outputs.
 *
 * Routes:
 *   POST /api/me/log-interaction     — log a page view, AI stream, search, etc.
 *   GET  /api/me/learning-profile    — get the user's learning vector (interests, history count)
 *   POST /api/me/feedback            — thumbs up/down on an AI output
 *   POST /api/me/learning/sync-persona — sync persona from localStorage to server
 */
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, userInteractionLogTable, userLearningProfilesTable, aiFeedbackTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
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

export default router;
