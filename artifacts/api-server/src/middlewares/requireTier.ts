import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { userMembershipsTable, membershipTiersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getAuth } from "@clerk/express";

const TIER_RANK: Record<string, number> = {
  discovery: 0,
  briefing: 1,
  workbench: 2,
  platform: 3,
};

/**
 * Middleware factory that requires the user to have an active membership
 * at or above a minimum tier level.
 *
 * Usage: `router.use("/simulation", requireTier("workbench"))`
 * This allows workbench AND platform users (anything >= workbench).
 */
export function requireTier(minimumTier: string) {
  const minRank = TIER_RANK[minimumTier] ?? 0;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Bypass if admin auth bypass is set (local dev)
    if (process.env.ADMIN_AUTH_BYPASS === "1") { next(); return; }

    const auth = getAuth(req);
    const userId = auth?.userId;

    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Find user's active membership
    const [membership] = await db.select({
      status: userMembershipsTable.status,
      tierSlug: membershipTiersTable.slug,
    })
      .from(userMembershipsTable)
      .innerJoin(membershipTiersTable, eq(userMembershipsTable.tierId, membershipTiersTable.id))
      .where(and(
        eq(userMembershipsTable.userId, userId),
        eq(userMembershipsTable.status, "active"),
      ))
      .limit(1);

    // No membership = treat as discovery (free tier)
    const userTier = membership?.tierSlug ?? "discovery";
    const userRank = TIER_RANK[userTier] ?? 0;

    if (userRank < minRank) {
      res.status(403).json({
        error: "Upgrade required",
        currentTier: userTier,
        requiredTier: minimumTier,
        message: `This feature requires the ${minimumTier.charAt(0).toUpperCase() + minimumTier.slice(1)} tier or higher.`,
      });
      return;
    }

    // Attach tier info to request for downstream use
    (req as any).userTier = userTier;
    (req as any).userId = userId;
    next();
  };
}
