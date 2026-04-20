import { clerkClient } from "@clerk/express";
import { db, userMembershipsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";

export type ClerkUserSummary = {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;   // best-effort "First Last" or email or truncated id
  imageUrl: string | null;
  createdAt: number | null;
  lastSignInAt: number | null;
};

const cache = new Map<string, { summary: ClerkUserSummary; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — profile data doesn't change often

/**
 * Resolve a Clerk user id to a rich profile summary. Cached for 5 minutes.
 * Never throws — returns a minimal fallback object if Clerk is unreachable.
 */
export async function getClerkUserSummary(userId: string): Promise<ClerkUserSummary> {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.summary;

  let summary: ClerkUserSummary = {
    userId,
    email: null,
    firstName: null,
    lastName: null,
    displayName: userId.slice(0, 16),
    imageUrl: null,
    createdAt: null,
    lastSignInAt: null,
  };

  try {
    const user = await clerkClient.users.getUser(userId);
    const email = user.primaryEmailAddress?.emailAddress
      ?? user.emailAddresses[0]?.emailAddress
      ?? null;
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    summary = {
      userId,
      email,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      displayName: fullName || user.username || email || userId.slice(0, 16),
      imageUrl: user.imageUrl ?? null,
      createdAt: user.createdAt ?? null,
      lastSignInAt: user.lastSignInAt ?? null,
    };

    // Opportunistically backfill user_memberships rows that are missing
    // email/name. Non-blocking — runs in the background, never delays the
    // caller and never throws.
    if (email || fullName) {
      db.update(userMembershipsTable)
        .set({ userEmail: email, userName: fullName || null })
        .where(and(
          eq(userMembershipsTable.userId, userId),
          isNull(userMembershipsTable.userEmail),
        ))
        .catch(err => logger.warn({ err, userId }, "[clerk-user] backfill failed"));
    }
  } catch (err) {
    logger.warn({ err, userId }, "[clerk-user] getUser failed — returning fallback");
  }

  cache.set(userId, { summary, expiresAt: Date.now() + CACHE_TTL_MS });
  return summary;
}

/** Batch variant — dedupes userIds and fetches in parallel. */
export async function getClerkUserSummaries(userIds: string[]): Promise<Map<string, ClerkUserSummary>> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  const results = await Promise.all(unique.map(id => getClerkUserSummary(id)));
  const map = new Map<string, ClerkUserSummary>();
  results.forEach((s, i) => map.set(unique[i], s));
  return map;
}

/** Invalidate the cache for one user (call after admin-initiated profile edits, impersonation setup, etc.). */
export function invalidateClerkUserCache(userId: string): void {
  cache.delete(userId);
}
