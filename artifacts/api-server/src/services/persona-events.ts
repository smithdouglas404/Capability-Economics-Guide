import { db, personaEventsTable, userPersonasTable, DEFAULT_PERSONA_SLUG, type PersonaEventType } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

type LogPersonaEventArgs = {
  userId: string;
  eventType: PersonaEventType;
  personaSlug: string;
  priorPersonaSlug?: string | null;
  feature?: string | null;
  context?: Record<string, unknown> | null;
};

/**
 * Append a row to persona_events. Fire-and-forget — callers should `void
 * logPersonaEvent(...)` so a logging failure can never fail the underlying
 * route handler. Returns a promise only so tests can await if they care.
 */
export async function logPersonaEvent(args: LogPersonaEventArgs): Promise<void> {
  try {
    await db.insert(personaEventsTable).values({
      userId: args.userId,
      eventType: args.eventType,
      personaSlug: args.personaSlug,
      priorPersonaSlug: args.priorPersonaSlug ?? null,
      feature: args.feature ?? null,
      context: args.context ?? null,
    });
  } catch (err) {
    logger.warn({ err, eventType: args.eventType, userId: args.userId }, "[persona-events] insert failed");
  }
}

/**
 * Resolve the active persona slug for a user, falling back to the platform
 * default. Used by route-entry feature_used logging where we need a persona
 * label on every event but don't want to require the user to have set one.
 * Swallows any DB error and returns the default — never throws.
 */
export async function getActivePersonaForUser(userId: string): Promise<string> {
  try {
    const [row] = await db
      .select({ slug: userPersonasTable.activePersonaSlug })
      .from(userPersonasTable)
      .where(eq(userPersonasTable.userId, userId))
      .limit(1);
    return row?.slug ?? DEFAULT_PERSONA_SLUG;
  } catch {
    return DEFAULT_PERSONA_SLUG;
  }
}

/**
 * Fire-and-forget feature usage logger. Resolves the user's active persona
 * itself so callers don't need to. No-op when userId is null/undefined
 * (anonymous traffic isn't part of the funnel).
 */
export async function logFeatureUsed(args: {
  userId: string | null | undefined;
  feature: string;
  context?: Record<string, unknown> | null;
}): Promise<void> {
  if (!args.userId) return;
  const personaSlug = await getActivePersonaForUser(args.userId);
  await logPersonaEvent({
    userId: args.userId,
    eventType: "feature_used",
    personaSlug,
    feature: args.feature,
    context: args.context ?? null,
  });
}
