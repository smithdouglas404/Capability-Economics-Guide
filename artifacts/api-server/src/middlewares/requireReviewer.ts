import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";

export type Reviewer = {
  userId: string;
  displayName: string;
  email: string | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      reviewer?: Reviewer;
    }
  }
}

const reviewerCache = new Map<string, { reviewer: Reviewer; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

async function loadReviewer(userId: string): Promise<Reviewer> {
  const cached = reviewerCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.reviewer;
  let displayName = userId;
  let email: string | null = null;
  try {
    const user = await clerkClient.users.getUser(userId);
    email = user.primaryEmailAddress?.emailAddress
      ?? user.emailAddresses[0]?.emailAddress
      ?? null;
    const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    displayName = fullName || user.username || email || userId;
  } catch {
    // fall back to the raw user id if Clerk lookup fails
  }
  const reviewer: Reviewer = { userId, displayName, email };
  reviewerCache.set(userId, { reviewer, expiresAt: Date.now() + CACHE_TTL_MS });
  return reviewer;
}

/**
 * Require a signed-in Clerk user. The shared ADMIN_API_KEY is honored only as a
 * break-glass fallback — when supplied, the request is attributed to a generic
 * "shared-key admin" identity so audit trails still flag it.
 */
export function requireReviewer() {
  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const auth = getAuth(req);
      const userId = auth?.userId;
      if (userId) {
        req.reviewer = await loadReviewer(userId);
        next();
        return;
      }

      // Break-glass: shared admin key. Allowed but clearly attributed.
      const expected = process.env.ADMIN_API_KEY;
      const provided = req.headers["x-admin-key"];
      if (expected && typeof provided === "string" && provided === expected) {
        req.reviewer = {
          userId: "shared-admin-key",
          displayName: "shared admin key (break-glass)",
          email: null,
        };
        next();
        return;
      }

      res.status(401).json({ error: "Unauthorized" });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "auth failed" });
    }
  };
}
