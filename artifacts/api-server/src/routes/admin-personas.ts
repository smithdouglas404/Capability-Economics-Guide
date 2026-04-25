import { Router, type IRouter } from "express";
import { db, personaEventsTable } from "@workspace/db";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAdmin";

const router: IRouter = Router();

const SIGNUP_EVENT_TYPES = ["first_set", "applied_from_org_invite"] as const;
const FEATURE_USE_LIMIT = 20;

function parseSince(raw: unknown): Date {
  if (typeof raw === "string" && raw.trim()) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  // Default: last 30 days.
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

/**
 * GET /api/admin/personas/funnel?since=ISO
 *
 * Aggregates persona_events into the four funnel views the admin dashboard
 * renders:
 *   - signups        per persona (first_set + applied_from_org_invite)
 *   - switches       per (from → to) persona pair
 *   - featureUse     per (persona × feature), top 20 by hit count
 *   - activeUsers    per persona (distinct user ids with any event in window)
 *
 * Window default is last 30 days when `since` is missing or unparseable.
 */
router.get("/admin/personas/funnel", requireAdmin, async (req, res) => {
  const since = parseSince(req.query.since);

  const baseWhere = gte(personaEventsTable.createdAt, since);

  const [signupRows, switchRows, featureRows, activeRows] = await Promise.all([
    db
      .select({
        personaSlug: personaEventsTable.personaSlug,
        count: sql<number>`count(*)::int`,
      })
      .from(personaEventsTable)
      .where(and(baseWhere, inArray(personaEventsTable.eventType, [...SIGNUP_EVENT_TYPES])))
      .groupBy(personaEventsTable.personaSlug),

    db
      .select({
        fromSlug: personaEventsTable.priorPersonaSlug,
        toSlug: personaEventsTable.personaSlug,
        count: sql<number>`count(*)::int`,
      })
      .from(personaEventsTable)
      .where(and(baseWhere, eq(personaEventsTable.eventType, "switched")))
      .groupBy(personaEventsTable.priorPersonaSlug, personaEventsTable.personaSlug)
      .orderBy(desc(sql`count(*)`)),

    db
      .select({
        personaSlug: personaEventsTable.personaSlug,
        feature: personaEventsTable.feature,
        count: sql<number>`count(*)::int`,
      })
      .from(personaEventsTable)
      .where(and(
        baseWhere,
        eq(personaEventsTable.eventType, "feature_used"),
        sql`${personaEventsTable.feature} is not null`,
      ))
      .groupBy(personaEventsTable.personaSlug, personaEventsTable.feature)
      .orderBy(desc(sql`count(*)`))
      .limit(FEATURE_USE_LIMIT),

    db
      .select({
        personaSlug: personaEventsTable.personaSlug,
        users: sql<number>`count(distinct ${personaEventsTable.userId})::int`,
      })
      .from(personaEventsTable)
      .where(baseWhere)
      .groupBy(personaEventsTable.personaSlug),
  ]);

  const totalSignups = signupRows.reduce((s, r) => s + (r.count ?? 0), 0);
  const signups = signupRows
    .map((r) => ({
      personaSlug: r.personaSlug,
      count: r.count,
      pctOfTotal: totalSignups > 0 ? Math.round((r.count / totalSignups) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const switches = switchRows.map((r) => ({
    fromSlug: r.fromSlug ?? "(none)",
    toSlug: r.toSlug,
    count: r.count,
  }));

  const featureUse = featureRows.map((r) => ({
    personaSlug: r.personaSlug,
    feature: r.feature ?? "(unknown)",
    count: r.count,
  }));

  const activeUsers = activeRows
    .map((r) => ({ personaSlug: r.personaSlug, users: r.users }))
    .sort((a, b) => b.users - a.users);

  res.json({
    since: since.toISOString(),
    totals: { signups: totalSignups, switches: switchRows.length, featureUseRows: featureRows.length },
    signups,
    switches,
    featureUse,
    activeUsers,
  });
});

export default router;
